'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { one } = require('./db');

function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const file = path.join(__dirname, '..', 'data', 'secret');
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    const s = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(file, s, { mode: 0o600 }); } catch { /* read-only FS: secret lives in memory */ }
    return s;
  }
}
const SECRET = loadSecret();
const COOKIE = 'lumea_sid';
const MAX_AGE_S = 60 * 60 * 24 * 30;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

function createSessionToken(userId) {
  const payload = b64(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S }));
  return `${payload}.${sign(payload)}`;
}

function readSessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setSession(res, userId) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${createSessionToken(userId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/** Attaches req.user (or null) from the session cookie. */
function sessionMiddleware(req, _res, next) {
  const data = readSessionToken(parseCookies(req.headers.cookie)[COOKIE]);
  req.user = data ? one('SELECT id, email, name, phone, role, loyalty_points, staff_id FROM users WHERE id = ?', data.uid) || null : null;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentification requise.' });
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Accès refusé.' });
    next();
  };
}

/** Naive in-memory rate limiter, keyed by IP + bucket name. */
const hits = new Map();
function rateLimit(bucket, max, windowMs) {
  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`;
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    if (++entry.count > max) return res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes.' });
    next();
  };
}

const randomToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

module.exports = {
  hashPassword, verifyPassword, setSession, clearSession, sessionMiddleware,
  requireRole, rateLimit, randomToken, createSessionToken, readSessionToken,
};
