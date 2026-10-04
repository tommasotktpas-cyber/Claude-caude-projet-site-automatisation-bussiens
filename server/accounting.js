'use strict';
// Invoices, expenses and a simple management bookkeeping: monthly result, Swiss VAT (effective method)
// and a journal export for the fiduciary (Bexio, Banana, Abacus… import CSV).
const { one, all, run, tx } = require('./db');
const T = require('./time');
const { HttpError, clean, EMAIL_RE } = require('./bookings');
const { randomToken } = require('./auth');
const { CURRENCY } = require('./plans');

const EXPENSE_CATEGORIES = {
  loyer: 'Loyer & charges', produits: 'Produits & fournitures', salaires: 'Salaires & charges sociales', assurances: 'Assurances',
  marketing: 'Publicité & marketing', logiciels: 'Logiciels & abonnements', materiel: 'Matériel & entretien', energie: 'Énergie & télécom',
  formation: 'Formation', impots: 'Impôts & taxes', autre: 'Autre',
};
const EXPENSE_METHODS = ['virement', 'carte', 'especes', 'twint', 'prelevement'];

const vatOf = (ttc, bp) => (bp > 0 ? Math.round((ttc * bp) / (10000 + bp)) : 0);
const toCents = (v) => Math.round(Number(String(v ?? '').replace(',', '.').replace(/[^\d.-]/g, '')) * 100);

// ---------- Invoices ----------

function nextNumber(salon) {
  const year = Number(T.now().date.slice(0, 4));
  const s = one('SELECT invoice_year, invoice_seq FROM salons WHERE id = ?', salon.id);
  const seq = s.invoice_year === year ? s.invoice_seq + 1 : 1;
  run('UPDATE salons SET invoice_year = ?, invoice_seq = ? WHERE id = ?', year, seq, salon.id);
  return `${year}-${String(seq).padStart(4, '0')}`;
}

function cleanItems(list) {
  if (!Array.isArray(list) || !list.length || list.length > 50) throw new HttpError(400, 'Ajoutez au moins une ligne.');
  return list.map((it) => {
    const qty = Math.max(1, Math.min(999, Number.parseInt(it.qty, 10) || 1));
    const unit = Number.isInteger(it.unit_cents) ? it.unit_cents : toCents(it.unit);
    const label = clean(it.label, 200);
    if (!label || !Number.isFinite(unit) || Math.abs(unit) > 10_000_000) throw new HttpError(400, 'Ligne de facture invalide.');
    return { label, qty, unit_cents: unit, total_cents: unit * qty };
  });
}

