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
    createSalon(uid, {
      name: salonName, owner_name: name, category: req.body.category, city: clean(req.body.city, 80),
      email, phone: clean(req.body.phone, 40),
    });
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

router.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const salon = req.user.role === 'pro' ? one('SELECT id, slug, name FROM salons WHERE owner_id = ?', req.user.id) : null;
  res.json({ user: req.user, salon });
});

router.get('/my-bookings', requireRole('client', 'pro', 'admin'), (req, res) => {
  res.json(all(
    `SELECT b.token, b.start_at, b.status, b.price_cents, s.name AS salon_name, s.slug AS salon_slug, sv.name AS service_name, st.name AS staff_name
     FROM bookings b JOIN salons s ON s.id = b.salon_id JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id
     JOIN clients c ON c.id = b.client_id
     WHERE b.user_id = ? OR c.user_id = ? ORDER BY b.start_at DESC LIMIT 100`, req.user.id, req.user.id,
  ));
});

module.exports = router;
