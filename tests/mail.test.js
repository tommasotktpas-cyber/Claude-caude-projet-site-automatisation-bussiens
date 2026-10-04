'use strict';
// Gmail / Outlook connection against fake providers, with AI sorting and the keyword fallback.
process.env.DB_PATH = ':memory:';
process.env.SESSION_SECRET = 'test-secret';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
process.env.MS_CLIENT_ID = 'ms-client';
process.env.MS_CLIENT_SECRET = 'ms-secret';
delete process.env.ANTHROPIC_API_KEY;

const test = require('node:test');
const assert = require('node:assert/strict');

const now = Date.now();
const gmailMessages = {
  g1: { id: 'g1', threadId: 't1', snippet: 'Bonjour, pourriez-vous déplacer mon rendez-vous de jeudi ? Merci, Léa', internalDate: String(now - 3600e3), payload: { headers: [{ name: 'From', value: '"Léa Rossi" <lea@example.com>' }, { name: 'Subject', value: 'Mon rendez-vous' }] } },
  g2: { id: 'g2', threadId: 't2', snippet: 'Votre facture n° 2210 de 480.00 CHF arrive à échéance le 15.10.', internalDate: String(now - 7200e3), payload: { headers: [{ name: 'From', value: 'Coiffure Pro SA <factures@coiffurepro.ch>' }, { name: 'Subject', value: 'Rappel : facture 2210' }] } },
  g3: { id: 'g3', threadId: 't3', snippet: '-40 % sur toute la gamme ce week-end ! Se désabonner', internalDate: String(now - 9000e3), payload: { headers: [{ name: 'From', value: 'Promo Beauté <news@promo.ch>' }, { name: 'Subject', value: 'Offre spéciale' }] } },
};
const realFetch = global.fetch;
const seen = [];
global.fetch = async (url, opts = {}) => {
  const u = String(url);
  const ok = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  if (u === 'https://oauth2.googleapis.com/token') {
    seen.push(new URLSearchParams(opts.body));
    return ok({ access_token: 'g-access', refresh_token: 'g-refresh-secret', expires_in: 3600 });
  }
  if (u.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/profile')) return ok({ emailAddress: 'Salon@Gmail.com' });
  if (u.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) return ok({ messages: Object.keys(gmailMessages).map((id) => ({ id })) });
  const m = /messages\/(\w+)\?format=metadata/.exec(u);
  if (m) return ok(gmailMessages[m[1]]);
  if (u === 'https://login.microsoftonline.com/common/oauth2/v2.0/token') return ok({ access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600 });
  if (u.startsWith('https://graph.microsoft.com/v1.0/me?')) return ok({ mail: null, userPrincipalName: 'salon@outlook.com' });
  if (u.startsWith('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages')) {
    return ok({ value: [{ id: 'o1', conversationId: 'c1', subject: 'Livraison de votre commande', from: { emailAddress: { name: 'Fournisseur', address: 'shop@fournisseur.ch' } }, receivedDateTime: new Date(now).toISOString(), bodyPreview: 'Votre commande 553 a été expédiée.', webLink: 'https://outlook.live.com/x' }] });
  }
  return realFetch(url, opts);
};

const { createApp } = require('../server/index');
const { createSalon } = require('../server/salons');
const { run, one, all } = require('../server/db');
const { hashPassword } = require('../server/auth');
const ai = require('../server/ai');

let base;
let server;
let cookie;
let salon;
test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('owner@test.ch', ?, 'Owner', 'pro')", hashPassword('password123')).lastInsertRowid);
  salon = createSalon(uid, { name: 'Salon Mail', city: 'Lausanne', hours: [], services: [{ name: 'Coupe', duration_min: 30, price_cents: 4000 }], staff: [{ name: 'Ana' }] });
  const login = await realFetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'owner@test.ch', password: 'password123' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
test.after(() => server.close());

const get = async (path) => (await realFetch(base + path, { headers: { Cookie: cookie } })).json();

async function connect(provider) {
  const { url } = await get(`/api/pro/mail/connect/${provider}`);
  const state = new URL(url).searchParams.get('state');
  return realFetch(`${base}/api/mail/callback/${provider}?state=${state}&code=abc`, { redirect: 'manual', headers: { Cookie: cookie } });
}

test('Gmail: read-only consent, encrypted tokens, AI sorting', async () => {
  const { url } = await get('/api/pro/mail/connect/gmail');
  const u = new URL(url);
  assert.match(u.searchParams.get('scope'), /gmail\.readonly/);
  assert.equal(u.searchParams.get('access_type'), 'offline');

  const prompts = [];
  ai.setClient({
    beta: {
      messages: {
        create: async (p) => {
          prompts.push(p);
          assert.equal(p.output_config.format.type, 'json_schema');
          const ids = Object.fromEntries(all('SELECT provider_id, id FROM mail_messages').map((r) => [r.provider_id, r.id]));
          return {
            stop_reason: 'end_turn',
            content: [{ type: 'text', text: JSON.stringify({ items: [
              { id: ids.g1, category: 'client', priority: 'haute', summary: 'Léa veut déplacer son RDV de jeudi.', action: 'Proposer un autre créneau' },
              { id: ids.g2, category: 'facture', priority: 'haute', summary: 'Facture Coiffure Pro 480 CHF, échéance 15.10.', action: 'Payer avant le 15.10' },
              { id: ids.g3, category: 'promo', priority: 'basse', summary: 'Publicité.', action: '' },
            ] }) }],
          };
        },
      },
    },
  });
  const cb = await connect('gmail');
  assert.equal(cb.headers.get('location'), '/app?mail=ok#emails');
  const acc = one('SELECT * FROM mail_accounts WHERE salon_id = ?', salon.id);
  assert.equal(acc.email, 'salon@gmail.com');
  assert.ok(!acc.refresh_token.includes('g-refresh-secret'), 'refresh token is encrypted at rest');
  assert.equal(require('../server/mail').unseal(acc.refresh_token), 'g-refresh-secret');
  assert.match(prompts[0].system, /n'exécute jamais/);

  const inbox = await get('/api/pro/mail');
  assert.deepEqual(inbox.messages.map((m) => m.provider_id), ['g1', 'g2'], 'promo hidden, urgent first');
  assert.equal(inbox.messages[0].action, 'Proposer un autre créneau');

  // A state can only be used once.
  const { url: url2 } = await get('/api/pro/mail/connect/gmail');
  const state = new URL(url2).searchParams.get('state');
  await realFetch(`${base}/api/mail/callback/gmail?state=${state}&code=x`, { redirect: 'manual', headers: { Cookie: cookie } });
  const replay = await realFetch(`${base}/api/mail/callback/gmail?state=${state}&code=x`, { redirect: 'manual', headers: { Cookie: cookie } });
  assert.match(replay.headers.get('location'), /mail_error=/);
});

test('Outlook without an AI key: keyword sorting', async () => {
  ai.setClient(null);
  const cb = await connect('outlook');
  assert.equal(cb.headers.get('location'), '/app?mail=ok#emails');
  const m = one("SELECT * FROM mail_messages WHERE provider_id = 'o1'");
  assert.equal(m.category, 'fournisseur');
  const d = await (await realFetch(`${base}/api/pro/mail/digest`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' })).json();
  assert.match(d.text, /Payer avant le 15\.10/);
});

test('callback refuses another logged-in user', async () => {
  const { url } = await get('/api/pro/mail/connect/gmail');
  const state = new URL(url).searchParams.get('state');
  const r = await realFetch(`${base}/api/mail/callback/gmail?state=${state}&code=abc`, { redirect: 'manual' });
  assert.match(r.headers.get('location'), /mail_error=/);
});
