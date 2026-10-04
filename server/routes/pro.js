'use strict';
const express = require('express');
const { one, all, run, tx } = require('../db');
const T = require('../time');
const { requireRole, hashPassword } = require('../auth');
const { getSlots } = require('../availability');
const { createBooking, rescheduleBooking, setStatus, HttpError, clean, EMAIL_RE } = require('../bookings');
const { randomToken } = require('../auth');
const { CATEGORIES } = require('../salons');
const { runAutomations, APP_URL } = require('../notifications');
const { PLANS, TEMPLATE_PRICING, CURRENCY } = require('../plans');
const sites = require('../sites');
const payments = require('../payments');
const billing = require('../billing');
const { TEMPLATES, SECTION_KEYS } = require('../templates');

const router = express.Router();
router.use(requireRole('pro', 'admin', 'staff'));

// Employees (role "staff") only reach their own agenda, bookings and the client file.
const STAFF_ALLOWED = [
  ['GET', /^\/(salon|staff|services|agenda|slots|clients(\/\d+)?|bookings\/\d+\/style|products|sales|gift-cards\/[\w-]+)$/],
  ['POST', /^\/(bookings|sales)$/],
  ['PATCH', /^\/bookings\/\d+$/],
  ['PUT', /^\/clients\/\d+$/],
];

router.use((req, _res, next) => {
  if (req.user.role === 'staff') {
    const staff = one('SELECT * FROM staff WHERE id = ? AND active = 1', req.user.staff_id);
    if (!staff) throw new HttpError(403, 'Votre accès a été désactivé. Contactez le gérant du salon.');
    if (!STAFF_ALLOWED.some(([m, re]) => m === req.method && re.test(req.path))) throw new HttpError(403, 'Réservé au gérant du salon.');
    req.staffId = staff.id;
    req.salon = one('SELECT * FROM salons WHERE id = ?', staff.salon_id);
    return next();
  }
  const salonId = req.user.role === 'admin' && req.query.salon ? Number(req.query.salon) : null;
  req.salon = salonId
    ? one('SELECT * FROM salons WHERE id = ?', salonId)
    : one('SELECT * FROM salons WHERE owner_id = ? ORDER BY id LIMIT 1', req.user.id);
  if (!req.salon) throw new HttpError(404, 'Aucun établissement associé à ce compte.');
  next();
});

const int = (v, min, max, def) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
const isHex = (c) => /^#[0-9a-f]{6}$/i.test(c);

function validHours(list) {
  if (!Array.isArray(list)) throw new HttpError(400, 'Horaires invalides.');
  return list.map((h) => {
    const start = h.open ?? h.start;
    const end = h.close ?? h.end;
    if (!(h.weekday >= 0 && h.weekday <= 6) || !T.isTime(start) || !T.isTime(end) || start >= end) {
      throw new HttpError(400, 'Horaires invalides (format HH:MM, ouverture avant fermeture).');
    }
    return { weekday: Number(h.weekday), start, end };
  });
}

function ownBooking(req) {
  const b = one('SELECT * FROM bookings WHERE id = ? AND salon_id = ?', Number(req.params.id), req.salon.id);
  if (!b || (req.staffId && b.staff_id !== req.staffId)) throw new HttpError(404, 'Rendez-vous introuvable.');
  return b;
}

function ownStaff(req, id = req.params.id) {
  const s = one('SELECT * FROM staff WHERE id = ? AND salon_id = ?', Number(id), req.salon.id);
  if (!s) throw new HttpError(404, 'Collaborateur introuvable.');
  return s;
}

// ---------- Salon & settings ----------

router.get('/salon', (req, res) => {
  const s = req.salon;
  if (req.staffId) {
    const { ical_token, stripe_customer_id, stripe_subscription_id, stripe_account_id, ...safe } = s;
    return res.json({ salon: safe, hours: all('SELECT weekday, open, close FROM opening_hours WHERE salon_id = ? ORDER BY weekday, open', s.id), categories: CATEGORIES, plans: [], links: {}, me: { staff_id: req.staffId } });
  }
  res.json({
    salon: s,
    hours: all('SELECT weekday, open, close FROM opening_hours WHERE salon_id = ? ORDER BY weekday, open', s.id),
    categories: CATEGORIES,
    plans: PLANS,
    links: {
      page: `${APP_URL}/salon.html?s=${s.slug}`,
      site: `${APP_URL}/s/${s.slug}`,
      widget: `<iframe src="${APP_URL}/salon.html?s=${s.slug}&embed=1" style="width:100%;min-height:720px;border:0;border-radius:16px" loading="lazy" title="Réserver chez ${s.name.replace(/"/g, '&quot;')}"></iframe>`,
      ical: `${APP_URL}/api/ical/${s.ical_token}.ics`,
    },
  });
});

