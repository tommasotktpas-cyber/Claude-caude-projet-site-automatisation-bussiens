'use strict';
// Invoices (numbering, VAT), expenses and the monthly result.
process.env.DB_PATH = ':memory:';
process.env.LUMEA_NOW = '2026-10-06T10:00';
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

async function req(path, { method = 'GET', body } = {}) {
  const res = await fetch(base + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const uid = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES ('compta@test.ch', ?, 'Owner', 'pro')", hashPassword('password123')).lastInsertRowid);
  salon = createSalon(uid, {
    name: 'Salon Compta', city: 'Genève', hours: [{ weekday: 2, open: '09:00', close: '18:00' }],
    services: [{ name: 'Coupe', duration_min: 30, price_cents: 10810 }], staff: [{ name: 'Ana' }, { name: 'Indé' }],
  });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'compta@test.ch', password: 'password123' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});
test.after(() => server.close());

test('VAT settings, sequential invoice numbers and the printable invoice', async () => {
  const bad = await req('/api/pro/accounting/settings', { method: 'PUT', body: { iban: 'pas un iban' } });
  assert.equal(bad.status, 400);
  const ok = await req('/api/pro/accounting/settings', { method: 'PUT', body: { vat_registered: true, vat_rate: '8.1', vat_number: 'CHE-123.456.789 TVA', iban: 'CH93 0076 2011 6238 5295 7', legal_name: 'Salon Compta Sàrl' } });
  assert.equal(ok.status, 200);

  const a = await req('/api/pro/invoices', { method: 'POST', body: { customer_name: 'Société Mariage SA', items: [{ label: 'Coiffure mariée', qty: 1, unit: '216.20' }] } });
  assert.equal(a.status, 201);
  assert.equal(a.body.number, '2026-0001');
  assert.equal(a.body.total_cents, 21620);
  assert.equal(a.body.vat_cents, 1620, '8.1 % included in 216.20');
  assert.equal(a.body.due_on, '2026-11-05');
  const b = await req('/api/pro/invoices', { method: 'POST', body: { customer_name: 'Client B', items: [{ label: 'Bon', qty: 2, unit: 50 }] } });
  assert.equal(b.body.number, '2026-0002');

  const html = await (await fetch(a.body.url.replace(/^https?:\/\/[^/]+/, base))).text();
  assert.match(html, /Facture/);
  assert.match(html, /2026-0001/);
  assert.match(html, /CHE-123\.456\.789/);
  assert.match(html, /CH93 0076 2011 6238 5295 7/);
  assert.match(html, /TVA 8\.1 %/);

  assert.equal((await req('/api/pro/invoices', { method: 'POST', body: { customer_name: 'X', items: [] } })).status, 400);
  await req(`/api/pro/invoices/${a.body.id}`, { method: 'PATCH', body: { status: 'paid' } });
  assert.equal(one('SELECT paid_on FROM invoices WHERE id = ?', a.body.id).paid_on, '2026-10-06');
});

test('invoice from a till sale is created once and already paid', async () => {
  const sv = one('SELECT id FROM services WHERE salon_id = ?', salon.id);
  const ana = one("SELECT id FROM staff WHERE salon_id = ? AND name = 'Ana'", salon.id);
  const sale = await req('/api/pro/sales', { method: 'POST', body: { items: [{ kind: 'service', ref_id: sv.id }], method: 'card', staff_id: ana.id, tip_cents: 500 } });
  assert.equal(sale.status, 201);
  const saleId = sale.body.id || sale.body.sale?.id;
  const inv = await req('/api/pro/invoices', { method: 'POST', body: { sale_id: saleId, customer_name: 'Marie' } });
  assert.equal(inv.body.status, 'paid');
  assert.equal(inv.body.total_cents, 10810);
  const again = await req('/api/pro/invoices', { method: 'POST', body: { sale_id: saleId, customer_name: 'Marie' } });
  assert.equal(again.body.id, inv.body.id);
});

test('expenses, monthly result, VAT due and journal export', async () => {
  const e = await req('/api/pro/expenses', { method: 'POST', body: { day: '2026-10-02', category: 'produits', supplier: 'L’Oréal', amount: '108.10' } });
  assert.equal(e.status, 201);
  assert.equal(e.body.vat_cents, 810, 'deductible VAT computed from the salon rate');
  await req('/api/pro/expenses', { method: 'POST', body: { day: '2026-10-01', category: 'loyer', amount: 2000, vat: 0 } });
  assert.equal((await req('/api/pro/expenses', { method: 'POST', body: { amount: -5 } })).status, 400);

  // The independent rents a chair 900 CHF / month and cashed nothing through the salon this month.
  run("UPDATE staff SET pay_model = 'loyer', chair_rent_cents = 90000 WHERE salon_id = ? AND name = 'Indé'", salon.id);
  const r = await req('/api/pro/accounting?year=2026');
  const oct = r.body.report.months.find((m) => m.month === '2026-10');
  assert.equal(oct.cash_cents, 10810, 'tips excluded');
  assert.equal(oct.invoiced_cents, 21620 + 10000);
  assert.equal(oct.revenue_cents, 10810 + 90000 + 31620, 'own sales + chair rent + invoices');
  assert.equal(oct.expenses_cents, 10810 + 200000);
  assert.equal(oct.result_cents, 10810 + 90000 + 31620 - 10810 - 200000);
  assert.equal(oct.vat.deductible_cents, 810);
  assert.equal(oct.vat.collected_cents, Math.round((132430 * 810) / 10810));
  assert.equal(r.body.report.invoices_open.n, 1);

  const csv = await req('/api/pro/export/journal.csv?from=2026-10-01&to=2026-10-31');
  const lines = csv.body.trim().split('\n');
  assert.match(lines[0], /date;type;piece;libelle;compte;montant_ttc;tva;paiement/);
  assert.ok(lines.some((l) => l.includes('"Dépense"') && l.includes('"-108.10"')));
  assert.ok(lines.some((l) => l.includes('"Recette"') && l.includes('"108.10"')));
  assert.ok(lines.some((l) => l.includes('"2026-0002"')));
});

test('on-demand TLS only for known domains', async () => {
  assert.equal((await fetch(`${base}/api/internal/domain-check?domain=evil.example.com`)).status, 404);
  run("UPDATE sites SET custom_domain = 'salon-compta.ch', published = 1 WHERE salon_id = ?", salon.id);
  run("UPDATE salons SET plan = 'premium' WHERE id = ?", salon.id);
  assert.equal((await fetch(`${base}/api/internal/domain-check?domain=salon-compta.ch`)).status, 200);
});
