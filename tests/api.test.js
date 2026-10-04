'use strict';
// End-to-end API tests on an in-memory database with a frozen clock.
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-05T08:00'; // Monday
process.env.SESSION_SECRET = 'test-secret';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server/index');
const { createSalon } = require('../server/salons');
const { run, one } = require('../server/db');
const { hashPassword } = require('../server/auth');
const { runAutomations } = require('../server/notifications');

let base;
let server;
const TUE = '2026-10-06';

async function req(path, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

function makeSalon(email, name) {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?, 'pro')", email, hashPassword('password123'), 'Owner').lastInsertRowid);
  return createSalon(uid, {
    name, city: 'Luxembourg',
    hours: [{ weekday: 2, open: '09:00', close: '12:00' }],
    services: [{ name: 'Coupe', duration_min: 60, price_cents: 5000 }],
    staff: [{ name: 'Alice' }],
  });
}

const customer = { name: 'Jean Test', email: 'jean@example.com', phone: '+352 600' };

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('slots respect opening hours and duration', async () => {
  const salon = makeSalon('a@test.lu', 'Salon A');
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id);
  const r = await req(`/api/public/salons/${salon.slug}/slots?service=${sv.id}&date=${TUE}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.slots[0], '09:00');
  assert.equal(r.body.slots.at(-1), '11:00'); // 60 min service must end by 12:00
  const closed = await req(`/api/public/salons/${salon.slug}/slots?service=${sv.id}&date=2026-10-07`);
  assert.equal(closed.body.slots.length, 0);
});

test('booking blocks the slot and prevents double booking', async () => {
  const salon = makeSalon('b@test.lu', 'Salon B');
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id);
  const ok = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: sv.id, date: TUE, time: '10:00', customer } });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.token);

  const dup = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: sv.id, date: TUE, time: '10:30', customer } });
  assert.equal(dup.status, 409);

  const slots = (await req(`/api/public/salons/${salon.slug}/slots?service=${sv.id}&date=${TUE}`)).body.slots;
  assert.ok(!slots.includes('10:00') && !slots.includes('09:15') && !slots.includes('10:45'));
  assert.ok(slots.includes('09:00') && slots.includes('11:00'));

  const notifs = one("SELECT COUNT(*) AS n FROM notifications WHERE booking_id = ? AND kind = 'confirmation'", ok.body.id).n;
  assert.ok(notifs >= 1, 'confirmation notification queued');
});

test('validation rejects bad input', async () => {
  const salon = makeSalon('c@test.lu', 'Salon C');
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id);
  const bad = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: sv.id, date: TUE, time: '10:00', customer: { name: 'X', email: 'nope' } } });
  assert.equal(bad.status, 400);
  const past = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: sv.id, date: '2026-09-29', time: '10:00', customer } });
  assert.equal(past.status, 409);
});

test('client self-service: cancellation window, reschedule, waitlist', async () => {
  const salon = makeSalon('d@test.lu', 'Salon D');
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id);
  run('UPDATE salons SET cancel_hours = 48 WHERE id = ?', salon.id);
  const b = (await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: sv.id, date: TUE, time: '09:00', customer } })).body;

  const tooLate = await req(`/api/public/bookings/${b.token}/cancel`, { method: 'POST', body: {} });
  assert.equal(tooLate.status, 400, 'cannot cancel within 48h');

  run('UPDATE salons SET cancel_hours = 2 WHERE id = ?', salon.id);
  const wl = await req(`/api/public/salons/${salon.slug}/waitlist`, { method: 'POST', body: { service_id: sv.id, date: TUE, name: 'Wait', email: 'wait@example.com' } });
  assert.equal(wl.status, 201);

  const moved = await req(`/api/public/bookings/${b.token}/reschedule`, { method: 'POST', body: { date: TUE, time: '11:00' } });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.start_at, `${TUE}T11:00`);

  const cancel = await req(`/api/public/bookings/${b.token}/cancel`, { method: 'POST', body: {} });
  assert.equal(cancel.status, 200);
  const w = one("SELECT notified FROM waitlist WHERE email = 'wait@example.com'");
  assert.equal(w.notified, 1, 'waitlist notified when slot frees up');

  const ics = await req(`/api/public/bookings/${b.token}/ics`);
  assert.match(ics.body, /BEGIN:VCALENDAR/);
  assert.match(ics.body, /STATUS:CANCELLED/);
});

test('reviews only after the appointment', async () => {
  const salon = makeSalon('e@test.lu', 'Salon E');
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id);
  const b = (await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: sv.id, date: TUE, time: '09:00', customer } })).body;
  const early = await req(`/api/public/bookings/${b.token}/review`, { method: 'POST', body: { rating: 5 } });
  assert.equal(early.status, 400);
  run("UPDATE bookings SET start_at = '2026-10-01T09:00', end_at = '2026-10-01T10:00', status = 'completed' WHERE token = ?", b.token);
  const ok = await req(`/api/public/bookings/${b.token}/review`, { method: 'POST', body: { rating: 5, comment: 'Top' } });
  assert.equal(ok.status, 201);
  const again = await req(`/api/public/bookings/${b.token}/review`, { method: 'POST', body: { rating: 4 } });
  assert.equal(again.status, 409);
  const page = await req(`/api/public/salons/${salon.slug}`);
  assert.equal(page.body.salon.rating, 5);
  assert.equal(page.body.reviews[0].author_name, 'Jean T.');
});

test('pro API requires auth and isolates salons', async () => {
  const a = makeSalon('f@test.lu', 'Salon F');
  makeSalon('g@test.lu', 'Salon G');
  const svA = one('SELECT id FROM services WHERE salon_id = ?', a.id);
  const bA = (await req(`/api/public/salons/${a.slug}/bookings`, { method: 'POST', body: { service_id: svA.id, date: TUE, time: '09:00', customer } })).body;

  assert.equal((await req('/api/pro/salon')).status, 401);
  const login = await req('/api/auth/login', { method: 'POST', body: { email: 'g@test.lu', password: 'password123' } });
  assert.equal(login.status, 200);
  const forbidden = await req(`/api/pro/bookings/${bA.id}`, { method: 'PATCH', cookie: login.cookie, body: { status: 'cancelled' } });
  assert.equal(forbidden.status, 404, 'salon G cannot touch salon F bookings');
  assert.equal((await req('/api/admin/overview', { cookie: login.cookie })).status, 403);

  const loginA = await req('/api/auth/login', { method: 'POST', body: { email: 'f@test.lu', password: 'password123' } });
  run("UPDATE bookings SET start_at = '2026-10-02T09:00', end_at = '2026-10-02T10:00' WHERE id = ?", bA.id);
  const done = await req(`/api/pro/bookings/${bA.id}`, { method: 'PATCH', cookie: loginA.cookie, body: { status: 'completed' } });
  assert.equal(done.status, 200);
  const stats = await req('/api/pro/stats?days=30', { cookie: loginA.cookie });
  assert.equal(stats.status, 200);
  assert.equal(stats.body.totals.revenue_cents, 5000);
});

test('pro can book walk-ins without e-mail and force a time', async () => {
  makeSalon('h@test.lu', 'Salon H');
  const login = await req('/api/auth/login', { method: 'POST', body: { email: 'h@test.lu', password: 'password123' } });
  const services = (await req('/api/pro/services', { cookie: login.cookie })).body;
  const staff = (await req('/api/pro/staff', { cookie: login.cookie })).body;
  const r = await req('/api/pro/bookings', { method: 'POST', cookie: login.cookie, body: { service_id: services[0].id, date: TUE, time: '09:00', customer: { name: 'Passage' } } });
  assert.equal(r.status, 201);
  const forced = await req('/api/pro/bookings', { method: 'POST', cookie: login.cookie, body: { service_id: services[0].id, staff_id: staff[0].id, date: TUE, time: '13:00', force: true, customer: { name: 'Hors horaires' } } });
  assert.equal(forced.status, 201);
  assert.equal(one("SELECT COUNT(*) AS n FROM notifications WHERE recipient LIKE '%.invalid'").n, 0, 'placeholder e-mails never notified');
});

test('pro signup creates a bookable salon with its own website', async () => {
  const r = await req('/api/auth/register-pro', { method: 'POST', body: { email: 'new@test.lu', password: 'password123', name: 'Nina', salon_name: 'Chez Nina', city: 'Fribourg', category: 'ongles' } });
  assert.equal(r.status, 201);
  const me = await req('/api/auth/me', { cookie: r.cookie });
  assert.equal(me.body.salon.name, 'Chez Nina');
  const site = await req(`/s/${me.body.salon.slug}`);
  assert.equal(site.status, 200);
  assert.match(site.body, /Chez Nina/);
  assert.match(site.body, /application\/ld\+json/);
});

test('website templates: Essentiel must unlock premium templates, Premium gets everything', async () => {
  const salon = makeSalon('web@test.lu', 'Salon Web');
  run("UPDATE salons SET plan = 'essentiel' WHERE id = ?", salon.id);
  const login = await req('/api/auth/login', { method: 'POST', body: { email: 'web@test.lu', password: 'password123' } });
  const cookie = login.cookie;

  const locked = await req('/api/pro/site', { method: 'PUT', cookie, body: { template: 'elegance' } });
  assert.equal(locked.status, 402);
  const css = await req('/api/pro/site', { method: 'PUT', cookie, body: { custom_css: 'body{color:red}' } });
  assert.equal(css.status, 402, 'custom CSS is Premium-only');

  const preview = await req('/api/pro/site/preview', { method: 'POST', cookie, body: { template: 'elegance', content: { hero_title: 'Titre test' } } });
  assert.match(preview.body, /Cormorant/, 'locked templates can still be previewed');
  assert.match(preview.body, /Titre test/);

  assert.equal((await req('/api/pro/site/licenses', { method: 'POST', cookie, body: { template: 'elegance', billing: 'monthly' } })).status, 201);
  const ok = await req('/api/pro/site', { method: 'PUT', cookie, body: { template: 'elegance', content: { hero_title: 'Bienvenue <b>chez nous</b>', gallery: ['javascript:alert(1)', 'https://img.test/a.jpg'] } } });
  assert.equal(ok.status, 200);
  let page = (await req(`/s/${salon.slug}`)).body;
  assert.match(page, /Cormorant/);
  assert.match(page, /Bienvenue &lt;b&gt;chez nous&lt;\/b&gt;/, 'content is escaped');
  assert.doesNotMatch(page, /javascript:alert/);
  assert.match(page, /propulsée par Lumea/);

  const site = (await req('/api/pro/site', { cookie })).body;
  const lic = site.licenses[0];
  assert.equal((await req(`/api/pro/site/licenses/${lic.id}`, { method: 'DELETE', cookie })).status, 200);
  page = (await req(`/s/${salon.slug}`)).body;
  assert.doesNotMatch(page, /Cormorant/, 'falls back to Classique when the rental ends');

  run("UPDATE salons SET plan = 'premium' WHERE id = ?", salon.id);
  const prem = await req('/api/pro/site', { method: 'PUT', cookie, body: { template: 'neon', custom_css: '.x{color:red}', custom_domain: 'www.salon-web.ch', content: { hide_branding: true } } });
  assert.equal(prem.status, 200);
  const byDomain = await fetch(`${base}/`, { headers: { 'X-Forwarded-Host': 'salon-web.ch' } }).then((x) => x.text());
  assert.match(byDomain, /Space Grotesk/, 'custom domain serves the salon site');
  assert.match(byDomain, /\.x\{color:red\}/);
  assert.doesNotMatch(byDomain, /propulsée par Lumea/);
});

test('premium design requests reach the platform admin', async () => {
  const salon = makeSalon('design@test.lu', 'Salon Design');
  run("UPDATE salons SET plan = 'premium' WHERE id = ?", salon.id);
  const login = await req('/api/auth/login', { method: 'POST', body: { email: 'design@test.lu', password: 'password123' } });
  const r = await req('/api/pro/site/design-requests', { method: 'POST', cookie: login.cookie, body: { brief: 'Ambiance minérale, beige et noir, photos de l’équipe.' } });
  assert.equal(r.status, 201);
  run("INSERT INTO users (email, password_hash, name, role) VALUES ('root@test.lu', ?, 'Root', 'admin')", hashPassword('password123'));
  const admin = await req('/api/auth/login', { method: 'POST', body: { email: 'root@test.lu', password: 'password123' } });
  const ov = await req('/api/admin/overview', { cookie: admin.cookie });
  assert.equal(ov.status, 200);
  assert.ok(ov.body.design_requests.some((d) => d.salon_name === 'Salon Design'));
  assert.ok(ov.body.kpis.mrr >= 158);
});

test('automations send 24h reminders once', async () => {
  const salon = makeSalon('i@test.lu', 'Salon I');
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id);
  const b = (await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: sv.id, date: TUE, time: '09:00', customer } })).body;
  runAutomations(); // 25 h before: too early
  process.env.LUMEA_NOW = '2026-10-05T10:00';
  try {
    runAutomations();
    runAutomations();
  } finally {
    process.env.LUMEA_NOW = '2026-10-05T08:00';
  }
  assert.equal(one("SELECT COUNT(*) AS n FROM notifications WHERE booking_id = ? AND kind = 'reminder' AND channel = 'email'", b.id).n, 1);
});

test('employee accounts only see their own agenda', async () => {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('owner2@test.lu', ?, 'Owner', 'pro')", hashPassword('password123')).lastInsertRowid);
  const salon = createSalon(uid, {
    name: 'Salon Equipe', city: 'Lausanne',
    hours: [{ weekday: 2, open: '09:00', close: '12:00' }],
    services: [{ name: 'Coupe', duration_min: 60, price_cents: 5000 }],
    staff: [{ name: 'Alice' }, { name: 'Bob' }],
  });
  const [alice, bob] = require('../server/db').all('SELECT id FROM staff WHERE salon_id = ? ORDER BY id', salon.id).map((s) => s.id);
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id).id;
  const owner = (await req('/api/auth/login', { method: 'POST', body: { email: 'owner2@test.lu', password: 'password123' } })).cookie;
  await req('/api/pro/bookings', { method: 'POST', cookie: owner, body: { service_id: sv, staff_id: alice, date: TUE, time: '09:00', customer: { name: 'Client Alice' } } });
  const bobBooking = await req('/api/pro/bookings', { method: 'POST', cookie: owner, body: { service_id: sv, staff_id: bob, date: TUE, time: '09:00', customer: { name: 'Client Bob' } } });

  const inv = await req(`/api/pro/staff/${alice}/access`, { method: 'POST', cookie: owner, body: { email: 'alice@test.lu' } });
  assert.equal(inv.status, 201);
  const token = inv.body.invite_url.split('t=')[1];
  const set = await req('/api/auth/reset', { method: 'POST', body: { token, password: 'alice-pass-1' } });
  assert.equal(set.body.role, 'staff');
  const cookie = set.cookie;

  const agenda = await req(`/api/pro/agenda?from=${TUE}&to=${TUE}`, { cookie });
  assert.deepEqual(agenda.body.bookings.map((b) => b.client_name), ['Client Alice']);
  assert.equal((await req(`/api/pro/bookings/${bobBooking.body.id}`, { method: 'PATCH', cookie, body: { status: 'cancelled' } })).status, 404);
  for (const path of ['/api/pro/stats', '/api/pro/site', '/api/pro/export/clients.csv']) {
    assert.equal((await req(path, { cookie })).status, 403, path);
  }
  assert.equal((await req('/api/pro/plan', { method: 'POST', cookie, body: { plan: 'premium' } })).status, 403);
  const salonInfo = await req('/api/pro/salon', { cookie });
  assert.equal(salonInfo.body.salon.ical_token, undefined, 'no access to the full agenda feed');

  await req(`/api/pro/staff/${alice}/access`, { method: 'DELETE', cookie: owner });
  assert.equal((await req('/api/pro/agenda', { cookie })).status, 401, 'revoked account is logged out');
});

test('3D studio: style sheet saved with the booking, only offered cuts, visible to the barber', async () => {
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('barber@test.lu', ?, 'Owner', 'pro')", hashPassword('password123')).lastInsertRowid);
  const salon = createSalon(uid, {
    name: 'Barber Studio', city: 'Lausanne', category: 'barbier',
    hours: [{ weekday: 2, open: '09:00', close: '12:00' }],
    services: [{ name: 'Coupe dégradé', duration_min: 30, price_cents: 3500 }, { name: 'Soin visage', duration_min: 30, price_cents: 3000 }],
    staff: [{ name: 'Karim' }],
  });
  const [cut, facial] = require('../server/db').all('SELECT id, studio FROM services WHERE salon_id = ? ORDER BY id', salon.id);
  assert.equal(cut.studio, 1, 'hair services get the studio automatically');
  assert.equal(facial.studio, 0);
  run('UPDATE salons SET style_catalog = ? WHERE id = ?', JSON.stringify(['fade', 'crew']), salon.id);
  const page = await req(`/api/public/salons/${salon.slug}`);
  assert.deepEqual(page.body.studio.styles.map((s) => s.id), ['crew', 'fade']);

  const style = { style: 'fade', params: { top: 3.5, sides: 0, back: 99, fade: 'skin', beard: 'short', color: '#16110e' }, note: 'Raie à gauche', image: 'data:image/jpeg;base64,AAAA' };
  const b = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: cut.id, date: TUE, time: '09:00', customer, style } });
  assert.equal(b.status, 201);
  const row = one('SELECT style_json, style_image FROM bookings WHERE id = ?', b.body.id);
  const saved = JSON.parse(row.style_json);
  assert.equal(saved.params.back, 50, 'lengths are clamped');
  assert.equal(saved.params.color_name, 'Noir');
  assert.equal(row.style_image, 'data:image/jpeg;base64,AAAA');

  const notOffered = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: cut.id, date: TUE, time: '10:00', customer, style: { ...style, style: 'afro' } } });
  assert.equal(one('SELECT style_json FROM bookings WHERE id = ?', notOffered.body.id).style_json, null, 'cuts the salon does not offer are ignored');
  const facialBooking = await req(`/api/public/salons/${salon.slug}/bookings`, { method: 'POST', body: { service_id: facial.id, date: TUE, time: '11:00', customer, style } });
  assert.equal(one('SELECT style_json FROM bookings WHERE id = ?', facialBooking.body.id).style_json, null);

  const owner = (await req('/api/auth/login', { method: 'POST', body: { email: 'barber@test.lu', password: 'password123' } })).cookie;
  const agenda = await req(`/api/pro/agenda?from=${TUE}&to=${TUE}`, { cookie: owner });
  const withStyle = agenda.body.bookings.find((x) => x.id === b.body.id);
  assert.equal(withStyle.has_style, 1);
  assert.equal(withStyle.style_image, null, 'agenda stays light');
  const sheet = await req(`/api/pro/bookings/${b.body.id}/style`, { cookie: owner });
  assert.match(sheet.body.summary, /Dégradé américain · dessus 3.5 cm/);
  assert.match(sheet.body.summary, /barbe courte/);
});