router.put('/salon', (req, res) => {
  const b = req.body || {};
  const s = req.salon;
  const name = clean(b.name ?? s.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Nom trop court.');
  run(
    `UPDATE salons SET name=?, category=?, description=?, address=?, city=?, zip=?, phone=?, email=?, cover_url=?, accent=?,
       deposit_percent=?, cancel_hours=?, buffer_min=?, slot_step=?, min_notice_min=?, max_days_ahead=?, loyalty_enabled=?, published=?, giftcards_enabled=?
     WHERE id=?`,
    name,
    CATEGORIES.includes(b.category) ? b.category : s.category,
    clean(b.description ?? s.description, 2000), clean(b.address ?? s.address, 200), clean(b.city ?? s.city, 80),
    clean(b.zip ?? s.zip, 12), clean(b.phone ?? s.phone, 40), clean(b.email ?? s.email, 160),
    /^https?:\/\/[^\s'"()<>\\]+$/.test(b.cover_url || '') ? clean(b.cover_url, 500) : (b.cover_url === '' ? '' : s.cover_url),
    isHex(b.accent) ? b.accent : s.accent,
    int(b.deposit_percent, 0, 100, s.deposit_percent), int(b.cancel_hours, 0, 168, s.cancel_hours),
    int(b.buffer_min, 0, 120, s.buffer_min), [5, 10, 15, 20, 30, 60].includes(Number(b.slot_step)) ? Number(b.slot_step) : s.slot_step,
    int(b.min_notice_min, 0, 10080, s.min_notice_min), int(b.max_days_ahead, 1, 365, s.max_days_ahead),
    b.loyalty_enabled === undefined ? s.loyalty_enabled : (b.loyalty_enabled ? 1 : 0),
    b.published === undefined ? s.published : (b.published ? 1 : 0),
    b.giftcards_enabled === undefined ? s.giftcards_enabled : (b.giftcards_enabled ? 1 : 0),
    s.id,
  );
  res.json({ ok: true });
});

router.put('/hours', (req, res) => {
  const hours = validHours(req.body?.hours);
  tx(() => {
    run('DELETE FROM opening_hours WHERE salon_id = ?', req.salon.id);
    for (const h of hours) run('INSERT INTO opening_hours (salon_id, weekday, open, close) VALUES (?,?,?,?)', req.salon.id, h.weekday, h.start, h.end);
  });
  res.json({ ok: true });
});

router.post('/plan', async (req, res) => {
  const plan = PLANS.find((p) => p.id === req.body?.plan);
  if (!plan) throw new HttpError(400, 'Formule inconnue.');
  if (!payments.enabled()) {
    // Demo / simulated mode: the plan switches instantly.
    billing.activatePlan(req.salon.id, plan.id);
    return res.json({ ok: true, simulated: true });
  }
  const session = await payments.platformCheckout({
    salon: req.salon, mode: 'subscription', name: `Lumea ${plan.name} — ${req.salon.name}`, amountChf: plan.price,
    metadata: { kind: 'plan', plan: plan.id, salon_id: String(req.salon.id) },
    successUrl: `${APP_URL}/app#billing`, cancelUrl: `${APP_URL}/app#billing`,
  });
  res.json({ checkout_url: session.url });
});

// Stripe customer portal: card, invoices, cancellation — handled by Stripe.
router.post('/billing/portal', async (req, res) => {
  if (!payments.enabled() || !req.salon.stripe_customer_id) throw new HttpError(400, 'Aucun abonnement payant à gérer pour le moment.');
  const session = await payments.stripe('POST', '/billing_portal/sessions', { customer: req.salon.stripe_customer_id, return_url: `${APP_URL}/app#billing` });
  res.json({ url: session.url });
});

// Stripe Connect: the salon links its own Stripe account to receive deposits directly (0 % commission).
router.get('/payments', async (req, res) => {
  let s = req.salon;
  if (payments.enabled() && s.stripe_account_id) {
    try {
      const acct = await payments.retrieveAccount(s.stripe_account_id);
      run('UPDATE salons SET stripe_charges_enabled = ? WHERE id = ?', acct.charges_enabled ? 1 : 0, s.id);
      s = one('SELECT * FROM salons WHERE id = ?', s.id);
    } catch (err) { console.error('[connect]', err.message); }
  }
  res.json({ mode: billing.depositMode(s), stripe: payments.enabled(), connected: !!s.stripe_account_id, charges_enabled: !!s.stripe_charges_enabled, active: billing.salonActive(s) });
});

router.post('/payments/connect', async (req, res) => {
  if (!payments.enabled()) throw new HttpError(400, 'Les paiements en ligne ne sont pas encore activés sur la plateforme (clé Stripe manquante).');
  const { account, url } = await payments.connectOnboarding(req.salon, { returnUrl: `${APP_URL}/app#settings`, refreshUrl: `${APP_URL}/app#settings` });
  run('UPDATE salons SET stripe_account_id = ? WHERE id = ?', account, req.salon.id);
  res.json({ url });
});

// ---------- Services ----------

router.get('/services', (req, res) => {
  res.json(all('SELECT * FROM services WHERE salon_id = ? ORDER BY position, id', req.salon.id));
});

function serviceFields(b) {
  const name = clean(b.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Nom de prestation requis.');
  const duration = int(b.duration_min, 5, 600, NaN);
  const price = Math.round(Number(b.price) * 100);
  if (!Number.isFinite(duration)) throw new HttpError(400, 'Durée invalide.');
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Prix invalide.');
  return {
    name, category: clean(b.category, 60) || 'Prestations', description: clean(b.description, 500), duration, price,
    active: b.active === false ? 0 : 1, studio: b.studio ? 1 : 0,
  };
}

router.post('/services', (req, res) => {
  const f = serviceFields(req.body || {});
  const id = tx(() => {
    const pos = one('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM services WHERE salon_id = ?', req.salon.id).p;
    const sid = Number(run('INSERT INTO services (salon_id, name, category, description, duration_min, price_cents, active, position, studio) VALUES (?,?,?,?,?,?,?,?,?)',
      req.salon.id, f.name, f.category, f.description, f.duration, f.price, f.active, pos, f.studio).lastInsertRowid);
    // New services are offered by every active staff member by default.
    for (const s of all('SELECT id FROM staff WHERE salon_id = ? AND active = 1', req.salon.id)) {
      run('INSERT INTO staff_services (staff_id, service_id) VALUES (?,?)', s.id, sid);
    }
    return sid;
  });
  res.status(201).json({ id });
});

router.put('/services/:id', (req, res) => {
  const f = serviceFields(req.body || {});
  const r = run('UPDATE services SET name=?, category=?, description=?, duration_min=?, price_cents=?, active=?, studio=? WHERE id=? AND salon_id=?',
    f.name, f.category, f.description, f.duration, f.price, f.active, f.studio, Number(req.params.id), req.salon.id);
  if (!r.changes) throw new HttpError(404, 'Prestation introuvable.');
  res.json({ ok: true });
});

router.delete('/services/:id', (req, res) => {
  const id = Number(req.params.id);
  const used = one('SELECT COUNT(*) AS n FROM bookings WHERE service_id = ? AND salon_id = ?', id, req.salon.id).n;
  // Keep history intact: services with bookings are archived instead of deleted.
  const r = used
    ? run('UPDATE services SET active = 0 WHERE id = ? AND salon_id = ?', id, req.salon.id)
    : run('DELETE FROM services WHERE id = ? AND salon_id = ?', id, req.salon.id);
  if (!r.changes) throw new HttpError(404, 'Prestation introuvable.');
  res.json({ ok: true, archived: !!used });
});

// ---------- Staff ----------

router.get('/staff', (req, res) => {
  const staff = all('SELECT * FROM staff WHERE salon_id = ? ORDER BY id', req.salon.id);
  res.json(staff.map((s) => ({
    ...s,
    hours: all('SELECT weekday, start, end FROM staff_hours WHERE staff_id = ? ORDER BY weekday, start', s.id),
    service_ids: all('SELECT service_id FROM staff_services WHERE staff_id = ?', s.id).map((r) => r.service_id),
    time_off: all('SELECT * FROM time_off WHERE staff_id = ? AND end_at >= ? ORDER BY start_at', s.id, T.now().iso),
    access: req.staffId ? undefined : one("SELECT email FROM users WHERE role = 'staff' AND staff_id = ?", s.id)?.email || null,
  })));
});

function saveStaffRelations(salonId, staffId, b) {
  if (b.hours) {
    const hours = validHours(b.hours);
    run('DELETE FROM staff_hours WHERE staff_id = ?', staffId);
    for (const h of hours) run('INSERT INTO staff_hours (staff_id, weekday, start, end) VALUES (?,?,?,?)', staffId, h.weekday, h.start, h.end);
  }
  if (Array.isArray(b.service_ids)) {
    run('DELETE FROM staff_services WHERE staff_id = ?', staffId);
    for (const sid of b.service_ids) {
      if (one('SELECT id FROM services WHERE id = ? AND salon_id = ?', Number(sid), salonId)) {
        run('INSERT INTO staff_services (staff_id, service_id) VALUES (?,?)', staffId, Number(sid));
      }
    }
  }
}

router.post('/staff', (req, res) => {
  const b = req.body || {};
  const name = clean(b.name, 80);
  if (name.length < 2) throw new HttpError(400, 'Nom requis.');
  const plan = PLANS.find((p) => p.id === req.salon.plan) || PLANS[1];
  const count = one('SELECT COUNT(*) AS n FROM staff WHERE salon_id = ? AND active = 1', req.salon.id).n;
  if (plan.max_staff && count >= plan.max_staff) {
    throw new HttpError(402, `Votre formule ${plan.name} est limitée à ${plan.max_staff} collaborateur(s). Passez à la formule supérieure.`);
  }
  const id = tx(() => {
    const sid = Number(run('INSERT INTO staff (salon_id, name, title, color) VALUES (?,?,?,?)',
      req.salon.id, name, clean(b.title, 80), isHex(b.color) ? b.color : '#0ea5e9').lastInsertRowid);
    const defaults = all('SELECT weekday, open AS start, close AS end FROM opening_hours WHERE salon_id = ?', req.salon.id);
    saveStaffRelations(req.salon.id, sid, {
      hours: b.hours || defaults,
      service_ids: b.service_ids || all('SELECT id FROM services WHERE salon_id = ?', req.salon.id).map((s) => s.id),
    });
    return sid;
  });
  res.status(201).json({ id });
});

router.put('/staff/:id', (req, res) => {
  const s = ownStaff(req);
  const b = req.body || {};
  tx(() => {
    run('UPDATE staff SET name=?, title=?, color=?, active=? WHERE id=?',
      clean(b.name ?? s.name, 80) || s.name, clean(b.title ?? s.title, 80), isHex(b.color) ? b.color : s.color,
      b.active === undefined ? s.active : (b.active ? 1 : 0), s.id);
    saveStaffRelations(req.salon.id, s.id, b);
  });
  res.json({ ok: true });
});

// Employee login: invite by e-mail (link to choose a password, valid 7 days).
router.post('/staff/:id/access', (req, res) => {
  const s = ownStaff(req);
  const email = clean(req.body?.email, 160).toLowerCase();
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  const existing = one('SELECT * FROM users WHERE email = ?', email);
  if (existing && !(existing.role === 'staff' && existing.staff_id === s.id)) throw new HttpError(409, 'Cet e-mail est déjà utilisé par un autre compte.');
  const token = randomToken(24);
  tx(() => {
    run("DELETE FROM users WHERE role = 'staff' AND staff_id = ? AND email != ?", s.id, email);
    if (!existing) {
      run("INSERT INTO users (email, password_hash, name, role, staff_id) VALUES (?,?,?, 'staff', ?)", email, hashPassword(randomToken(24)), s.name, s.id);
    }
    const uid = one('SELECT id FROM users WHERE email = ?', email).id;
    run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)',
      require('node:crypto').createHash('sha256').update(token).digest('hex'), uid, Date.now() + 7 * 24 * 3600 * 1000);
  });
  const inviteUrl = `${APP_URL}/reset.html?t=${token}`;
  const body = `Bonjour ${s.name},\n\n${req.salon.name} vous donne accès à votre agenda sur Lumea.\nChoisissez votre mot de passe ici (lien valable 7 jours) :\n${inviteUrl}\n\nEnsuite, connectez-vous sur ${APP_URL}/connexion avec ${email}.`;
  run("INSERT INTO notifications (salon_id, kind, channel, recipient, subject, body) VALUES (?, 'staff_invite', 'email', ?, ?, ?)", req.salon.id, email, `Votre accès Lumea — ${req.salon.name}`, body);
  require('../mailer').send({ channel: 'email', to: email, subject: `Votre accès Lumea — ${req.salon.name}`, body, fromName: req.salon.name });
  res.status(201).json({ ok: true, invite_url: inviteUrl });
});

router.delete('/staff/:id/access', (req, res) => {
  const s = ownStaff(req);
  run("DELETE FROM users WHERE role = 'staff' AND staff_id = ?", s.id);
  res.json({ ok: true });
});

router.post('/staff/:id/time-off', (req, res) => {
  const s = ownStaff(req);
  const { start_at, end_at, reason } = req.body || {};
  const re = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!re.test(start_at) || !re.test(end_at) || start_at >= end_at) throw new HttpError(400, 'Période invalide.');
  run('INSERT INTO time_off (staff_id, start_at, end_at, reason) VALUES (?,?,?,?)', s.id, start_at, end_at, clean(reason, 120));
  res.status(201).json({ ok: true });
});

