'use strict';
// AI receptionist (phone via Twilio + website chat) against a scripted fake Claude client.
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-06T09:10'; // Tuesday, salon open 09:00–12:00
process.env.SESSION_SECRET = 'test-secret';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TWILIO_AUTH_TOKEN;

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createApp } = require('../server/index');
const { createSalon } = require('../server/salons');
const { run, one } = require('../server/db');
const { hashPassword } = require('../server/auth');
const ai = require('../server/ai');

let base;
let server;
const TODAY = '2026-10-06';

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

function makeSalon(email) {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?, 'pro')", email, hashPassword('password123'), 'Owner').lastInsertRowid);
  const salon = createSalon(uid, {
    name: 'Barber Test', city: 'Genève',
    hours: [{ weekday: 2, open: '09:00', close: '12:00' }],
    services: [{ name: 'Coupe', duration_min: 30, price_cents: 4000 }],
    staff: [{ name: 'Marco' }],
  });
  return { ...salon, service: one('SELECT id FROM services WHERE salon_id = ?', salon.id).id };
}

/** Fake Messages API: each call runs the next scripted step, which can inspect the request. */
function script(steps) {
  const calls = [];
  ai.setClient({
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          const step = steps.shift();
          assert.ok(step, 'unexpected extra model call');
          return step(params);
        },
      },
    },
  });
  return calls;
}
const toolUse = (name, input, id = `tu_${name}_${Math.random().toString(36).slice(2, 8)}`) => ({ type: 'tool_use', id, name, input });
const lastToolResults = (params) => params.messages.at(-1).content.filter((b) => b.type === 'tool_result');

