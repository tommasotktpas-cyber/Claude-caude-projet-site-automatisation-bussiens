'use strict';
const express = require('express');
const { one, all, run } = require('../db');
const T = require('../time');
const { getSlots, nextAvailableDays } = require('../availability');
const { createBooking, cancelBooking, rescheduleBooking, HttpError, clean, EMAIL_RE } = require('../bookings');
const { rateLimit, randomToken } = require('../auth');
const { buildIcs } = require('../ics');
const payments = require('../payments');
const billing = require('../billing');
const { APP_URL } = require('../notifications');

/** Opens a Stripe Checkout for a booking's deposit (charged on the salon's own Stripe account). */
async function depositSession(booking) {
  const salon = one('SELECT * FROM salons WHERE id = ?', booking.salon_id);
  const service = one('SELECT name FROM services WHERE id = ?', booking.service_id);
  const client = one('SELECT email FROM clients WHERE id = ?', booking.client_id);
  const session = await payments.depositCheckout({
    salon, booking, serviceName: service.name, customerEmail: client.email,
    successUrl: `${APP_URL}/rdv.html?t=${booking.token}&paid=1`,
    cancelUrl: `${APP_URL}/rdv.html?t=${booking.token}&paid=0`,
  });
  run('UPDATE bookings SET stripe_session_id = ? WHERE id = ?', session.id, booking.id);
  return session.url;
}

const router = express.Router();

const RATING_SQL = `(SELECT ROUND(AVG(rating), 1) FROM reviews r WHERE r.salon_id = s.id) AS rating,
  (SELECT COUNT(*) FROM reviews r WHERE r.salon_id = s.id) AS review_count`;

function salonBySlug(slug) {
  const salon = one('SELECT * FROM salons WHERE slug = ? AND published = 1', String(slug));
  if (!salon) throw new HttpError(404, 'Salon introuvable.');
  return salon;
}

function publicSalon(s) {
  const {
    ical_token, owner_id, trial_ends_at, plan, stripe_customer_id, stripe_subscription_id, stripe_account_id, stripe_charges_enabled,
    boost_until, boost_subscription_id, ai_forward_phone, ai_twilio_number, ai_instructions, ai_ring_seconds, ...rest
  } = s;
  rest.chat_enabled = 1; // the chat always reaches someone: the AI, or the team
  // Deposits are only announced when they can actually be collected.
  if (billing.depositMode(s) === 'off') rest.deposit_percent = 0;
  rest.online_booking = billing.salonActive(s);
  return rest;
}

router.get('/meta', (_req, res) => {
  res.json({
    categories: all("SELECT category, COUNT(*) AS n FROM salons WHERE published = 1 GROUP BY category ORDER BY n DESC"),
    cities: all("SELECT city, COUNT(*) AS n FROM salons WHERE published = 1 AND city != '' GROUP BY city ORDER BY n DESC"),
    stats: one(`SELECT (SELECT COUNT(*) FROM salons WHERE published = 1) AS salons,
                       (SELECT COUNT(*) FROM bookings) AS bookings,
                       (SELECT ROUND(AVG(rating),1) FROM reviews) AS rating`),
  });
});