router.delete('/time-off/:id', (req, res) => {
  const r = run('DELETE FROM time_off WHERE id = ? AND staff_id IN (SELECT id FROM staff WHERE salon_id = ?)', Number(req.params.id), req.salon.id);
  if (!r.changes) throw new HttpError(404, 'Absence introuvable.');
  res.json({ ok: true });
});

// ---------- Agenda & bookings ----------

router.get('/agenda', (req, res) => {
  const from = T.isDate(req.query.from) ? req.query.from : T.now().date;
  const to = T.isDate(req.query.to) ? req.query.to : from;
  res.json({
    bookings: all(
      `SELECT b.*, NULL AS style_image, (b.style_json IS NOT NULL) AS has_style, sv.name AS service_name, st.name AS staff_name, st.color AS staff_color,
              c.name AS client_name, c.phone AS client_phone, c.email AS client_email
       FROM bookings b JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id JOIN clients c ON c.id = b.client_id
       WHERE b.salon_id = ? AND b.start_at >= ? AND b.start_at < ? AND (? = 0 OR b.staff_id = ?) ORDER BY b.start_at`,
      req.salon.id, `${from}T00:00`, `${T.addDays(to, 1)}T00:00`, req.staffId || 0, req.staffId || 0,
    ),
    time_off: all(
      `SELECT t.*, s.name AS staff_name FROM time_off t JOIN staff s ON s.id = t.staff_id
       WHERE s.salon_id = ? AND t.start_at < ? AND t.end_at > ?`,
      req.salon.id, `${T.addDays(to, 1)}T00:00`, `${from}T00:00`,
    ),
    hours: all('SELECT weekday, open, close FROM opening_hours WHERE salon_id = ?', req.salon.id),
    today: T.now().date,
  });
});

