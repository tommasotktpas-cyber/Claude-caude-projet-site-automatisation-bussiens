'use strict';
// Stripe flows against a fake Stripe API (global fetch is stubbed for api.stripe.com).
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-05T08:00';
process.env.SESSION_SECRET = 'test-secret';
process.env.STRIPE_SECRET_KEY = 'sk_test_fake';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const stripeCalls = [];
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  if (String(url).startsWith('https://api.stripe.com/')) {
    const path = String(url).replace('https://api.stripe.com/v1', '');
    const params = new URLSearchParams(opts.body || '');
    stripeCalls.push({ method: opts.method, path, params, account: opts.headers?.['Stripe-Account'] });
    let body = {};
    if (path === '/checkout/sessions') body = { id: `cs_${stripeCalls.length}`, url: `https://checkout.stripe.test/${stripeCalls.length}` };
    else if (path.startsWith('/checkout/sessions/')) body = { id: path.split('/').pop(), payment_status: 'paid', payment_intent: 'pi_123' };
    else if (path === '/refunds') body = { id: 're_1' };
    else if (path === '/accounts') body = { id: 'acct_salon' };
    else if (path === '/account_links') body = { url: 'https://connect.stripe.test/onboard' };
    else if (path.startsWith('/accounts/')) body = { id: 'acct_salon', charges_enabled: true };
    else if (path.startsWith('/subscriptions/')) body = { id: path.split('/').pop() };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  if (String(url).startsWith('https://api.brevo.com/')) return new Response('{}', { status: 201 });
  return realFetch(url, opts);
};

const { createApp } = require('../server/index');
const { createSalon } = require('../server/salons');
const { run, one } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { runAutomations } = require('../server/notifications');

let base;
let server;
const TUE = '2026-10-06';

