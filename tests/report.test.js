'use strict';
// Morning briefing: content, once a day, the owner gets the salon, each collaborator their own day.
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-06T06:30'; // Tuesday, before the 7:00 report
process.env.SESSION_SECRET = 'test-secret';
delete process.env.ANTHROPIC_API_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSalon } = require('../server/salons');
const { createBooking } = require('../server/bookings');
const { run, one, all } = require('../server/db');
const report = require('../server/report');

test('daily report: content, timing, no duplicates, per-collaborator', async () => {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('boss@test.ch', 'x', 'Boss', 'pro')").lastInsertRowid);
  const salon = createSalon(uid, {
    name: 'Barber Report', city: 'Sion', hours: [{ weekday: 2, open: '08:00', close: '18:00' }],
    services: [{ name: 'Coupe', duration_min: 30, price_cents: 4000 }, { name: 'Barbe', duration_min: 30, price_cents: 2500 }],
    staff: [{ name: 'Marco' }, { name: 'Sara' }],
  });
  run('UPDATE salons SET email = ?, min_notice_min = 0 WHERE id = ?', 'salon@test.ch', salon.id);
  const [coupe, barbe] = all('SELECT id FROM services WHERE salon_id = ? ORDER BY id', salon.id).map((r) => r.id);
  const [marco, sara] = all('SELECT id FROM staff WHERE salon_id = ? ORDER BY id', salon.id).map((r) => r.id);
  run("INSERT INTO users (email, password_hash, name, role, staff_id) VALUES ('sara@test.ch', 'x', 'Sara', 'staff', ?)", sara);

  const b1 = createBooking({ salonId: salon.id, serviceId: coupe, staffId: marco, date: '2026-10-06', time: '09:00', customer: { name: 'Luca', email: 'luca@test.ch', phone: '+41790000001', notes: 'dégradé bas' }, source: 'pro' });
  createBooking({ salonId: salon.id, serviceId: barbe, staffId: sara, date: '2026-10-06', time: '10:00', customer: { name: 'Noah', email: 'noah@test.ch', phone: '+41790000002' }, source: 'phone' });
  run("UPDATE clients SET birthday = '10-06' WHERE id = ?", b1.client_id);
  run(`INSERT INTO ai_conversations (salon_id, channel, external_id, customer_name, status, outcome) VALUES (?, 'phone', 'CA1', 'Mme Keller', 'to_handle', 'Message : devis mariage, rappeler après 17 h')`, salon.id);

  const b = report.brief(one('SELECT * FROM salons WHERE id = ?', salon.id), '2026-10-06');
  assert.equal(b.count, 2);
  assert.equal(b.expected_cents, 6500);
  assert.ok(b.bookings[0].flags.includes('anniversaire aujourd’hui 🎂'));
  assert.ok(b.bookings[0].flags.includes('nouveau client'));
  assert.ok(b.bookings[1].flags.includes('réservé par l’assistant IA'));
  const text = report.toText(b);
  assert.match(text, /2 rendez-vous, de 09:00 à 10:30/);
  assert.match(text, /Note : dégradé bas/);
  assert.match(text, /Mme Keller \(appel\) : Message : devis mariage/);

  assert.equal(await report.runDailyReports({ date: '2026-10-06', time: '06:30', min: 390 }), 0, 'not before the chosen hour');
  assert.equal(await report.runDailyReports({ date: '2026-10-06', time: '07:05', min: 425 }), 2, 'owner + Sara');
  assert.equal(await report.runDailyReports({ date: '2026-10-06', time: '07:10', min: 430 }), 0, 'once a day');
  const sent = all("SELECT recipient, body FROM notifications WHERE kind = 'daily_report' ORDER BY id");
  assert.deepEqual(sent.map((n) => n.recipient), ['salon@test.ch', 'sara@test.ch']);
  assert.doesNotMatch(sent[1].body, /Luca/, 'a collaborator only sees their own clients');
  assert.match(sent[1].body, /Noah/);
});
