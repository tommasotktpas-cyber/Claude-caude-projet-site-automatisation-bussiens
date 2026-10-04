'use strict';
// All appointment times are stored as salon-local wall-clock strings: "YYYY-MM-DDTHH:MM".
// This keeps the agenda readable and avoids DST drift for a single-timezone business.

const TZ = process.env.APP_TZ || 'Europe/Zurich';

const pad = (n) => String(n).padStart(2, '0');
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
};
const fromMin = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function weekday(date) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Current salon-local date/time. Overridable for tests via LUMEA_NOW="YYYY-MM-DDTHH:MM". */
function now() {
  if (process.env.LUMEA_NOW) {
    const [date, time] = process.env.LUMEA_NOW.split('T');
    return { date, time, min: toMin(time), iso: process.env.LUMEA_NOW };
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}`;
  return { date, time, min: toMin(time), iso: `${date}T${time}` };
}

/** Adds minutes to a local ISO string ("YYYY-MM-DDTHH:MM"). */
function addMinutes(iso, minutes) {
  const [date, time] = iso.split('T');
  const total = toMin(time) + minutes;
  const dayShift = Math.floor(total / 1440);
  return `${addDays(date, dayShift)}T${fromMin(((total % 1440) + 1440) % 1440)}`;
}

/** Minutes between two local ISO strings (b - a). */
function diffMinutes(a, b) {
  const toAbs = (iso) => {
    const [date, time] = iso.split('T');
    return Date.parse(`${date}T00:00:00Z`) / 60000 + toMin(time);
  };
  return toAbs(b) - toAbs(a);
}

module.exports = { TZ, pad, toMin, fromMin, isDate, isTime, weekday, addDays, now, addMinutes, diffMinutes };
