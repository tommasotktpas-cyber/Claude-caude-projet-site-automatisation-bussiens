'use strict';
const express = require('express');
const { one, all, run } = require('../db');
const { requireRole } = require('../auth');
const { HttpError } = require('../bookings');
const { PLANS } = require('../plans');
const T = require('../time');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/overview', (_req, res) => {
  const salons = all(
    `SELECT s.id, s.name, s.slug, s.city, s.category, s.plan, s.trial_ends_at, s.published, s.created_at, u.email AS owner_email,
            (SELECT COUNT(*) FROM bookings b WHERE b.salon_id = s.id) AS bookings,
            (SELECT COUNT(*) FROM staff st WHERE st.salon_id = s.id AND st.active = 1) AS staff
     FROM salons s JOIN users u ON u.id = s.owner_id ORDER BY s.created_at DESC`,
  );
  const price = Object.fromEntries(PLANS.map((p) => [p.id, p.price_eur]));
  const paying = salons.filter((s) => price[s.plan]);
  res.json({
    salons,
    kpis: {
      salons: salons.length,
      paying: paying.length,
      trials: salons.filter((s) => s.plan === 'trial').length,
      mrr_eur: paying.reduce((sum, s) => sum + price[s.plan], 0),
      bookings_30d: one('SELECT COUNT(*) AS n FROM bookings WHERE created_at >= ?', `${T.addDays(T.now().date, -30)} 00:00:00`).n,
      users: one("SELECT COUNT(*) AS n FROM users WHERE role = 'client'").n,
    },
    plans: PLANS,
  });
});

router.patch('/salons/:id', (req, res) => {
  const s = one('SELECT * FROM salons WHERE id = ?', Number(req.params.id));
  if (!s) throw new HttpError(404, 'Salon introuvable.');
  const { plan, published } = req.body || {};
  if (plan !== undefined && !['trial', ...PLANS.map((p) => p.id)].includes(plan)) throw new HttpError(400, 'Formule inconnue.');
  run('UPDATE salons SET plan = ?, published = ? WHERE id = ?', plan ?? s.plan, published === undefined ? s.published : (published ? 1 : 0), s.id);
  res.json({ ok: true });
});

module.exports = router;