router.get('/slots', (req, res) => {
  const out = getSlots({
    salonId: req.salon.id, serviceId: Number(req.query.service), date: String(req.query.date),
    staffId: req.query.staff ? Number(req.query.staff) : null, excludeBookingId: Number(req.query.exclude) || 0, ignoreNotice: true,
  });
  res.json({ slots: out.slots.map((s) => s.time), reason: out.reason });
});

router.post('/bookings', (req, res) => {
  const b = req.body || {};
  if (req.staffId) b.staff_id = req.staffId;
  const booking = createBooking({
    salonId: req.salon.id, serviceId: b.service_id, staffId: b.staff_id ? Number(b.staff_id) : null,
    date: b.date, time: b.time, customer: b.customer, source: 'pro', force: !!b.force,
  });
  res.status(201).json({ id: booking.id });
});

router.patch('/bookings/:id', (req, res) => {
  const booking = ownBooking(req);
  const b = req.body || {};
  if (req.staffId) b.staff_id = req.staffId;
  if (b.date && b.time) rescheduleBooking(booking, { date: b.date, time: b.time, staffId: b.staff_id ? Number(b.staff_id) : null });
  if (b.status && b.status !== booking.status) setStatus(one('SELECT * FROM bookings WHERE id = ?', booking.id), b.status);
  if (b.notes !== undefined) run('UPDATE bookings SET notes = ? WHERE id = ?', clean(b.notes, 500), booking.id);
  res.json({ ok: true });
});

// ---------- Clients (CRM) ----------

router.get('/clients', (req, res) => {
  const q = `%${clean(req.query.q, 80).toLowerCase()}%`;
  res.json(all(
    `SELECT c.*, COUNT(b.id) FILTER (WHERE b.status IN ('confirmed','completed')) AS visits,
            COUNT(b.id) FILTER (WHERE b.status = 'no_show') AS no_shows,
            COALESCE(SUM(b.price_cents) FILTER (WHERE b.status = 'completed'), 0) AS spent_cents,
            MAX(b.start_at) AS last_visit
     FROM clients c LEFT JOIN bookings b ON b.client_id = c.id
     WHERE c.salon_id = ? AND (lower(c.name) LIKE ? OR lower(c.email) LIKE ? OR c.phone LIKE ?)
     GROUP BY c.id ORDER BY last_visit DESC NULLS LAST LIMIT 500`,
    req.salon.id, q, q, q,
  ));
});

