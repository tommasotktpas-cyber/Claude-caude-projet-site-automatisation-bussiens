'use strict';
const express = require('express');
const { one, all, run, tx } = require('../db');
const { hashPassword, verifyPassword, setSession, clearSession, rateLimit, requireRole } = require('../auth');
const { HttpError, clean, EMAIL_RE } = require('../bookings');
const { createSalon } = require('../salons');
const crypto = require('node:crypto');
const { randomToken } = require('../auth');
const { send } = require('../mailer');
const { APP_URL } = require('../notifications');

const router = express.Router();
const limiter = rateLimit('auth', 15, 15 * 60 * 1000);

function readCredentials(body = {}) {
  const email = clean(body.email, 160).toLowerCase();
  const password = String(body.password || '');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Adresse e-mail invalide.');
  if (password.length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  return { email, password };
}

function createUser({ email, password, name, phone, role }) {
  if (one('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Un compte existe déjà avec cet e-mail.');
  return Number(run('INSERT INTO users (email, password_hash, name, phone, role) VALUES (?,?,?,?,?)',
    email, hashPassword(password), name, phone, role).lastInsertRowid);
}

router.post('/register', limiter, (req, res) => {
  const { email, password } = readCredentials(req.body);
  const name = clean(req.body.name, 120);
  if (name.length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  const id = createUser({ email, password, name, phone: clean(req.body.phone, 40), role: 'client' });
  // Link previous guest bookings made with the same e-mail.
  run('UPDATE clients SET user_id = ? WHERE email = ? AND user_id IS NULL', id, email);
  run('UPDATE bookings SET user_id = ? WHERE user_id IS NULL AND client_id IN (SELECT id FROM clients WHERE user_id = ?)', id, id);
  setSession(res, id);
  res.status(201).json({ ok: true, role: 'client' });
});

router.post('/register-pro', limiter, (req, res) => {
  const { email, password } = readCredentials(req.body);
  const name = clean(req.body.name, 120);
  const salonName = clean(req.body.salon_name, 120);
  if (name.length < 2) throw new HttpError(400, 'Merci d’indiquer votre nom.');
  if (salonName.length < 2) throw new HttpError(400, 'Merci d’indiquer le nom de votre établissement.');
  const id = tx(() => {
    const uid = createUser({ email, password, name, phone: clean(req.body.phone, 40), role: 'pro' });
    const salon = createSalon(uid, {
      name: salonName, owner_name: name, category: req.body.category, city: clean(req.body.city, 80),
      email, phone: clean(req.body.phone, 40),
    });
    if (req.body.ref) require('../referrals').attach(salon.id, req.body.ref);
    return uid;
  });
  setSession(res, id);
  res.status(201).json({ ok: true, role: 'pro' });
});

router.post('/login', limiter, (req, res) => {
  const email = clean(req.body?.email, 160).toLowerCase();
  const user = one('SELECT * FROM users WHERE email = ?', email);
  if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash)) {
    throw new HttpError(401, 'E-mail ou mot de passe incorrect.');
  }
  setSession(res, user.id);
  res.json({ ok: true, role: user.role });
});

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

// Password reset: always answers OK (does not reveal whether an account exists).
router.post('/forgot', limiter, (req, res) => {
  const email = clean(req.body?.email, 160).toLowerCase();
  const user = EMAIL_RE.test(email) && one('SELECT id, name, email FROM users WHERE email = ?', email);
  if (user) {
    const token = randomToken(24);
    run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', sha256(token), user.id, Date.now() + 60 * 60 * 1000);
    const body = `Bonjour ${user.name},\n\nPour choisir un nouveau mot de passe, ouvrez ce lien (valable 1 heure) :\n${APP_URL}/reset.html?t=${token}\n\nSi vous n’êtes pas à l’origine de cette demande, ignorez cet e-mail.`;
    run("INSERT INTO notifications (kind, channel, recipient, subject, body) VALUES ('password_reset','email',?,?,?)", user.email, 'Réinitialisation de votre mot de passe', body);
    send({ kind: 'password_reset', channel: 'email', to: user.email, subject: 'Réinitialisation de votre mot de passe', body });
  }
  res.json({ ok: true });
});

router.post('/reset', limiter, (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (password.length < 8) throw new HttpError(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  const row = one('SELECT * FROM password_resets WHERE token_hash = ?', sha256(token));
  if (!row || row.used || row.expires_at < Date.now()) throw new HttpError(400, 'Lien expiré ou déjà utilisé. Refaites une demande.');
  tx(() => {
    run('UPDATE password_resets SET used = 1 WHERE user_id = ?', row.user_id);
    run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), row.user_id);
  });
  setSession(res, row.user_id);
  res.json({ ok: true, role: one('SELECT role FROM users WHERE id = ?', row.user_id).role });
});

