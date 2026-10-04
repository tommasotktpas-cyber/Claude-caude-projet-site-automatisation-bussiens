'use strict';
const path = require('node:path');
const express = require('express');
const { one, all } = require('./db');
const { sessionMiddleware, hashPassword } = require('./auth');
const { runAutomations } = require('./notifications');
const { buildIcs } = require('./ics');
const T = require('./time');
const { CURRENCY } = require('./plans');
const sites = require('./sites');
const { TEMPLATES } = require('./templates');

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
  // Stripe webhooks need the raw body for signature verification.
  app.post('/api/stripe/webhook', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    const payments = require('./payments');
    const raw = req.body.toString('utf8');
    if (!payments.verifyWebhook(raw, req.headers['stripe-signature'])) return res.status(400).json({ error: 'Signature invalide.' });
    try {
      res.json({ received: await require('./billing').handleStripeEvent(JSON.parse(raw)) });
    } catch (err) {
      console.error('[stripe webhook]', err);
      res.status(500).json({ error: 'Traitement impossible.' });
    }
  });
  app.use((req, res, next) => (req.path === '/api/pro/clients/import' ? next() : express.json({ limit: '100kb' })(req, res, next)));
  app.use(sessionMiddleware);

  // Premium: a salon's own domain (www.mon-salon.ch) serves its website at "/".
  app.get('/', (req, res, next) => {
    const salon = sites.siteByDomain(req.hostname);
    if (!salon) return next();
    res.type('html').send(sites.renderSalonSite(salon));
  });

  // 3D studio engine (three.js served locally: no third-party CDN needed).
  app.get('/vendor/three.module.min.js', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=604800');
    res.sendFile(path.join(__dirname, '..', 'node_modules', 'three', 'build', 'three.module.min.js'));
  });

  app.get('/js/config.js', (_req, res) => {
    const { PLATFORM_FEE_PERCENT, CUSTOM_SITE_PRICE, BOOST_PRICE } = require('./plans');
    res.type('application/javascript').send(`window.LUMEA_CONFIG = ${JSON.stringify({ currency: CURRENCY, platform_fee: PLATFORM_FEE_PERCENT, custom_site_price: CUSTOM_SITE_PRICE, boost_price: BOOST_PRICE })};`);
  });

  // Each salon's own website.
  app.get('/s/:slug', (req, res) => {
    const salon = one('SELECT * FROM salons WHERE slug = ? AND published = 1', req.params.slug);
    const site = salon && sites.ensureSite(salon.id);
    if (!salon || !site.published) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Site introuvable</title><p style="font-family:system-ui;padding:40px">Ce site n’existe pas ou n’est pas encore publié. <a href="/">Retour</a></p>');
    res.type('html').send(sites.renderSalonSite(salon));
  });

  // Public template showcase, rendered with the demo salon's data.
  app.get('/modeles/:template', (req, res) => {
    const tpl = TEMPLATES.find((t) => t.id === req.params.template);
    const salon = one("SELECT * FROM salons WHERE published = 1 ORDER BY id LIMIT 1");
    if (!tpl || !salon) return res.status(404).send('Not found');
    res.type('html').send(sites.renderSalonSite(salon, { templateId: tpl.id, content: {}, customCss: '', preview: true }));
  });
  // Invoice shared with the client (unguessable token link).
  app.get('/facture/:token', (req, res) => {
    const inv = one('SELECT * FROM invoices WHERE token = ?', String(req.params.token));
    if (!inv) return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><title>Facture introuvable</title><p style="font-family:system-ui;padding:40px">Facture introuvable.</p>');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.type('html').send(require('./accounting').renderInvoice(inv));
  });
  app.get('/api/templates', (_req, res) => res.json(sites.templateCatalog(null)));

  app.get('/api/health', (_req, res) => res.json({ ok: true, now: T.now().iso }));
  // Caddy "on-demand TLS" asks here before issuing a certificate: only for our domain and salons' custom domains.
  app.get('/api/internal/domain-check', (req, res) => {
    const domain = String(req.query.domain || '').toLowerCase();
    const own = (process.env.APP_URL || '').replace(/^https?:\/\//, '').replace(/[:/].*$/, '').toLowerCase();
    const ok = (own && (domain === own || domain === `www.${own}`)) || !!sites.siteByDomain(domain);
    res.status(ok ? 200 : 404).end();
  });
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/public', require('./routes/public'));
  app.use('/api/pro', require('./routes/pro'));
  app.use('/api/admin', require('./routes/admin'));
  app.use('/api/voice', require('./voice').router());
  app.use('/api/sms', require('./sms').router());
  // Gmail / Outlook connection: the provider sends the owner back here (top-level navigation, session cookie present).
  app.get('/api/mail/callback/:provider', async (req, res) => {
    try {
      await require('./mail').handleCallback(req.params.provider, req.query, req.user);
      res.redirect('/app?mail=ok#emails');
    } catch (err) {
      if (!err.status) console.error('[mail callback]', err);
      res.redirect(`/app?mail_error=${encodeURIComponent(err.status ? err.message : 'Connexion impossible, réessayez.')}#emails`);
    }
  });
  app.get('/api/plans', (_req, res) => {
    const { PLANS, TEMPLATE_PRICING } = require('./plans');
    const extra = require('./plans');
    res.json({ plans: PLANS, template_pricing: TEMPLATE_PRICING, currency: CURRENCY, templates: TEMPLATES.length, platform_fee: extra.PLATFORM_FEE_PERCENT, custom_site_price: extra.CUSTOM_SITE_PRICE, boost_price: extra.BOOST_PRICE });
  });

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
  setInterval(() => { try { require('./backup').maybeBackup(); } catch (err) { console.error('[backup]', err); } }, 10 * 60 * 1000).unref();
  setInterval(() => require('./report').runDailyReports().catch((err) => console.error('[report]', err)), 5 * 60 * 1000).unref();
  setInterval(() => require('./mail').syncAll().catch((err) => console.error('[mail]', err)), 10 * 60 * 1000).unref();
}

module.exports = { createApp, ensureAdmin };
