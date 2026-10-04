'use strict';
// Swiss QR-bill (QR-facture) payment part, per SIX "Swiss Implementation Guidelines QR-bill" v2.3:
// SPC payload, structured addresses, QRR (QR-IBAN) or SCOR (RF creditor reference), Swiss cross in the code.
const QRCode = require('qrcode');

const clean = (s, max = 70) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const ibanDigits = (iban) => String(iban || '').replace(/\s/g, '').toUpperCase();

function validIban(raw) {
  const iban = ibanDigits(raw);
  if (!/^(CH|LI)\d{7}[A-Z0-9]{12}$/.test(iban)) return false;
  const moved = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of moved) r = (r * 10 + Number(ch)) % 97;
  return r === 1;
}
/** QR-IBAN: institution id 30000–31999 → requires a QRR reference. */
const isQrIban = (iban) => { const iid = Number(ibanDigits(iban).slice(4, 9)); return iid >= 30000 && iid <= 31999; };

/** ISO 11649 creditor reference ("RF" + check + payload). */
function scorReference(payload) {
  const p = String(payload).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 21) || '0';
  const num = `${p}RF00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let r = 0;
  for (const ch of num) r = (r * 10 + Number(ch)) % 97;
  return `RF${String(98 - r).padStart(2, '0')}${p}`;
}

/** 27-digit QR reference with recursive mod-10 check digit. */
function qrrReference(number) {
  const base = String(number).replace(/\D/g, '').padStart(26, '0').slice(-26);
  const table = [0, 9, 4, 6, 8, 2, 7, 1, 3, 5];
  let carry = 0;
  for (const d of base) carry = table[(carry + Number(d)) % 10];
  return base + ((10 - carry) % 10);
}

/** Free-text address "Rue 1\n1200 Genève" → structured fields (or null when it cannot be parsed). */
function parseAddress(name, text) {
  const lines = String(text || '').split(/\n|,/).map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) || '';
  const m = /^(?:CH-)?(\d{4})\s+(.+)$/.exec(last);
  if (!name || !m) return null;
  return { name: clean(name), street: clean(lines.length > 1 ? lines[0] : '', 70), zip: m[1], town: clean(m[2], 35), country: 'CH' };
}

function payload({ iban, creditor, amountCents, currency, debtor, refType, reference, message }) {
  const addr = (a) => (a ? ['S', a.name, a.street, '', a.zip, a.town, a.country] : ['', '', '', '', '', '', '']);
  return [
    'SPC', '0200', '1', ibanDigits(iban), ...addr(creditor), '', '', '', '', '', '', '',
    amountCents ? (amountCents / 100).toFixed(2) : '', currency, ...addr(debtor), refType, reference, clean(message, 140), 'EPD',
  ].join('\n');
}

/** QR code as SVG (46 × 46 mm) with the Swiss cross (7 × 7 mm) in the middle. */
function qrSvg(text) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  let d = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.modules.get(x, y)) d += `M${x} ${y}h1v1h-1z`;
  const c = (n * 7) / 46; // cross size in modules
  const o = (n - c) / 2;
  const u = c / 32; // the official logo is drawn on a 32-unit grid
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="46mm" height="46mm" shape-rendering="crispEdges" role="img" aria-label="QR-code de paiement">
<path d="${d}" fill="#000"/><rect x="${o - u * 2}" y="${o - u * 2}" width="${c + u * 4}" height="${c + u * 4}" fill="#fff"/>
<rect x="${o}" y="${o}" width="${c}" height="${c}" fill="#000"/>
<rect x="${o + 13 * u}" y="${o + 6 * u}" width="${6 * u}" height="${20 * u}" fill="#fff"/><rect x="${o + 6 * u}" y="${o + 13 * u}" width="${20 * u}" height="${6 * u}" fill="#fff"/></svg>`;
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmtIban = (i) => ibanDigits(i).replace(/(.{4})/g, '$1 ').trim();
const fmtRef = (type, r) => (type === 'QRR' ? `${r.slice(0, 2)} ${r.slice(2).replace(/(.{5})/g, '$1 ')}`.trim() : r.replace(/(.{4})/g, '$1 ').trim());
const fmtAmount = (c) => (c / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Payment part for an open invoice, or '' when the salon's data does not allow a valid QR-bill
 * (IBAN CH/LI, address with postal code and town, amount in CHF or EUR).
 */
function paymentPart(inv, salon, currency = 'CHF') {
  if (inv.status !== 'issued' || !validIban(salon.iban) || !salon.zip || !salon.city || !['CHF', 'EUR'].includes(currency)) return '';
  const creditor = { name: clean(salon.legal_name || salon.name), street: clean(salon.address), zip: clean(salon.zip, 16), town: clean(salon.city, 35), country: 'CH' };
  const debtor = parseAddress(inv.customer_name, inv.customer_address);
  const qrr = isQrIban(salon.iban);
  const refType = qrr ? 'QRR' : 'SCOR';
  const reference = qrr ? qrrReference(inv.number) : scorReference(inv.number);
  const message = `Facture ${inv.number}`;
  const svg = qrSvg(payload({ iban: salon.iban, creditor, amountCents: inv.total_cents, currency, debtor, refType, reference, message }));
  const addr = (a) => `${esc(a.name)}<br>${a.street ? `${esc(a.street)}<br>` : ''}${esc(a.zip)} ${esc(a.town)}`;
  const debtorHtml = debtor ? addr(debtor) : `${esc(inv.customer_name)}`;
  return `<section class="qrbill" aria-label="Section paiement QR-facture">
<div class="qr-receipt"><h3>Récépissé</h3>
  <h4>Compte / Payable à</h4><p>${fmtIban(salon.iban)}<br>${addr(creditor)}</p>
  <h4>Référence</h4><p>${fmtRef(refType, reference)}</p>
  <h4>Payable par</h4><p>${debtorHtml}</p>
  <div class="qr-amt"><div><h4>Monnaie</h4><p>${currency}</p></div><div><h4>Montant</h4><p>${fmtAmount(inv.total_cents)}</p></div></div>
  <h4 class="qr-depot">Point de dépôt</h4></div>
<div class="qr-pay"><h3>Section paiement</h3>
  <div class="qr-row"><div class="qr-left">${svg}
    <div class="qr-amt"><div><h4>Monnaie</h4><p>${currency}</p></div><div><h4>Montant</h4><p>${fmtAmount(inv.total_cents)}</p></div></div></div>
  <div class="qr-info"><h4>Compte / Payable à</h4><p>${fmtIban(salon.iban)}<br>${addr(creditor)}</p>
    <h4>Référence</h4><p>${fmtRef(refType, reference)}</p>
    <h4>Informations supplémentaires</h4><p>${esc(message)}</p>
    <h4>Payable par</h4><p>${debtorHtml}</p></div></div></div>
</section>`;
}

const CSS = `.qrbill{display:flex;width:210mm;height:105mm;margin:28px auto 0;border-top:1px dashed #000;font-family:Arial,Helvetica,sans-serif;color:#000;background:#fff;page-break-inside:avoid;position:relative}
.qrbill::before{content:"✂ À détacher avant le versement";position:absolute;top:-18px;left:0;font-size:9pt;color:#777}
.qrbill h3{font-size:11pt;font-weight:bold;margin:0 0 4mm}.qrbill h4{font-size:6pt;font-weight:bold;margin:0}.qrbill p{font-size:8pt;margin:0 0 3mm;line-height:1.2}
.qr-receipt{width:62mm;padding:5mm;border-right:1px dashed #000;box-sizing:border-box}.qr-receipt p{font-size:8pt}
.qr-pay{width:148mm;padding:5mm;box-sizing:border-box}.qr-pay .qr-info h4{font-size:8pt}.qr-pay .qr-info p{font-size:10pt}
.qr-row{display:flex;gap:5mm}.qr-left{width:51mm}.qr-left svg{display:block;margin:0 0 5mm}.qr-amt{display:flex;gap:6mm}.qr-pay .qr-amt p{font-size:10pt}
.qr-depot{text-align:right;margin-top:6mm!important}
@media print{.qrbill{margin:0;position:fixed;bottom:0;left:0}}
@media (max-width:820px){.qrbill{transform:scale(.45);transform-origin:top left;margin-bottom:-55mm}}`;

module.exports = { paymentPart, CSS, validIban, isQrIban, scorReference, qrrReference, parseAddress, payload };
