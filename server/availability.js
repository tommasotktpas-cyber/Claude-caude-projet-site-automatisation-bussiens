'use strict';
const { one, all } = require('./db');
const T = require('./time');

/** Intersects two sorted lists of [start, end) minute intervals. */
function intersect(a, b) {
  const out = [];
  for (const [s1, e1] of a) {
    for (const [s2, e2] of b) {
      const s = Math.max(s1, s2);
      const e = Math.min(e1, e2);
      if (s < e) out.push([s, e]);
    }
  }
  return out.sort((x, y) => x[0] - y[0]);
}

/** Minute intervals during which a staff member is busy on `date` (bookings + time off). */
function busyIntervals(staffId, date, bufferMin, excludeBookingId = 0) {
  const busy = [];
  const bookings = all(
    `SELECT start_at, end_at FROM bookings
     WHERE staff_id = ? AND status != 'cancelled' AND id != ?
       AND start_at < ? AND end_at > ?`,
    staffId, excludeBookingId, `${date}T24:00`, `${date}T00:00`,
  );
  for (const b of bookings) {
    const s = b.start_at.startsWith(date) ? T.toMin(b.start_at.slice(11)) : 0;
    const e = b.end_at.startsWith(date) ? T.toMin(b.end_at.slice(11)) : 1440;
    busy.push([s, e + bufferMin]);
  }
  const offs = all(
    'SELECT start_at, end_at FROM time_off WHERE staff_id = ? AND start_at < ? AND end_at > ?',
    staffId, `${date}T24:00`, `${date}T00:00`,
  );
  for (const o of offs) {
    const s = o.start_at.startsWith(date) ? T.toMin(o.start_at.slice(11)) : 0;
    const e = o.end_at.startsWith(date) ? T.toMin(o.end_at.slice(11)) : 1440;
    busy.push([s, e]);
  }
  return busy;
}

/**
 * Computes bookable start times.
 * @returns {{ slots: {time: string, staff_ids: number[]}[], reason?: string }}
 */
function getSlots({ salonId, serviceId, date, staffId = null, excludeBookingId = 0, ignoreNotice = false }) {
  const salon = one('SELECT * FROM salons WHERE id = ?', salonId);
  const service = one('SELECT * FROM services WHERE id = ? AND salon_id = ? AND active = 1', serviceId, salonId);
  if (!salon || !service) return { slots: [], reason: 'Prestation introuvable.' };
  if (!ignoreNotice && !require('./billing').salonActive(salon)) return { slots: [], reason: 'Réservation en ligne momentanément indisponible. Contactez le salon.' };
  if (!T.isDate(date)) return { slots: [], reason: 'Date invalide.' };

  const now = T.now();
  if (!ignoreNotice) {
    if (date < now.date) return { slots: [], reason: 'Date passée.' };
    if (date > T.addDays(now.date, salon.max_days_ahead)) return { slots: [], reason: 'Date trop éloignée.' };
  }

  const wd = T.weekday(date);
  const opening = all('SELECT open, close FROM opening_hours WHERE salon_id = ? AND weekday = ? ORDER BY open', salonId, wd)
    .map((h) => [T.toMin(h.open), T.toMin(h.close)]);
  if (!opening.length) return { slots: [], reason: 'Salon fermé ce jour-là.' };

  let staffList = all(
    `SELECT s.id FROM staff s JOIN staff_services ss ON ss.staff_id = s.id
     WHERE s.salon_id = ? AND s.active = 1 AND ss.service_id = ?`,
    salonId, serviceId,
  ).map((s) => s.id);
  if (staffId) staffList = staffList.filter((id) => id === Number(staffId));
  if (!staffList.length) return { slots: [], reason: 'Aucun collaborateur disponible pour cette prestation.' };

  const step = Math.max(5, salon.slot_step);
  const dur = service.duration_min;
  const buf = salon.buffer_min;
  const earliest = !ignoreNotice && date === now.date ? now.min + salon.min_notice_min : -1;

  const byTime = new Map();
  for (const sid of staffList) {
    const hours = all('SELECT start, end FROM staff_hours WHERE staff_id = ? AND weekday = ? ORDER BY start', sid, wd)
      .map((h) => [T.toMin(h.start), T.toMin(h.end)]);
    const working = intersect(opening, hours);
    if (!working.length) continue;
    const busy = busyIntervals(sid, date, buf, excludeBookingId);
    for (const [ws, we] of working) {
      for (let t = Math.ceil(ws / step) * step; t + dur <= we; t += step) {
        if (t < earliest) continue;
        const clash = busy.some(([bs, be]) => t < be && bs < t + dur + buf);
        if (clash) continue;
        const key = T.fromMin(t);
        if (!byTime.has(key)) byTime.set(key, []);
        byTime.get(key).push(sid);
      }
    }
  }

  const slots = [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([time, staff_ids]) => ({ time, staff_ids }));
  return { slots, reason: slots.length ? undefined : 'Complet ce jour-là.' };
}

/** Picks the least-loaded staff member among candidates for a given day (balances the agenda). */
function pickStaff(candidates, date) {
  if (candidates.length === 1) return candidates[0];
  let best = candidates[0];
  let bestLoad = Infinity;
  for (const id of candidates) {
    const { n } = one(
      "SELECT COUNT(*) AS n FROM bookings WHERE staff_id = ? AND status != 'cancelled' AND substr(start_at,1,10) = ?",
      id, date,
    );
    if (n < bestLoad) { best = id; bestLoad = n; }
  }
  return best;
}

/** Returns the first N days (from `from`) that have at least one slot — powers "prochaine disponibilité". */
function nextAvailableDays({ salonId, serviceId, staffId = null, from, days = 14, limit = 5 }) {
  const out = [];
  for (let i = 0; i < days && out.length < limit; i++) {
    const date = T.addDays(from, i);
    const { slots } = getSlots({ salonId, serviceId, date, staffId });
    if (slots.length) out.push({ date, count: slots.length, first: slots[0].time });
  }
  return out;
}

module.exports = { getSlots, pickStaff, nextAvailableDays, intersect };
