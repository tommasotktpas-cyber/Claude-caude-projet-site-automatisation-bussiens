'use strict';
// Outbound e-mail & SMS delivery.
// - BREVO_API_KEY set  -> real e-mails (and SMS) through Brevo's transactional API (EU-hosted, CHF-friendly).
// - NOTIFY_WEBHOOK_URL -> every message is also POSTed as JSON (Make, Zapier, n8n, Twilio…).
// - neither            -> messages are only logged in the `notifications` table (development).

const BREVO_KEY = process.env.BREVO_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'no-reply@lumea.app';
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'Lumea';
const SMS_SENDER = (process.env.SMS_SENDER || 'Lumea').replace(/[^A-Za-z0-9]/g, '').slice(0, 11);
const WEBHOOK = process.env.NOTIFY_WEBHOOK_URL || '';
// Two-way SMS through Twilio (clients can answer 1 / 2 to a reminder) when a sending number is configured.
const twilioSms = () => !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_SMS_FROM);

async function twilio(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: `+${to}`, From: process.env.TWILIO_SMS_FROM, Body: body.slice(0, 640) }),
  });
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

/** "+41 79 123 45 67" / "079 123 45 67" -> "41791234567" (Brevo expects digits with country code). */
function normalizePhone(raw, defaultCountry = process.env.SMS_DEFAULT_COUNTRY || '41') {
  let p = String(raw || '').replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  else if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0')) p = defaultCountry + p.slice(1);
  return /^\d{8,15}$/.test(p) ? p : '';
}

const htmlBody = (text) => `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:15px;line-height:1.6;color:#18151f;max-width:560px">${
  String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#6d28d9">$1</a>')
    .replace(/\n/g, '<br>')}</div>`;

async function brevo(path, body) {
  const res = await fetch(`https://api.brevo.com/v3${path}`, {
    method: 'POST',
    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return true;
}

/**
 * Sends one message. Resolves true when at least one real channel accepted it.
 * @param {{channel:'email'|'sms', to:string, subject:string, body:string, fromName?:string, replyTo?:string}} msg
 */
async function send(msg) {
  let delivered = false;
  if (msg.channel === 'sms' && twilioSms()) {
    const recipient = normalizePhone(msg.to);
    try { if (recipient) delivered = await twilio(recipient, msg.body); } catch (err) { console.error('[mailer]', err.message); }
  } else if (BREVO_KEY) {
    try {
      if (msg.channel === 'email') {
        delivered = await brevo('/smtp/email', {
          sender: { name: msg.fromName || MAIL_FROM_NAME, email: MAIL_FROM },
          to: [{ email: msg.to }],
          ...(msg.replyTo ? { replyTo: { email: msg.replyTo } } : {}),
          subject: msg.subject,
          textContent: msg.body,
          htmlContent: htmlBody(msg.body),
        });
      } else if (msg.channel === 'sms') {
        const recipient = normalizePhone(msg.to);
        if (recipient) {
          delivered = await brevo('/transactionalSMS/sms', {
            sender: SMS_SENDER, recipient, content: msg.body.slice(0, 640), type: 'transactional',
          });
        }
      }
    } catch (err) {
      console.error('[mailer]', err.message);
    }
  }
  if (WEBHOOK) {
    try {
      const res = await fetch(WEBHOOK, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
      delivered = delivered || res.ok;
    } catch (err) {
      console.error('[mailer] webhook failed:', err.message);
    }
  }
  return delivered;
}

const configured = () => ({ brevo: !!BREVO_KEY, webhook: !!WEBHOOK, twoWaySms: twilioSms() });

module.exports = { send, normalizePhone, configured, twilioSms };