router.get('/salons', (req, res) => {
  const q = clean(req.query.q, 80).toLowerCase();
  const city = clean(req.query.city, 80);
  const category = clean(req.query.category, 40);
  const sort = req.query.sort;
  const now = T.now();
  const wd = T.weekday(now.date);

  const where = ['s.published = 1'];
  const params = [];
  if (city) { where.push('s.city = ? COLLATE NOCASE'); params.push(city); }
  if (category) { where.push('s.category = ?'); params.push(category); }
  if (q) {
    where.push(`(lower(s.name) LIKE ? OR lower(s.description) LIKE ? OR lower(s.city) LIKE ?
      OR EXISTS (SELECT 1 FROM services sv WHERE sv.salon_id = s.id AND sv.active = 1 AND lower(sv.name) LIKE ?))`);
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  let rows = all(
    `SELECT s.*, ${RATING_SQL},
       (SELECT MIN(price_cents) FROM services sv WHERE sv.salon_id = s.id AND sv.active = 1) AS min_price,
       (SELECT COUNT(*) FROM opening_hours h WHERE h.salon_id = s.id AND h.weekday = ? AND h.open <= ? AND h.close > ?) AS open_now
     FROM salons s WHERE ${where.join(' AND ')}`,
    wd, now.time, now.time, ...params,
  );
  if (req.query.open === '1') rows = rows.filter((r) => r.open_now);
  const sorters = {
    rating: (a, b) => (b.rating || 0) - (a.rating || 0) || b.review_count - a.review_count,
    price: (a, b) => (a.min_price ?? 1e9) - (b.min_price ?? 1e9),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  rows.sort(sorters[sort] || sorters.rating);
  // Sponsored salons ("mise en avant") come first, clearly labelled.
  const today = now.date;
  rows.sort((a, b) => Number(b.boost_until >= today) - Number(a.boost_until >= today));
  const services = all("SELECT salon_id, name FROM services WHERE active = 1 ORDER BY position, id");
  // "Available today at 14:30" on each card: first free slot today or tomorrow for the salon's first service.
  const { getSlots } = require('../availability');
  const nextSlot = (salonId) => {
    const sv = one('SELECT id FROM services WHERE salon_id = ? AND active = 1 ORDER BY position, id LIMIT 1', salonId);
    if (!sv) return null;
    for (const [i, date] of [now.date, T.addDays(now.date, 1)].entries()) {
      const first = getSlots({ salonId, serviceId: sv.id, date }).slots[0];
      if (first) return { day: i === 0 ? 'today' : 'tomorrow', time: first.time, deal: first.deal };
    }
    return null;
  };
  res.json(rows.map((r) => ({
    ...publicSalon(r),
    top_services: services.filter((s) => s.salon_id === r.id).slice(0, 3).map((s) => s.name),
    next_slot: nextSlot(r.id),
    sponsored: !!r.boost_until && r.boost_until >= today,
  })));
});

router.get('/salons/:slug', (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const withRating = one(`SELECT ${RATING_SQL} FROM salons s WHERE s.id = ?`, salon.id);
  const staff = all('SELECT id, name, title, color FROM staff WHERE salon_id = ? AND active = 1 ORDER BY id', salon.id);
  const links = all('SELECT ss.staff_id, ss.service_id FROM staff_services ss JOIN staff s ON s.id = ss.staff_id WHERE s.salon_id = ?', salon.id);
  res.json({
    salon: { ...publicSalon(salon), ...withRating },
    services: all('SELECT id, name, category, description, duration_min, price_cents, studio FROM services WHERE salon_id = ? AND active = 1 ORDER BY position, id', salon.id),
    studio: (() => {
      const st = require('../styles');
      return { styles: st.catalogFor(salon), colors: st.COLORS, fades: st.FADES, beards: st.BEARDS };
    })(),
    staff: staff.map((s) => ({ ...s, service_ids: links.filter((l) => l.staff_id === s.id).map((l) => l.service_id) })),
    hours: all('SELECT weekday, open, close FROM opening_hours WHERE salon_id = ? ORDER BY weekday, open', salon.id),
    reviews: all('SELECT rating, comment, reply, author_name, created_at FROM reviews WHERE salon_id = ? ORDER BY created_at DESC LIMIT 30', salon.id),
    today: T.now().date,
  });
});

router.get('/salons/:slug/slots', (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const out = getSlots({ salonId: salon.id, serviceId: Number(req.query.service), date: String(req.query.date), staffId: req.query.staff ? Number(req.query.staff) : null });
  const deals = Object.fromEntries(out.slots.filter((x) => x.deal).map((x) => [x.time, x.deal]));
  res.json({ slots: out.slots.map((x) => x.time), deals, reason: out.reason });
});

router.get('/salons/:slug/next', (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const from = T.isDate(req.query.from) ? req.query.from : T.now().date;
  res.json(nextAvailableDays({ salonId: salon.id, serviceId: Number(req.query.service), staffId: req.query.staff ? Number(req.query.staff) : null, from, days: 21, limit: 6 }));
});

router.post('/salons/:slug/bookings', rateLimit('book', 20, 10 * 60 * 1000), async (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const b = req.body || {};
  const booking = createBooking({
    salonId: salon.id,
    serviceId: b.service_id,
    staffId: b.staff_id ? Number(b.staff_id) : null,
    date: b.date,
    time: b.time,
    customer: b.customer,
    userId: req.user?.id ?? null,
    source: b.source === 'widget' ? 'widget' : 'online',
    style: b.style,
  });
  if (booking.payment_status === 'pending') {
    try {
      return res.status(201).json({ token: booking.token, id: booking.id, checkout_url: await depositSession(booking) });
    } catch (err) {
      run("UPDATE bookings SET status = 'cancelled', payment_status = 'none' WHERE id = ?", booking.id);
      throw new HttpError(502, 'Le paiement de l’acompte est momentanément indisponible. Réessayez dans un instant.');
    }
  }
  res.status(201).json({ token: booking.token, id: booking.id });
});

router.post('/salons/:slug/waitlist', rateLimit('waitlist', 10, 10 * 60 * 1000), (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const { service_id, date, name, email, phone } = req.body || {};
  if (!T.isDate(date)) throw new HttpError(400, 'Date invalide.');
  if (!EMAIL_RE.test(String(email || ''))) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (!one('SELECT id FROM services WHERE id = ? AND salon_id = ?', Number(service_id), salon.id)) throw new HttpError(404, 'Prestation introuvable.');
  run('INSERT INTO waitlist (salon_id, service_id, date, name, email, phone) VALUES (?,?,?,?,?,?)',
    salon.id, Number(service_id), date, clean(name, 120) || 'Client', clean(email, 160), clean(phone, 40));
  res.status(201).json({ ok: true });
});

// ---- Gift cards (sold online, redeemed at the salon's till) ----

function sendGiftCardEmail(card, salon) {
  if (!card.buyer_email) return;
  const body = `Merci pour votre achat !\n\nCarte cadeau ${salon.name} : ${(card.initial_cents / 100).toFixed(2)} ${process.env.CURRENCY || 'CHF'}${card.recipient_name ? ` pour ${card.recipient_name}` : ''}.\nCode : ${card.code}\nÀ imprimer ou à transférer : ${APP_URL}/carte-cadeau.html?c=${card.code}\nValable jusqu’au ${card.expires_at}.`;
  run("INSERT INTO notifications (salon_id, kind, channel, recipient, subject, body) VALUES (?, 'gift_card', 'email', ?, ?, ?)", salon.id, card.buyer_email, `Votre carte cadeau ${salon.name}`, body);
  require('../mailer').send({ channel: 'email', to: card.buyer_email, subject: `Votre carte cadeau ${salon.name}`, body, fromName: salon.name });
}

router.post('/salons/:slug/gift-cards', rateLimit('gift', 10, 10 * 60 * 1000), async (req, res) => {
  const salon = salonBySlug(req.params.slug);
  if (!salon.giftcards_enabled || !billing.salonActive(salon)) throw new HttpError(403, 'Ce salon ne vend pas de cartes cadeaux en ligne pour le moment.');
  const b = req.body || {};
  const amount = Math.round(Number(b.amount) * 100);
  if (!EMAIL_RE.test(String(b.buyer_email || ''))) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (clean(b.buyer_name, 120).length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  const live = billing.depositMode(salon) === 'stripe';
  const pos = require('../pos');
  const card = pos.issueGiftCard(salon.id, {
    amountCents: amount, buyerName: b.buyer_name, buyerEmail: b.buyer_email, recipientName: b.recipient_name, message: b.message,
    source: 'online', status: live ? 'pending' : 'active',
  });
  if (!live) {
    sendGiftCardEmail(card, salon);
    return res.status(201).json({ code: card.code });
  }
  const session = await payments.stripe('POST', '/checkout/sessions', {
    mode: 'payment', customer_email: card.buyer_email,
    line_items: [{ quantity: 1, price_data: { currency: (process.env.CURRENCY || 'CHF').toLowerCase(), unit_amount: card.initial_cents, product_data: { name: `Carte cadeau ${salon.name}` } } }],
    metadata: { kind: 'gift_card', gift_card_id: String(card.id), salon_id: String(salon.id) },
    ...(require('../plans').platformFee(card.initial_cents) ? { payment_intent_data: { application_fee_amount: require('../plans').platformFee(card.initial_cents) } } : {}),
    success_url: `${APP_URL}/carte-cadeau.html?c=${card.code}`, cancel_url: `${APP_URL}/carte-cadeau.html?s=${salon.slug}`,
  }, { account: salon.stripe_account_id });
  run('UPDATE gift_cards SET stripe_session_id = ? WHERE id = ?', session.id, card.id);
  res.status(201).json({ checkout_url: session.url });
});

router.get('/gift-cards/:code', rateLimit('giftlookup', 60, 10 * 60 * 1000), async (req, res) => {
  let g = one('SELECT * FROM gift_cards WHERE code = ? COLLATE NOCASE', clean(req.params.code, 20).toUpperCase());
  if (!g || g.status === 'void') throw new HttpError(404, 'Carte cadeau introuvable.');
  const salon = one('SELECT * FROM salons WHERE id = ?', g.salon_id);
  if (g.status === 'pending' && g.stripe_session_id && payments.enabled()) {
    // Back from Checkout: confirm without waiting for the webhook.
    const session = await payments.retrieveSession(g.stripe_session_id, salon.stripe_account_id).catch(() => null);
    if (session?.payment_status === 'paid' && billing.activateGiftCard(g.id)) g = one('SELECT * FROM gift_cards WHERE id = ?', g.id);
  }
  res.json({
    code: g.code, status: g.status, initial_cents: g.initial_cents, balance_cents: g.balance_cents, recipient_name: g.recipient_name,
    buyer_name: g.buyer_name, message: g.message, expires_at: g.expires_at,
    salon: { name: salon.name, slug: salon.slug, accent: salon.accent, address: salon.address, city: salon.city, phone: salon.phone },
  });
});

// ---- Self-service booking management (magic link, no account needed) ----

function bookingByToken(token) {
  const b = one('SELECT * FROM bookings WHERE token = ?', String(token));
  if (!b) throw new HttpError(404, 'Rendez-vous introuvable.');
  return b;
}

router.get('/bookings/:token', (req, res) => {
  const b = bookingByToken(req.params.token);
  const detail = one(
    `SELECT b.id, b.token, b.start_at, b.end_at, b.status, b.price_cents, b.deposit_cents, b.paid_cents, b.notes, b.payment_status,
            s.name AS salon_name, s.slug AS salon_slug, s.address, s.city, s.phone AS salon_phone, s.cancel_hours, s.accent,
            sv.id AS service_id, sv.name AS service_name, sv.duration_min, st.id AS staff_id, st.name AS staff_name, c.name AS client_name,
            (SELECT rating FROM reviews WHERE booking_id = b.id) AS review_rating
     FROM bookings b JOIN salons s ON s.id = b.salon_id JOIN services sv ON sv.id = b.service_id
     JOIN staff st ON st.id = b.staff_id JOIN clients c ON c.id = b.client_id WHERE b.id = ?`, b.id,
  );
  const minutesLeft = T.diffMinutes(T.now().iso, b.start_at);
  detail.can_modify = b.status === 'confirmed' && minutesLeft >= detail.cancel_hours * 60;
  detail.can_review = b.status !== 'cancelled' && b.status !== 'no_show' && minutesLeft <= 0 && !detail.review_rating;
  res.json(detail);
});

router.get('/bookings/:token/slots', (req, res) => {
  const b = bookingByToken(req.params.token);
  const out = getSlots({ salonId: b.salon_id, serviceId: b.service_id, date: String(req.query.date), excludeBookingId: b.id });
  res.json({ slots: out.slots.map((s) => s.time), reason: out.reason });
});

// Back from Stripe Checkout: confirm the deposit without waiting for the webhook.
router.post('/bookings/:token/confirm-payment', async (req, res) => {
  const b = bookingByToken(req.params.token);
  if (b.payment_status === 'pending' && b.stripe_session_id && payments.enabled()) {
    const salon = one('SELECT stripe_account_id FROM salons WHERE id = ?', b.salon_id);
    const session = await payments.retrieveSession(b.stripe_session_id, salon.stripe_account_id);
    if (session.payment_status === 'paid') billing.markDepositPaid(b.id, session.payment_intent);
  }
  res.json({ payment_status: one('SELECT payment_status FROM bookings WHERE id = ?', b.id).payment_status });
});

// Retry paying a deposit (e.g. card declined, window closed) while the slot is still held.
router.post('/bookings/:token/pay', async (req, res) => {
  const b = bookingByToken(req.params.token);
  if (b.payment_status !== 'pending' || b.status !== 'confirmed') throw new HttpError(400, 'Aucun paiement en attente pour ce rendez-vous.');
  res.json({ checkout_url: await depositSession(b) });
});

router.post('/bookings/:token/cancel', (req, res) => {
  cancelBooking(bookingByToken(req.params.token), { byClient: true });
  res.json({ ok: true });
});

router.post('/bookings/:token/reschedule', (req, res) => {
  const b = rescheduleBooking(bookingByToken(req.params.token), { date: req.body?.date, time: req.body?.time, byClient: true });
  res.json({ ok: true, start_at: b.start_at });
});

router.post('/bookings/:token/review', (req, res) => {
  const b = bookingByToken(req.params.token);
  const rating = Number(req.body?.rating);
  if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, 'Note invalide.');
  if (b.status === 'cancelled' || b.status === 'no_show' || T.diffMinutes(T.now().iso, b.start_at) > 0) {
    throw new HttpError(400, 'Vous pourrez laisser un avis après votre rendez-vous.');
  }
  if (one('SELECT id FROM reviews WHERE booking_id = ?', b.id)) throw new HttpError(409, 'Avis déjà publié.');
  const client = one('SELECT name FROM clients WHERE id = ?', b.client_id);
  const parts = client.name.split(/\s+/);
  const author = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
  run('INSERT INTO reviews (booking_id, salon_id, rating, comment, author_name) VALUES (?,?,?,?,?)',
    b.id, b.salon_id, Math.round(rating), clean(req.body?.comment, 1000), author);
  res.status(201).json({ ok: true });
});

router.get('/bookings/:token/ics', (req, res) => {
  const b = bookingByToken(req.params.token);
  const d = one(
    `SELECT b.*, s.name AS salon_name, s.address, s.city, sv.name AS service_name, st.name AS staff_name
     FROM bookings b JOIN salons s ON s.id = b.salon_id JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id
     WHERE b.id = ?`, b.id,
  );
  res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rendez-vous.ics"');
  res.send(buildIcs(d.salon_name, [{
    uid: `booking-${d.id}@lumea`, start: d.start_at, end: d.end_at,
    summary: `${d.service_name} — ${d.salon_name}`, location: `${d.address}, ${d.city}`,
    description: `Avec ${d.staff_name}`, cancelled: d.status === 'cancelled',
  }]));
});

// ---------- Website chat (AI assistant, or the team itself) ----------

const CHAT_MAX_MESSAGES = 40;
const chatSession = (v) => (/^[\w-]{16,40}$/.test(String(v || '')) ? String(v) : null);
const chatLog = (c) => (c ? JSON.parse(c.transcript).map(({ from, text, at }) => ({ from, text, at })) : []);

router.post('/salons/:slug/chat', rateLimit('chat', 30, 10 * 60 * 1000), async (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const text = clean(req.body?.text, 1000);
  if (!text) throw new HttpError(400, 'Message vide.');
  const session = chatSession(req.body?.session) || randomToken(18);
  const existing = one("SELECT * FROM ai_conversations WHERE salon_id = ? AND channel = 'chat' AND external_id = ?", salon.id, session);
  if (existing && JSON.parse(existing.transcript).length >= CHAT_MAX_MESSAGES) {
    throw new HttpError(429, 'Conversation trop longue : appelez le salon ou réservez directement en ligne.');
  }
  const ai = require('../ai');
  const humanOnly = !salon.ai_chat_enabled || !ai.enabled();
  const result = await require('../assistant').respond({ salon, channel: 'chat', externalId: session, text, humanOnly });
  const conv = one('SELECT * FROM ai_conversations WHERE id = ?', result.conversationId);
  res.json({ session, reply: result.reply, human: !!(humanOnly || conv.human_mode), messages: chatLog(conv) });
});

router.get('/salons/:slug/chat/:session', (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const session = chatSession(req.params.session);
  const conv = session && one("SELECT * FROM ai_conversations WHERE salon_id = ? AND channel = 'chat' AND external_id = ?", salon.id, session);
  res.json({ messages: chatLog(conv), human: !!(conv?.human_mode || !salon.ai_chat_enabled || !require('../ai').enabled()) });
});

// Contact form of the salon's website: lands in « Messages » (to handle) and in the salon's inbox.
router.post('/salons/:slug/contact', rateLimit('contact', 5, 10 * 60 * 1000), (req, res) => {
  const salon = salonBySlug(req.params.slug);
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot: bots fill every field
  const name = clean(b.name, 120);
  const contact = clean(b.phone || b.email, 160);
  const message = clean(b.message, 2000);
  if (!name || !contact || message.length < 3) throw new HttpError(400, 'Merci d’indiquer votre nom, un moyen de vous joindre et votre message.');
  const isEmail = EMAIL_RE.test(contact);
  const now = T.now().iso;
  run(
    `INSERT INTO ai_conversations (salon_id, channel, external_id, customer_name, customer_phone, transcript, outcome, status, unread, human_mode)
     VALUES (?, 'chat', ?, ?, ?, ?, ?, 'to_handle', 1, 1)`,
    salon.id, `contact-${randomToken(9)}`, name, contact, JSON.stringify([{ from: 'client', text: message, at: now }]),
    `Formulaire de contact${isEmail ? ` (${contact})` : ''} : ${message.slice(0, 200)}`,
  );
  if (salon.email) {
    const body = `${name} (${contact}) vous a écrit depuis votre site :\n\n${message}\n\nRépondez directement ${isEmail ? 'par e-mail' : 'par téléphone'}. Message aussi disponible dans Lumea › Messages.`;
    run("INSERT INTO notifications (salon_id, kind, channel, recipient, subject, body) VALUES (?, 'contact', 'email', ?, ?, ?)", salon.id, salon.email, `Nouveau message de ${name}`, body);
    require('../mailer').send({ channel: 'email', to: salon.email, subject: `Nouveau message de ${name}`, body, fromName: 'Lumea', replyTo: isEmail ? contact : undefined }).catch(() => {});
  }
  res.status(201).json({ ok: true });
});

module.exports = router;
