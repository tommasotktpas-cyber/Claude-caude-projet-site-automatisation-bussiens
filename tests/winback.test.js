'use strict';
// Win-back of inactive clients: who gets it, once, with a working unsubscribe link.
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-06T10:30';
process.env.SESSION_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');
const { createSalon } = require('../server/salons');
const { run, one, all } = require('../server/db');
const { runWinback } = require('../server/notifications');
const T = require('../server/time');

test('only opted-in clients inactive for 90+ days, once, unsubscribe works', async () => {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('wb@test.ch', 'x', 'O', 'pro')").lastInsertRowid);
  const salon = createSalon(uid, { name: 'Salon WB', city: 'Nyon', hours: [], services: [{ name: 'Coupe', duration_min: 30, price_cents: 4000 }], staff: [{ name: 'Al' }] });
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id).id;
  const st = one('SELECT id FROM staff WHERE salon_id = ?', salon.id).id;
  const client = (name, optin, lastVisit, future = false) => {
    const id = Number(run('INSERT INTO clients (salon_id, name, email, phone, marketing_opt_in) VALUES (?,?,?,?,?)', salon.id, name, `${name}@t.ch`, '', optin).lastInsertRowid);
    const book = (start, status) => run("INSERT INTO bookings (salon_id, service_id, staff_id, client_id, start_at, end_at, status, price_cents, token) VALUES (?,?,?,?,?,?,?,4000,?)", salon.id, sv, st, id, start, T.addMinutes(start, 30), status, `${name}-${start}`);
    book(`${lastVisit}T10:00`, 'completed');
    if (future) book('2026-10-20T10:00', 'confirmed');
    return id;
  };
  const lost = client('lost', 1, '2026-06-01');
  client('noconsent', 0, '2026-06-01');
  client('recent', 1, '2026-09-01');
  client('booked', 1, '2026-06-01', true);
  client('tooold', 1, '2025-06-01');

  assert.equal(runWinback({ date: '2026-10-06', time: '09:00', min: 540 }), 0, 'not before 10:00');
  assert.equal(runWinback(T.now()), 1);
  assert.equal(runWinback(T.now()), 0, 'once');
  const n = one("SELECT recipient, body FROM notifications WHERE kind = 'winback'");
  assert.equal(n.recipient, 'lost@t.ch');
  assert.match(n.body, /-10 % sur votre prochaine visite/);

  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const link = /\/api\/public\/unsubscribe\/\S+/.exec(n.body)[0];
  const page = await (await fetch(`http://127.0.0.1:${server.address().port}${link}`)).text();
  assert.match(page, /ne recevrez plus/);
  assert.equal(one('SELECT marketing_opt_in FROM clients WHERE id = ?', lost).marketing_opt_in, 0);
  const forged = await (await fetch(`http://127.0.0.1:${server.address().port}/api/public/unsubscribe/${lost + 1}.AAAAAAAAAAAAAAAAAAAAAA`)).text();
  assert.match(forged, /Lien invalide/);
  server.close();
  assert.equal(all('SELECT id FROM clients WHERE marketing_opt_in = 0').length, 2);
});
