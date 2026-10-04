'use strict';
const path = require('node:path');
const express = require('express');
const { one, all } = require('./db');
const { sessionMiddleware, hashPassword } = require('./auth');
const { runAutomations } = require('./notifications');
const { buildIcs } = require('./ics');
const T = require('./time');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // The booking page must be embeddable (widget); everything else is not.
    if (!(req.path === '/salon.html' && req.query.embed === '1')) res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware);

  app.get('/api/health', (_req, res) => res.json({ ok: true, now: T.now().iso }));
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/public', require('./routes/public'));
  app.use('/api/pro', require('./routes/pro'));
  app.use('/api/admin', require('./routes/admin'));
  app.get('/api/plans', (_req, res) => res.json(require('./plans').PLANS));

  // Subscribable agenda feed (Google Calendar, Apple Calendar, Outlook).
  app.get('/api/ical/:token.ics', (req, res) => {
    const salon = one('SELECT * FROM salons WHERE ical_token = ?', req.params.token);
    if (!salon) return res.status(404).send('Not found');
    const rows = all(
      `SELECT b.*, sv.name AS service_name, st.name AS staff_name, c.name AS client_name, c.phone AS client_phone
       FROM bookings b JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id JOIN clients c ON c.id = b.client_id
       WHERE b.salon_id = ? AND b.start_at >= ? AND b.status != 'cancelled' ORDER BY b.start_at`,
      salon.id, `${T.addDays(T.now().date, -30)}T00:00`,
    );
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(buildIcs(salon.name, rows.map((b) => ({
      uid: `booking-${b.id}@lumea`, start: b.start_at, end: b.end_at,
      summary: `${b.client_name} — ${b.service_name} (${b.staff_name})`, location: salon.name,
      description: `Tél : ${b.client_phone || '—'}${b.notes ? `\nNote : ${b.notes}` : ''}`,
    }))));
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Route inconnue.' }));
  app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'], maxAge: '1h' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erreur interne. Réessayez dans un instant.' : err.message });
  });
  return app;
}

function ensureAdmin() {
  const email = (process.env.ADMIN_EMAIL || 'admin@lumea.app').toLowerCase();
  if (one("SELECT id FROM users WHERE role = 'admin'")) return;
  const password = process.env.ADMIN_PASSWORD || 'admin-lumea-2026';
  require('./db').run("INSERT OR IGNORE INTO users (email, password_hash, name, role) VALUES (?,?,?, 'admin')", email, hashPassword(password), 'Administrateur');
  if (!process.env.ADMIN_PASSWORD) console.warn(`[lumea] Compte admin créé : ${email} / ${password} — définissez ADMIN_PASSWORD en production.`);
}

if (require.main === module) {
  ensureAdmin();
  if (!one('SELECT id FROM salons LIMIT 1') && process.env.SEED_DEMO !== '0') {
    require('./seed').seed();
    console.log('[lumea] Données de démonstration chargées.');
  }
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, () => console.log(`[lumea] http://localhost:${port}`));
  setInterval(() => {
    try { runAutomations(); } catch (err) { console.error('[automations]', err); }
  }, 60 * 1000).unref();
}

module.exports = { createApp, ensureAdmin };
