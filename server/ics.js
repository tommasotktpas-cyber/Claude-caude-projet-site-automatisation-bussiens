'use strict';
const { TZ } = require('./time');

const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => `\\${m}`);
const stamp = (iso) => iso.replace(/[-:]/g, '') + '00';

/** Builds an iCalendar document; times are local to the salon timezone (TZID). */
function buildIcs(calName, events) {
  const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lumea//Booking//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(calName)}`, `X-WR-TIMEZONE:${TZ}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${now}`,
      `DTSTART;TZID=${TZ}:${stamp(e.start)}`, `DTEND;TZID=${TZ}:${stamp(e.end)}`,
      `SUMMARY:${esc(e.summary)}`, `LOCATION:${esc(e.location)}`, `DESCRIPTION:${esc(e.description)}`,
      `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

module.exports = { buildIcs };