async function form(path, body, headers = {}) {
  const res = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(body) });
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') };
}
async function json(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

test('phone: rings the salon, then the AI answers, refuses a too-close slot and books', async () => {
  const salon = makeSalon('phone@test.ch');
  run("UPDATE salons SET ai_phone_enabled = 1, ai_twilio_number = '+41 22 555 00 00', ai_forward_phone = '+41 79 111 22 33', ai_ring_seconds = 12, min_notice_min = 0 WHERE id = ?", salon.id);
  const call = { To: '+41225550000', From: '+41791234567', CallSid: 'CA123' };

  const incoming = await form('/api/voice/incoming', call);
  assert.match(incoming.type, /xml/);
  assert.match(incoming.text, /<Dial timeout="12" action="\/api\/voice\/after-dial"/);
  assert.match(incoming.text, /<Number>\+41791112233<\/Number>/);

  const answered = await form('/api/voice/after-dial', { ...call, DialCallStatus: 'completed' });
  assert.match(answered.text, /<Hangup\/>/);
  const missed = await form('/api/voice/after-dial', { ...call, DialCallStatus: 'no-answer' });
  assert.match(missed.text, /<Gather input="speech"/);
  assert.match(missed.text, /intelligence artificielle/, 'the assistant says it is an AI');

  const calls = script([
    (p) => {
      assert.equal(p.model, 'claude-opus-5-5');
      assert.equal(p.fallbacks, 'default');
      assert.equal(p.system[0].cache_control.type, 'ephemeral');
      assert.ok(p.tools.every((t) => t.strict === true));
      assert.match(p.messages[0].content, /2026-10-06 09:10/);
      assert.match(p.messages[0].content, /\+41791234567/);
      return { stop_reason: 'tool_use', content: [toolUse('check_availability', { service_id: salon.service, date: TODAY, staff_id: null })] };
    },
    (p) => {
      const out = JSON.parse(lastToolResults(p)[0].content);
      assert.equal(out.available_times[0], '10:00', 'nothing before now + 45 min');
      assert.ok(!out.available_times.includes('09:30'));
      return { stop_reason: 'tool_use', content: [toolUse('book_appointment', { service_id: salon.service, date: TODAY, time: '09:30', staff_id: null, customer_name: 'Luca', customer_phone: null, notes: null })] };
    },
    (p) => {
      const [r] = lastToolResults(p);
      assert.equal(r.is_error, true);
      assert.match(r.content, /Trop proche/);
      return { stop_reason: 'tool_use', content: [toolUse('book_appointment', { service_id: salon.service, date: TODAY, time: '10:00', staff_id: null, customer_name: 'Luca', customer_phone: null, notes: 'dégradé' })] };
    },
    (p) => {
      assert.equal(JSON.parse(lastToolResults(p)[0].content).ok, true);
      return { stop_reason: 'tool_use', content: [{ type: 'text', text: "C'est noté, Luca : mardi à dix heures avec Marco. Au revoir !" }, toolUse('end_call', {})] };
    },
  ]);
  const turn = await form('/api/voice/turn', { ...call, SpeechResult: 'Bonjour, je voudrais une coupe ce matin à neuf heures et demie.' });
  assert.equal(calls.length, 4);
  assert.match(turn.text, /C&apos;est noté|C'est noté/);
  assert.match(turn.text, /<Hangup\/>/);

  const b = one("SELECT b.*, c.phone, c.name FROM bookings b JOIN clients c ON c.id = b.client_id WHERE b.salon_id = ?", salon.id);
  assert.equal(b.start_at, `${TODAY}T10:00`);
  assert.equal(b.source, 'phone');
  assert.equal(b.name, 'Luca');
  assert.equal(b.phone, '+41791234567');
  const conv = one("SELECT * FROM ai_conversations WHERE salon_id = ? AND channel = 'phone'", salon.id);
  assert.equal(conv.status, 'done');
  assert.equal(conv.booking_id, b.id);
  assert.match(conv.outcome, /RDV réservé/);
});

test('phone: a slow model turn answers with a filler and a redirect', async () => {
  const salon = makeSalon('slow@test.ch');
  run("UPDATE salons SET ai_phone_enabled = 1, ai_twilio_number = '022 555 11 11' WHERE id = ?", salon.id);
  let release;
  script([() => new Promise((r) => { release = () => r({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Quel jour vous arrangerait ?' }] }); })]);
  const call = { To: '+41225551111', From: '+41790000001', CallSid: 'CA-slow' };
  const t0 = Date.now();
  const turn = await form('/api/voice/turn', { ...call, SpeechResult: 'Je voudrais un rendez-vous.' });
  assert.ok(Date.now() - t0 >= 3900);
  assert.match(turn.text, /<Redirect method="POST">\/api\/voice\/result<\/Redirect>/);
  setTimeout(release, 50);
  const result = await form('/api/voice/result', call);
  assert.match(result.text, /<Gather input="speech"[^>]*><Say[^>]*>Quel jour vous arrangerait \?<\/Say><\/Gather>/);
});

test('Twilio signature is required when the auth token is set', async () => {
  const salon = makeSalon('sig@test.ch');
  run("UPDATE salons SET ai_twilio_number = '+41 22 555 22 22' WHERE id = ?", salon.id);
  process.env.TWILIO_AUTH_TOKEN = 'twilio-secret';
  try {
    const params = { To: '+41225552222', CallSid: 'CA-sig' };
    assert.equal((await form('/api/voice/incoming', params)).status, 403);
    const url = `${base}/api/voice/incoming`;
    const sig = crypto.createHmac('sha1', 'twilio-secret').update(url + Object.keys(params).sort().map((k) => k + params[k]).join('')).digest('base64');
    const ok = await form('/api/voice/incoming', params, { 'X-Twilio-Signature': sig });
    assert.equal(ok.status, 200);
  } finally {
    delete process.env.TWILIO_AUTH_TOKEN;
  }
});

test('website chat: AI answers, the team takes over, then the AI stays silent', async () => {
  const salon = makeSalon('chat@test.ch');
  script([() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Bonjour ! Pour quelle prestation ?' }] })]);
  const first = await json(`/api/public/salons/${salon.slug}/chat`, { method: 'POST', body: { text: 'Bonjour, vous êtes ouverts samedi ?' } });
  assert.equal(first.status, 200);
  assert.ok(first.body.session.length >= 16);
  assert.equal(first.body.reply, 'Bonjour ! Pour quelle prestation ?');
  assert.equal(first.body.human, false);

  const login = await json('/api/auth/login', { method: 'POST', body: { email: 'chat@test.ch', password: 'password123' } });
  const list = await json('/api/pro/conversations', { cookie: login.cookie });
  assert.equal(list.body.conversations.length, 1);
  const id = list.body.conversations[0].id;
  const reply = await json(`/api/pro/conversations/${id}/reply`, { method: 'POST', cookie: login.cookie, body: { text: 'Bonjour, oui de 9h à 16h ! Marco' } });
  assert.equal(reply.body.messages.at(-1).from, 'team');

  const calls = script([]); // any model call would fail the test
  const second = await json(`/api/public/salons/${salon.slug}/chat`, { method: 'POST', body: { session: first.body.session, text: 'Super, merci !' } });
  assert.equal(second.body.reply, null);
  assert.equal(second.body.human, true);
  assert.equal(calls.length, 0);
  const poll = await json(`/api/public/salons/${salon.slug}/chat/${first.body.session}`);
  assert.deepEqual(poll.body.messages.map((m) => m.from), ['client', 'assistant', 'team', 'client']);
  const inbox = await json('/api/pro/conversations', { cookie: login.cookie });
  assert.equal(inbox.body.conversations[0].unread, 1);
  assert.equal(inbox.body.to_handle, 1);
});

test('without an API key the chat still reaches the team', async () => {
  const salon = makeSalon('nokey@test.ch');
  ai.setClient(null);
  const r = await json(`/api/public/salons/${salon.slug}/chat`, { method: 'POST', body: { text: 'Avez-vous de la place demain ?' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.human, true);
  assert.equal(one("SELECT status FROM ai_conversations WHERE salon_id = ?", salon.id).status, 'to_handle');
});

test('simulator never books for real', async () => {
  const salon = makeSalon('sim@test.ch');
  script([
    () => ({ stop_reason: 'tool_use', content: [toolUse('book_appointment', { service_id: salon.service, date: TODAY, time: '11:00', staff_id: null, customer_name: 'Test', customer_phone: '+41790000000', notes: null })] }),
    (p) => {
      assert.equal(JSON.parse(lastToolResults(p)[0].content).test_mode, true);
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Réservé (test).' }] };
    },
  ]);
  const login = await json('/api/auth/login', { method: 'POST', body: { email: 'sim@test.ch', password: 'password123' } });
  const r = await json('/api/pro/assistant/test', { method: 'POST', cookie: login.cookie, body: { text: 'Une coupe à 11h' } });
  assert.equal(r.body.reply, 'Réservé (test).');
  assert.equal(one('SELECT COUNT(*) AS n FROM bookings WHERE salon_id = ?', salon.id).n, 0);
  const settings = await json('/api/pro/assistant', { cookie: login.cookie });
  assert.equal(settings.body.settings.ai_min_notice_min, 45);
  const upd = await json('/api/pro/assistant', { method: 'PUT', cookie: login.cookie, body: { ai_min_notice_min: 5, ai_phone_enabled: true } });
  assert.equal(upd.status, 200);
  assert.equal(one('SELECT ai_min_notice_min FROM salons WHERE id = ?', salon.id).ai_min_notice_min, 15, 'never less than 15 minutes');
});
