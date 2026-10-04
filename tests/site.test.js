'use strict';
// Website builder: section order, FAQ, contact form wired to « Messages ».
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');
const { createSalon } = require('../server/salons');
const { run, one } = require('../server/db');
const { hashPassword } = require('../server/auth');

let base;
let server;
let cookie;
let salon;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('site@test.ch', ?, 'Owner', 'pro')", hashPassword('password123')).lastInsertRowid);
  salon = createSalon(uid, { name: 'Salon Site', city: 'Bienne', description: 'Coiffure de quartier.', hours: [{ weekday: 2, open: '09:00', close: '18:00' }], services: [{ name: 'Coupe', duration_min: 30, price_cents: 4000 }], staff: [{ name: 'Lou' }] });
  run("UPDATE salons SET email = 'salon@site.ch' WHERE id = ?", salon.id);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'site@test.ch', password: 'password123' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
test.after(() => server.close());

test('sections follow the chosen order; FAQ is rendered and sanitised', async () => {
  const put = await fetch(`${base}/api/pro/site`, {
    method: 'PUT', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ published: true, content: { order: ['faq', 'contact', 'services', 'bogus', 'faq'], faq: [{ q: 'Parking ?', a: 'Oui, <b>gratuit</b>.' }, { q: 'vide', a: '' }] } }),
  });
  assert.equal(put.status, 200);
  const html = await (await fetch(`${base}/s/${salon.slug}`)).text();
  const pos = (id) => html.indexOf(`<section id="${id}"`);
  assert.ok(pos('faq') > 0 && pos('faq') < pos('contact') && pos('contact') < pos('services') && pos('services') < pos('infos'));
  assert.match(html, /<summary>Parking \?<\/summary><p>Oui, &lt;b&gt;gratuit&lt;\/b&gt;\.<\/p>/);
  assert.doesNotMatch(html, /summary>vide</);
  assert.match(html, /<a href="#faq">FAQ<\/a><a href="#contact">Contact<\/a><a href="#services">/);
});

test('contact form lands in Messages, bots are ignored', async () => {
  const send = (body) => fetch(`${base}/api/public/salons/${salon.slug}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await send({ name: 'Bot', phone: 'x@y.ch', message: 'spam', website: 'http://spam' })).status, 200);
  assert.equal((await send({ name: '', phone: '', message: '' })).status, 400);
  assert.equal((await send({ name: 'Julie', phone: 'julie@mail.ch', message: 'Faites-vous les extensions ?' })).status, 201);
  const conv = one("SELECT * FROM ai_conversations WHERE salon_id = ? AND external_id LIKE 'contact-%'", salon.id);
  assert.equal(conv.customer_name, 'Julie');
  assert.equal(conv.status, 'to_handle');
  assert.equal(conv.human_mode, 1);
  const list = await (await fetch(`${base}/api/pro/conversations`, { headers: { Cookie: cookie } })).json();
  assert.equal(list.conversations.length, 1, 'the bot message was dropped');
  assert.equal(list.conversations[0].contact_form, true);
  assert.ok(one("SELECT id FROM notifications WHERE kind = 'contact' AND recipient = 'salon@site.ch'"));
});
