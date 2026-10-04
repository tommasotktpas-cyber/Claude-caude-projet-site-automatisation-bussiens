'use strict';
const express = require('express');
const { one, all, run, tx } = require('../db');
const T = require('../time');
const { requireRole } = require('../auth');
const { getSlots } = require('../availability');
const { createBooking, rescheduleBooking, setStatus, HttpError, clean } = require('../bookings');
const { CATEGORIES } = require('../salons');
const { runAutomations, APP_URL } = require('../notifications');
const { PLANS } = require('../plans');

const router = express.Router();
router.use(requireRole('pro', 'admin'));
router.use((req, _res, next) => {
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
  if (!b) throw new HttpError(404, 'Rendez-vous introuvable.');
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
  res.json({
    salon: s,
    hours: all('SELECT weekday, open, close FROM opening_hours WHERE salon_id = ? ORDER BY weekday, open', s.id),
    categories: CATEGORIES,
    plans: PLANS,
    links: {
      page: `${APP_URL}/salon.html?s=${s.slug}`,
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
       deposit_percent=?, cancel_hours=?, buffer_min=?, slot_step=?, min_notice_min=?, max_days_ahead=?, loyalty_enabled=?, published=?
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

router.post('/plan', (req, res) => {
  const plan = req.body?.plan;
  if (!PLANS.some((p) => p.id === plan)) throw new HttpError(400, 'Formule inconnue.');
  // Billing integration point (Stripe Checkout / Billing): see README "Paiements".
  run('UPDATE salons SET plan = ? WHERE id = ?', plan, req.salon.id);
  res.json({ ok: true });
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
  return { name, category: clean(b.category, 60) || 'Prestations', description: clean(b.description, 500), duration, price, active: b.active === false ? 0 : 1 };
}

router.post('/services', (req, res) => {
  const f = serviceFields(req.body || {});
  const id = tx(() => {
    const pos = one('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM services WHERE salon_id = ?', req.salon.id).p;
    const sid = Number(run('INSERT INTO services (salon_id, name, category, description, duration_min, price_cents, active, position) VALUES (?,?,?,?,?,?,?,?)',
      req.salon.id, f.name, f.category, f.description, f.duration, f.price, f.active, pos).lastInsertRowid);
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
  const r = run('UPDATE services SET name=?, category=?, description=?, duration_min=?, price_cents=?, active=? WHERE id=? AND salon_id=?',
    f.name, f.category, f.description, f.duration, f.price, f.active, Number(req.params.id), req.salon.id);
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
      `SELECT b.*, sv.name AS service_name, st.name AS staff_name, st.color AS staff_color,
              c.name AS client_name, c.phone AS client_phone, c.email AS client_email
       FROM bookings b JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id JOIN clients c ON c.id = b.client_id
       WHERE b.salon_id = ? AND b.start_at >= ? AND b.start_at < ? ORDER BY b.start_at`,
      req.salon.id, `${from}T00:00`, `${T.addDays(to, 1)}T00:00`,
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
  const booking = createBooking({
    salonId: req.salon.id, serviceId: b.service_id, staffId: b.staff_id ? Number(b.staff_id) : null,
    date: b.date, time: b.time, customer: b.customer, source: 'pro', force: !!b.force,
  });
  res.status(201).json({ id: booking.id });
});

router.patch('/bookings/:id', (req, res) => {
  const booking = ownBooking(req);
  const b = req.body || {};
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

module.exports = router;
