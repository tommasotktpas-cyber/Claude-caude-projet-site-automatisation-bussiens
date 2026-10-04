'use strict';
// Catalogue of haircuts for the 3D studio. Each salon picks the cuts it actually does;
// clients start from one of them and fine-tune lengths, fade, beard and colour.
// Lengths are in centimetres (what the barber talks about), converted to 3D units client-side.

const FADES = { none: 'Sans dégradé', low: 'Dégradé bas', mid: 'Dégradé mi-hauteur', high: 'Dégradé haut', skin: 'Dégradé à blanc' };
const BEARDS = { none: 'Rasé', stubble: 'Barbe de 3 jours', short: 'Barbe courte', full: 'Barbe longue', goatee: 'Bouc', moustache: 'Moustache' };

const STYLES = [
  { id: 'buzz', name: 'Boule à zéro / Buzz', group: 'Court', p: { top: 0.6, sides: 0.4, back: 0.4, fringe: 0, volume: 0, curl: 0, fade: 'none' } },
  { id: 'crew', name: 'Coupe militaire', group: 'Court', p: { top: 2.5, sides: 0.9, back: 1, fringe: 0.5, volume: 0.1, curl: 0, fade: 'low' } },
  { id: 'fade', name: 'Dégradé américain', group: 'Court', p: { top: 3, sides: 0, back: 0, fringe: 1, volume: 0.2, curl: 0, fade: 'skin' } },
  { id: 'french_crop', name: 'French crop', group: 'Court', p: { top: 3, sides: 0.6, back: 0.6, fringe: 3, volume: 0.1, curl: 0, fade: 'high' } },
  { id: 'undercut', name: 'Undercut', group: 'Mi-long', p: { top: 7, sides: 0.3, back: 0.3, fringe: 2, volume: 0.5, curl: 0, fade: 'high' } },
  { id: 'pompadour', name: 'Pompadour', group: 'Mi-long', p: { top: 8, sides: 1, back: 1.2, fringe: 1, volume: 1, curl: 0, fade: 'mid' } },
  { id: 'quiff', name: 'Quiff', group: 'Mi-long', p: { top: 6, sides: 1, back: 1.2, fringe: 2, volume: 0.7, curl: 0, fade: 'mid' } },
  { id: 'curly_top', name: 'Boucles dessus', group: 'Mi-long', p: { top: 6, sides: 0.5, back: 0.6, fringe: 3, volume: 0.3, curl: 0.9, fade: 'mid' } },
  { id: 'mohawk', name: 'Crête', group: 'Mi-long', p: { top: 7, sides: 0, back: 0.5, fringe: 1, volume: 0.9, curl: 0, fade: 'skin', mohawk: true } },
  { id: 'afro', name: 'Afro', group: 'Volume', p: { top: 9, sides: 8, back: 8, fringe: 4, volume: 0.6, curl: 1, fade: 'none' } },
  { id: 'pixie', name: 'Coupe garçonne', group: 'Court', p: { top: 4, sides: 2, back: 2.5, fringe: 5, volume: 0.2, curl: 0, fade: 'none' } },
  { id: 'bob', name: 'Carré', group: 'Mi-long', p: { top: 8, sides: 18, back: 18, fringe: 9, volume: 0.1, curl: 0, fade: 'none' } },
  { id: 'lob', name: 'Carré long', group: 'Long', p: { top: 10, sides: 26, back: 28, fringe: 0, volume: 0.1, curl: 0.15, fade: 'none' } },
  { id: 'long', name: 'Cheveux longs', group: 'Long', p: { top: 12, sides: 38, back: 42, fringe: 0, volume: 0.1, curl: 0.1, fade: 'none' } },
  { id: 'long_curly', name: 'Longs bouclés', group: 'Long', p: { top: 12, sides: 32, back: 36, fringe: 6, volume: 0.4, curl: 0.9, fade: 'none' } },
];

const COLORS = [
  { id: 'noir', name: 'Noir', hex: '#16110e' },
  { id: 'brun', name: 'Brun', hex: '#3b2417' },
  { id: 'chatain', name: 'Châtain', hex: '#6b4329' },
  { id: 'blond_fonce', name: 'Blond foncé', hex: '#9c7448' },
  { id: 'blond', name: 'Blond', hex: '#d2ad6e' },
  { id: 'platine', name: 'Platine', hex: '#e6dccb' },
  { id: 'roux', name: 'Roux', hex: '#a2441f' },
  { id: 'gris', name: 'Poivre et sel', hex: '#8d8a86' },
  { id: 'rose', name: 'Rose pastel', hex: '#e7a1b8' },
  { id: 'bleu', name: 'Bleu nuit', hex: '#28325e' },
];

/** Hair services get the 3D studio by default (cuts, colour, styling, beard). */
const STUDIO_SERVICE_RE = /coupe|barbe|d[ée]grad|brushing|couleur|balayage|chignon|coiffure|boucle|racines|design|rasage/i;

function catalogFor(salon) {
  let ids = [];
  try { ids = JSON.parse(salon.style_catalog || '[]'); } catch { ids = []; }
  const list = ids.length ? STYLES.filter((s) => ids.includes(s.id)) : STYLES;
  return list.length ? list : STYLES;
}

const clamp = (v, min, max, def) => (Number.isFinite(Number(v)) ? Math.min(max, Math.max(min, Number(v))) : def);

/** Validates a client's style sheet (sent with the booking). Returns null when absent/invalid. */
function sanitizeStyle(raw, salon) {
  if (!raw || typeof raw !== 'object') return null;
  const style = catalogFor(salon).find((s) => s.id === raw.style);
  if (!style) return null;
  const p = raw.params || {};
  const color = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color : '#3b2417';
  const out = {
    style: style.id,
    style_name: style.name,
    params: {
      top: clamp(p.top, 0, 20, style.p.top),
      sides: clamp(p.sides, 0, 50, style.p.sides),
      back: clamp(p.back, 0, 50, style.p.back),
      fringe: clamp(p.fringe, 0, 20, style.p.fringe),
      volume: clamp(p.volume, 0, 1, style.p.volume),
      curl: clamp(p.curl, 0, 1, style.p.curl),
      fade: FADES[p.fade] ? p.fade : style.p.fade,
      beard: BEARDS[p.beard] ? p.beard : 'none',
      color,
      color_name: COLORS.find((c) => c.hex.toLowerCase() === color.toLowerCase())?.name || 'Personnalisée',
      mohawk: !!style.p.mohawk,
    },
    note: String(raw.note || '').trim().slice(0, 300),
  };
  const image = String(raw.image || '');
  if (/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) && image.length < 200_000) out.image = image;
  return out;
}

/** Plain-text summary for the barber (agenda, e-mails). */
function describeStyle(s) {
  if (!s) return '';
  const p = s.params;
  const parts = [s.style_name, `dessus ${p.top} cm`, `côtés ${p.sides} cm`, `nuque ${p.back} cm`];
  if (p.fringe) parts.push(`frange ${p.fringe} cm`);
  if (p.fade !== 'none') parts.push(FADES[p.fade].toLowerCase());
  if (p.beard !== 'none') parts.push(BEARDS[p.beard].toLowerCase());
  parts.push(`couleur ${p.color_name.toLowerCase()}`);
  return parts.join(' · ');
}

module.exports = { STYLES, COLORS, FADES, BEARDS, STUDIO_SERVICE_RE, catalogFor, sanitizeStyle, describeStyle };