async function req(path, { method = 'GET', body, cookie, headers = {}, raw } = {}) {
  const res = await realFetch(base + path, {
    method,
    headers: { ...(body || raw ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

function signed(event) {
  const raw = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
  return { raw, headers: { 'Stripe-Signature': `t=${t},v1=${sig}` } };
}
const webhook = (event) => { const s = signed(event); return req('/api/stripe/webhook', { method: 'POST', raw: s.raw, headers: s.headers }); };

function makeSalon(email, extra = {}) {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?, 'pro')", email, hashPassword('password123'), 'Owner').lastInsertRowid);
  const salon = createSalon(uid, {
    name: `Salon ${email}`, city: 'Genève', email,
    hours: [{ weekday: 2, open: '09:00', close: '12:00' }],
    services: [{ name: 'Coupe', duration_min: 60, price_cents: 10000 }],
    staff: [{ name: 'Alice' }],
    ...extra,
  });
  return salon;
}
const login = async (email) => (await req('/api/auth/login', { method: 'POST', body: { email, password: 'password123' } })).cookie;
const customer = { name: 'Jean Test', email: 'jean@example.com', phone: '079 123 45 67' };

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('webhooks require a valid Stripe signature', async () => {
  const bad = await req('/api/stripe/webhook', { method: 'POST', raw: '{"id":"evt_x","type":"x"}', headers: { 'Stripe-Signature': 't=1,v1=deadbeef' } });
  assert.equal(bad.status, 400);
});

test('plan purchase goes through Stripe Checkout and is activated by the webhook', async () => {
  const salon = makeSalon('plan@test.ch');
  const cookie = await login('plan@test.ch');
  const r = await req('/api/pro/plan', { method: 'POST', cookie, body: { plan: 'premium' } });
  assert.equal(r.status, 200);
  assert.match(r.body.checkout_url, /checkout\.stripe\.test/);
  const call = stripeCalls.at(-1);
  assert.equal(call.params.get('mode'), 'subscription');
  assert.equal(call.params.get('line_items[0][price_data][unit_amount]'), '15800');
  assert.equal(call.params.get('line_items[0][price_data][currency]'), 'chf');
  assert.equal(one('SELECT plan FROM salons WHERE id = ?', salon.id).plan, 'trial', 'not active before payment');

  const event = { id: 'evt_plan', type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', customer: 'cus_1', subscription: 'sub_1', metadata: { kind: 'plan', plan: 'premium', salon_id: String(salon.id) } } } };
  assert.equal((await webhook(event)).status, 200);
  assert.equal((await webhook(event)).body.received, 'duplicate', 'events are idempotent');
  const s = one('SELECT plan, stripe_customer_id, stripe_subscription_id FROM salons WHERE id = ?', salon.id);
  assert.deepEqual({ ...s }, { plan: 'premium', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' });

  await webhook({ id: 'evt_del', type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } });
  const after = one('SELECT * FROM salons WHERE id = ?', salon.id);
  assert.equal(after.plan, 'trial');
  const svc = one('SELECT id FROM services WHERE salon_id = ?', salon.id).id;
  const slots = await req(`/api/public/salons/${after.slug}/slots?service=${svc}&date=${TUE}`);
  assert.match(slots.body.reason, /indisponible/);
  assert.equal(slots.body.slots.length, 0, 'online booking paused when the subscription ends');
});

test('template rental via Stripe, cancelled at period end', async () => {
  const salon = makeSalon('tpl@test.ch');
  run("UPDATE salons SET plan = 'essentiel' WHERE id = ?", salon.id);
  const cookie = await login('tpl@test.ch');
  const r = await req('/api/pro/site/licenses', { method: 'POST', cookie, body: { template: 'zen', billing: 'monthly' } });
  assert.ok(r.body.checkout_url);
  assert.equal(stripeCalls.at(-1).params.get('line_items[0][price_data][unit_amount]'), '2000');
  await webhook({ id: 'evt_tpl', type: 'checkout.session.completed', data: { object: { mode: 'subscription', payment_status: 'paid', subscription: 'sub_tpl', metadata: { kind: 'template', template: 'zen', billing: 'monthly', salon_id: String(salon.id) } } } });
  const lic = one('SELECT * FROM template_licenses WHERE salon_id = ?', salon.id);
  assert.equal(lic.active, 1);
  const del = await req(`/api/pro/site/licenses/${lic.id}`, { method: 'DELETE', cookie });
  assert.equal(del.body.until_period_end, true);
  assert.equal(stripeCalls.at(-1).params.get('cancel_at_period_end'), 'true');
});

test('deposits: 0 % commission direct charge on the salon account, confirm, refund, expiry', async () => {
  const salon = makeSalon('dep@test.ch');
  run("UPDATE salons SET plan = 'essentiel', deposit_percent = 30, cancel_hours = 2 WHERE id = ?", salon.id);

  // Not connected to Stripe yet: no deposit is requested.
  const svc = one('SELECT id FROM services WHERE salon_id = ?', salon.id).id;
  let b = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: svc, date: TUE, time: '09:00', customer } });
  assert.equal(b.status, 201);
  assert.equal(b.body.checkout_url, undefined);
  assert.equal(one('SELECT deposit_cents FROM bookings WHERE token = ?', b.body.token).deposit_cents, 0);

  const cookie = await login('dep@test.ch');
  const c = await req('/api/pro/payments/connect', { method: 'POST', cookie, body: {} });
  assert.match(c.body.url, /connect\.stripe\.test/);
  const st = await req('/api/pro/payments', { cookie });
  assert.equal(st.body.mode, 'stripe');

  b = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: svc, date: TUE, time: '10:00', customer } });
  assert.match(b.body.checkout_url, /checkout\.stripe\.test/);
  const call = stripeCalls.find((x) => x.path === '/checkout/sessions' && x.account === 'acct_salon');
  assert.ok(call, 'charged on the connected account');
  assert.equal(call.params.get('line_items[0][price_data][unit_amount]'), '3000');
  assert.equal(call.params.get('payment_intent_data[application_fee_amount]'), null, 'no platform fee');
  let row = one('SELECT * FROM bookings WHERE token = ?', b.body.token);
  assert.equal(row.payment_status, 'pending');
  assert.equal(one("SELECT COUNT(*) AS n FROM notifications WHERE booking_id = ? AND kind = 'confirmation'", row.id).n, 0, 'no confirmation before payment');

  const conf = await req(`/api/public/bookings/${b.body.token}/confirm-payment`, { method: 'POST', body: {} });
  assert.equal(conf.body.payment_status, 'paid');
  row = one('SELECT * FROM bookings WHERE id = ?', row.id);
  assert.equal(row.paid_cents, 3000);
  assert.ok(one("SELECT COUNT(*) AS n FROM notifications WHERE booking_id = ? AND kind = 'confirmation'", row.id).n >= 1);

  await req(`/api/public/bookings/${b.body.token}/cancel`, { method: 'POST', body: {} });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(stripeCalls.some((x) => x.path === '/refunds' && x.params.get('payment_intent') === 'pi_123' && x.account === 'acct_salon'));
  assert.equal(one('SELECT payment_status FROM bookings WHERE id = ?', row.id).payment_status, 'refunded');

  // Unpaid hold is released after 35 minutes.
  const held = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: svc, date: TUE, time: '11:00', customer } });
  run("UPDATE bookings SET created_at = datetime('now', '-40 minutes') WHERE token = ?", held.body.token);
  runAutomations();
  assert.equal(one('SELECT status FROM bookings WHERE token = ?', held.body.token).status, 'cancelled');
});

test('password reset and CSV import', async () => {
  makeSalon('reset@test.ch');
  await req('/api/auth/forgot', { method: 'POST', body: { email: 'reset@test.ch' } });
  const n = one("SELECT body FROM notifications WHERE kind = 'password_reset' AND recipient = 'reset@test.ch'");
  const token = n.body.match(/reset\.html\?t=([\w-]+)/)[1];
  assert.equal((await req('/api/auth/reset', { method: 'POST', body: { token, password: 'nouveau-mdp-1' } })).status, 200);
  assert.equal((await req('/api/auth/reset', { method: 'POST', body: { token, password: 'encore-un-2' } })).status, 400, 'single use');
  assert.equal((await req('/api/auth/login', { method: 'POST', body: { email: 'reset@test.ch', password: 'nouveau-mdp-1' } })).status, 200);
  assert.equal((await req('/api/auth/forgot', { method: 'POST', body: { email: 'inconnu@test.ch' } })).status, 200, 'no account enumeration');

  const cookie = await login('dep@test.ch');
  const csv = '﻿Prénom;Nom de famille;E-mail;Natel;Remarques\r\nJulie;Muller;julie@x.ch;079 111 22 33;"Couleur 7.1; allergie"\r\nMarc;Favre;;078 999 88 77;\r\n;;;;\r\nX;;;;\r\nJean;Test;jean@example.com;;VIP\r\n';
  const r = await req('/api/pro/clients/import', { method: 'POST', cookie, body: { csv } });
  assert.deepEqual(r.body, { imported: 2, updated: 1, skipped: 1 });
  const julie = one("SELECT * FROM clients WHERE email = 'julie@x.ch'");
  assert.equal(julie.notes, 'Couleur 7.1; allergie');
});