/** Creates an invoice (prices are VAT-inclusive, as displayed in the salon). Numbering is sequential per year. */
function createInvoice(salon, body = {}) {
  return tx(() => {
    let items;
    let clientId = body.client_id ? Number(body.client_id) : null;
    let saleId = null;
    if (body.sale_id) {
      const sale = one('SELECT * FROM sales WHERE id = ? AND salon_id = ? AND voided = 0', Number(body.sale_id), salon.id);
      if (!sale) throw new HttpError(404, 'Vente introuvable.');
      const existing = one("SELECT id FROM invoices WHERE sale_id = ? AND status != 'cancelled'", sale.id);
      if (existing) return one('SELECT * FROM invoices WHERE id = ?', existing.id);
      saleId = sale.id;
      clientId ||= sale.client_id;
      items = all('SELECT name AS label, qty, unit_cents, total_cents FROM sale_items WHERE sale_id = ?', sale.id);
      if (sale.discount_cents) items.push({ label: 'Remise', qty: 1, unit_cents: -sale.discount_cents, total_cents: -sale.discount_cents });
    } else {
      items = cleanItems(body.items);
    }
    const client = clientId ? one('SELECT * FROM clients WHERE id = ? AND salon_id = ?', clientId, salon.id) : null;
    const name = clean(body.customer_name || client?.name, 160);
    if (!name) throw new HttpError(400, 'Nom du client requis.');
    const email = clean(body.customer_email || client?.email || '', 160);
    if (email && !EMAIL_RE.test(email)) throw new HttpError(400, 'E-mail invalide.');
    const total = items.reduce((s, it) => s + it.total_cents, 0);
    if (total <= 0) throw new HttpError(400, 'Le total doit être positif.');
    const bp = salon.vat_registered ? salon.vat_rate_bp : 0;
    const issued = T.now().date;
    const r = run(
      `INSERT INTO invoices (salon_id, number, token, sale_id, client_id, customer_name, customer_address, customer_email, issued_on, due_on, items, total_cents, vat_cents, vat_rate_bp, status, paid_on, note)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      salon.id, nextNumber(salon), randomToken(18), saleId, client?.id || null, name, clean(body.customer_address, 300), email,
      issued, T.addDays(issued, Math.max(0, Math.min(90, Number(body.due_days ?? 30)))), JSON.stringify(items), total, vatOf(total, bp), bp,
      saleId ? 'paid' : 'issued', saleId ? issued : null, clean(body.note, 500),
    );
    return one('SELECT * FROM invoices WHERE id = ?', Number(r.lastInsertRowid));
  });
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (c) => `${(c / 100).toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dmy = (d) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : '');

/** Printable invoice (A4). "Imprimer / PDF" uses the browser's print dialog. */
function renderInvoice(inv) {
  const s = one('SELECT * FROM salons WHERE id = ?', inv.salon_id);
  const items = JSON.parse(inv.items);
  const status = { issued: '', paid: `<div class="stamp">Payée${inv.paid_on ? ` le ${dmy(inv.paid_on)}` : ''}</div>`, cancelled: '<div class="stamp void">Annulée</div>' }[inv.status];
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Facture ${esc(inv.number)} · ${esc(s.name)}</title>
<style>
body{font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18151f;background:#f3f0eb;margin:0;padding:24px}
.page{max-width:800px;margin:0 auto;background:#fff;padding:48px 52px;border-radius:12px;box-shadow:0 4px 24px rgba(0,0,0,.06);position:relative}
h1{font-size:28px;margin:0 0 4px;letter-spacing:-.02em}.muted{color:#7a7486}.row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;margin:28px 0 12px}th,td{padding:10px 8px;border-bottom:1px solid #eee;text-align:left}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#7a7486}
td.n,th.n{text-align:right;white-space:nowrap}.tot td{border:0;padding:4px 8px}.grand td{font-size:18px;font-weight:700;border-top:2px solid #18151f;padding-top:10px}
.brand{font-size:20px;font-weight:700;color:${/^#[0-9a-f]{6}$/i.test(s.accent) ? s.accent : '#6d28d9'}}.box{background:#faf8f5;border-radius:10px;padding:14px 16px;margin-top:20px}
.stamp{position:absolute;top:42px;right:52px;border:3px solid #15803d;color:#15803d;font-weight:800;text-transform:uppercase;padding:6px 14px;border-radius:8px;transform:rotate(-6deg)}.stamp.void{border-color:#be123c;color:#be123c}
.actions{max-width:800px;margin:0 auto 14px;text-align:right}.actions button{font:inherit;font-weight:600;border:0;background:#18151f;color:#fff;padding:10px 18px;border-radius:10px;cursor:pointer}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;border-radius:0;padding:0}.actions{display:none}}
@media (max-width:600px){.page{padding:28px 20px}.stamp{position:static;display:inline-block;margin-bottom:12px}}
</style></head><body>
<div class="actions"><button onclick="print()">Imprimer / PDF</button></div>
<div class="page">${status}
  <div class="row"><div><div class="brand">${esc(s.name)}</div><div class="muted">${esc(s.legal_name || s.name)}<br>${esc(s.address)}<br>${esc(s.zip)} ${esc(s.city)}${s.phone ? `<br>${esc(s.phone)}` : ''}${s.email ? `<br>${esc(s.email)}` : ''}</div>
    ${s.vat_registered && s.vat_number ? `<div class="muted">N° TVA : ${esc(s.vat_number)}</div>` : ''}</div>
    <div style="text-align:right"><h1>Facture</h1><div>N° <b>${esc(inv.number)}</b></div><div class="muted">Date : ${dmy(inv.issued_on)}${inv.status === 'issued' ? `<br>Échéance : ${dmy(inv.due_on)}` : ''}</div></div></div>
  <div class="box" style="max-width:340px"><div class="muted" style="font-size:12px">Facturé à</div><b>${esc(inv.customer_name)}</b>${inv.customer_address ? `<br>${esc(inv.customer_address).replace(/\n/g, '<br>')}` : ''}${inv.customer_email ? `<br>${esc(inv.customer_email)}` : ''}</div>
  <table><thead><tr><th>Désignation</th><th class="n">Qté</th><th class="n">Prix unitaire</th><th class="n">Montant ${CURRENCY}</th></tr></thead><tbody>
  ${items.map((it) => `<tr><td>${esc(it.label)}</td><td class="n">${it.qty}</td><td class="n">${money(it.unit_cents)}</td><td class="n">${money(it.total_cents)}</td></tr>`).join('')}
  </tbody></table>
  <table class="tot" style="width:auto;margin-left:auto">
    ${inv.vat_rate_bp ? `<tr><td class="muted">Total hors TVA</td><td class="n">${money(inv.total_cents - inv.vat_cents)}</td></tr><tr><td class="muted">TVA ${(inv.vat_rate_bp / 100).toFixed(1)} %</td><td class="n">${money(inv.vat_cents)}</td></tr>` : ''}
    <tr class="grand"><td>Total ${CURRENCY}</td><td class="n">${money(inv.total_cents)}</td></tr></table>
  ${!inv.vat_rate_bp ? '<p class="muted" style="font-size:12px">Entreprise non assujettie à la TVA.</p>' : ''}
  ${inv.note ? `<p>${esc(inv.note)}</p>` : ''}
  ${inv.status === 'issued' && s.iban ? `<div class="box"><b>Paiement</b> d’ici au ${dmy(inv.due_on)} sur le compte<br>IBAN <b>${esc(s.iban)}</b> · ${esc(s.legal_name || s.name)}<br>Référence : facture ${esc(inv.number)}</div>` : ''}
  ${s.invoice_footer ? `<p class="muted" style="font-size:12px;margin-top:28px">${esc(s.invoice_footer)}</p>` : ''}
</div></body></html>`;
}

// ---------- Expenses ----------

function saveExpense(salon, body = {}, id = null) {
  const day = T.isDate(body.day) ? body.day : T.now().date;
  const category = EXPENSE_CATEGORIES[body.category] ? body.category : 'autre';
  const amount = Number.isInteger(body.amount_cents) ? body.amount_cents : toCents(body.amount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) throw new HttpError(400, 'Montant invalide.');
  let vat = Number.isInteger(body.vat_cents) ? body.vat_cents : (body.vat === undefined || body.vat === '' ? null : toCents(body.vat));
  if (vat === null) vat = salon.vat_registered && body.vat_auto !== false ? vatOf(amount, salon.vat_rate_bp) : 0;
  if (!Number.isFinite(vat) || vat < 0 || vat > amount) throw new HttpError(400, 'TVA invalide.');
  const method = EXPENSE_METHODS.includes(body.method) ? body.method : 'virement';
  const mailId = body.mail_message_id && one('SELECT id FROM mail_messages WHERE id = ? AND salon_id = ?', Number(body.mail_message_id), salon.id)?.id;
  const vals = [day, category, clean(body.supplier, 120), clean(body.description, 300), amount, vat, method];
  if (id) {
    const r = run('UPDATE expenses SET day=?, category=?, supplier=?, description=?, amount_cents=?, vat_cents=?, method=? WHERE id = ? AND salon_id = ?', ...vals, id, salon.id);
    if (!r.changes) throw new HttpError(404, 'Dépense introuvable.');
    return one('SELECT * FROM expenses WHERE id = ?', id);
  }
  const r = run('INSERT INTO expenses (salon_id, day, category, supplier, description, amount_cents, vat_cents, method, mail_message_id) VALUES (?,?,?,?,?,?,?,?,?)', salon.id, ...vals, mailId || null);
  if (mailId) run('UPDATE mail_messages SET done = 1 WHERE id = ?', mailId);
  return one('SELECT * FROM expenses WHERE id = ?', Number(r.lastInsertRowid));
}

// ---------- Report ----------

/**
 * Monthly result over [from, to] (inclusive months "YYYY-MM").
 * Cash collected at the till (tips and gift-card redemptions excluded: tips go to staff, gift cards were cashed when sold),
 * minus what goes back to independents (their sales less the chair rent), commissions, and expenses.
 */
function report(salon, fromMonth, toMonth) {
  const months = [];
  for (let m = fromMonth; m <= toMonth && months.length < 24; m = T.addDays(`${m}-28`, 7).slice(0, 7)) months.push(m);
  const staff = all('SELECT * FROM staff WHERE salon_id = ?', salon.id);
  const bp = salon.vat_registered ? salon.vat_rate_bp : 0;
  const rows = months.map((month) => {
    const from = `${month}-01`;
    const to = `${month}-31`;
    const till = one(
      `SELECT COALESCE(SUM(total_cents - tip_cents - gift_card_cents), 0) AS cash, COUNT(*) AS n FROM sales
       WHERE salon_id = ? AND voided = 0 AND day BETWEEN ? AND ?`, salon.id, from, to,
    );
    const byMethod = all(
      `SELECT method, COALESCE(SUM(total_cents - tip_cents - gift_card_cents), 0) AS cents FROM sales
       WHERE salon_id = ? AND voided = 0 AND day BETWEEN ? AND ? GROUP BY method`, salon.id, from, to,
    );
    let independents = 0;
    let commissions = 0;
    for (const st of staff) {
      const s = one(
        `SELECT COALESCE(SUM(i.total_cents) FILTER (WHERE i.kind = 'service'), 0) AS services,
                COALESCE(SUM(i.total_cents) FILTER (WHERE i.kind = 'product'), 0) AS products,
                (SELECT COALESCE(SUM(discount_cents), 0) FROM sales WHERE salon_id = ?1 AND staff_id = ?2 AND voided = 0 AND day BETWEEN ?3 AND ?4) AS discounts
         FROM sales x JOIN sale_items i ON i.sale_id = x.id
         WHERE x.salon_id = ?1 AND x.staff_id = ?2 AND x.voided = 0 AND x.day BETWEEN ?3 AND ?4`, salon.id, st.id, from, to,
      );
      const services = s.services - s.discounts;
      if (st.pay_model === 'loyer') {
        // Chair rent is counted for past and current months only.
        const rent = month <= T.now().date.slice(0, 7) && st.active ? st.chair_rent_cents : 0;
        independents += services + s.products - rent;
      } else if (st.pay_model === 'commission') {
        commissions += Math.round((services * st.rate_percent) / 100);
      } else {
        commissions += Math.round((s.products * st.rate_percent) / 100);
      }
    }
    const invoiced = one(
      "SELECT COALESCE(SUM(total_cents), 0) AS cents FROM invoices WHERE salon_id = ? AND sale_id IS NULL AND status != 'cancelled' AND issued_on BETWEEN ? AND ?",
      salon.id, from, to,
    ).cents;
    const expenses = all('SELECT category, SUM(amount_cents) AS cents, SUM(vat_cents) AS vat FROM expenses WHERE salon_id = ? AND day BETWEEN ? AND ? GROUP BY category', salon.id, from, to);
    const expTotal = expenses.reduce((a, e) => a + e.cents, 0);
    const revenue = till.cash - independents + invoiced; // the salon's own turnover (incl. chair rents and invoices)
    const vatCollected = vatOf(Math.max(0, revenue), bp);
    const vatDeductible = bp ? expenses.reduce((a, e) => a + e.vat, 0) : 0;
    return {
      month, sales_count: till.n, cash_cents: till.cash, by_method: byMethod, independents_cents: independents, invoiced_cents: invoiced, revenue_cents: revenue,
      commissions_cents: commissions, expenses_cents: expTotal, expenses_by_category: expenses,
      result_cents: revenue - commissions - expTotal,
      vat: { collected_cents: vatCollected, deductible_cents: vatDeductible, due_cents: vatCollected - vatDeductible },
    };
  });
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const open = one("SELECT COUNT(*) AS n, COALESCE(SUM(total_cents), 0) AS cents FROM invoices WHERE salon_id = ? AND status = 'issued'", salon.id);
  const overdue = one("SELECT COUNT(*) AS n FROM invoices WHERE salon_id = ? AND status = 'issued' AND due_on < ?", salon.id, T.now().date).n;
  return {
    months: rows,
    totals: {
      cash_cents: sum('cash_cents'), revenue_cents: sum('revenue_cents'), commissions_cents: sum('commissions_cents'), expenses_cents: sum('expenses_cents'), result_cents: sum('result_cents'),
      vat_due_cents: rows.reduce((a, r) => a + r.vat.due_cents, 0), vat_collected_cents: rows.reduce((a, r) => a + r.vat.collected_cents, 0), vat_deductible_cents: rows.reduce((a, r) => a + r.vat.deductible_cents, 0),
    },
    invoices_open: { ...open, overdue },
    vat_registered: !!salon.vat_registered,
    vat_rate: salon.vat_rate_bp / 100,
  };
}

/** Accounting journal (CSV, « ; », amounts in CHF) for the fiduciary. */
function journalCsv(salon, from, to) {
  // Text cells are protected against spreadsheet formula injection; amounts stay plain numbers.
  const cell = (v) => (/^-?\d+(\.\d+)?$/.test(String(v)) ? `"${v}"` : `"${String(v ?? '').replace(/"/g, '""').replace(/^[=+\-@]/, "'$&")}"`);
  const chf = (c) => (c / 100).toFixed(2);
  const METHOD = { cash: 'Espèces', card: 'Carte', twint: 'TWINT', gift_card: 'Carte cadeau', other: 'Autre' };
  const lines = [];
  for (const d of all(
    `SELECT day, method, SUM(total_cents - tip_cents - gift_card_cents) AS cents, COUNT(*) AS n FROM sales
     WHERE salon_id = ? AND voided = 0 AND day BETWEEN ? AND ? GROUP BY day, method ORDER BY day`, salon.id, from, to,
  )) {
    if (d.cents) lines.push([d.day, 'Recette', `Z-${d.day}`, `Ventes caisse (${d.n})`, 'Chiffre d’affaires', chf(d.cents), chf(vatOf(d.cents, salon.vat_registered ? salon.vat_rate_bp : 0)), METHOD[d.method] || d.method]);
  }
  for (const i of all("SELECT * FROM invoices WHERE salon_id = ? AND sale_id IS NULL AND status != 'cancelled' AND issued_on BETWEEN ? AND ? ORDER BY issued_on", salon.id, from, to)) {
    lines.push([i.issued_on, 'Facture', i.number, i.customer_name, 'Chiffre d’affaires (facture)', chf(i.total_cents), chf(i.vat_cents), i.status === 'paid' ? `Payée ${i.paid_on || ''}` : 'Ouverte']);
  }
  for (const e of all('SELECT * FROM expenses WHERE salon_id = ? AND day BETWEEN ? AND ? ORDER BY day', salon.id, from, to)) {
    lines.push([e.day, 'Dépense', `D-${e.id}`, [e.supplier, e.description].filter(Boolean).join(' · '), EXPENSE_CATEGORIES[e.category] || e.category, chf(-e.amount_cents), chf(-e.vat_cents), e.method]);
  }
  lines.sort((a, b) => a[0].localeCompare(b[0]));
  return `﻿${['date;type;piece;libelle;compte;montant_ttc;tva;paiement', ...lines.map((l) => l.map(cell).join(';'))].join('\n')}`;
}

module.exports = { EXPENSE_CATEGORIES, EXPENSE_METHODS, createInvoice, renderInvoice, saveExpense, report, journalCsv, vatOf };
