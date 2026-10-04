'use strict';
// Stripe integration (no SDK, plain HTTPS). Activated by STRIPE_SECRET_KEY; without it the platform
// runs in "simulated" mode (plans / templates switch instantly, deposits are recorded, nothing is charged).
//
// Money flows:
//  - Subscriptions (Essentiel / Premium) and template purchases/rentals are paid to YOU (platform account).
//  - Booking deposits are DIRECT CHARGES on the salon's own Stripe account (Stripe Connect Express):
//    the money goes straight to the salon, Lumea takes 0 % (no application fee); the salon pays only
//    Stripe's own processing fees. Cards, Apple Pay, Google Pay and TWINT are offered by Checkout.

const crypto = require('node:crypto');

const key = () => process.env.STRIPE_SECRET_KEY || '';
const enabled = () => !!key();
const webhookSecrets = () => [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);

/** Encodes nested objects the way Stripe expects (a[b][0][c]=…). */
function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const name = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') form(v, name, out);
    else out.append(name, String(v));
  }
  return out;
}

async function stripe(method, path, params, { account } = {}) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(account ? { 'Stripe-Account': account } : {}),
    },
    body: method === 'GET' ? undefined : form(params || {}).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `Stripe ${res.status}`);
    err.status = 502;
    throw err;
  }
  return data;
}

/** Verifies a Stripe-Signature header against the raw request body. */
function verifyWebhook(rawBody, header, toleranceSec = 300) {
  const items = String(header || '').split(',').map((p) => p.trim().split('='));
  const t = Number(items.find(([k]) => k === 't')?.[1]);
  const signatures = items.filter(([k]) => k === 'v1').map(([, v]) => v || '');
  if (!t || !signatures.length || Math.abs(Date.now() / 1000 - t) > toleranceSec) return false;
  return webhookSecrets().some((secret) => {
    const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
    return signatures.some((sig) => sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)));
  });
}

const money = (chf) => Math.round(chf * 100);
const currency = () => (process.env.CURRENCY || 'CHF').toLowerCase();

/** Checkout for a platform subscription (plan or monthly template) or a one-off template purchase. */
function platformCheckout({ salon, mode, name, amountChf, metadata, successUrl, cancelUrl }) {
  return stripe('POST', '/checkout/sessions', {
    mode,
    ...(salon.stripe_customer_id ? { customer: salon.stripe_customer_id } : { customer_email: salon.email || undefined }),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: currency(),
        unit_amount: money(amountChf),
        product_data: { name },
        ...(mode === 'subscription' ? { recurring: { interval: 'month' } } : {}),
      },
    }],
    metadata,
    ...(mode === 'subscription' ? { subscription_data: { metadata } } : {}),
    client_reference_id: String(salon.id),
    allow_promotion_codes: true,
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
}

/** Checkout for a booking deposit, charged directly on the salon's connected account (0 % platform fee). */
function depositCheckout({ salon, booking, serviceName, successUrl, cancelUrl, customerEmail }) {
  return stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: customerEmail && !customerEmail.endsWith('.invalid') ? customerEmail : undefined,
    line_items: [{
      quantity: 1,
      price_data: { currency: currency(), unit_amount: booking.deposit_cents, product_data: { name: `Acompte — ${serviceName} (${salon.name})` } },
    }],
    metadata: { kind: 'deposit', booking_id: String(booking.id), salon_id: String(salon.id) },
    payment_intent_data: { metadata: { kind: 'deposit', booking_id: String(booking.id) } },
    expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    success_url: successUrl,
    cancel_url: cancelUrl,
  }, { account: salon.stripe_account_id });
}

const retrieveSession = (id, account) => stripe('GET', `/checkout/sessions/${encodeURIComponent(id)}`, null, { account });
const refund = (paymentIntent, account) => stripe('POST', '/refunds', { payment_intent: paymentIntent }, { account });
const cancelSubscription = (id, { atPeriodEnd = true } = {}) => (atPeriodEnd
  ? stripe('POST', `/subscriptions/${encodeURIComponent(id)}`, { cancel_at_period_end: true })
  : stripe('DELETE', `/subscriptions/${encodeURIComponent(id)}`));

async function connectOnboarding(salon, { returnUrl, refreshUrl }) {
  let account = salon.stripe_account_id;
  if (!account) {
    const acct = await stripe('POST', '/accounts', {
      type: 'express', country: process.env.STRIPE_CONNECT_COUNTRY || 'CH', email: salon.email || undefined,
      business_profile: { name: salon.name, mcc: '7230', product_description: 'Prestations de beauté et bien-être' },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { salon_id: String(salon.id) },
    });
    account = acct.id;
  }
  const link = await stripe('POST', '/account_links', { account, type: 'account_onboarding', return_url: returnUrl, refresh_url: refreshUrl });
  return { account, url: link.url };
}

const retrieveAccount = (id) => stripe('GET', `/accounts/${encodeURIComponent(id)}`);

module.exports = {
  enabled, stripe, form, verifyWebhook, platformCheckout, depositCheckout, retrieveSession, refund,
  cancelSubscription, connectOnboarding, retrieveAccount,
};
