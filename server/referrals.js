'use strict';
// Salon referral programme: a salon shares its link; the new salon gets 60 days of trial instead of 30,
// and when it starts paying, the referrer earns one free month (Stripe customer credit, or trial extension,
// or a credit recorded for the admin to apply).
const crypto = require('node:crypto');
const { one, all, run } = require('./db');
const T = require('./time');
const payments = require('./payments');
const { PLANS } = require('./plans');

const EXTRA_TRIAL_DAYS = 30;

function codeFor(salon) {
  if (salon.referral_code) return salon.referral_code;
  for (;;) {
    const code = `${salon.slug.replace(/[^a-z0-9]/g, '').slice(0, 6).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    if (!one('SELECT id FROM salons WHERE referral_code = ?', code)) {
      run('UPDATE salons SET referral_code = ? WHERE id = ?', code, salon.id);
      return code;
    }
  }
}

/** Called right after a new salon is created with ?ref=CODE. */
function attach(newSalonId, code) {
  const ref = code && one('SELECT id FROM salons WHERE referral_code = ?', String(code).toUpperCase().slice(0, 20));
  if (!ref || ref.id === newSalonId) return false;
  const s = one('SELECT trial_ends_at FROM salons WHERE id = ?', newSalonId);
  run('UPDATE salons SET referred_by = ?, trial_ends_at = ? WHERE id = ?', ref.id, T.addDays(s.trial_ends_at || T.now().date, EXTRA_TRIAL_DAYS), newSalonId);
  return true;
}

/** Called when a salon activates a paid plan: rewards its referrer once. */
async function rewardIfDue(salonId) {
  const s = one('SELECT * FROM salons WHERE id = ?', salonId);
  if (!s?.referred_by || s.referral_rewarded || s.plan === 'trial') return null;
  run('UPDATE salons SET referral_rewarded = 1 WHERE id = ?', s.id); // claim first: never twice
  const ref = one('SELECT * FROM salons WHERE id = ?', s.referred_by);
  if (!ref) return null;
  const price = (PLANS.find((p) => p.id === ref.plan) || PLANS[0]).price;
  if (ref.plan === 'trial') {
    run('UPDATE salons SET trial_ends_at = ? WHERE id = ?', T.addDays(ref.trial_ends_at > T.now().date ? ref.trial_ends_at : T.now().date, 30), ref.id);
    return 'trial_extended';
  }
  if (ref.stripe_customer_id && payments.enabled()) {
    try {
      // Negative balance = credit, used automatically on the next invoices.
      await payments.stripe('POST', `/customers/${ref.stripe_customer_id}/balance_transactions`, {
        amount: -Math.round(price * 100), currency: 'chf', description: `Parrainage : 1 mois offert (${s.name})`,
      });
      return 'stripe_credit';
    } catch (err) {
      console.error('[referral]', err.message);
    }
  }
  run('UPDATE salons SET referral_credit_months = referral_credit_months + 1 WHERE id = ?', ref.id);
  return 'credit_recorded';
}

function stats(salon) {
  const list = all('SELECT name, plan, referral_rewarded, created_at FROM salons WHERE referred_by = ? ORDER BY id DESC', salon.id);
  return { code: codeFor(salon), referred: list, rewarded: list.filter((x) => x.referral_rewarded).length, credit_months: salon.referral_credit_months };
}

module.exports = { codeFor, attach, rewardIfDue, stats, EXTRA_TRIAL_DAYS };
