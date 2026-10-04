'use strict';
const { one, run, tx } = require('./db');
const T = require('./time');
const { getSlots, pickStaff } = require('./availability');
const { notify, notifyWaitlist } = require('./notifications');
const { randomToken } = require('./auth');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function validateCustomer(c = {}, { requireEmail = true } = {}) {
  const customer = {
    name: clean(c.name, 120),
    email: clean(c.email, 160).toLowerCase(),
    phone: clean(c.phone, 40),
    notes: clean(c.notes, 500),
    marketing: c.marketing ? 1 : 0,
    birthday: /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(String(c.birthday || '').slice(5)) ? String(c.birthday).slice(5) : (/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(c.birthday || '') ? c.birthday : ''),
  };
  if (customer.name.length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  if (!customer.email && !requireEmail) {
    // Walk-in / phone booking without e-mail: unique placeholder, never notified (see notifications.js).
    customer.email = `client-${randomToken(6).toLowerCase()}@sans-email.invalid`;
  }
  if (!EMAIL_RE.test(customer.email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  return customer;
}

function upsertClient(salonId, customer, userId) {
  const existing = one('SELECT id FROM clients WHERE salon_id = ? AND email = ?', salonId, customer.email);
  if (existing) {
    run(
      `UPDATE clients SET name = ?, phone = CASE WHEN ? != '' THEN ? ELSE phone END,
         user_id = COALESCE(user_id, ?), marketing_opt_in = MAX(marketing_opt_in, ?),
         birthday = CASE WHEN ? != '' THEN ? ELSE birthday END WHERE id = ?`,
      customer.name, customer.phone, customer.phone, userId ?? null, customer.marketing, customer.birthday, customer.birthday, existing.id,
    );
    return existing.id;
  }
  return Number(run(
    'INSERT INTO clients (salon_id, user_id, name, email, phone, marketing_opt_in, birthday) VALUES (?,?,?,?,?,?,?)',
    salonId, userId ?? null, customer.name, customer.email, customer.phone, customer.marketing, customer.birthday,
  ).lastInsertRowid);
}

/**
 * Creates a booking atomically: availability is re-checked inside an IMMEDIATE transaction,
 * so two clients can never grab the same slot.
 */
function createBooking({ salonId, serviceId, staffId = null, date, time, customer, userId = null, source = 'online', force = false, style = null }) {
  if (!T.isDate(date) || !T.isTime(time)) throw new HttpError(400, 'Date ou heure invalide.');
  const cust = validateCustomer(customer, { requireEmail: !['pro', 'phone', 'chat'].includes(source) });
  const salon = one('SELECT * FROM salons WHERE id = ?', salonId);
  const service = one('SELECT * FROM services WHERE id = ? AND salon_id = ?', Number(serviceId), salonId);
  if (!salon || !service || (!service.active && !force)) throw new HttpError(404, 'Prestation introuvable.');
  const billing = require('./billing');
  if (!['pro'].includes(source) && !billing.salonActive(salon)) throw new HttpError(403, 'La réservation en ligne est momentanément indisponible pour ce salon. Merci de le contacter directement.');
  // No online deposit for bookings made by the salon or by the AI assistant (phone / chat).
  const mode = ['pro', 'phone', 'chat'].includes(source) ? 'off' : billing.depositMode(salon);

  let dealPct = 0;
  const id = tx(() => {
    let chosenStaff;
    if (force && staffId) {
      chosenStaff = Number(staffId);
      if (!one('SELECT id FROM staff WHERE id = ? AND salon_id = ?', chosenStaff, salonId)) throw new HttpError(400, 'Collaborateur invalide.');
    } else {
      const { slots } = getSlots({ salonId, serviceId: service.id, date, staffId, ignoreNotice: source === 'pro' });
      const slot = slots.find((s) => s.time === time);
      if (!slot) throw new HttpError(409, 'Ce créneau vient d’être pris. Merci d’en choisir un autre.');
      chosenStaff = pickStaff(slot.staff_ids, date);
      if (source !== 'pro') dealPct = slot.deal || 0;
    }
    const clientId = upsertClient(salonId, cust, userId);
    const start = `${date}T${time}`;
    const price = Math.round((service.price_cents * (100 - dealPct)) / 100);
    const deposit = mode === 'off' ? 0 : Math.round((price * salon.deposit_percent) / 100);
    // Real deposits hold the slot as "pending" until Stripe confirms payment (released after 30 min otherwise).
    const pending = mode === 'stripe' && deposit > 0;
    return Number(run(
      `INSERT INTO bookings (salon_id, service_id, staff_id, client_id, user_id, start_at, end_at, price_cents,
         deposit_cents, paid_cents, source, token, notes, payment_status, deal_percent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      salonId, service.id, chosenStaff, clientId, userId, start, T.addMinutes(start, service.duration_min),
      price, deposit, pending ? 0 : deposit, source, randomToken(), cust.notes, pending ? 'pending' : 'none', dealPct,
    ).lastInsertRowid);
  });

  // Client's 3D style sheet (only for services where the salon enabled the studio).
  const sheet = service.studio ? require('./styles').sanitizeStyle(style, salon) : null;
  if (sheet) {
    const { image, ...rest } = sheet;
    run('UPDATE bookings SET style_json = ?, style_image = ? WHERE id = ?', JSON.stringify(rest), image || null, id);
  }
  const booking = one('SELECT * FROM bookings WHERE id = ?', id);
  if (booking.payment_status !== 'pending') {
    notify('confirmation', id);
    if (source !== 'pro') notify('new_booking_pro', id);
  }
  return booking;
}

function cancelBooking(booking, { byClient = false } = {}) {
  if (booking.status !== 'confirmed') throw new HttpError(400, 'Ce rendez-vous ne peut plus être annulé.');
  if (byClient) {
    const salon = one('SELECT cancel_hours FROM salons WHERE id = ?', booking.salon_id);
    if (T.diffMinutes(T.now().iso, booking.start_at) < salon.cancel_hours * 60) {
      throw new HttpError(400, `Annulation en ligne possible jusqu’à ${salon.cancel_hours} h avant le rendez-vous. Merci de contacter le salon.`);
    }
  }
  run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", booking.id);
  // Cancelled within the allowed window (or by the salon): the deposit goes back to the client.
  if (booking.payment_status === 'paid') require('./billing').refundDeposit(booking);
  if (booking.payment_status !== 'pending') notify('cancelled', booking.id);
  notifyWaitlist(booking.salon_id, booking.service_id, booking.start_at.slice(0, 10));
}

function rescheduleBooking(booking, { date, time, staffId = null, byClient = false }) {
  if (booking.status !== 'confirmed') throw new HttpError(400, 'Ce rendez-vous ne peut plus être modifié.');
  if (!T.isDate(date) || !T.isTime(time)) throw new HttpError(400, 'Date ou heure invalide.');
  if (byClient) {
    const salon = one('SELECT cancel_hours FROM salons WHERE id = ?', booking.salon_id);
    if (T.diffMinutes(T.now().iso, booking.start_at) < salon.cancel_hours * 60) {
      throw new HttpError(400, `Modification en ligne possible jusqu’à ${salon.cancel_hours} h avant le rendez-vous.`);
    }
  }
  const oldDate = booking.start_at.slice(0, 10);
  tx(() => {
    const { slots } = getSlots({
      salonId: booking.salon_id, serviceId: booking.service_id, date, staffId, excludeBookingId: booking.id, ignoreNotice: !byClient,
    });
    const slot = slots.find((s) => s.time === time);
    if (!slot) throw new HttpError(409, 'Créneau indisponible.');
    const staff = slot.staff_ids.includes(booking.staff_id) ? booking.staff_id : pickStaff(slot.staff_ids, date);
    const service = one('SELECT duration_min FROM services WHERE id = ?', booking.service_id);
    const start = `${date}T${time}`;
    run(
      'UPDATE bookings SET start_at = ?, end_at = ?, staff_id = ?, reminder_sent = 0 WHERE id = ?',
      start, T.addMinutes(start, service.duration_min), staff, booking.id,
    );
  });
  notify('rescheduled', booking.id);
  if (oldDate !== date) notifyWaitlist(booking.salon_id, booking.service_id, oldDate);
  return one('SELECT * FROM bookings WHERE id = ?', booking.id);
}

/** Status change by the salon. Completing a visit credits loyalty points (1 point per franc spent). */
function setStatus(booking, status) {
  if (!['confirmed', 'completed', 'no_show', 'cancelled'].includes(status)) throw new HttpError(400, 'Statut invalide.');
  if (status === 'cancelled') return cancelBooking(booking);
  tx(() => {
    run('UPDATE bookings SET status = ? WHERE id = ?', status, booking.id);
    if (status === 'completed' && booking.status !== 'completed') {
      run('UPDATE bookings SET paid_cents = price_cents WHERE id = ?', booking.id);
      const salon = one('SELECT loyalty_enabled FROM salons WHERE id = ?', booking.salon_id);
      if (salon.loyalty_enabled && booking.user_id) {
        run('UPDATE users SET loyalty_points = loyalty_points + ? WHERE id = ?', Math.floor(booking.price_cents / 100), booking.user_id);
      }
    }
  });
}

module.exports = { HttpError, createBooking, cancelBooking, rescheduleBooking, setStatus, validateCustomer, clean, EMAIL_RE };
