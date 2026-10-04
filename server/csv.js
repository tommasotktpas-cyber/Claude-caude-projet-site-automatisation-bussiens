'use strict';
// Minimal RFC 4180 CSV parser (handles quotes, escaped quotes, CRLF, ; or , or tab delimiters).

function detectDelimiter(firstLine) {
  const counts = [';', ',', '\t'].map((d) => [d, firstLine.split(d).length]);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsv(text) {
  const src = String(text || '').replace(/^\ufeff/, '');
  const delim = detectDelimiter(src.split(/\r?\n/, 1)[0] || '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');

/** Maps header names from common exports (Salonkee, Planity, Excel, Google Contacts…) to client fields. */
function mapHeaders(headers) {
  const map = {};
  headers.forEach((h, i) => {
    const k = norm(h);
    if (map.email === undefined && /^(email|e?mail|courriel|adresseemail|emailaddress)/.test(k)) map.email = i;
    else if (map.phone === undefined && /(tel|phone|mobile|natel|portable|gsm)/.test(k)) map.phone = i;
    else if (map.first === undefined && /^(prenom|firstname|givenname|vorname)/.test(k)) map.first = i;
    else if (map.last === undefined && /^(nomdefamille|lastname|familyname|surname|nachname)/.test(k)) map.last = i;
    else if (map.name === undefined && /^(nom|name|client|clientname|nomcomplet|fullname)$/.test(k)) map.name = i;
    else if (map.notes === undefined && /(note|remarque|commentaire|comment|bemerkung)/.test(k)) map.notes = i;
  });
  return map;
}

module.exports = { parseCsv, mapHeaders };
