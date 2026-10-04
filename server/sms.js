'use strict';
// Answers to the SMS reminder (Twilio inbound webhook): "1" confirms, "2" cancels and frees the slot
// (the waitlist is told at once). Anything else is passed to the salon in « Messages ».
const express = require('express');
const { one, all, run } = require('./db');
const T = require('./time');
const { cancelBooking } = require('./bookings');
const { validSignature } = require('./voice');
const { randomToken } = require('./auth');

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reply = (text) => `<?xml version="1.0" encoding="UTF-8"?><Response>${text ? `<Message>${xml(text)}</Message>` : ''}</Response>`;

/** The client's next appointment (within 3 days) matching the phone number. */
function nextBooking(phone) {
  const d = digits(phone);
  if (!d) return null;
  const now = T.now().iso;
  return all(
    `SELECT b.*, c.phone AS client_phone, c.name AS client_name, s.name AS salon_name, s.cancel_hours FROM bookings b
     JOIN clients c ON c.id = b.client_id JOIN salons s ON s.id = b.salon_id
     WHERE b.status = 'confirmed' AND b.start_at > ? AND b.start_at <= ? ORDER BY b.start_at`, now, T.addMinutes(now, 72 * 60),
  ).find((b) => digits(b.client_phone) === d) || null;
}

function handle(from, text) {
  const b = nextBooking(from);
  const answer = String(text || '').trim().toLowerCase();
  if (!b) return 'Nous n’avons pas trouvé de rendez-vous à venir pour ce numéro. Contactez directement le salon.';
  const when = `${b.start_at.slice(8, 10)}.${b.start_at.slice(5, 7)} à ${b.start_at.slice(11, 16).replace(':', 'h')}`;
  if (/^(1|oui|ok|confirm)/.test(answer)) {
    run('UPDATE bookings SET client_confirmed = 1 WHERE id = ?', b.id);
    return `Merci ${b.client_name.split(' ')[0]}, c’est confirmé : à bientôt chez ${b.salon_name} (${when}).`;
  }
  if (/^(2|non|annul)/.test(answer)) {
    const late = T.diffMinutes(T.now().iso, b.start_at) < b.cancel_hours * 60;
    cancelBooking(b, { byClient: true, late });
    return `Votre rendez-vous du ${when} chez ${b.salon_name} est annulé.${late && b.payment_status === 'paid' ? ' L’acompte est conservé (annulation tardive).' : ''} Merci de nous avoir prévenus !`;
  }
  // Free text: forwarded to the salon.
  run(
    `INSERT INTO ai_conversations (salon_id, channel, external_id, customer_name, customer_phone, transcript, outcome, status, unread, human_mode)
     VALUES (?, 'chat', ?, ?, ?, ?, ?, 'to_handle', 1, 1)`,
    b.salon_id, `sms-${randomToken(9)}`, b.client_name, b.client_phone,
    JSON.stringify([{ from: 'client', text: String(text).slice(0, 1000), at: T.now().iso }]), `SMS : ${String(text).slice(0, 200)}`,
  );
  return 'Message transmis au salon, qui vous répondra. Pour confirmer répondez 1, pour annuler 2.';
}

function router() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '32kb' }));
  r.post('/incoming', (req, res) => {
    if (!validSignature(req)) return res.status(403).send('Invalid signature');
    let text;
    try { text = handle(req.body.From, req.body.Body); } catch (err) { text = err.status ? err.message : 'Erreur, contactez le salon.'; }
    res.type('text/xml').send(reply(text));
  });
  return r;
}

module.exports = { router, handle, nextBooking };
