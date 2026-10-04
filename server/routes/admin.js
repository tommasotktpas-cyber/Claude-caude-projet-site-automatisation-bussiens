'use strict';
const express = require('express');
const { one, all, run } = require('../db');
const { requireRole } = require('../auth');
const { HttpError } = require('../bookings');
const { PLANS, TEMPLATE_PRICING, CURRENCY } = require('../plans');
const T = require('../time');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/overview', (_req, res) => {
  const salons = all(
    `SELECT s.id, s.name, s.slug, s.city, s.category, s.plan, s.trial_ends_at, s.published, s.created_at, u.email AS owner_email,
            (SELECT COUNT(*) FROM bookings b WHERE b.salon_id = s.id) AS bookings,
            (SELECT COUNT(*) FROM staff st WHERE st.salon_id = s.id AND st.active = 1) AS staff,
            x.template, x.published AS site_published, x.custom_domain, s.boost_until, s.referral_credit_months,
            (SELECT r.name FROM salons r WHERE r.id = s.referred_by) AS referred_by_name,
            (SELECT COUNT(*) FROM template_licenses l WHERE l.salon_id = s.id AND l.active = 1) AS licenses
     FROM salons s LEFT JOIN sites x ON x.salon_id = s.id JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC`,
  );
  const price = Object.fromEntries(PLANS.map((p) => [p.id, p.price]));
  const paying = salons.filter((s) => price[s.plan]);
  const lic = one(`SELECT COALESCE(SUM(price_chf) FILTER (WHERE billing = 'monthly' AND active = 1), 0) AS monthly,
                          COALESCE(SUM(price_chf) FILTER (WHERE billing = 'once'), 0) AS once,
                          COUNT(*) FILTER (WHERE active = 1) AS active FROM template_licenses`);
  const { BOOST_PRICE, PLATFORM_FEE_PERCENT } = require('../plans');
  const boosts = one("SELECT COUNT(*) AS n FROM salons WHERE boost_until >= ?", T.now().date).n;
  const plansMrr = paying.reduce((sum, s) => sum + price[s.plan], 0) + boosts * BOOST_PRICE;
  const customSites = one('SELECT COALESCE(SUM(paid_chf), 0) AS total, COUNT(*) FILTER (WHERE paid_chf > 0) AS n FROM design_requests');
  res.json({
    salons,
    kpis: {
      salons: salons.length,
      paying: paying.length,
      trials: salons.filter((s) => s.plan === 'trial').length,
      mrr: plansMrr + lic.monthly,
      mrr_plans: plansMrr,
      mrr_templates: lic.monthly,
      templates_once_total: lic.once,
      licenses_active: lic.active,
      boosts,
      custom_sites_total: customSites.total,
      custom_sites: customSites.n,
      platform_fee_percent: PLATFORM_FEE_PERCENT,
      premium: salons.filter((s) => s.plan === 'premium').length,
      essentiel: salons.filter((s) => s.plan === 'essentiel').length,
      bookings_30d: one('SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?', `${T.addDays(T.now().date, -30)} 00:00:00`).n,
      users: one("SELECT COUNT(*) AS n FROM users WHERE role = 'client'").n,
    },
    plans: PLANS,
    currency: CURRENCY,
    template_pricing: TEMPLATE_PRICING,
    design_requests: all(
      `SELECT d.*, s.name AS salon_name, s.slug, u.email AS owner_email FROM design_requests d
       JOIN salons s ON s.id = d.salon_id JOIN users u ON u.id = s.owner_id ORDER BY d.status = 'livre', d.created_at DESC`,
    ),
  });
});

router.patch('/salons/:id', (req, res) => {
  const s = one('SELECT * FROM salons WHERE id = ?', Number(req.params.id));
  if (!s) throw new HttpError(404, 'Salon introuvable.');
  const { plan, published, referral_credit_months: credit } = req.body || {};
  if (credit !== undefined) run('UPDATE salons SET referral_credit_months = ? WHERE id = ?', Math.max(0, Number.parseInt(credit, 10) || 0), s.id);
  if (plan !== undefined && !['trial', ...PLANS.map((p) => p.id)].includes(plan)) throw new HttpError(400, 'Formule inconnue.');
  run('UPDATE salons SET plan = ?, published = ? WHERE id = ?', plan ?? s.plan, published === undefined ? s.published : (published ? 1 : 0), s.id);
  res.json({ ok: true });
});

router.patch('/design-requests/:id', (req, res) => {
  const d = one('SELECT * FROM design_requests WHERE id = ?', Number(req.params.id));
  if (!d) throw new HttpError(404, 'Demande introuvable.');
  const status = req.body?.status ?? d.status;
  if (!['nouveau', 'en_cours', 'livre'].includes(status)) throw new HttpError(400, 'Statut invalide.');
  run('UPDATE design_requests SET status = ?, admin_note = ? WHERE id = ?', status, String(req.body?.admin_note ?? d.admin_note).slice(0, 2000), d.id);
  res.json({ ok: true });
});

module.exports = router;