// ---- Social login (Google, Apple) ----
const oauth = require('../oauth');
const oauthStates = new Map(); // state -> { provider, nonce, next, exp } (single-instance, 10 min)

router.get('/providers', (_req, res) => res.json(oauth.enabledProviders()));

router.get('/oauth/:provider/start', (req, res) => {
  const p = oauth.PROVIDERS[req.params.provider];
  if (!p || !p.enabled()) throw new HttpError(404, 'Connexion indisponible.');
  const state = randomToken(18);
  const nonce = randomToken(18);
  const next = /^\/[\w\-/#?=&.]*$/.test(req.query.next || '') ? req.query.next : '';
  for (const [k, v] of oauthStates) if (v.exp < Date.now()) oauthStates.delete(k);
  oauthStates.set(state, { provider: req.params.provider, nonce, next, exp: Date.now() + 10 * 60 * 1000 });
  res.redirect(oauth.authorizeUrl(req.params.provider, { redirectUri: `${APP_URL}/api/auth/oauth/${req.params.provider}/callback`, state, nonce }));
});

async function oauthCallback(req, res) {
  const params = { ...req.query, ...(req.body || {}) };
  const saved = oauthStates.get(String(params.state || ''));
  oauthStates.delete(String(params.state || ''));
  const fail = (msg) => res.redirect(`/connexion?erreur=${encodeURIComponent(msg)}`);
  if (!saved || saved.provider !== req.params.provider || saved.exp < Date.now()) return fail('La connexion a expiré, réessayez.');
  if (params.error || !params.code) return fail('Connexion annulée.');
  try {
    const tokens = await oauth.exchangeCode(saved.provider, { code: String(params.code), redirectUri: `${APP_URL}/api/auth/oauth/${saved.provider}/callback` });
    const claims = await oauth.verifyIdToken(saved.provider, tokens.id_token, saved.nonce);
    const email = String(claims.email || '').toLowerCase();
    const verified = claims.email_verified === true || claims.email_verified === 'true';
    let userId = one('SELECT user_id FROM user_identities WHERE provider = ? AND subject = ?', saved.provider, String(claims.sub))?.user_id;
    if (!userId) {
      if (!EMAIL_RE.test(email) || !verified) return fail('Adresse e-mail non vérifiée par le fournisseur.');
      const existing = one('SELECT id FROM users WHERE email = ?', email);
      if (existing) userId = existing.id;
      else {
        // Apple sends the name only on the very first sign-in (form field "user").
        let name = claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ');
        try { const u = JSON.parse(params.user || '{}'); name ||= [u.name?.firstName, u.name?.lastName].filter(Boolean).join(' '); } catch { /* ignore */ }
        userId = Number(run("INSERT INTO users (email, password_hash, name, role) VALUES (?,?,?, 'client')", email, hashPassword(randomToken(24)), clean(name, 120) || email.split('@')[0]).lastInsertRowid);
        run('UPDATE clients SET user_id = ? WHERE email = ? AND user_id IS NULL', userId, email);
      }
      run('INSERT OR IGNORE INTO user_identities (provider, subject, user_id) VALUES (?,?,?)', saved.provider, String(claims.sub), userId);
    }
    setSession(res, userId);
    const role = one('SELECT role FROM users WHERE id = ?', userId).role;
    res.redirect(saved.next || (role === 'pro' || role === 'staff' ? '/app' : role === 'admin' ? '/admin' : '/compte'));
  } catch (err) {
    console.error('[oauth]', err.message);
    fail('Connexion impossible, réessayez ou utilisez votre e-mail.');
  }
}
router.get('/oauth/:provider/callback', oauthCallback);
router.post('/oauth/:provider/callback', express.urlencoded({ extended: false, limit: '20kb' }), oauthCallback);

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const salon = req.user.role === 'pro' ? one('SELECT id, slug, name FROM salons WHERE owner_id = ?', req.user.id)
    : req.user.role === 'staff' ? one('SELECT s.id, s.slug, s.name FROM salons s JOIN staff st ON st.salon_id = s.id JOIN users u ON u.staff_id = st.id WHERE u.id = ?', req.user.id)
      : null;
  res.json({ user: req.user, salon });
});

router.get('/my-bookings', requireRole('client', 'pro', 'admin'), (req, res) => {
  res.json(all(
    `SELECT b.token, b.start_at, b.status, b.price_cents, b.service_id, s.name AS salon_name, s.slug AS salon_slug, sv.name AS service_name, st.name AS staff_name
     FROM bookings b JOIN salons s ON s.id = b.salon_id JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id
     JOIN clients c ON c.id = b.client_id
     WHERE b.user_id = ? OR c.user_id = ? ORDER BY b.start_at DESC LIMIT 100`, req.user.id, req.user.id,
  ));
});

module.exports = router;
