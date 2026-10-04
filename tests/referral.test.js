'use strict';
// Salon referral: 60-day trial for the newcomer, one free month for the referrer once it pays.
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-06T10:00';
process.env.SESSION_SECRET = 'test-secret';
delete process.env.STRIPE_SECRET_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');
const { one } = require('../server/db');
const billing = require('../server/billing');

let base;
let server;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = async (path, body, cookie) => {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
};

test('referral link, longer trial, reward once', async () => {
  const a = await post('/api/auth/register-pro', { email: 'a@salon.ch', password: 'password123', name: 'Anna', salon_name: 'Salon A', city: 'Genève', category: 'coiffure' });
  const ref = await (await fetch(`${base}/api/pro/referral`, { headers: { Cookie: a.cookie } })).json();
  assert.match(ref.link, /\/pro\?ref=[A-Z0-9]+$/);
  const salonA = one("SELECT * FROM salons WHERE name = 'Salon A'");
  const trialA = salonA.trial_ends_at;

  await post('/api/auth/register-pro', { email: 'b@salon.ch', password: 'password123', name: 'Ben', salon_name: 'Salon B', city: 'Genève', category: 'barbier', ref: ref.code });
  const b = one("SELECT * FROM salons WHERE name = 'Salon B'");
  assert.equal(b.referred_by, salonA.id);
  assert.equal(b.trial_ends_at > trialA, true, '60 days instead of 30');

  billing.activatePlan(b.id, 'essentiel');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(one('SELECT trial_ends_at FROM salons WHERE id = ?', salonA.id).trial_ends_at > trialA, true, 'referrer on trial: +30 days');
  const after = one('SELECT trial_ends_at FROM salons WHERE id = ?', salonA.id).trial_ends_at;
  billing.activatePlan(b.id, 'premium');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(one('SELECT trial_ends_at FROM salons WHERE id = ?', salonA.id).trial_ends_at, after, 'rewarded only once');

  // Paying referrer without Stripe: credit recorded for the admin.
  billing.activatePlan(salonA.id, 'essentiel');
  await post('/api/auth/register-pro', { email: 'c@salon.ch', password: 'password123', name: 'Cy', salon_name: 'Salon C', city: 'Sion', category: 'coiffure', ref: ref.code });
  billing.activatePlan(one("SELECT id FROM salons WHERE name = 'Salon C'").id, 'essentiel');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(one('SELECT referral_credit_months FROM salons WHERE id = ?', salonA.id).referral_credit_months, 1);
  const st = await (await fetch(`${base}/api/pro/referral`, { headers: { Cookie: a.cookie } })).json();
  assert.equal(st.referred.length, 2);
  assert.equal(st.rewarded, 2);

  const self = await post('/api/auth/register-pro', { email: 'd@salon.ch', password: 'password123', name: 'Di', salon_name: 'Salon D', city: 'Sion', category: 'coiffure', ref: 'NOPE00' });
  assert.equal(self.status, 201, 'an unknown code is simply ignored');
});
