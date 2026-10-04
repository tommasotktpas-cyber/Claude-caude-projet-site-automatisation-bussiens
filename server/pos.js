'use strict';
// Point of sale: checkout (services, products, gift cards), stock movements, gift card balances, daily closing.
const crypto = require('node:crypto');
const { one, all, run, tx } = require('./db');
const T = require('./time');
const { HttpError, clean, setStatus } = require('./bookings');

const METHODS = { cash: 'Espèces', card: 'Carte', twint: 'TWINT', gift_card: 'Carte cadeau', other: 'Autre', online: 'Acompte en ligne' };
const GIFT_VALIDITY_DAYS = 365 * 2;

/** Readable gift card code, no ambiguous characters: LUM-7K3P-Q9XD. */
function newGiftCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const bytes = crypto.randomBytes(8);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    const code = `LUM-${chars.slice(0, 4)}-${chars.slice(4)}`;
    if (!one('SELECT id FROM gift_cards WHERE code = ?', code)) return code;
  }
}

function issueGiftCard(salonId, { amountCents, buyerName = '', buyerEmail = '', recipientName = '', message = '', source = 'caisse', status = 'active' }) {
  if (!(amountCents >= 1000 && amountCents <= 100000)) throw new HttpError(400, 'Montant de carte cadeau invalide (10 à 1000).');
  const code = newGiftCode();
  const id = Number(run(
    `INSERT INTO gift_cards (salon_id, code, initial_cents, balance_cents, buyer_name, buyer_email, recipient_name, message, source, status, expires_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    salonId, code, amountCents, amountCents, clean(buyerName, 120), clean(buyerEmail, 160).toLowerCase(), clean(recipientName, 120),
    clean(message, 300), source, status, T.addDays(T.now().date, GIFT_VALIDITY_DAYS),
  ).lastInsertRowid);
  return one('SELECT * FROM gift_cards WHERE id = ?', id);
}

function findGiftCard(salonId, code) {
  const g = one('SELECT * FROM gift_cards WHERE salon_id = ? AND code = ? COLLATE NOCASE', salonId, clean(code, 20).toUpperCase());
  if (!g || g.status !== 'active') throw new HttpError(404, 'Carte cadeau introuvable ou inactive.');
  if (g.expires_at < T.now().date) throw new HttpError(400, `Carte cadeau expirée le ${g.expires_at}.`);
  return g;
}

/**
 * Records a sale atomically: prices come from the database (products) or the booking (services),
 * stock is decremented, gift cards are debited or issued, and a linked booking is closed as completed.
 */
function createSale(salon, userId, body = {}) {
  const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
  if (!items.length) throw new HttpError(400, 'Ajoutez au moins un article.');
  const method = METHODS[body.method] && body.method !== 'online' ? body.method : null;
  if (!method) throw new HttpError(400, 'Moyen de paiement invalide.');
  const booking = body.booking_id ? one('SELECT * FROM bookings WHERE id = ? AND salon_id = ?', Number(body.booking_id), salon.id) : null;
  if (body.booking_id && !booking) throw new HttpError(404, 'Rendez-vous introuvable.');
  if (booking && one('SELECT id FROM sales WHERE booking_id = ? AND voided = 0', booking.id)) throw new HttpError(409, 'Ce rendez-vous a déjà été encaissé.');

  return tx(() => {
    const lines = [];
    const issued = [];
    for (const it of items) {
      const qty = Math.max(1, Math.min(99, Number.parseInt(it.qty, 10) || 1));
      if (it.kind === 'product') {
        const p = one('SELECT * FROM products WHERE id = ? AND salon_id = ?', Number(it.ref_id), salon.id);
        if (!p) throw new HttpError(404, 'Produit introuvable.');
        if (p.stock < qty) throw new HttpError(409, `Stock insuffisant pour « ${p.name} » (${p.stock} en stock).`);
        lines.push({ kind: 'product', ref_id: p.id, name: p.brand ? `${p.brand} — ${p.name}` : p.name, qty, unit: p.price_cents });
      } else if (it.kind === 'service') {
        const sv = one('SELECT * FROM services WHERE id = ? AND salon_id = ?', Number(it.ref_id), salon.id);
        if (!sv) throw new HttpError(404, 'Prestation introuvable.');
        // The salon may adjust the price at checkout (extra product used, longer hair…).
        const unit = Number.isFinite(Number(it.unit_cents)) ? Math.max(0, Math.round(Number(it.unit_cents))) : sv.price_cents;
        lines.push({ kind: 'service', ref_id: sv.id, name: sv.name, qty, unit });
      } else if (it.kind === 'gift_card') {
        const amount = Math.round(Number(it.unit_cents));
        lines.push({ kind: 'gift_card', ref_id: null, name: 'Carte cadeau', qty: 1, unit: amount, recipient: it.recipient_name, message: it.message });
      } else {
        throw new HttpError(400, 'Article invalide.');
      }
    }
    const subtotal = lines.reduce((s, l) => s + l.unit * l.qty, 0);
    const discount = Math.min(subtotal, Math.max(0, Math.round(Number(body.discount_cents) || 0)));
    const tip = Math.max(0, Math.min(100000, Math.round(Number(body.tip_cents) || 0)));
    const total = subtotal - discount + tip;

    let gift = null;
    let giftCents = 0;
    if (body.gift_card_code) {
      gift = findGiftCard(salon.id, body.gift_card_code);
      giftCents = Math.min(gift.balance_cents, total);
      if (method === 'gift_card' && giftCents < total) {
        throw new HttpError(400, `Solde insuffisant (${(gift.balance_cents / 100).toFixed(2)}). Choisissez un autre moyen de paiement pour le reste.`);
      }
    } else if (method === 'gift_card') {
      throw new HttpError(400, 'Saisissez le code de la carte cadeau.');
    }

    // Deposit already paid online is deducted from what the till collects.
    const prepaid = booking && booking.payment_status === 'paid' ? Math.min(booking.deposit_cents, total - giftCents) : 0;
    const staffId = body.staff_id ? Number(body.staff_id) : booking?.staff_id ?? null;
    const saleId = Number(run(
      `INSERT INTO sales (salon_id, booking_id, client_id, staff_id, subtotal_cents, discount_cents, tip_cents, total_cents, method,
         gift_card_id, gift_card_cents, note, created_by, day, prepaid_cents)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      salon.id, booking?.id ?? null, booking?.client_id ?? (body.client_id ? Number(body.client_id) : null), staffId,
      subtotal, discount, tip, total, method, gift?.id ?? null, giftCents, clean(body.note, 300), userId ?? null, T.now().date, prepaid,
    ).lastInsertRowid);

    for (const l of lines) {
      run('INSERT INTO sale_items (sale_id, kind, ref_id, name, qty, unit_cents, total_cents) VALUES (?,?,?,?,?,?,?)',
        saleId, l.kind, l.ref_id, l.name, l.qty, l.unit, l.unit * l.qty);
      if (l.kind === 'product') {
        run('UPDATE products SET stock = stock - ? WHERE id = ?', l.qty, l.ref_id);
        run("INSERT INTO stock_movements (product_id, delta, reason, sale_id) VALUES (?,?, 'sale', ?)", l.ref_id, -l.qty, saleId);
      }
      if (l.kind === 'gift_card') {
        const card = issueGiftCard(salon.id, { amountCents: l.unit, recipientName: l.recipient || '', message: l.message || '', source: 'caisse' });
        issued.push(card);
      }
    }
    if (gift && giftCents) run('UPDATE gift_cards SET balance_cents = balance_cents - ? WHERE id = ?', giftCents, gift.id);
    if (booking && booking.status !== 'completed') {
      setStatus(booking, 'completed');
    }
    if (booking) run('UPDATE bookings SET paid_cents = ? WHERE id = ?', booking.price_cents, booking.id);
    return { id: saleId, total_cents: total, gift_card_used_cents: giftCents, issued_gift_cards: issued.map((g) => ({ code: g.code, amount_cents: g.initial_cents })) };
  });
}