router.get('/clients/:id', (req, res) => {
  const c = one('SELECT * FROM clients WHERE id = ? AND salon_id = ?', Number(req.params.id), req.salon.id);
  if (!c) throw new HttpError(404, 'Client introuvable.');
  c.history = all(
    `SELECT b.id, b.start_at, b.status, b.price_cents, sv.name AS service_name, st.name AS staff_name
     FROM bookings b JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id
     WHERE b.client_id = ? ORDER BY b.start_at DESC`, c.id,
  );
  res.json(c);
});

router.put('/clients/:id', (req, res) => {
  const b = req.body || {};
  const r = run('UPDATE clients SET notes = ?, phone = COALESCE(?, phone) WHERE id = ? AND salon_id = ?',
    clean(b.notes, 2000), b.phone === undefined ? null : clean(b.phone, 40), Number(req.params.id), req.salon.id);
  if (!r.changes) throw new HttpError(404, 'Client introuvable.');
  res.json({ ok: true });
});

router.post('/clients/import', express.json({ limit: '5mb' }), (req, res) => {
  const { parseCsv, mapHeaders } = require('../csv');
  const rows = parseCsv(req.body?.csv);
  if (rows.length < 2) throw new HttpError(400, 'Fichier vide ou illisible. Exportez vos clients au format CSV (Excel : Fichier › Enregistrer sous › CSV).');
  const map = mapHeaders(rows[0]);
  if (map.name === undefined && map.first === undefined && map.last === undefined) {
    throw new HttpError(400, 'Colonne « Nom » introuvable. La première ligne doit contenir les titres (Nom, Prénom, E-mail, Téléphone…).');
  }
  const get = (r, k) => (map[k] === undefined ? '' : String(r[map[k]] ?? '').trim());
  const stats = { imported: 0, updated: 0, skipped: 0 };
  tx(() => {
    for (const r of rows.slice(1, 20001)) {
      const name = clean(get(r, 'name') || [get(r, 'first'), get(r, 'last')].filter(Boolean).join(' '), 120);
      let email = clean(get(r, 'email'), 160).toLowerCase();
      const phone = clean(get(r, 'phone'), 40);
      const notes = clean(get(r, 'notes'), 2000);
      if (name.length < 2 || (!email && !phone)) { stats.skipped++; continue; }
      if (email && !EMAIL_RE.test(email)) email = '';
      const existing = email
        ? one('SELECT id FROM clients WHERE salon_id = ? AND email = ?', req.salon.id, email)
        : one("SELECT id FROM clients WHERE salon_id = ? AND phone = ? AND phone != ''", req.salon.id, phone);
      if (existing) {
        run("UPDATE clients SET phone = CASE WHEN phone = '' THEN ? ELSE phone END, notes = CASE WHEN notes = '' THEN ? ELSE notes END WHERE id = ?", phone, notes, existing.id);
        stats.updated++;
      } else {
        run('INSERT INTO clients (salon_id, name, email, phone, notes) VALUES (?,?,?,?,?)',
          req.salon.id, name, email || `client-${randomToken(6).toLowerCase()}@sans-email.invalid`, phone, notes);
        stats.imported++;
      }
    }
  });
  res.json(stats);
});

