'use strict';
// "Continuer avec Google / Apple" against fake identity providers.
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.APPLE_CLIENT_ID = 'ch.lumea.web';
process.env.APPLE_TEAM_ID = 'TEAM123';
process.env.APPLE_KEY_ID = 'KEY123';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const appleDevKey = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
process.env.APPLE_PRIVATE_KEY = appleDevKey.privateKey.export({ type: 'pkcs8', format: 'pem' });
const idpKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...idpKey.publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };

function idToken(claims) {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600, ...claims })).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), idpKey.privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

let nextClaims = {};
const tokenRequests = [];
const realFetch = global.fetch;
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.endsWith('/certs') || u.endsWith('/auth/keys')) return new Response(JSON.stringify({ keys: [jwk] }));
  if (u === 'https://oauth2.googleapis.com/token' || u === 'https://appleid.apple.com/auth/token') {
    tokenRequests.push({ url: u, body: new URLSearchParams(opts.body) });
    return new Response(JSON.stringify({ id_token: idToken(nextClaims) }));
  }
  return realFetch(url, opts);
};

const { createApp } = require('../server/index');
const { one } = require('../server/db');

let base;
let server;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

async function start(provider) {
  const res = await realFetch(`${base}/api/auth/oauth/${provider}/start?next=/compte`, { redirect: 'manual' });
  const loc = new URL(res.headers.get('location'));
  return { state: loc.searchParams.get('state'), nonce: loc.searchParams.get('nonce'), loc };
}

test('providers are listed when configured', async () => {
  const list = await (await realFetch(`${base}/api/auth/providers`)).json();
  assert.deepEqual(list.map((p) => p.id), ['google', 'apple']);
});

test('Google sign-in creates a client account and opens a session', async () => {
  const { state, nonce, loc } = await start('google');
  assert.equal(loc.host, 'accounts.google.com');
  nextClaims = { iss: 'https://accounts.google.com', aud: 'google-client', sub: 'g-123', email: 'Lea@Gmail.com', email_verified: true, name: 'Léa Rossi', nonce };
  const cb = await realFetch(`${base}/api/auth/oauth/google/callback?state=${state}&code=abc`, { redirect: 'manual' });
  assert.equal(cb.headers.get('location'), '/compte');
  const cookie = cb.headers.get('set-cookie').split(';')[0];
  const me = await (await realFetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  assert.equal(me.user.email, 'lea@gmail.com');
  assert.equal(me.user.name, 'Léa Rossi');
  assert.equal(me.user.role, 'client');

  const replay = await realFetch(`${base}/api/auth/oauth/google/callback?state=${state}&code=abc`, { redirect: 'manual' });
  assert.match(replay.headers.get('location'), /erreur=/, 'a state can only be used once');
});

test('tampered or wrong-audience tokens are rejected', async () => {
  const { state, nonce } = await start('google');
  nextClaims = { iss: 'https://accounts.google.com', aud: 'someone-else', sub: 'g-999', email: 'x@gmail.com', email_verified: true, nonce };
  const cb = await realFetch(`${base}/api/auth/oauth/google/callback?state=${state}&code=abc`, { redirect: 'manual' });
  assert.match(cb.headers.get('location'), /erreur=/);
  assert.equal(one("SELECT COUNT(*) AS n FROM users WHERE email = 'x@gmail.com'").n, 0);
});

test('Apple sign-in (form_post) with a signed client secret and first-login name', async () => {
  const { state, nonce } = await start('apple');
  nextClaims = { iss: 'https://appleid.apple.com', aud: 'ch.lumea.web', sub: 'a-1', email: 'tom@privaterelay.appleid.com', email_verified: 'true', nonce };
  const cb = await realFetch(`${base}/api/auth/oauth/apple/callback`, {
    method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ state, code: 'xyz', user: JSON.stringify({ name: { firstName: 'Tom', lastName: 'Favre' } }) }),
  });
  assert.equal(cb.headers.get('location'), '/compte');
  assert.equal(one("SELECT name FROM users WHERE email = 'tom@privaterelay.appleid.com'").name, 'Tom Favre');
  const secret = tokenRequests.at(-1).body.get('client_secret');
  const [h, p, sig] = secret.split('.');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key: appleDevKey.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')), 'ES256 client secret');
});