function voidSale(salonId, saleId) {
  const sale = one('SELECT * FROM sales WHERE id = ? AND salon_id = ?', saleId, salonId);
  if (!sale) throw new HttpError(404, 'Vente introuvable.');
  if (sale.voided) throw new HttpError(400, 'Vente déjà annulée.');
  tx(() => {
    run('UPDATE sales SET voided = 1 WHERE id = ?', sale.id);
    for (const it of all("SELECT * FROM sale_items WHERE sale_id = ? AND kind = 'product'", sale.id)) {
      run('UPDATE products SET stock = stock + ? WHERE id = ?', it.qty, it.ref_id);
      run("INSERT INTO stock_movements (product_id, delta, reason, sale_id) VALUES (?,?, 'annulation', ?)", it.ref_id, it.qty, sale.id);
    }
    if (sale.gift_card_id && sale.gift_card_cents) run('UPDATE gift_cards SET balance_cents = balance_cents + ? WHERE id = ?', sale.gift_card_cents, sale.gift_card_id);
  });
}

/** Daily closing ("ticket Z"): totals per payment method, tips per staff member, items sold. */
function dayReport(salonId, day) {
  const sales = all(
    `SELECT s.*, st.name AS staff_name, c.name AS client_name FROM sales s
     LEFT JOIN staff st ON st.id = s.staff_id LEFT JOIN clients c ON c.id = s.client_id
     WHERE s.salon_id = ? AND s.day = ? ORDER BY s.created_at DESC, s.id DESC`, salonId, day,
  );
  for (const s of sales) s.items = all('SELECT kind, name, qty, unit_cents, total_cents FROM sale_items WHERE sale_id = ?', s.id);
  const valid = sales.filter((s) => !s.voided);
  const byMethod = Object.fromEntries(Object.keys(METHODS).map((m) => [m, 0]));
  for (const s of valid) {
    byMethod.gift_card += s.gift_card_cents;
    byMethod.online += s.prepaid_cents;
    if (s.method !== 'gift_card') byMethod[s.method] += s.total_cents - s.gift_card_cents - s.prepaid_cents;
  }
  const tips = {};
  for (const s of valid) if (s.tip_cents) tips[s.staff_name || 'Sans collaborateur'] = (tips[s.staff_name || 'Sans collaborateur'] || 0) + s.tip_cents;
  const items = {};
  for (const s of valid) for (const it of s.items) {
    const k = `${it.kind}:${it.name}`;
    items[k] ||= { kind: it.kind, name: it.name, qty: 0, total_cents: 0 };
    items[k].qty += it.qty;
    items[k].total_cents += it.total_cents;
  }
  return {
    day,
    sales,
    totals: {
      count: valid.length,
      revenue_cents: valid.reduce((a, s) => a + s.total_cents - s.tip_cents, 0),
      tips_cents: valid.reduce((a, s) => a + s.tip_cents, 0),
      discounts_cents: valid.reduce((a, s) => a + s.discount_cents, 0),
      collected_cents: valid.reduce((a, s) => a + s.total_cents, 0),
      services_cents: valid.reduce((a, s) => a + s.items.filter((i) => i.kind === 'service').reduce((x, i) => x + i.total_cents, 0), 0),
      products_cents: valid.reduce((a, s) => a + s.items.filter((i) => i.kind === 'product').reduce((x, i) => x + i.total_cents, 0), 0),
    },
    by_method: byMethod,
    methods: METHODS,
    tips_by_staff: tips,
    items: Object.values(items).sort((a, b) => b.total_cents - a.total_cents),
  };
}

module.exports = { METHODS, issueGiftCard, findGiftCard, createSale, voidSale, dayReport, newGiftCode };
