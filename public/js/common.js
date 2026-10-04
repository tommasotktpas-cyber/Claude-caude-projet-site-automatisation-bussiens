/* Lumea — shared front-end helpers (no framework, no build step). */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, { method = 'GET', body, raw = false } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const CURRENCY = (window.LUMEA_CONFIG && window.LUMEA_CONFIG.currency) || 'CHF';
const fmt = {
  eur: (cents) => new Intl.NumberFormat('fr-CH', { style: 'currency', currency: CURRENCY, minimumFractionDigits: cents % 100 ? 2 : 0 }).format((cents || 0) / 100),
  duration: (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`),
  date: (iso, opts = { weekday: 'long', day: 'numeric', month: 'long' }) => {
    const s = new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  time: (iso) => iso.slice(11, 16).replace(':', 'h'),
  dateTime: (iso) => `${fmt.date(iso)} à ${fmt.time(iso)}`,
  initials: (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join(''),
  stars: (n) => '★★★★★'.slice(0, Math.round(n || 0)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n || 0)),
};

const dateUtil = {
  addDays(date, n) {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  },
  weekday: (date) => new Date(`${date}T12:00:00Z`).getUTCDay(),
  toMin: (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; },
  fromMin: (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`,
};

const CATEGORY_LABELS = { coiffure: 'Coiffure', barbier: 'Barbier', esthetique: 'Esthétique', ongles: 'Ongles', spa: 'Spa', massage: 'Massage' };
const WEEKDAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const STATUS = {
  confirmed: { label: 'Confirmé', cls: 'badge-brand' },
  completed: { label: 'Terminé', cls: 'badge-ok' },
  cancelled: { label: 'Annulé', cls: '' },
  no_show: { label: 'Absent', cls: 'badge-danger' },
};

function toast(message, type = 'info') {
  let wrap = $('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    wrap.setAttribute('role', 'status');
    document.body.append(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type === 'error' ? 'error' : ''}`;
  el.textContent = message;
  wrap.append(el);
  setTimeout(() => el.remove(), 4200);
}

/** Opens a <dialog> modal. `body` is an HTML string; resolves with the clicked action name (or null). */
function modal({ title, body, actions = [{ id: 'close', label: 'Fermer', cls: 'btn-ghost' }], onOpen }) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'modal';
    d.innerHTML = `
      <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-act="__x" aria-label="Fermer">×</button></div>
      <div class="modal-body">${body}</div>
      <div class="modal-foot">${actions.map((a) => `<button class="btn ${a.cls || ''}" data-act="${a.id}">${esc(a.label)}</button>`).join('')}</div>`;
    document.body.append(d);
    const close = (val) => { d.close(); d.remove(); resolve(val); };
    d.addEventListener('click', async (e) => {
      if (e.target === d) return close(null);
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === '__x' || act === 'close') return close(null);
      const handler = actions.find((a) => a.id === act)?.handler;
      if (handler) {
        btn.disabled = true;
        try {
          const keep = await handler(d);
          if (keep === false) { btn.disabled = false; return; }
        } catch (err) {
          toast(err.message, 'error');
          btn.disabled = false;
          return;
        }
      }
      close(act);
    });
    d.addEventListener('cancel', (e) => { e.preventDefault(); close(null); });
    d.showModal();
    onOpen?.(d);
  });
}

const formData = (form) => Object.fromEntries(new FormData(form).entries());

const ICONS = {
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  pin: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/></svg>',
  scissors: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.5 7.5 20 19M8.5 16.5 20 5"/></svg>',
  team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  cog: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  till: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="10" width="18" height="11" rx="2"/><path d="M7 10V5h10v5M7 14h2M11 14h2M15 14h2M7 17h10"/></svg>',
  box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1.5S10 8 12 8zm0 0c2-4 6-4 6-1.5S14 8 12 8z"/></svg>',
  card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg>',
};

/** Renders the public site header + footer and reflects the session state. */
async function mountChrome() {
  const header = $('#site-header');
  if (header) {
    header.className = 'site-header';
    header.innerHTML = `
      <div class="container">
        <a class="logo" href="/"><span class="logo-mark" aria-hidden="true"></span>Lumea</a>
        <nav class="nav" aria-label="Navigation principale">
          <a href="/#salons" class="hide-sm">Trouver un salon</a>
          <a href="/pro" class="hide-sm">Lumea Pro</a>
          <button class="btn btn-sm btn-ghost" data-install-app hidden>Installer l’app</button>
          <span id="nav-session"><a href="/connexion" class="btn btn-sm btn-ghost">Se connecter</a></span>
        </nav>
      </div>`;
    addEventListener('scroll', () => header.classList.toggle('scrolled', scrollY > 8), { passive: true });
  }
  const footer = $('#site-footer');
  if (footer) {
    footer.className = 'site-footer';
    footer.innerHTML = `
      <div class="container">
        <div class="cols">
          <div><a class="logo" href="/"><span class="logo-mark" aria-hidden="true"></span>Lumea</a>
            <p style="margin-top:12px;max-width:320px">La réservation beauté, simple et sans engagement. Pensée pour les salons indépendants, adorée par leurs clients.</p></div>
          <div><h4>Clients</h4><a href="/#salons">Trouver un salon</a><a href="/connexion">Mon compte</a></div>
          <div><h4>Professionnels</h4><a href="/pro">Fonctionnalités</a><a href="/pro#modeles">Modèles de site</a><a href="/pro#tarifs">Tarifs</a><a href="/connexion?pro=1">Créer mon salon</a></div>
          <div><h4>Lumea</h4><a href="/mentions">Mentions légales</a><a href="/mentions#cgu">CGU</a><a href="/mentions#rgpd">Confidentialité</a></div>
        </div>
        <p style="margin-top:32px">© ${new Date().getFullYear()} Lumea. Tous droits réservés.</p>
      </div>`;
  }
  try {
    const { user } = await api('/api/auth/me');
    const slot = $('#nav-session');
    if (user && slot) {
      const target = user.role === 'pro' || user.role === 'staff' ? '/app' : user.role === 'admin' ? '/admin' : '/compte';
      const label = user.role === 'client' ? 'Mon compte' : user.role === 'admin' ? 'Admin' : user.role === 'staff' ? 'Mon agenda' : 'Mon espace pro';
      slot.innerHTML = `<a href="${target}" class="btn btn-sm">${label}</a>`;
    }
    return user;
  } catch {
    return null;
  }
}

/** Scales full-size iframe previews (1280px wide) down to their thumbnail container. */
function scaleThumbs(root = document) {
  const apply = (box) => {
    const f = box.querySelector('iframe');
    if (f) f.style.transform = `scale(${box.clientWidth / 1280})`;
  };
  const ro = new ResizeObserver((entries) => entries.forEach((e) => apply(e.target)));
  root.querySelectorAll('.tpl-thumb').forEach((b) => { apply(b); ro.observe(b); });
}

// Installable app (PWA): register the service worker, offer "install" where the browser supports it.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  document.querySelectorAll('[data-install-app]').forEach((b) => { b.hidden = false; });
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-install-app]');
  if (!b || !deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => {});
  deferredInstall = null;
  b.hidden = true;
});

// Commercial wording adapts to the platform fee configured on the server (PLATFORM_FEE_PERCENT).
document.addEventListener('DOMContentLoaded', () => {
  const fee = Number(window.LUMEA_CONFIG?.platform_fee || 0);
  document.querySelectorAll('[data-fee]').forEach((el) => { el.textContent = `${String(fee).replace('.', ',')} %`; });
  document.querySelectorAll('[data-if-fee]').forEach((el) => { el.hidden = !fee; });
  document.querySelectorAll('[data-if-nofee]').forEach((el) => { el.hidden = !!fee; });
});
