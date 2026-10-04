'use strict';
// Two-way SMS: "1" confirms, "2" cancels (late = deposit kept), free text goes to Messages.
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-05T10:00'; // Monday
process.env.SESSION_SECRET = 'test-secret';
process.env.TWILIO_ACCOUNT_SID = 'AC123';
process.env.TWILIO_SMS_FROM = '+41225550000';
delete process.env.TWILIO_AUTH_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');
const { createSalon } = require('../server/salons');
const { createBooking } = require('../server/bookings');
const { run, one } = require('../server/db');

let base;
let server;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const sms = async (from, body) => (await fetch(`${base}/api/sms/incoming`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: from, Body: body }) })).text();

test('reply 1 confirms, 2 cancels, text goes to the salon', async () => {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('sms@test.ch', 'x', 'O', 'pro')").lastInsertRowid);
  const salon = createSalon(uid, { name: 'Salon SMS', city: 'Fribourg', hours: [{ weekday: 2, open: '09:00', close: '18:00' }], services: [{ name: 'Coupe', duration_min: 30, price_cents: 4000 }], staff: [{ name: 'Eva' }] });
  run('UPDATE salons SET cancel_hours = 24, min_notice_min = 0 WHERE id = ?', salon.id);
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id).id;
  const b = createBooking({ salonId: salon.id, serviceId: sv, staffId: null, date: '2026-10-06', time: '09:00', customer: { name: 'Tom Roy', email: 'tom@test.ch', phone: '079 123 45 67' }, source: 'pro' });

  assert.match(await sms('+41791234567', 'Oui 1'), /c’est confirmé/);
  assert.equal(one('SELECT client_confirmed FROM bookings WHERE id = ?', b.id).client_confirmed, 1);

  assert.match(await sms('+41791234567', 'Je serai 10 min en retard'), /transmis au salon/);
  assert.ok(one("SELECT id FROM ai_conversations WHERE external_id LIKE 'sms-%' AND status = 'to_handle'"));

  // 23 h before: past the free window, still cancelled so the slot is freed.
  assert.match(await sms('0041 79 123 45 67', '2'), /est annulé/);
  assert.equal(one('SELECT status FROM bookings WHERE id = ?', b.id).status, 'cancelled');
  assert.match(await sms('+41791234567', '1'), /pas trouvé/);
  assert.match(await sms('+41780000000', '1'), /pas trouvé/);
});
