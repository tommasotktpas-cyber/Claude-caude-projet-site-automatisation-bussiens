'use strict';
const { one, all, run } = require('./db');
const T = require('./time');

const APP_URL = (process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const { send } = require('./mailer');

const { CURRENCY } = require('./plans');
const euros = (cents) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: CURRENCY }).format(cents / 100);
const frDate = (iso) => {
  const [date, time] = iso.split('T');
  const d = new Date(`${date}T12:00:00Z`);
  const label = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return `${label} à ${time.replace(':', 'h')}`;
};

function bookingContext(bookingId) {
  return one(
    `SELECT b.*, s.name AS salon_name, s.email AS salon_email, s.address, s.city, s.phone AS salon_phone, s.cancel_hours,
            sv.name AS service_name, st.name AS staff_name, c.name AS client_name, c.email AS client_email, c.phone AS client_phone
     FROM bookings b
     JOIN salons s ON s.id = b.salon_id
     JOIN services sv ON sv.id = b.service_id
     JOIN staff st ON st.id = b.staff_id
     JOIN clients c ON c.id = b.client_id
     WHERE b.id = ?`, bookingId,
  );
}

const templates = {
  confirmation: (b) => ({
    subject: `Rendez-vous confirmé — ${b.salon_name}`,
    body: `Bonjour ${b.client_name},\n\nVotre rendez-vous « ${b.service_name} » avec ${b.staff_name} est confirmé pour le ${frDate(b.start_at)}.\n`
      + `Adresse : ${b.address}, ${b.city}\nMontant : ${euros(b.price_cents)}${b.deposit_cents ? ` (acompte réglé : ${euros(b.deposit_cents)})` : ''}\n\n`
      + `Gérer / déplacer / annuler : ${APP_URL}/rdv.html?t=${b.token}\nAjouter à mon agenda : ${APP_URL}/api/public/bookings/${b.token}/ics\n`,
  }),
  reminder: (b) => ({
    subject: `Rappel : demain chez ${b.salon_name}`,
    body: `Bonjour ${b.client_name}, petit rappel : « ${b.service_name} » le ${frDate(b.start_at)} chez ${b.salon_name}.\n`
      + `Un empêchement ? Déplacez en 1 clic : ${APP_URL}/rdv.html?t=${b.token}`,
  }),
  rescheduled: (b) => ({
    subject: `Rendez-vous déplacé — ${b.salon_name}`,
    body: `Bonjour ${b.client_name}, votre rendez-vous « ${b.service_name} » est désormais prévu le ${frDate(b.start_at)} avec ${b.staff_name}.\n${APP_URL}/rdv.html?t=${b.token}`,
  }),
  cancelled: (b) => ({
    subject: `Rendez-vous annulé — ${b.salon_name}`,
    body: `Bonjour ${b.client_name}, votre rendez-vous « ${b.service_name} » du ${frDate(b.start_at)} a été annulé.\nReprendre rendez-vous : ${APP_URL}/salon.html?s=${encodeURIComponent(b.salon_slug || '')}`,
  }),
  review: (b) => ({
    subject: `Comment s'est passé votre rendez-vous chez ${b.salon_name} ?`,
    body: `Bonjour ${b.client_name}, merci de votre visite ! Donnez votre avis en 20 secondes : ${APP_URL}/rdv.html?t=${b.token}#avis`,
  }),
  new_booking_pro: (b) => ({
    subject: `Nouveau rendez-vous : ${b.client_name}`,
    body: `${b.client_name} a réservé « ${b.service_name} » avec ${b.staff_name} le ${frDate(b.start_at)}. Tél : ${b.client_phone || '—'}`
      + (b.style_json ? `\nCoupe souhaitée (studio 3D) : ${require('./styles').describeStyle(JSON.parse(b.style_json))}` : ''),
  }),
};

/** Forwards a stored notification to the real channels (see mailer.js) and flags it delivered. */
function deliver(notificationId, payload) {
  return send(payload)
    .then((ok) => { if (ok) run('UPDATE notifications SET delivered = 1 WHERE id = ?', notificationId); return ok; })
    .catch((err) => { console.error('[notify]', err.message); return false; });
}

/**
 * Queues a notification: stored in the `notifications` table (visible in the pro dashboard)
 * and sent through Brevo and/or NOTIFY_WEBHOOK_URL when configured.
 */
