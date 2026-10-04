import { STRINGS } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;

document.body.classList.add('loading');
$('#year').textContent = new Date().getFullYear();

// ---------------- languages ----------------
const original = new Map($$('[data-i18n]').map((el) => [el, el.innerHTML]));
function setLang(lang) {
  for (const [el, it] of original) {
    const v = lang === 'it' ? it : STRINGS[lang]?.[el.dataset.i18n];
    if (v !== undefined) el.innerHTML = v;
  }
  document.documentElement.lang = lang;
  $$('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  try { localStorage.setItem('sg-lang', lang); } catch { /* private mode */ }
  splitWords();
}
$$('[data-lang]').forEach((b) => { b.onclick = () => setLang(b.dataset.lang); });

// ---------------- 3D story ----------------
const story = $('#processo');
const chapters = $$('.chapter');
const dots = $$('#progress button');
let scene = null;

async function start3D() {
  const canvas = $('#scene');
  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
  if (!gl) { document.body.classList.add('no-webgl'); return; }
  try {
    const { createStory } = await import('./scene.js');
    scene = createStory(canvas);
    new IntersectionObserver(([e]) => (e.isIntersecting ? scene.resume() : scene.pause())).observe(story);
  } catch (err) {
    console.error(err);
    document.body.classList.add('no-webgl');
  }
}

function storyProgress() {
  const r = story.getBoundingClientRect();
  const total = story.offsetHeight - innerHeight;
  return clamp(-r.top / total) * 6.6; // a short hold at the end on the finished house
}

function onScroll() {
  const t = storyProgress();
  scene?.setProgress(Math.min(t, 6));
  $('#hero').style.opacity = String(1 - clamp(t / 0.35));
  $('#hero').style.transform = `translateY(${-clamp(t / 0.35) * 40}px)`;
  const active = t < 0.35 ? -1 : (t >= 5.9 ? 6 : Math.min(5, Math.floor(t)));
  chapters.forEach((c, i) => c.classList.toggle('on', i === active && (i === 6 || t - i > 0.18) && t < 6.6));
  dots.forEach((d, i) => d.classList.toggle('on', i === active));
  $('#progress').classList.toggle('on', t > 0.35 && t < 6.5);
  $('#meter-fill').style.width = `${clamp(t / 6) * 100}%`;
  document.body.classList.toggle('night', t > 5.3 && t < 6.6);
  $('#nav').classList.toggle('solid', story.getBoundingClientRect().bottom < 80);
  heritage();
  words();
}
dots.forEach((d) => {
  d.onclick = () => {
    const i = Number(d.dataset.go);
    const total = story.offsetHeight - innerHeight;
    scrollTo({ top: story.offsetTop + ((i === 6 ? 6.05 : i + 0.55) / 6.6) * total, behavior: reduce ? 'auto' : 'smooth' });
  };
});

// ---------------- heritage: vertical scroll → horizontal timeline ----------------
const her = $('#eredita');
const tl = $('#timeline');
function heritage() {
  const r = her.getBoundingClientRect();
  const k = clamp(-r.top / (her.offsetHeight - innerHeight));
  const max = tl.scrollWidth - innerWidth + 48;
  tl.style.transform = `translateX(${-k * Math.max(0, max)}px)`;
}

// ---------------- manifesto: words light up as you read ----------------
let wordEls = [];
function splitWords() {
  const p = $('.reveal-words');
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        const frag = document.createDocumentFragment();
        child.textContent.split(/(\s+)/).forEach((part) => {
          if (!part.trim()) { frag.append(part); return; }
          const s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.append(s);
        });
        child.replaceWith(frag);
      } else if (child.nodeType === 1) walk(child);
    }
  };
  walk(p);
  wordEls = $$('.w', p);
  words();
}
function words() {
  const p = $('.reveal-words');
  const r = p.getBoundingClientRect();
  const k = clamp((innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.35));
  const n = Math.round(k * wordEls.length);
  wordEls.forEach((w, i) => w.classList.toggle('lit', reduce || i < n));
}

// ---------------- reveals ----------------
const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.15, rootMargin: '0px 0px -8% 0px' });
$$('.reveal').forEach((el, i) => { el.style.transitionDelay = `${(i % 4) * 80}ms`; io.observe(el); });

// ---------------- cursor, magnetic buttons, tilt ----------------
if (fine && !reduce) {
  const cur = $('.cursor');
  let x = innerWidth / 2; let y = innerHeight / 2; let cx = x; let cy = y;
  addEventListener('pointermove', (e) => {
    x = e.clientX; y = e.clientY;
    scene?.setPointer((x / innerWidth - 0.5) * 2, (y / innerHeight - 0.5) * 2);
    cur.classList.toggle('big', !!e.target.closest('a, button, [data-tilt], input, select, textarea'));
  });
  (function loop() { cx += (x - cx) * 0.2; cy += (y - cy) * 0.2; cur.style.transform = `translate(${cx}px, ${cy}px)`; requestAnimationFrame(loop); }());
  $$('[data-magnetic]').forEach((b) => {
    b.addEventListener('pointermove', (e) => { const r = b.getBoundingClientRect(); b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`; });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });
  $$('[data-tilt]').forEach((c) => {
    c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); const px = (e.clientX - r.left) / r.width - 0.5; const py = (e.clientY - r.top) / r.height - 0.5; c.style.transform = `perspective(800px) rotateX(${-py * 8}deg) rotateY(${px * 10}deg) translateZ(6px)`; });
    c.addEventListener('pointerleave', () => { c.style.transform = ''; });
  });
}

// ---------------- mobile menu ----------------
$('#menu-btn').onclick = () => {
  const open = document.body.classList.toggle('menu-open');
  $('#menu-btn').setAttribute('aria-expanded', String(open));
};
$$('.links a').forEach((a) => { a.addEventListener('click', () => document.body.classList.remove('menu-open')); });

// ---------------- contact form (opens the mail app) ----------------
$('#contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = `${f.get('nome')}\n${f.get('contatto')}\n${f.get('tipo')}\n\n${f.get('messaggio')}`;
  location.href = `mailto:info@studiogellner.com?subject=${encodeURIComponent(`Progetto — ${f.get('tipo')}`)}&body=${encodeURIComponent(body)}`;
});

// ---------------- boot ----------------
let saved = 'it';
try { saved = localStorage.getItem('sg-lang') || (navigator.language || 'it').slice(0, 2); } catch { /* ignore */ }
setLang(['it', 'en', 'fr'].includes(saved) ? saved : 'it');
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
start3D().finally(() => {
  setTimeout(() => {
    $('#loader').classList.add('done');
    document.body.classList.remove('loading');
    document.body.classList.add('ready');
    onScroll();
  }, reduce ? 0 : 1400);
});
onScroll();
