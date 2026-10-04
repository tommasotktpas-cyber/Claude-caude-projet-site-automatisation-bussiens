'use strict';
// Account status and the effects of payments (shared by Stripe webhooks and simulated mode).
const { one, all, run, tx } = require('./db');
const T = require('./time');
const payments = require('./payments');
const { TEMPLATE_PRICING } = require('./plans');

/** A salon is active when it pays (Essentiel / Premium) or is inside its free trial. */
function salonActive(salon) {
  if (salon.plan === 'essentiel' || salon.plan === 'premium') return true;
  return !!salon.trial_ends_at && salon.trial_ends_at >= T.now().date;
}

/**
 * How a deposit is handled for this salon:
 *  - 'stripe'    : real payment on the salon's Stripe account (Stripe configured + salon onboarded)
 *  - 'simulated' : demo mode (no Stripe key) — recorded as paid, nothing charged
 *  - 'off'       : Stripe configured but salon not onboarded yet — no deposit is requested
 */
function depositMode(salon) {
  if (!payments.enabled()) return 'simulated';
  return salon.stripe_account_id && salon.stripe_charges_enabled ? 'stripe' : 'off';
}

function activatePlan(salonId, plan, { customerId, subscriptionId } = {}) {
  const salon = one('SELECT * FROM salons WHERE id = ?', salonId);
  if (!salon) return;
  const previous = salon.stripe_subscription_id;
  run('UPDATE salons SET plan = ?, stripe_customer_id = COALESCE(?, stripe_customer_id), stripe_subscription_id = COALESCE(?, stripe_subscription_id) WHERE id = ?',
    plan, customerId || null, subscriptionId || null, salonId);
  // Switching plan through a new Checkout: stop the old subscription so the salon is never billed twice.
  if (previous && subscriptionId && previous !== subscriptionId && payments.enabled()) {
    payments.cancelSubscription(previous, { atPeriodEnd: false }).catch((err) => console.error('[billing] cancel old plan:', err.message));
  }
}

function addLicense(salonId, template, billing, { subscriptionId } = {}) {
  if (one('SELECT id FROM template_licenses WHERE salon_id = ? AND template = ? AND active = 1', salonId, template)) return;
  run('INSERT INTO template_licenses (salon_id, template, billing, price_chf, stripe_subscription_id) VALUES (?,?,?,?,?)',
    salonId, template, billing, TEMPLATE_PRICING[billing], subscriptionId || null);
}

/** Subscription ended (cancelled or unpaid): plan → expired trial, or template rental → inactive. */
function subscriptionEnded(subscriptionId) {
  const salon = one('SELECT id FROM salons WHERE stripe_subscription_id = ?', subscriptionId);
  if (salon) {
    run("UPDATE salons SET plan = 'trial', trial_ends_at = ?, stripe_subscription_id = NULL WHERE id = ?", T.addDays(T.now().date, -1), salon.id);
  }
  run("UPDATE template_licenses SET active = 0, cancelled_at = COALESCE(cancelled_at, datetime('now')) WHERE stripe_subscription_id = ?", subscriptionId);
}

/** Deposit paid → booking confirmed for good; confirmation messages go out now. */
function markDepositPaid(bookingId, paymentIntent) {
  const { notify } = require('./notifications');
  const b = one('SELECT * FROM bookings WHERE id = ?', bookingId);
  if (!b || b.payment_status === 'paid') return false;
  if (b.status === 'cancelled') {
    // Paid after the hold expired: give the money back rather than keep it for a cancelled slot.
    if (paymentIntent) refundDeposit({ ...b, stripe_payment_intent: paymentIntent });
    return false;
  }
  run("UPDATE bookings SET payment_status = 'paid', paid_cents = deposit_cents, stripe_payment_intent = COALESCE(?, stripe_payment_intent) WHERE id = ?",
    paymentIntent || null, b.id);
  notify('confirmation', b.id);
  notify('new_booking_pro', b.id);
  return true;
}

function refundDeposit(booking) {
  if (!booking.stripe_payment_intent || !payments.enabled()) return;
  const salon = one('SELECT stripe_account_id FROM salons WHERE id = ?', booking.salon_id);
  payments.refund(booking.stripe_payment_intent, salon.stripe_account_id)
    .then(() => run("UPDATE bookings SET payment_status = 'refunded', paid_cents = 0 WHERE id = ?", booking.id))
    .catch((err) => console.error('[billing] refund failed:', err.message));
}

/** Releases slots held by deposits that were never paid (Checkout expires after 30 min). */
function releaseUnpaidHolds() {
  const { notifyWaitlist } = require('./notifications');
  const cutoff = new Date(Date.now() - 35 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  const stale = all("SELECT * FROM bookings WHERE payment_status = 'pending' AND status = 'confirmed' AND created_at < ?", cutoff);
  for (const b of stale) {
    tx(() => run("UPDATE bookings SET status = 'cancelled', payment_status = 'none' WHERE id = ?", b.id));
    notifyWaitlist(b.salon_id, b.service_id, b.start_at.slice(0, 10));
  }
  return stale.length;
}

/** Applies one verified Stripe event. Idempotent (events are recorded). */
async function handleStripeEvent(event) {
  if (one('SELECT id FROM stripe_events WHERE id = ?', event.id)) return 'duplicate';
  run('INSERT INTO stripe_events (id, type) VALUES (?,?)', event.id, event.type);
  const obj = event.data?.object || {};
  const meta = obj.metadata || {};
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      if (obj.payment_status !== 'paid' && obj.mode !== 'subscription') break;
      if (meta.kind === 'plan') activatePlan(Number(meta.salon_id), meta.plan, { customerId: obj.customer, subscriptionId: obj.subscription });
      else if (meta.kind === 'template') {
        addLicense(Number(meta.salon_id), meta.template, meta.billing, { subscriptionId: obj.subscription });
        if (obj.customer) run('UPDATE salons SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE id = ?', obj.customer, Number(meta.salon_id));
      } else if (meta.kind === 'deposit') markDepositPaid(Number(meta.booking_id), obj.payment_intent);
      break;
    case 'customer.subscription.deleted':
      subscriptionEnded(obj.id);
      break;
    case 'account.updated':
      run('UPDATE salons SET stripe_charges_enabled = ? WHERE stripe_account_id = ?', obj.charges_enabled ? 1 : 0, obj.id);
      break;
    default:
      break;
  }
  return 'ok';
}

module.exports = {
  salonActive, depositMode, activatePlan, addLicense, subscriptionEnded, markDepositPaid, refundDeposit,
  releaseUnpaidHolds, handleStripeEvent,
};