function notify(kind, bookingId) {
  const b = bookingContext(bookingId);
  if (!b || !templates[kind]) return;
  b.salon_slug = one('SELECT slug FROM salons WHERE id = ?', b.salon_id)?.slug;
  const { subject, body } = templates[kind](b);
  const toPro = kind === 'new_booking_pro';
  const recipients = toPro
    ? [{ channel: 'email', to: one('SELECT email FROM salons WHERE id = ?', b.salon_id)?.email || '' }]
    : [{ channel: 'email', to: b.client_email }, ...(b.client_phone && ['reminder', 'confirmation'].includes(kind) ? [{ channel: 'sms', to: b.client_phone }] : [])];

  for (const r of recipients) {
    if (!r.to || r.to.endsWith('.invalid')) continue;
    // SMS reminder: short, and asks for a 1 / 2 answer when two-way SMS is set up.
    const text = r.channel === 'sms' && kind === 'reminder'
      ? `${b.salon_name} : rappel de votre RDV « ${b.service_name} » le ${frDate(b.start_at)}.${require('./mailer').twilioSms() ? ' Répondez 1 pour confirmer, 2 pour annuler.' : ` Déplacer : ${APP_URL}/rdv.html?t=${b.token}`}`
      : body;
    const info = run(
      'INSERT INTO notifications (salon_id, booking_id, kind, channel, recipient, subject, body) VALUES (?,?,?,?,?,?,?)',
      b.salon_id, b.id, kind, r.channel, r.to, subject, text,
    );
    deliver(info.lastInsertRowid, {
      kind, channel: r.channel, to: r.to, subject, body: text, booking_id: b.id, salon_id: b.salon_id,
      fromName: toPro ? 'Lumea Pro' : b.salon_name, replyTo: toPro ? undefined : b.salon_email || undefined,
    });
  }
}

function notifyWaitlist(salonId, serviceId, date) {
  const rows = all('SELECT * FROM waitlist WHERE salon_id = ? AND service_id = ? AND date = ? AND notified = 0', salonId, serviceId, date);
  const salon = one('SELECT name, slug FROM salons WHERE id = ?', salonId);
  for (const w of rows) {
    const subject = `Un créneau vient de se libérer chez ${salon.name}`;
    const body = `Bonjour ${w.name}, une place s'est libérée le ${date}. Réservez vite : ${APP_URL}/salon.html?s=${salon.slug}&service=${serviceId}&date=${date}`;
    const info = run('INSERT INTO notifications (salon_id, kind, channel, recipient, subject, body) VALUES (?,?,?,?,?,?)', salonId, 'waitlist', 'email', w.email, subject, body);
    run('UPDATE waitlist SET notified = 1 WHERE id = ?', w.id);
    deliver(info.lastInsertRowid, { kind: 'waitlist', channel: 'email', to: w.email, subject, body, salon_id: salonId, fromName: salon.name });
  }
}

/** Periodic automation: 24h reminders and post-visit review requests. */
function runAutomations() {
  require('./billing').releaseUnpaidHolds();
  const now = T.now();
  const in24h = T.addMinutes(now.iso, 24 * 60);
  const due = all(
    "SELECT id FROM bookings WHERE status = 'confirmed' AND payment_status != 'pending' AND reminder_sent = 0 AND start_at > ? AND start_at <= ?",
    now.iso, in24h,
  );
  for (const { id } of due) {
    run('UPDATE bookings SET reminder_sent = 1 WHERE id = ?', id);
    notify('reminder', id);
  }
  const twoHoursAgo = T.addMinutes(now.iso, -120);
  const done = all(
    `SELECT b.id FROM bookings b LEFT JOIN reviews r ON r.booking_id = b.id
     WHERE b.status IN ('confirmed','completed') AND b.review_requested = 0 AND b.end_at <= ? AND r.id IS NULL`,
    twoHoursAgo,
  );
  for (const { id } of done) {
    run('UPDATE bookings SET review_requested = 1 WHERE id = ?', id);
    notify('review', id);
  }
  return { reminders: due.length, reviews: done.length, rebooks: runRebookReminders(now), birthdays: runBirthdays(now), winbacks: runWinback(now) };
}

/** "Time for your next cut": X weeks after a completed visit, if the client has nothing booked since. */
function runRebookReminders(now) {
  const rows = all(
    `SELECT b.id, b.client_id, b.salon_id, b.service_id, b.staff_id, sv.name AS service_name, sv.rebook_weeks, s.name AS salon_name, s.slug, s.email AS salon_email,
            c.name AS client_name, c.email AS client_email, st.name AS staff_name
     FROM bookings b JOIN services sv ON sv.id = b.service_id JOIN salons s ON s.id = b.salon_id JOIN clients c ON c.id = b.client_id JOIN staff st ON st.id = b.staff_id
     WHERE b.status = 'completed' AND b.rebook_sent = 0 AND sv.rebook_weeks > 0 AND sv.active = 1
       AND date(substr(b.start_at,1,10), '+' || (sv.rebook_weeks * 7) || ' days') <= ?
       AND substr(b.start_at,1,10) >= date(?, '-120 days')
       AND NOT EXISTS (SELECT 1 FROM bookings nb WHERE nb.client_id = b.client_id AND nb.start_at > b.start_at AND nb.status != 'cancelled')`,
    now.date, now.date,
  );
  for (const r of rows) {
    run('UPDATE bookings SET rebook_sent = 1 WHERE id = ?', r.id);
    if (r.client_email.endsWith('.invalid')) continue;
    const subject = `${r.client_name.split(' ')[0]}, c’est le moment de revenir chez ${r.salon_name}`;
    const body = `Bonjour ${r.client_name.split(' ')[0]},\n\nVotre dernier rendez-vous « ${r.service_name} » date de ${r.rebook_weeks} semaines : c’est le bon moment pour l’entretenir.\n`
      + `Réservez en 30 secondes avec ${r.staff_name} : ${APP_URL}/salon.html?s=${r.slug}&service=${r.service_id}\n\nÀ bientôt !`;
    const info = run("INSERT INTO notifications (salon_id, booking_id, kind, channel, recipient, subject, body) VALUES (?,?, 'rebook', 'email', ?,?,?)", r.salon_id, r.id, r.client_email, subject, body);
    deliver(info.lastInsertRowid, { kind: 'rebook', channel: 'email', to: r.client_email, subject, body, salon_id: r.salon_id, fromName: r.salon_name, replyTo: r.salon_email || undefined });
  }
  return rows.length;
}

