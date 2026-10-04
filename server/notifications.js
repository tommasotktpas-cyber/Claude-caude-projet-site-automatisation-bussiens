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
    const info = run(
      'INSERT INTO notifications (salon_id, booking_id, kind, channel, recipient, subject, body) VALUES (?,?,?,?,?,?,?)',
      b.salon_id, b.id, kind, r.channel, r.to, subject, body,
    );
    deliver(info.lastInsertRowid, {
      kind, channel: r.channel, to: r.to, subject, body, booking_id: b.id, salon_id: b.salon_id,
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
  return { reminders: due.length, reviews: done.length };
}

module.exports = { notify, notifyWaitlist, runAutomations, APP_URL, euros, frDate };
