'use strict';
// Website templates. Each salon gets its own site rendered server-side (fast, SEO-friendly)
// from one of these designs plus its own content (texts, colours, photos, sections).

const T = require('./time');

const CATEGORY_LABELS = { coiffure: 'Coiffure', barbier: 'Barbier', esthetique: 'Institut de beauté', ongles: 'Onglerie', spa: 'Spa', massage: 'Massage' };
const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

const TEMPLATES = [
  {
    id: 'classique', name: 'Classique', free: true, best_for: ['coiffure', 'esthetique', 'ongles'],
    description: 'Clair, moderne et efficace. Vos couleurs, votre nom, la réservation au premier plan.',
    fonts: { display: 'Plus Jakarta Sans', body: 'Plus Jakarta Sans', href: 'Plus+Jakarta+Sans:wght@400;500;700;800' },
    colors: { bg: '#faf9f7', surface: '#ffffff', text: '#1b1820', muted: '#6e6878', line: '#e9e5df', accent: null },
    hero: 'centered', services: 'cards', radius: 16, headingWeight: 800,
  },
  {
    id: 'elegance', name: 'Élégance', best_for: ['coiffure', 'spa', 'esthetique'],
    description: 'Noir profond et or, typographie couture. Pour les salons haut de gamme.',
    fonts: { display: 'Cormorant Garamond', body: 'Jost', href: 'Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Jost:wght@300;400;500' },
    colors: { bg: '#0f0e0d', surface: '#191715', text: '#f3ede4', muted: '#a89f92', line: '#2c2925', accent: '#c9a96e', accentInk: '#0f0e0d' },
    hero: 'split', services: 'menu', radius: 2, headingWeight: 600, labelCase: 'uppercase',
  },
  {
    id: 'minimal', name: 'Minimal', best_for: ['coiffure', 'barbier'],
    description: 'Noir sur blanc, grandes lettres, zéro décoration. Le style des concept-stores.',
    fonts: { display: 'Inter Tight', body: 'Inter Tight', href: 'Inter+Tight:wght@400;500;800' },
    colors: { bg: '#ffffff', surface: '#f5f5f5', text: '#111111', muted: '#6b6b6b', line: '#e5e5e5', accent: '#111111', accentInk: '#ffffff' },
    hero: 'editorial', services: 'menu', radius: 0, headingWeight: 800, tight: true,
  },
  {
    id: 'urbain', name: 'Urbain', best_for: ['barbier'],
    description: 'Sombre, contrasté, titres en capitales. Taillé pour les barber shops.',
    fonts: { display: 'Oswald', body: 'Barlow', href: 'Oswald:wght@500;600;700&family=Barlow:wght@400;500;600' },
    colors: { bg: '#121212', surface: '#1c1c1c', text: '#f5f5f5', muted: '#a3a3a3', line: '#2b2b2b', accent: '#e4b649', accentInk: '#121212' },
    hero: 'full', services: 'cards', radius: 4, headingWeight: 600, headingCase: 'uppercase',
  },
  {
    id: 'zen', name: 'Zen', best_for: ['spa', 'massage'],
    description: 'Tons sauge et sable, formes douces. Une respiration dès la première seconde.',
    fonts: { display: 'Lora', body: 'Nunito Sans', href: 'Lora:ital,wght@0,500;1,500&family=Nunito+Sans:wght@400;600;700' },
    colors: { bg: '#f4f1ea', surface: '#fbfaf6', text: '#2f3a33', muted: '#6f7a72', line: '#e2ddd2', accent: '#6b8f71', accentInk: '#ffffff' },
    hero: 'split', services: 'menu', radius: 26, headingWeight: 500,
  },
  {
    id: 'pop', name: 'Pop', best_for: ['ongles', 'esthetique'],
    description: 'Rose vif, formes rondes, énergie. Parfait pour les ongleries et le nail art.',
    fonts: { display: 'Poppins', body: 'Poppins', href: 'Poppins:wght@400;500;700;800' },
    colors: { bg: '#fff5f9', surface: '#ffffff', text: '#2b1030', muted: '#85677f', line: '#f6dbe7', accent: '#ff3d8b', accentInk: '#ffffff' },
    hero: 'centered', services: 'cards', radius: 28, headingWeight: 800, blobs: true,
  },
  {
    id: 'nature', name: 'Nature', best_for: ['spa', 'massage', 'esthetique'],
    description: 'Terre cuite, lin et bois. Chaleureux, authentique, cosmétique naturelle.',
    fonts: { display: 'DM Serif Display', body: 'DM Sans', href: 'DM+Serif+Display&family=DM+Sans:wght@400;500;700' },
    colors: { bg: '#f3ece2', surface: '#fbf7f1', text: '#3b2f25', muted: '#7d6b5c', line: '#e4d8c8', accent: '#b5653d', accentInk: '#ffffff' },
    hero: 'full', services: 'menu', radius: 12, headingWeight: 400,
  },
  {
    id: 'riviera', name: 'Riviera', best_for: ['coiffure', 'spa'],
    description: 'Bleu lac et blanc, lumineux et aérien. L’esprit Léman.',
    fonts: { display: 'Playfair Display', body: 'Source Sans 3', href: 'Playfair+Display:wght@600;700&family=Source+Sans+3:wght@400;600' },
    colors: { bg: '#f7fbfd', surface: '#ffffff', text: '#10314a', muted: '#5a7489', line: '#dde9f0', accent: '#1f7fb6', accentInk: '#ffffff' },
    hero: 'split', services: 'cards', radius: 18, headingWeight: 700,
  },
  {
    id: 'atelier', name: 'Atelier', best_for: ['coiffure', 'barbier', 'esthetique'],
    description: 'Mise en page éditoriale façon magazine, filets fins et grandes capitales.',
    fonts: { display: 'Libre Baskerville', body: 'Work Sans', href: 'Libre+Baskerville:wght@400;700&family=Work+Sans:wght@400;500;600' },
    colors: { bg: '#fbfaf7', surface: '#ffffff', text: '#1a1a1a', muted: '#6d6a64', line: '#1a1a1a22', accent: '#a3382c', accentInk: '#ffffff' },
    hero: 'editorial', services: 'menu', radius: 0, headingWeight: 700, labelCase: 'uppercase',
  },
  {
    id: 'neon', name: 'Néon', best_for: ['barbier', 'ongles'],
    description: 'Fond nuit, accents lumineux, typographie tech. Pour une clientèle jeune.',
    fonts: { display: 'Space Grotesk', body: 'Space Grotesk', href: 'Space+Grotesk:wght@400;500;700' },
    colors: { bg: '#0b0b14', surface: '#15152b', text: '#ececff', muted: '#9a9ac4', line: '#25254a', accent: '#8b5cf6', accentInk: '#ffffff' },
    hero: 'full', services: 'cards', radius: 14, headingWeight: 700, glow: true,
  },
];