/** Birthday message with the salon's offer, once a year, from 9:00 on the day. */
function runBirthdays(now) {
  if (now.min < 9 * 60) return 0;
  const year = Number(now.date.slice(0, 4));
  const rows = all(
    `SELECT c.*, s.name AS salon_name, s.slug, s.birthday_offer, s.email AS salon_email FROM clients c JOIN salons s ON s.id = c.salon_id
     WHERE c.birthday = ? AND c.birthday_sent_year < ? AND s.birthday_offer != '' AND c.email NOT LIKE '%.invalid'`,
    now.date.slice(5), year,
  );
  for (const c of rows) {
    run('UPDATE clients SET birthday_sent_year = ? WHERE id = ?', year, c.id);
    const subject = `Joyeux anniversaire ${c.name.split(' ')[0]} ! 🎂`;
    const body = `Bonjour ${c.name.split(' ')[0]},\n\nToute l’équipe de ${c.salon_name} vous souhaite un très joyeux anniversaire !\nPour l’occasion : ${c.birthday_offer}.\n\nRéservez ici : ${APP_URL}/salon.html?s=${c.slug}`;
    const info = run("INSERT INTO notifications (salon_id, kind, channel, recipient, subject, body) VALUES (?, 'birthday', 'email', ?,?,?)", c.salon_id, c.email, subject, body);
    deliver(info.lastInsertRowid, { kind: 'birthday', channel: 'email', to: c.email, subject, body, salon_id: c.salon_id, fromName: c.salon_name, replyTo: c.salon_email || undefined });
  }
  return rows.length;
}

/**
 * "We miss you": clients whose last visit is older than the salon's threshold (90 days by default), with nothing booked,
 * who accepted offers, get one message with the salon's offer — at most every 6 months, from 10:00.
 */
function runWinback(now) {
  if (now.min < 10 * 60) return 0;
  const rows = all(
    `SELECT c.id, c.name, c.email, c.salon_id, s.name AS salon_name, s.slug, s.email AS salon_email, s.winback_offer, s.winback_days, MAX(b.start_at) AS last_visit
     FROM clients c JOIN salons s ON s.id = c.salon_id JOIN bookings b ON b.client_id = c.id AND b.status = 'completed'
     WHERE s.winback_enabled = 1 AND c.marketing_opt_in = 1 AND c.email != '' AND c.email NOT LIKE '%.invalid'
       AND (c.winback_sent_at = '' OR c.winback_sent_at < date(?, '-180 days'))
       AND NOT EXISTS (SELECT 1 FROM bookings f WHERE f.client_id = c.id AND f.status = 'confirmed')
     GROUP BY c.id
     HAVING substr(last_visit, 1, 10) <= date(?, '-' || s.winback_days || ' days') AND substr(last_visit, 1, 10) >= date(?, '-365 days')
     LIMIT 200`, now.date, now.date, now.date,
  );
  const { unsubscribeToken } = require('./auth');
  for (const c of rows) {
    run('UPDATE clients SET winback_sent_at = ? WHERE id = ?', now.date, c.id);
    const first = c.name.split(' ')[0];
    const subject = `${first}, vous nous manquez chez ${c.salon_name}`;
    const body = `Bonjour ${first},

Cela fait un moment que nous ne vous avons pas vu(e) chez ${c.salon_name} !`
      + `${c.winback_offer ? `
Pour votre retour : ${c.winback_offer}.` : ''}

Réservez en 30 secondes : ${APP_URL}/salon.html?s=${c.slug}

À très vite,
${c.salon_name}`
      + `

Ne plus recevoir nos offres : ${APP_URL}/api/public/unsubscribe/${unsubscribeToken(c.id)}`;
    const info = run("INSERT INTO notifications (salon_id, kind, channel, recipient, subject, body) VALUES (?, 'winback', 'email', ?,?,?)", c.salon_id, c.email, subject, body);
    deliver(info.lastInsertRowid, { kind: 'winback', channel: 'email', to: c.email, subject, body, salon_id: c.salon_id, fromName: c.salon_name, replyTo: c.salon_email || undefined });
  }
  return rows.length;
}

module.exports = { notify, notifyWaitlist, runAutomations, runWinback, APP_URL, euros, frDate };
