'use strict';
// AI phone receptionist over Twilio Programmable Voice.
// Call flow: the salon's Twilio number rings the salon's real phone for `ai_ring_seconds`; if nobody answers,
// the assistant picks up, says it is an AI, listens (speech recognition), checks the agenda and books.
// Twilio expects TwiML within ~15 s, so each model turn runs as a background job: we answer with a short
// filler and a <Redirect>, then hand back the reply once the job is done.
const crypto = require('node:crypto');
const express = require('express');
const { one } = require('./db');
const assistant = require('./assistant');

const VOICE = process.env.TWILIO_VOICE || 'Polly.Lea-Neural';
const LANG = process.env.TWILIO_LANGUAGE || 'fr-FR';
const SPEECH_LANG = process.env.TWILIO_SPEECH_LANGUAGE || 'fr-CH';
const QUICK_WAIT_MS = 4000;   // answer directly if the assistant is that fast
const RESULT_WAIT_MS = 9000;  // each /result poll waits at most this long
const MAX_POLLS = 4;

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const twiml = (body) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
const say = (text) => `<Say voice="${VOICE}" language="${LANG}">${xml(text)}</Say>`;
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-9);

/** Listens for the caller's next sentence, then posts it to /turn. */
const gather = (prompt) => `<Gather input="speech" language="${SPEECH_LANG}" speechTimeout="auto" action="/api/voice/turn" method="POST">${say(prompt)}</Gather>`
  + `${say('Je ne vous entends plus. N’hésitez pas à rappeler ou à réserver en ligne. Au revoir.')}<Hangup/>`;

/** Twilio request signature: HMAC-SHA1 over the full URL followed by the sorted POST params. */
function validSignature(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return true; // not configured (development / tests)
  const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const params = req.body || {};
  const data = base + req.originalUrl + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', token).update(data).digest('base64');
  const got = String(req.get('x-twilio-signature') || '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

function salonForCall(body) {
  const to = digits(body.To || body.Called);
  if (!to) return null;
  return one("SELECT * FROM salons WHERE ai_twilio_number != '' AND substr(replace(replace(replace(ai_twilio_number, ' ', ''), '-', ''), '.', ''), -9) = ?", to);
}

function greeting(salon) {
  return `Bonjour, vous êtes bien chez ${salon.name}. L’équipe est occupée : je suis l’assistant virtuel du salon, une intelligence artificielle. `
    + 'Je peux prendre, déplacer ou annuler un rendez-vous. Que puis-je faire pour vous ?';
}

// In-flight assistant turns, keyed by CallSid.
const jobs = new Map();
const settle = (p, ms) => Promise.race([p.then((r) => ({ done: true, r })), new Promise((ok) => setTimeout(() => ok({ done: false }), ms).unref())]);

function replyTwiml(result) {
  if (result.endCall) return twiml(`${say(result.reply)}<Hangup/>`);
  return twiml(gather(result.reply));
}

function router() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: '64kb' }));
  r.use((req, res, next) => (validSignature(req) ? next() : res.status(403).send('Invalid signature')));
  r.use((_req, res, next) => { res.type('text/xml'); next(); });

  // 1. Incoming call: ring the salon first.
  r.post('/incoming', (req, res) => {
    const salon = salonForCall(req.body);
    if (!salon) return res.send(twiml(`${say('Ce numéro n’est pas attribué.')}<Hangup/>`));
    const forward = salon.ai_forward_phone.replace(/[^\d+]/g, '');
    if (forward) {
      const ring = Math.min(60, Math.max(5, salon.ai_ring_seconds || 15));
      return res.send(twiml(`<Dial timeout="${ring}" action="/api/voice/after-dial" method="POST" answerOnBridge="true"><Number>${xml(forward)}</Number></Dial>`));
    }
    if (!salon.ai_phone_enabled) return res.send(twiml(`${say(`Bonjour, vous êtes bien chez ${salon.name}. Nous ne pouvons pas répondre pour le moment. Vous pouvez réserver en ligne. Merci et à bientôt.`)}<Hangup/>`));
    res.send(twiml(gather(greeting(salon))));
  });

  // 2. Nobody picked up (or busy): the assistant takes the call.
  r.post('/after-dial', (req, res) => {
    const salon = salonForCall(req.body);
    if (!salon || req.body.DialCallStatus === 'completed') return res.send(twiml('<Hangup/>'));
    if (!salon.ai_phone_enabled) return res.send(twiml(`${say(`Vous êtes bien chez ${salon.name}. Nous sommes occupés, merci de rappeler plus tard ou de réserver en ligne.`)}<Hangup/>`));
    res.send(twiml(gather(greeting(salon))));
  });

  // 3. The caller said something: start the assistant turn.
  r.post('/turn', async (req, res) => {
    const salon = salonForCall(req.body);
    const sid = String(req.body.CallSid || '');
    const speech = String(req.body.SpeechResult || '').trim();
    if (!salon || !sid) return res.send(twiml('<Hangup/>'));
    if (!speech) return res.send(twiml(gather('Pardon, je n’ai pas bien entendu. Pouvez-vous répéter ?')));
    const job = assistant.respond({ salon, channel: 'phone', externalId: sid, text: speech, callerPhone: String(req.body.From || '') })
      .catch((err) => {
        console.error('[voice]', err);
        return { reply: 'Je rencontre un souci technique. Je transmets votre appel à l’équipe, qui vous rappellera rapidement. Au revoir.', endCall: true };
      });
    jobs.set(sid, { job, polls: 0 });
    const quick = await settle(job, QUICK_WAIT_MS);
    if (quick.done) { jobs.delete(sid); return res.send(replyTwiml(quick.r)); }
    res.send(twiml(`${say('Un instant, je regarde l’agenda.')}<Redirect method="POST">/api/voice/result</Redirect>`));
  });

  // 4. Hand back the reply once ready.
  r.post('/result', async (req, res) => {
    const sid = String(req.body.CallSid || '');
    const entry = jobs.get(sid);
    if (!entry) return res.send(twiml(gather('Pouvez-vous répéter, s’il vous plaît ?')));
    const out = await settle(entry.job, RESULT_WAIT_MS);
    if (out.done) { jobs.delete(sid); return res.send(replyTwiml(out.r)); }
    if (++entry.polls >= MAX_POLLS) {
      jobs.delete(sid);
      return res.send(twiml(`${say('Désolé, cela prend trop de temps. L’équipe vous rappellera. Au revoir.')}<Hangup/>`));
    }
    res.send(twiml(`${say('Encore un instant.')}<Redirect method="POST">/api/voice/result</Redirect>`));
  });

  // Call ended: forget any pending job.
  r.post('/status', (req, res) => {
    jobs.delete(String(req.body.CallSid || ''));
    res.send(twiml(''));
  });
  return r;
}

module.exports = { router, validSignature, salonForCall };