const templateById = (id) => TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];

const SECTION_KEYS = ['about', 'services', 'team', 'gallery', 'reviews', 'infos'];

/** Fills content defaults from the salon record. */
function contentWithDefaults(salon, raw = {}) {
  const firstSentence = (salon.description || '').split(/(?<=[.!?])\s/)[0];
  const sections = Object.fromEntries(SECTION_KEYS.map((k) => [k, raw.sections?.[k] !== false]));
  return {
    announcement: raw.announcement || '',
    tagline: raw.tagline || `${CATEGORY_LABELS[salon.category] || ''} · ${salon.city}`.replace(/^ · /, ''),
    hero_title: raw.hero_title || salon.name,
    hero_subtitle: raw.hero_subtitle || firstSentence || 'Réservez votre rendez-vous en ligne, 24 h / 24.',
    hero_image: raw.hero_image || salon.cover_url || '',
    cta_label: raw.cta_label || 'Prendre rendez-vous',
    about_title: raw.about_title || 'Notre maison',
    about_text: raw.about_text || salon.description || '',
    gallery: Array.isArray(raw.gallery) ? raw.gallery.filter(Boolean).slice(0, 12) : [],
    accent: /^#[0-9a-f]{6}$/i.test(raw.accent || '') ? raw.accent : '',
    socials: {
      instagram: raw.socials?.instagram || '', facebook: raw.socials?.facebook || '',
      tiktok: raw.socials?.tiktok || '', whatsapp: raw.socials?.whatsapp || '',
    },
    sections,
    hide_branding: !!raw.hide_branding,
  };
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (/^https?:\/\/[^\s'"()<>\\]+$/.test(u || '') ? u : '');
const initials = (n) => String(n).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

function money(cents, currency) {
  return new Intl.NumberFormat('fr-CH', { style: 'currency', currency, minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}
const duration = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`);

/** Renders a complete, standalone HTML page for a salon's website. */
function renderSite({ salon, services, staff, hours, reviews, rating, content, templateId, customCss = '', currency = 'CHF', preview = false, showBranding = true }) {
  const t = templateById(templateId);
  const c = contentWithDefaults(salon, content);
  const accent = c.accent || t.colors.accent || salon.accent || '#7c3aed';
  const accentInk = t.colors.accentInk || '#ffffff';
  const slug = encodeURIComponent(salon.slug);
  const heroImg = safeUrl(c.hero_image);
  const today = T.weekday(T.now().date);

  const groups = {};
  for (const s of services) (groups[s.category] ||= []).push(s);
  const byDay = {};
  for (const h of hours) (byDay[h.weekday] ||= []).push(`${h.open.replace(':', 'h')} – ${h.close.replace(':', 'h')}`);
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${salon.address}, ${salon.zip} ${salon.city}`)}`;
  const minPrice = services.length ? Math.min(...services.map((s) => s.price_cents)) : null;
  const socialLinks = [
    ['instagram', 'Instagram', (v) => (v.startsWith('http') ? v : `https://instagram.com/${v.replace(/^@/, '')}`)],
    ['facebook', 'Facebook', (v) => (v.startsWith('http') ? v : `https://facebook.com/${v}`)],
    ['tiktok', 'TikTok', (v) => (v.startsWith('http') ? v : `https://tiktok.com/@${v.replace(/^@/, '')}`)],
    ['whatsapp', 'WhatsApp', (v) => `https://wa.me/${v.replace(/[^\d]/g, '')}`],
  ].filter(([k]) => c.socials[k]).map(([k, label, fn]) => `<a href="${esc(safeUrl(fn(c.socials[k])))}" target="_blank" rel="noopener">${label}</a>`).join('');

  const ratingHtml = rating?.avg ? `<span class="rating"><span class="stars">★</span> ${Number(rating.avg).toFixed(1)} <span class="muted">· ${rating.n} avis vérifiés</span></span>` : '';
  const heroVisual = heroImg
    ? `<div class="hero-visual" style="background-image:url('${esc(heroImg)}')"></div>`
    : `<div class="hero-visual hero-visual--art"><span>${esc(initials(salon.name))}</span></div>`;

  const heroes = {
    centered: `
      <section class="hero hero--centered">${t.blobs ? '<i class="blob b1"></i><i class="blob b2"></i>' : ''}
        <div class="wrap center">
          <p class="label">${esc(c.tagline)}</p>
          <h1>${esc(c.hero_title)}</h1>
          <p class="lead">${esc(c.hero_subtitle)}</p>
          <div class="actions"><button class="btn" data-book>${esc(c.cta_label)}</button><a class="btn btn--ghost" href="#services">Voir les prestations</a></div>
          <div class="hero-meta">${ratingHtml}${minPrice != null ? `<span>Dès ${money(minPrice, currency)}</span>` : ''}<span>${esc(salon.city)}</span></div>
        </div>
        ${heroImg ? `<div class="wrap"><div class="hero-banner" style="background-image:url('${esc(heroImg)}')"></div></div>` : ''}
      </section>`,
    split: `
      <section class="hero hero--split"><div class="wrap grid2">
        <div><p class="label">${esc(c.tagline)}</p><h1>${esc(c.hero_title)}</h1><p class="lead">${esc(c.hero_subtitle)}</p>
          <div class="actions"><button class="btn" data-book>${esc(c.cta_label)}</button><a class="btn btn--ghost" href="#infos">Horaires & accès</a></div>
          <div class="hero-meta">${ratingHtml}</div></div>
        ${heroVisual}
      </div></section>`,
    full: `
      <section class="hero hero--full" ${heroImg ? `style="background-image:linear-gradient(180deg,rgba(0,0,0,.35),rgba(0,0,0,.7)),url('${esc(heroImg)}')"` : ''}>
        <div class="wrap"><p class="label">${esc(c.tagline)}</p><h1>${esc(c.hero_title)}</h1><p class="lead">${esc(c.hero_subtitle)}</p>
          <div class="actions"><button class="btn" data-book>${esc(c.cta_label)}</button></div><div class="hero-meta">${ratingHtml}</div></div>
      </section>`,
    editorial: `
      <section class="hero hero--editorial"><div class="wrap">
        <div class="rule"><span>${esc(c.tagline)}</span><span>${esc(salon.city)}</span></div>
        <h1>${esc(c.hero_title)}</h1>
        <div class="grid2"><p class="lead">${esc(c.hero_subtitle)}</p>
          <div class="actions" style="justify-content:flex-end"><button class="btn" data-book>${esc(c.cta_label)}</button></div></div>
        ${heroImg ? `<div class="hero-banner" style="background-image:url('${esc(heroImg)}')"></div>` : '<div class="rule"></div>'}
      </div></section>`,
  };

  const serviceItem = (s) => (t.services === 'menu'
    ? `<div class="menu-item"><div class="mi-main"><span class="mi-name">${esc(s.name)}</span><span class="mi-dots"></span><span class="mi-price">${money(s.price_cents, currency)}</span></div>
        <div class="mi-sub"><span>${duration(s.duration_min)}${s.description ? ` · ${esc(s.description)}` : ''}</span><button class="link" data-book="${s.id}">Réserver →</button></div></div>`
    : `<div class="card svc"><div><h4>${esc(s.name)}</h4><p class="muted small">${duration(s.duration_min)}${s.description ? ` · ${esc(s.description)}` : ''}</p></div>
        <div class="svc-foot"><b>${money(s.price_cents, currency)}</b><button class="btn btn--sm" data-book="${s.id}">Réserver</button></div></div>`);

  const sections = [];
  if (c.sections.about && c.about_text) {
    sections.push(`<section id="about" class="section"><div class="wrap grid2 about">
      <div><p class="label">À propos</p><h2>${esc(c.about_title)}</h2></div>
      <div><p class="big">${esc(c.about_text)}</p>${ratingHtml ? `<p>${ratingHtml}</p>` : ''}</div></div></section>`);
  }
  if (c.sections.services && services.length) {
    sections.push(`<section id="services" class="section alt"><div class="wrap">
      <p class="label">Carte des soins</p><h2>Prestations & tarifs</h2>
      ${Object.entries(groups).map(([cat, list]) => `<div class="svc-group"><h3>${esc(cat)}</h3><div class="${t.services === 'menu' ? 'menu' : 'svc-grid'}">${list.map(serviceItem).join('')}</div></div>`).join('')}
    </div></section>`);
  }
  if (c.sections.team && staff.length) {
    sections.push(`<section id="team" class="section"><div class="wrap">
      <p class="label">L’équipe</p><h2>Les mains derrière le résultat</h2>
      <div class="team">${staff.map((p) => `<div class="member"><div class="avatar" style="--c:${esc(p.color)}">${esc(initials(p.name))}</div><b>${esc(p.name)}</b><span class="muted small">${esc(p.title)}</span></div>`).join('')}</div>
    </div></section>`);
  }
  if (c.sections.gallery && c.gallery.length) {
    sections.push(`<section id="gallery" class="section alt"><div class="wrap"><p class="label">Galerie</p><h2>Nos réalisations</h2>
      <div class="gallery">${c.gallery.map(safeUrl).filter(Boolean).map((u) => `<div class="g" style="background-image:url('${esc(u)}')"></div>`).join('')}</div></div></section>`);
  }
  if (c.sections.reviews && reviews.length) {
    sections.push(`<section id="reviews" class="section"><div class="wrap">
      <p class="label">Ils en parlent</p><h2>${rating?.avg ? `${Number(rating.avg).toFixed(1)} / 5 sur ${rating.n} avis vérifiés` : 'Avis clients'}</h2>
      <div class="reviews">${reviews.slice(0, 6).map((r) => `<figure class="card review"><div class="stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div><blockquote>${esc(r.comment || 'Excellent.')}</blockquote><figcaption>— ${esc(r.author_name)}</figcaption></figure>`).join('')}</div>
    </div></section>`);
  }
  if (c.sections.infos) {
    sections.push(`<section id="infos" class="section alt"><div class="wrap grid2">
      <div><p class="label">Nous trouver</p><h2>Horaires & accès</h2>
        <p class="big">${esc(salon.address)}<br>${esc(salon.zip)} ${esc(salon.city)}</p>
        <div class="actions"><a class="btn btn--ghost" href="${esc(mapsUrl)}" target="_blank" rel="noopener">Itinéraire</a>${salon.giftcards_enabled ? `<a class="btn btn--ghost" href="/carte-cadeau.html?s=${slug}">Offrir une carte cadeau</a>` : ''}${salon.phone ? `<a class="btn btn--ghost" href="tel:${esc(salon.phone.replace(/\s/g, ''))}">${esc(salon.phone)}</a>` : ''}</div>
        ${socialLinks ? `<div class="socials">${socialLinks}</div>` : ''}</div>
      <div class="card hours">${[1, 2, 3, 4, 5, 6, 0].map((wd) => `<div class="${wd === today ? 'today' : ''}"><span>${WEEKDAYS[wd]}</span><span>${byDay[wd] ? byDay[wd].join(', ') : 'Fermé'}</span></div>`).join('')}</div>
    </div></section>`);
  }

  const navLinks = [['services', 'Prestations'], ['team', 'Équipe'], ['reviews', 'Avis'], ['infos', 'Infos']]
    .filter(([k]) => c.sections[k]).map(([k, l]) => `<a href="#${k}">${l}</a>`).join('');

  const css = `
:root{--bg:${t.colors.bg};--surface:${t.colors.surface};--text:${t.colors.text};--muted:${t.colors.muted};--line:${t.colors.line};--accent:${accent};--accent-ink:${accentInk};--r:${t.radius}px;--fd:'${t.fonts.display}',Georgia,serif;--fb:'${t.fonts.body}',system-ui,sans-serif}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font-family:var(--fb);line-height:1.6;font-size:16px}
a{color:inherit}img{max-width:100%}.wrap{width:min(1120px,100% - 40px);margin-inline:auto}.center{text-align:center}.muted{color:var(--muted)}.small{font-size:.88rem}
h1,h2,h3,h4{font-family:var(--fd);font-weight:${t.headingWeight};line-height:1.08;margin:0 0 .4em;${t.headingCase ? `text-transform:${t.headingCase};` : ''}${t.tight ? 'letter-spacing:-.04em;' : 'letter-spacing:-.01em;'}}
h1{font-size:clamp(2.6rem,7vw,5.4rem)}h2{font-size:clamp(1.9rem,4vw,3rem)}h3{font-size:1rem;font-family:var(--fb);letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:34px 0 14px}h4{font-size:1.2rem;font-family:var(--fb);text-transform:none;letter-spacing:0}
.label{font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;color:var(--accent);font-weight:600;margin:0 0 14px}
.lead{font-size:1.2rem;color:var(--muted);max-width:620px}.center .lead{margin-inline:auto}.big{font-size:1.15rem}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--accent);color:var(--accent-ink);border:1px solid var(--accent);padding:14px 26px;border-radius:var(--r);font:inherit;font-weight:600;cursor:pointer;text-decoration:none;transition:transform .1s,box-shadow .2s,opacity .2s${t.glow ? ';box-shadow:0 0 24px color-mix(in srgb,var(--accent) 60%,transparent)' : ''}}
.btn:hover{transform:translateY(-1px);opacity:.92}.btn--ghost{background:transparent;color:var(--text);border-color:var(--line)}.btn--sm{padding:8px 16px;font-size:.9rem}
.link{background:none;border:0;color:var(--accent);font:inherit;font-weight:600;cursor:pointer;padding:0}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:26px}.center .actions{justify-content:center}
.announce{background:var(--accent);color:var(--accent-ink);text-align:center;padding:8px 16px;font-size:.9rem;font-weight:500}
.nav{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.nav .wrap{display:flex;align-items:center;gap:24px;height:70px}.brand{font-family:var(--fd);font-weight:${t.headingWeight};font-size:1.4rem;text-decoration:none;${t.headingCase ? `text-transform:${t.headingCase};` : ''}white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.nav nav{display:flex;gap:22px;margin-left:auto}.nav nav a{text-decoration:none;color:var(--muted);font-weight:500}.nav nav a:hover{color:var(--text)}
@media(max-width:760px){.nav nav{display:none}.nav .btn{margin-left:auto;padding:10px 16px}}
.hero{position:relative;overflow:hidden}.hero-meta{display:flex;gap:18px;flex-wrap:wrap;margin-top:22px;color:var(--muted);font-size:.95rem}.center .hero-meta{justify-content:center}
.stars{color:#f5a623}.rating{color:var(--text)}
.hero--centered{padding:110px 0 80px}.hero-banner{margin-top:56px;height:min(52vw,460px);border-radius:var(--r);background-size:cover;background-position:center}
.blob{position:absolute;border-radius:50%;filter:blur(60px);opacity:.5;z-index:-1}.b1{width:420px;height:420px;background:var(--accent);top:-120px;left:-120px}.b2{width:380px;height:380px;background:#ffb547;bottom:-160px;right:-80px}
.hero--split{padding:90px 0}.grid2{display:grid;grid-template-columns:1.1fr 1fr;gap:56px;align-items:center}
.hero-visual{aspect-ratio:4/5;border-radius:var(--r);background-size:cover;background-position:center;position:relative}
.hero-visual--art{background:radial-gradient(circle at 25% 20%,color-mix(in srgb,var(--accent) 40%,#fff),transparent 55%),linear-gradient(140deg,var(--accent),color-mix(in srgb,var(--accent) 45%,var(--text)));display:grid;place-items:center}
.hero-visual--art span{font-family:var(--fd);font-size:clamp(4rem,12vw,9rem);color:color-mix(in srgb,#fff 85%,transparent)}
.hero--full{min-height:82vh;display:flex;align-items:flex-end;padding:120px 0 90px;color:#fff;background:radial-gradient(circle at 80% 10%,color-mix(in srgb,var(--accent) 55%,transparent),transparent 50%),linear-gradient(160deg,color-mix(in srgb,var(--accent) 35%,#000),#000);background-size:cover;background-position:center}
.hero--full .lead,.hero--full .hero-meta,.hero--full .rating{color:#ffffffcc}.hero--full h1{max-width:900px}
.hero--editorial{padding:70px 0 40px}.hero--editorial h1{font-size:clamp(3rem,11vw,9rem);margin:28px 0}.rule{display:flex;justify-content:space-between;border-top:1px solid var(--text);padding-top:12px;font-size:.8rem;letter-spacing:.16em;text-transform:uppercase}
.section{padding:100px 0}.section.alt{background:var(--surface)}
.about .big{font-size:1.3rem;line-height:1.7}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:24px}.alt .card{background:var(--bg)}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}.svc{display:flex;flex-direction:column;justify-content:space-between;gap:16px}.svc-foot{display:flex;justify-content:space-between;align-items:center}
.menu{border-top:1px solid var(--line)}.menu-item{padding:18px 0;border-bottom:1px solid var(--line)}.mi-main{display:flex;align-items:baseline;gap:10px;font-size:1.1rem}.mi-name{font-weight:500}.mi-dots{flex:1;border-bottom:1px dotted var(--muted);opacity:.5;transform:translateY(-4px)}.mi-price{font-family:var(--fd);font-size:1.25rem}
.mi-sub{display:flex;justify-content:space-between;gap:16px;color:var(--muted);font-size:.9rem;margin-top:4px}
.team{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:22px;margin-top:20px}.member{display:flex;flex-direction:column;gap:4px;align-items:flex-start}
.avatar{width:100%;aspect-ratio:1;border-radius:var(--r);background:linear-gradient(150deg,var(--c),color-mix(in srgb,var(--c) 50%,var(--text)));display:grid;place-items:center;color:#fff;font-family:var(--fd);font-size:2.6rem;margin-bottom:10px}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;margin-top:20px}.g{aspect-ratio:1;border-radius:var(--r);background-size:cover;background-position:center}
.reviews{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:20px}.review blockquote{margin:12px 0;font-size:1.05rem}.review figcaption{color:var(--muted);font-size:.9rem}
.hours div{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--line)}.hours div:last-child{border:0}.hours .today{color:var(--accent);font-weight:700}
.socials{display:flex;gap:18px;margin-top:22px}.socials a{color:var(--accent);font-weight:600;text-decoration:none}
footer{padding:40px 0;border-top:1px solid var(--line);color:var(--muted);font-size:.88rem}footer .wrap{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}
.sticky-cta{display:none}@media(max-width:760px){.grid2{grid-template-columns:1fr;gap:32px}.section{padding:70px 0}.hero--split{padding:50px 0}.hero-visual{aspect-ratio:16/10}
.sticky-cta{display:block;position:fixed;left:12px;right:12px;bottom:12px;z-index:30}.sticky-cta .btn{width:100%}body{padding-bottom:80px}}
.bk{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px}.bk.open{display:flex}
.bk-box{width:min(540px,100%);height:min(860px,100%);background:#fff;border-radius:18px;overflow:hidden;position:relative;box-shadow:0 30px 80px rgba(0,0,0,.35)}.bk-box iframe{width:100%;height:100%;border:0}
@media(max-width:600px){.bk{padding:0}.bk-box{height:100%;border-radius:0}}
${preview ? '.preview-flag{position:fixed;bottom:10px;left:10px;z-index:200;background:#111;color:#fff;font:600 12px system-ui;padding:6px 10px;border-radius:8px;opacity:.8}' : ''}
`;

  const description = `${c.hero_subtitle} ${salon.address}, ${salon.city}. Réservation en ligne 24/7.`.slice(0, 300);
  const jsonLd = {
    '@context': 'https://schema.org', '@type': 'BeautySalon', name: salon.name, description: salon.description,
    address: { '@type': 'PostalAddress', streetAddress: salon.address, postalCode: salon.zip, addressLocality: salon.city },
    telephone: salon.phone || undefined,
    ...(rating?.avg ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: rating.avg, reviewCount: rating.n } } : {}),
  };

  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(salon.name)} — ${esc(c.tagline)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(salon.name)}"><meta property="og:description" content="${esc(description)}">${heroImg ? `<meta property="og:image" content="${esc(heroImg)}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${t.fonts.href}&display=swap">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>${css}</style>
${customCss ? `<style>${customCss.replace(/<\/style/gi, '')}</style>` : ''}
</head>
<body>
${preview ? '<div class="preview-flag">Aperçu</div>' : ''}
${c.announcement ? `<div class="announce">${esc(c.announcement)}</div>` : ''}
<header class="nav"><div class="wrap"><a class="brand" href="#top">${esc(salon.name)}</a><nav>${navLinks}</nav><button class="btn btn--sm" data-book>Réserver</button></div></header>
<main id="top">
${heroes[t.hero]}
${sections.join('\n')}
</main>
<footer><div class="wrap"><span>© ${new Date().getFullYear()} ${esc(salon.name)} · ${esc(salon.address)}, ${esc(salon.city)}</span>${showBranding ? '<a href="/pro" target="_blank" rel="noopener">Réservation propulsée par Lumea</a>' : ''}</div></footer>
<div class="sticky-cta"><button class="btn" data-book>${esc(c.cta_label)}</button></div>
<div class="bk" id="bk" role="dialog" aria-modal="true" aria-label="Réservation"><div class="bk-box"><iframe id="bk-frame" title="Réservation" loading="lazy"></iframe></div></div>
<script>
(function(){
  var bk=document.getElementById('bk'),fr=document.getElementById('bk-frame');
  function open(id){fr.src='/salon.html?s=${slug}&embed=1&modal=1&accent=${encodeURIComponent(accent.slice(1))}'+(id?'&service='+encodeURIComponent(id):'&book=1');bk.classList.add('open');document.body.style.overflow='hidden'}
  function close(){bk.classList.remove('open');document.body.style.overflow='';fr.src='about:blank'}
  document.addEventListener('click',function(e){var b=e.target.closest('[data-book]');if(b){e.preventDefault();${preview ? "return;" : ''}open(b.getAttribute('data-book'))}});
  bk.addEventListener('click',function(e){if(e.target===bk)close()});
  addEventListener('keydown',function(e){if(e.key==='Escape')close()});
  addEventListener('message',function(e){if(e.origin===location.origin&&e.data&&e.data.lumea==='close')close()});
})();
</script>
${preview ? '' : `<script src="/js/chat-widget.js" data-salon="${slug}" data-color="${esc(accent)}" data-name="${esc(salon.name)}" data-offset="1" defer></script>`}
</body>
</html>`;
}

module.exports = { TEMPLATES, templateById, renderSite, contentWithDefaults, SECTION_KEYS };