router.get('/export/clients.csv', (req, res) => {
  const rows = all('SELECT name, email, phone, marketing_opt_in, created_at FROM clients WHERE salon_id = ? ORDER BY name', req.salon.id);
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const csv = ['nom;email;telephone;optin_marketing;cree_le', ...rows.map((r) => [r.name, r.email, r.phone, r.marketing_opt_in, r.created_at].map(cell).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="clients.csv"');
  res.send('﻿' + csv);
});

// ---------- Stats ----------

router.get('/stats', (req, res) => {
  const days = int(req.query.days, 7, 365, 30);
  const today = T.now().date;
  const from = T.addDays(today, -days + 1);
  const range = [req.salon.id, `${from}T00:00`, `${T.addDays(today, 1)}T00:00`];
  const totals = one(
    `SELECT COUNT(*) FILTER (WHERE status != 'cancelled') AS bookings,
            COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
            COUNT(*) FILTER (WHERE status = 'no_show') AS no_shows,
            COALESCE(SUM(price_cents) FILTER (WHERE status IN ('completed','confirmed')), 0) AS revenue_cents,
            COUNT(*) FILTER (WHERE source != 'pro' AND status != 'cancelled') AS online,
            COALESCE(AVG(price_cents) FILTER (WHERE status IN ('completed','confirmed')), 0) AS avg_ticket_cents
     FROM bookings WHERE salon_id = ? AND start_at >= ? AND start_at < ?`, ...range,
  );
  const daily = all(
    `SELECT substr(start_at,1,10) AS day, COUNT(*) AS n, SUM(price_cents) AS revenue_cents
     FROM bookings WHERE salon_id = ? AND start_at >= ? AND start_at < ? AND status IN ('completed','confirmed')
     GROUP BY day ORDER BY day`, ...range,
  );
  const topServices = all(
    `SELECT sv.name, COUNT(*) AS n, SUM(b.price_cents) AS revenue_cents FROM bookings b JOIN services sv ON sv.id = b.service_id
     WHERE b.salon_id = ? AND b.start_at >= ? AND b.start_at < ? AND b.status IN ('completed','confirmed')
     GROUP BY sv.id ORDER BY revenue_cents DESC LIMIT 5`, ...range,
  );
  const byStaff = all(
    `SELECT st.name, st.color, COUNT(*) AS n, SUM(b.price_cents) AS revenue_cents FROM bookings b JOIN staff st ON st.id = b.staff_id
     WHERE b.salon_id = ? AND b.start_at >= ? AND b.start_at < ? AND b.status IN ('completed','confirmed')
     GROUP BY st.id ORDER BY revenue_cents DESC`, ...range,
  );
  const newClients = one('SELECT COUNT(*) AS n FROM clients WHERE salon_id = ? AND created_at >= ?', req.salon.id, `${from} 00:00:00`).n;

  // Occupancy = booked minutes / available staff minutes over the period.
  let capacity = 0;
  const staff = all('SELECT id FROM staff WHERE salon_id = ? AND active = 1', req.salon.id);
  const hoursByStaff = new Map(staff.map((s) => [s.id, all('SELECT weekday, start, end FROM staff_hours WHERE staff_id = ?', s.id)]));
  for (let i = 0; i < days; i++) {
    const wd = T.weekday(T.addDays(from, i));
    for (const hs of hoursByStaff.values()) for (const h of hs) if (h.weekday === wd) capacity += T.toMin(h.end) - T.toMin(h.start);
  }
  const booked = all(
    "SELECT start_at, end_at FROM bookings WHERE salon_id = ? AND start_at >= ? AND start_at < ? AND status IN ('completed','confirmed','no_show')", ...range,
  ).reduce((sum, b) => sum + T.diffMinutes(b.start_at, b.end_at), 0);

  const upcoming = one("SELECT COUNT(*) AS n, COALESCE(SUM(price_cents),0) AS revenue_cents FROM bookings WHERE salon_id = ? AND status = 'confirmed' AND start_at >= ?", req.salon.id, T.now().iso);
  const rating = one('SELECT ROUND(AVG(rating),1) AS avg, COUNT(*) AS n FROM reviews WHERE salon_id = ?', req.salon.id);

  res.json({
    from, to: today, days, totals, daily, topServices, byStaff, newClients, upcoming, rating,
    occupancy: capacity ? Math.round((booked / capacity) * 100) : 0,
    no_show_rate: totals.bookings ? Math.round((totals.no_shows / totals.bookings) * 1000) / 10 : 0,
  });
});

// ---------- Reviews, notifications, waitlist ----------

router.get('/reviews', (req, res) => {
  res.json(all(
    `SELECT r.*, sv.name AS service_name FROM reviews r JOIN bookings b ON b.id = r.booking_id JOIN services sv ON sv.id = b.service_id
     WHERE r.salon_id = ? ORDER BY r.created_at DESC`, req.salon.id,
  ));
});

router.put('/reviews/:id/reply', (req, res) => {
  const r = run('UPDATE reviews SET reply = ? WHERE id = ? AND salon_id = ?', clean(req.body?.reply, 1000), Number(req.params.id), req.salon.id);
  if (!r.changes) throw new HttpError(404, 'Avis introuvable.');
  res.json({ ok: true });
});

router.get('/notifications', (req, res) => {
  res.json(all('SELECT * FROM notifications WHERE salon_id = ? ORDER BY id DESC LIMIT 100', req.salon.id));
});

router.post('/automations/run', (_req, res) => res.json(runAutomations()));

router.get('/waitlist', (req, res) => {
  res.json(all(
    `SELECT w.*, sv.name AS service_name FROM waitlist w JOIN services sv ON sv.id = w.service_id
     WHERE w.salon_id = ? AND w.date >= ? ORDER BY w.date, w.created_at`, req.salon.id, T.now().date,
  ));
});


// ---------- Point of sale, stock, gift cards ----------

const pos = require('../pos');

function productFields(b) {
  const name = clean(b.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Nom du produit requis.');
  const price = Math.round(Number(b.price) * 100);
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, 'Prix invalide.');
  return {
    name, brand: clean(b.brand, 80), category: clean(b.category, 60) || 'Produits', price,
    cost: Math.max(0, Math.round(Number(b.cost || 0) * 100)) || 0,
    low: int(b.low_stock, 0, 9999, 3), active: b.active === false ? 0 : 1,
  };
}

router.get('/products', (req, res) => {
  res.json(all('SELECT * FROM products WHERE salon_id = ? ORDER BY active DESC, category, name', req.salon.id));
});

router.post('/products', (req, res) => {
  const f = productFields(req.body || {});
  const stock = int(req.body?.stock, 0, 99999, 0);
  const id = tx(() => {
    const pid = Number(run('INSERT INTO products (salon_id, name, brand, category, price_cents, cost_cents, stock, low_stock, active) VALUES (?,?,?,?,?,?,?,?,?)',
      req.salon.id, f.name, f.brand, f.category, f.price, f.cost, stock, f.low, f.active).lastInsertRowid);
    if (stock) run("INSERT INTO stock_movements (product_id, delta, reason) VALUES (?,?, 'stock initial')", pid, stock);
    return pid;
  });
  res.status(201).json({ id });
});

router.put('/products/:id', (req, res) => {
  const f = productFields(req.body || {});
  const r = run('UPDATE products SET name=?, brand=?, category=?, price_cents=?, cost_cents=?, low_stock=?, active=? WHERE id=? AND salon_id=?',
    f.name, f.brand, f.category, f.price, f.cost, f.low, f.active, Number(req.params.id), req.salon.id);
  if (!r.changes) throw new HttpError(404, 'Produit introuvable.');
  res.json({ ok: true });
});

router.post('/products/:id/stock', (req, res) => {
  const p = one('SELECT * FROM products WHERE id = ? AND salon_id = ?', Number(req.params.id), req.salon.id);
  if (!p) throw new HttpError(404, 'Produit introuvable.');
  const delta = int(req.body?.delta, -99999, 99999, 0);
  if (!delta) throw new HttpError(400, 'Quantité invalide.');
  if (p.stock + delta < 0) throw new HttpError(400, 'Le stock ne peut pas être négatif.');
  tx(() => {
    run('UPDATE products SET stock = stock + ? WHERE id = ?', delta, p.id);
    run('INSERT INTO stock_movements (product_id, delta, reason) VALUES (?,?,?)', p.id, delta, clean(req.body?.reason, 60) || (delta > 0 ? 'réassort' : 'correction'));
  });
  res.json({ stock: p.stock + delta });
});

router.delete('/products/:id', (req, res) => {
  const r = run('UPDATE products SET active = 0 WHERE id = ? AND salon_id = ?', Number(req.params.id), req.salon.id);
  if (!r.changes) throw new HttpError(404, 'Produit introuvable.');
  res.json({ ok: true });
});

router.post('/sales', (req, res) => {
  const b = { ...(req.body || {}) };
  if (req.staffId) b.staff_id = req.staffId;
  res.status(201).json(pos.createSale(req.salon, req.user.id, b));
});

router.get('/sales', (req, res) => {
  const day = T.isDate(req.query.day) ? req.query.day : T.now().date;
  res.json(pos.dayReport(req.salon.id, day));
});

router.post('/sales/:id/void', (req, res) => {
  pos.voidSale(req.salon.id, Number(req.params.id));
  res.json({ ok: true });
});

router.get('/export/sales.csv', (req, res) => {
  const from = T.isDate(req.query.from) ? req.query.from : T.addDays(T.now().date, -30);
  const to = T.isDate(req.query.to) ? req.query.to : T.now().date;
  const rows = all(
    `SELECT s.day, s.created_at, s.id, st.name AS staff, c.name AS client, s.subtotal_cents, s.discount_cents, s.tip_cents, s.total_cents, s.method, s.gift_card_cents, s.voided
     FROM sales s LEFT JOIN staff st ON st.id = s.staff_id LEFT JOIN clients c ON c.id = s.client_id
     WHERE s.salon_id = ? AND s.day BETWEEN ? AND ? ORDER BY s.created_at`, req.salon.id, from, to,
  );
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`;
  const chf = (c) => (c / 100).toFixed(2);
  const csv = ['jour;heure;vente;collaborateur;client;sous_total;remise;pourboire;total;moyen;carte_cadeau;annulee',
    ...rows.map((r) => [r.day, r.created_at.slice(11, 16), r.id, r.staff, r.client, chf(r.subtotal_cents), chf(r.discount_cents), chf(r.tip_cents), chf(r.total_cents), pos.METHODS[r.method], chf(r.gift_card_cents), r.voided ? 'oui' : 'non'].map(cell).join(';'))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ventes-${from}-${to}.csv"`);
  res.send('\ufeff' + csv);
});

router.get('/gift-cards', (req, res) => {
  res.json(all("SELECT * FROM gift_cards WHERE salon_id = ? AND status != 'pending' ORDER BY created_at DESC LIMIT 300", req.salon.id));
});

router.get('/gift-cards/:code', (req, res) => {
  const g = pos.findGiftCard(req.salon.id, req.params.code);
  res.json({ code: g.code, balance_cents: g.balance_cents, initial_cents: g.initial_cents, expires_at: g.expires_at, recipient_name: g.recipient_name });
});

// ---------- 3D haircut studio ----------

router.get('/studio', (req, res) => {
  const { STYLES, COLORS, FADES, BEARDS, catalogFor } = require('../styles');
  res.json({ styles: STYLES, colors: COLORS, fades: FADES, beards: BEARDS, offered: catalogFor(req.salon).map((s) => s.id) });
});

router.put('/studio', (req, res) => {
  const { STYLES } = require('../styles');
  const ids = (Array.isArray(req.body?.offered) ? req.body.offered : []).filter((id) => STYLES.some((s) => s.id === id));
  if (!ids.length) throw new HttpError(400, 'Choisissez au moins une coupe.');
  run('UPDATE salons SET style_catalog = ? WHERE id = ?', JSON.stringify(ids), req.salon.id);
  res.json({ ok: true });
});

router.get('/bookings/:id/style', (req, res) => {
  const b = ownBooking(req);
  const style = b.style_json ? JSON.parse(b.style_json) : null;
  res.json({ style, image: b.style_image || null, summary: require('../styles').describeStyle(style) });
});

// ---------- Website (each salon has its own site) ----------

const siteUrl = (salon) => `${APP_URL}/s/${salon.slug}`;
const httpUrl = (v) => (/^https?:\/\/[^\s'"()<>\\]+$/.test(String(v || '').trim()) ? String(v).trim().slice(0, 500) : '');

function sanitizeContent(raw = {}) {
  const str = (v, max) => clean(v, max);
  return {
    announcement: str(raw.announcement, 160),
    tagline: str(raw.tagline, 80),
    hero_title: str(raw.hero_title, 100),
    hero_subtitle: str(raw.hero_subtitle, 300),
    hero_image: httpUrl(raw.hero_image),
    cta_label: str(raw.cta_label, 40),
    about_title: str(raw.about_title, 80),
    about_text: str(raw.about_text, 2000),
    gallery: (Array.isArray(raw.gallery) ? raw.gallery : String(raw.gallery || '').split(/\s+/)).map(httpUrl).filter(Boolean).slice(0, 12),
    accent: /^#[0-9a-f]{6}$/i.test(raw.accent || '') ? raw.accent : '',
    socials: Object.fromEntries(['instagram', 'facebook', 'tiktok', 'whatsapp'].map((k) => [k, str(raw.socials?.[k], 120)])),
    sections: Object.fromEntries(SECTION_KEYS.map((k) => [k, raw.sections?.[k] !== false])),
    hide_branding: !!raw.hide_branding,
  };
}

router.get('/site', (req, res) => {
  const site = sites.ensureSite(req.salon.id);
  res.json({
    site: { ...site, content: sites.parseContent(site) },
    templates: sites.templateCatalog(req.salon),
    pricing: TEMPLATE_PRICING,
    currency: CURRENCY,
    plan: req.salon.plan,
    premium: sites.hasPremiumFeatures(req.salon),
    url: siteUrl(req.salon),
    licenses: all('SELECT * FROM template_licenses WHERE salon_id = ? ORDER BY created_at DESC', req.salon.id),
    design_requests: all('SELECT * FROM design_requests WHERE salon_id = ? ORDER BY created_at DESC', req.salon.id),
  });
});

router.put('/site', (req, res) => {
  const b = req.body || {};
  const site = sites.ensureSite(req.salon.id);
  const template = b.template ?? site.template;
  if (!TEMPLATES.some((t) => t.id === template)) throw new HttpError(400, 'Modèle inconnu.');
  if (!sites.canUseTemplate(req.salon, template)) {
    throw new HttpError(402, `Ce modèle est premium : ${TEMPLATE_PRICING.once} ${CURRENCY} une fois ou ${TEMPLATE_PRICING.monthly} ${CURRENCY} / mois, ou inclus dans la formule Premium.`);
  }
  const premium = sites.hasPremiumFeatures(req.salon);
  let domain = site.custom_domain;
  if (b.custom_domain !== undefined) {
    const d = clean(b.custom_domain, 120).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    if (d && !premium) throw new HttpError(402, 'Le nom de domaine personnalisé est inclus dans la formule Premium.');
    if (d && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) throw new HttpError(400, 'Nom de domaine invalide (ex. : mon-salon.ch).');
    if (d && one('SELECT salon_id FROM sites WHERE custom_domain = ? AND salon_id != ?', d, req.salon.id)) throw new HttpError(409, 'Ce domaine est déjà utilisé.');
    domain = d || null;
  }
  const css = b.custom_css !== undefined ? String(b.custom_css).slice(0, 20000) : site.custom_css;
  if (b.custom_css && !premium) throw new HttpError(402, 'Le CSS personnalisé est inclus dans la formule Premium.');
  run(
    `UPDATE sites SET template = ?, content = ?, published = ?, custom_css = ?, custom_domain = ?, updated_at = datetime('now') WHERE salon_id = ?`,
    template,
    JSON.stringify(b.content !== undefined ? sanitizeContent(b.content) : sites.parseContent(site)),
    b.published === undefined ? site.published : (b.published ? 1 : 0),
    css, domain, req.salon.id,
  );
  res.json({ ok: true, url: siteUrl(req.salon) });
});

/** Live preview of unsaved edits (any template can be previewed, even locked ones). */
router.post('/site/preview', (req, res) => {
  const b = req.body || {};
  const template = TEMPLATES.some((t) => t.id === b.template) ? b.template : undefined;
  res.type('html').send(sites.renderSalonSite(req.salon, {
    templateId: template, content: b.content ? sanitizeContent(b.content) : undefined,
    customCss: b.custom_css !== undefined ? String(b.custom_css).slice(0, 20000) : undefined, preview: true,
  }));
});

router.post('/site/licenses', async (req, res) => {
  const { template, billing: mode } = req.body || {};
  const tpl = TEMPLATES.find((t) => t.id === template);
  if (!tpl || tpl.free) throw new HttpError(400, 'Modèle invalide.');
  if (!['once', 'monthly'].includes(mode)) throw new HttpError(400, 'Mode de paiement invalide.');
  if (sites.isPremium(req.salon)) throw new HttpError(400, 'Tous les modèles sont déjà inclus dans votre formule Premium.');
  if (sites.activeLicenses(req.salon.id).some((l) => l.template === template)) throw new HttpError(409, 'Vous disposez déjà de ce modèle.');
  if (!payments.enabled()) {
    billing.addLicense(req.salon.id, template, mode);
    return res.status(201).json({ ok: true, simulated: true });
  }
  const session = await payments.platformCheckout({
    salon: req.salon, mode: mode === 'once' ? 'payment' : 'subscription',
    name: `Modèle de site « ${tpl.name} »${mode === 'once' ? '' : ' (location mensuelle)'}`, amountChf: TEMPLATE_PRICING[mode],
    metadata: { kind: 'template', template, billing: mode, salon_id: String(req.salon.id) },
    successUrl: `${APP_URL}/app#site`, cancelUrl: `${APP_URL}/app#site`,
  });
  res.json({ checkout_url: session.url });
});

router.delete('/site/licenses/:id', (req, res) => {
  const l = one('SELECT * FROM template_licenses WHERE id = ? AND salon_id = ? AND active = 1', Number(req.params.id), req.salon.id);
  if (!l) throw new HttpError(404, 'Licence introuvable.');
  if (l.billing !== 'monthly') throw new HttpError(400, 'Un modèle acheté vous appartient définitivement.');
  if (l.stripe_subscription_id && payments.enabled()) {
    // Stays active until the end of the paid month; Stripe then sends customer.subscription.deleted.
    payments.cancelSubscription(l.stripe_subscription_id, { atPeriodEnd: true }).catch((err) => console.error('[billing]', err.message));
    run("UPDATE template_licenses SET cancelled_at = datetime('now') WHERE id = ?", l.id);
    return res.json({ ok: true, until_period_end: true });
  }
  run("UPDATE template_licenses SET active = 0, cancelled_at = datetime('now') WHERE id = ?", l.id);
  res.json({ ok: true });
});

router.post('/site/design-requests', (req, res) => {
  if (!sites.hasPremiumFeatures(req.salon)) throw new HttpError(402, 'Le site sur mesure est inclus dans la formule Premium.');
  const brief = clean(req.body?.brief, 4000);
  if (brief.length < 20) throw new HttpError(400, 'Décrivez votre projet en quelques phrases (20 caractères minimum).');
  run('INSERT INTO design_requests (salon_id, brief) VALUES (?,?)', req.salon.id, brief);
  res.status(201).json({ ok: true });
});

module.exports = router;
