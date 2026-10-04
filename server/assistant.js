'use strict';
// AI assistant of a salon: answers the phone when nobody picks up, and the chat on the salon's website.
// It reads the real agenda through tools, books / moves / cancels appointments, or leaves a message
// for the team. Hard rules (minimum notice, opening hours, the salon's own cut-off) are enforced in code,
// never left to the model.
const { one, all, run } = require('./db');
const T = require('./time');
const ai = require('./ai');
const { getSlots } = require('./availability');
const { createBooking, cancelBooking, rescheduleBooking, HttpError } = require('./bookings');
const { CURRENCY } = require('./plans');

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MAX_ROUNDS = 6;

const digits = (p) => String(p || '').replace(/\D/g, '').slice(-9);
const money = (c) => `${(c / 100).toFixed(c % 100 ? 2 : 0)} ${CURRENCY}`;
const dayLabel = (date) => `${WEEKDAYS[T.weekday(date)]} ${Number(date.slice(8))}.${date.slice(5, 7)}`;

/** Stable per salon and channel, so the prompt cache is reused across calls. */
function systemPrompt(salon, channel) {
  const services = all('SELECT id, name, category, duration_min, price_cents FROM services WHERE salon_id = ? AND active = 1 ORDER BY position, id', salon.id);
  const staff = all('SELECT id, name, title FROM staff WHERE salon_id = ? AND active = 1 ORDER BY id', salon.id);
  const hours = all('SELECT weekday, open, close FROM opening_hours WHERE salon_id = ? ORDER BY weekday, open', salon.id);
  const hoursText = [1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const h = hours.filter((x) => x.weekday === wd);
    return `${WEEKDAYS[wd]} : ${h.length ? h.map((x) => `${x.open}-${x.close}`).join(', ') : 'fermé'}`;
  }).join('\n');
  const style = channel === 'phone'
    ? `Tu parles au téléphone : ta réponse est lue à voix haute.
- Une ou deux phrases courtes par réponse, ton chaleureux et naturel, vouvoiement.
- Jamais de listes, de puces, d'emojis ni de mise en forme. Dis les heures comme on les dit (« seize heures trente »), les dates avec le jour (« jeudi 7 »).
- Propose au plus trois créneaux à la fois.
- Quand l'échange est terminé (rendez-vous confirmé et rien d'autre à faire, ou la personne dit au revoir), dis au revoir et appelle end_call.`
    : `Tu réponds dans le chat du site du salon.
- Réponses courtes et claires, vouvoiement, pas de longs paragraphes.
- Tu peux présenter quelques créneaux sous forme de liste courte.`;

  return `Tu es l'assistant IA de « ${salon.name} » (${salon.category}, ${salon.address}, ${salon.zip} ${salon.city}). Tu aides les clients à la place de l'équipe quand elle est occupée.

${style}

Règles :
- Tu es une intelligence artificielle : si on te le demande, dis-le simplement.
- Pour connaître les disponibilités, utilise toujours check_availability : n'invente jamais un créneau.
- Un rendez-vous doit commencer au moins ${salon.ai_min_notice_min} minutes après maintenant. Jamais dans le passé.
- Avant de réserver, il te faut : la prestation, le jour, l'heure et le nom du client${channel === 'chat' ? ', ainsi qu\'un numéro de téléphone' : ''}. Récapitule et fais confirmer, puis appelle book_appointment.
- Pour déplacer ou annuler, retrouve d'abord le rendez-vous avec find_appointments (numéro de téléphone du client).
- Si le créneau demandé est pris, propose les plus proches (le même jour, puis les jours suivants).
- Pour une question que tu ne peux pas régler (prix spécial, réclamation, demande à parler à quelqu'un), propose de laisser un message avec leave_message : l'équipe rappellera.
- Ne donne jamais d'informations sur d'autres clients.
- Annulation gratuite jusqu'à ${salon.cancel_hours} h avant le rendez-vous.

Prestations (id · nom · durée · prix) :
${services.map((s) => `${s.id} · ${s.name} · ${s.duration_min} min · ${money(s.price_cents)}`).join('\n')}

Équipe (id · nom) :
${staff.map((s) => `${s.id} · ${s.name}${s.title ? ` (${s.title})` : ''}`).join('\n')}

Horaires d'ouverture :
${hoursText}

Téléphone du salon : ${salon.phone || 'non communiqué'}
${salon.ai_instructions ? `\nInformations ajoutées par le salon :\n${salon.ai_instructions}` : ''}`;
}

const nullable = (type) => ({ type: [type, 'null'] });
const TOOLS = [
  {
    name: 'check_availability',
    description: 'Créneaux libres pour une prestation un jour donné (déjà filtrés : délai minimum, horaires, agenda réel). Si le jour est complet, renvoie les prochaines disponibilités.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['service_id', 'date', 'staff_id'],
      properties: {
        service_id: { type: 'integer', description: 'id de la prestation' },
        date: { type: 'string', description: 'AAAA-MM-JJ' },
        staff_id: { ...nullable('integer'), description: 'id du collaborateur souhaité, ou null si indifférent' },
      },
    },
  },
  {
    name: 'book_appointment',
    description: 'Réserve un rendez-vous après confirmation explicite du client.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['service_id', 'date', 'time', 'staff_id', 'customer_name', 'customer_phone', 'notes'],
      properties: {
        service_id: { type: 'integer' },
        date: { type: 'string', description: 'AAAA-MM-JJ' },
        time: { type: 'string', description: 'HH:MM' },
        staff_id: nullable('integer'),
        customer_name: { type: 'string' },
        customer_phone: { ...nullable('string'), description: 'null au téléphone si le client appelle depuis son propre numéro' },
        notes: { ...nullable('string'), description: 'précisions du client (coupe souhaitée, allergie…)' },
      },
    },
  },
  {
    name: 'find_appointments',
    description: 'Rendez-vous à venir du client, retrouvés par son numéro de téléphone.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['customer_phone'],
      properties: { customer_phone: { ...nullable('string'), description: 'null pour utiliser le numéro de l’appelant' } },
    },
  },
  {
    name: 'reschedule_appointment',
    description: 'Déplace un rendez-vous existant (id obtenu par find_appointments) après confirmation du client.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['booking_id', 'date', 'time'],
      properties: { booking_id: { type: 'integer' }, date: { type: 'string' }, time: { type: 'string' } },
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Annule un rendez-vous existant (id obtenu par find_appointments) après confirmation du client.',
    input_schema: { type: 'object', additionalProperties: false, required: ['booking_id'], properties: { booking_id: { type: 'integer' } } },
  },
  {
    name: 'leave_message',
    description: 'Transmet un message à l’équipe, qui rappellera le client.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['message', 'urgent', 'callback_phone', 'customer_name'],
      properties: {
        message: { type: 'string' }, urgent: { type: 'boolean' },
        callback_phone: nullable('string'), customer_name: nullable('string'),
      },
    },
  },
  {
    name: 'end_call',
    description: 'Termine l’appel téléphonique, après avoir dit au revoir.',
    input_schema: { type: 'object', additionalProperties: false, required: [], properties: {} },
  },
].map((t) => ({ ...t, strict: true }));

/** Earliest bookable start for the assistant: now + the salon's minimum notice. */
const earliestIso = (salon) => T.addMinutes(T.now().iso, Math.max(15, salon.ai_min_notice_min));

function availableTimes(salon, serviceId, date, staffId) {
  const min = earliestIso(salon);
  const { slots, reason } = getSlots({ salonId: salon.id, serviceId, date, staffId });
  return { times: slots.filter((s) => `${date}T${s.time}` >= min).map((s) => s.time), reason };
}

function toolHandlers(conv, salon, ctx) {
  const ownBooking = (id) => {
    const phone = digits(conv.customer_phone || ctx.callerPhone);
    const b = one(
      `SELECT b.*, c.phone AS client_phone FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE b.id = ? AND b.salon_id = ?`, Number(id), salon.id,
    );
    if (!b || !phone || digits(b.client_phone) !== phone) throw new HttpError(404, 'Rendez-vous introuvable pour ce numéro.');
    return b;
  };
  const checkNotice = (date, time) => {
    if (!T.isDate(date) || !T.isTime(time)) throw new HttpError(400, 'Date ou heure invalide.');
    if (`${date}T${time}` < earliestIso(salon)) {
      throw new HttpError(400, `Trop proche : le rendez-vous doit commencer au moins ${salon.ai_min_notice_min} minutes après maintenant.`);
    }
  };
  return {
    check_availability({ service_id, date, staff_id }) {
      if (!T.isDate(date)) throw new HttpError(400, 'Date invalide (AAAA-MM-JJ).');
      if (date < T.now().date) throw new HttpError(400, 'Cette date est passée.');
      const service = one('SELECT name, duration_min FROM services WHERE id = ? AND salon_id = ? AND active = 1', service_id, salon.id);
      if (!service) throw new HttpError(404, 'Prestation inconnue.');
      const { times, reason } = availableTimes(salon, service_id, date, staff_id);
      const out = { date, day: dayLabel(date), service: service.name, duration_min: service.duration_min, available_times: times };
      if (!times.length) {
        out.reason = reason || 'Plus de créneau ce jour-là.';
        out.next_available = [];
        for (let i = 1; i <= 21 && out.next_available.length < 4; i++) {
          const d = T.addDays(date, i);
          const t = availableTimes(salon, service_id, d, staff_id).times;
          if (t.length) out.next_available.push({ date: d, day: dayLabel(d), first_times: t.slice(0, 3) });
        }
      }
      return out;
    },
    book_appointment({ service_id, date, time, staff_id, customer_name, customer_phone, notes }) {
      checkNotice(date, time);
      const phone = customer_phone || ctx.callerPhone || '';
      if (!digits(phone)) throw new HttpError(400, 'Il faut un numéro de téléphone pour confirmer le rendez-vous.');
      if (ctx.dryRun) {
        if (!availableTimes(salon, service_id, date, staff_id).times.includes(time)) throw new HttpError(409, 'Ce créneau n’est plus disponible.');
        conv.outcome = `Test : RDV simulé ${dayLabel(date)} ${time}`;
        return { ok: true, test_mode: true, message: 'Mode test : aucun rendez-vous réellement créé.' };
      }
      const booking = createBooking({
        salonId: salon.id, serviceId: service_id, staffId: staff_id || null, date, time,
        customer: { name: customer_name, phone, email: '', notes: notes || '' }, source: ctx.channel === 'phone' ? 'phone' : 'chat',
      });
      const svc = one('SELECT name FROM services WHERE id = ?', booking.service_id);
      const st = one('SELECT name FROM staff WHERE id = ?', booking.staff_id);
      conv.booking_id = booking.id;
      conv.customer_name ||= customer_name;
      conv.customer_phone ||= phone;
      conv.outcome = `RDV réservé : ${svc.name}, ${dayLabel(date)} à ${time} avec ${st.name}`;
      return { ok: true, booking_id: booking.id, service: svc.name, day: dayLabel(date), time, with: st.name, price: money(booking.price_cents), confirmation: 'SMS de confirmation envoyé au client.' };
    },
    find_appointments({ customer_phone }) {
      const phone = digits(customer_phone || ctx.callerPhone);
      if (!phone) throw new HttpError(400, 'Numéro de téléphone nécessaire.');
      if (customer_phone) conv.customer_phone ||= customer_phone;
      const rows = all(
        `SELECT b.id, b.start_at, sv.name AS service, st.name AS staff, c.phone FROM bookings b
         JOIN services sv ON sv.id = b.service_id JOIN staff st ON st.id = b.staff_id JOIN clients c ON c.id = b.client_id
         WHERE b.salon_id = ? AND b.status = 'confirmed' AND b.start_at >= ? ORDER BY b.start_at`, salon.id, T.now().iso,
      ).filter((r) => digits(r.phone) === phone);
      return { appointments: rows.map((r) => ({ booking_id: r.id, day: dayLabel(r.start_at.slice(0, 10)), date: r.start_at.slice(0, 10), time: r.start_at.slice(11), service: r.service, with: r.staff })) };
    },
    reschedule_appointment({ booking_id, date, time }) {
      checkNotice(date, time);
      const b = ownBooking(booking_id);
      if (ctx.dryRun) return { ok: true, test_mode: true };
      rescheduleBooking(b, { date, time, byClient: true });
      conv.booking_id = b.id;
      conv.outcome = `RDV déplacé au ${dayLabel(date)} à ${time}`;
      return { ok: true, day: dayLabel(date), time };
    },
    cancel_appointment({ booking_id }) {
      const b = ownBooking(booking_id);
      if (ctx.dryRun) return { ok: true, test_mode: true };
      cancelBooking(b, { byClient: true });
      conv.booking_id = b.id;
      conv.outcome = `RDV du ${dayLabel(b.start_at.slice(0, 10))} annulé`;
      return { ok: true };
    },
    leave_message({ message, urgent, callback_phone, customer_name }) {
      conv.status = 'to_handle';
      if (customer_name) conv.customer_name ||= customer_name;
      if (callback_phone) conv.customer_phone ||= callback_phone;
      conv.outcome = `${urgent ? 'URGENT — ' : ''}Message : ${String(message).slice(0, 500)}`;
      if (!ctx.dryRun && salon.email) {
        const { send } = require('./mailer');
        const body = `${conv.outcome}\nDe : ${conv.customer_name || 'client'} · ${conv.customer_phone || ctx.callerPhone || 'numéro inconnu'}\n(${ctx.channel === 'phone' ? 'appel' : 'chat'} traité par l'assistant IA)`;
        run("INSERT INTO notifications (salon_id, kind, channel, recipient, subject, body) VALUES (?, 'ai_message', 'email', ?, ?, ?)", salon.id, salon.email, 'Message laissé à l’assistant IA', body);
        send({ channel: 'email', to: salon.email, subject: `${urgent ? '[Urgent] ' : ''}Message laissé à l’assistant IA`, body, fromName: 'Lumea' });
      }
      return { ok: true, info: 'Message transmis, l’équipe rappellera.' };
    },
    end_call() {
      ctx.endCall = true;
      return { ok: true };
    },
  };
}

function loadConversation(salonId, channel, externalId, callerPhone) {
  run('INSERT OR IGNORE INTO ai_conversations (salon_id, channel, external_id, customer_phone) VALUES (?,?,?,?)', salonId, channel, externalId, callerPhone || '');
  const c = one('SELECT * FROM ai_conversations WHERE salon_id = ? AND channel = ? AND external_id = ?', salonId, channel, externalId);
  return { ...c, api: JSON.parse(c.api_messages), log: JSON.parse(c.transcript) };
}

function saveConversation(c) {
  run(
    `UPDATE ai_conversations SET api_messages = ?, transcript = ?, customer_phone = ?, customer_name = ?, outcome = ?, status = ?, booking_id = ?,
       unread = ?, updated_at = datetime('now') WHERE id = ?`,
    JSON.stringify(c.api), JSON.stringify(c.log), c.customer_phone || '', c.customer_name || '', c.outcome || '', c.status, c.booking_id || null,
    c.status === 'to_handle' || c.unread ? 1 : 0, c.id,
  );
}

const clean = (text, channel) => (channel === 'phone'
  ? String(text).replace(/[*_#`>]/g, '').replace(/^\s*[-•]\s*/gm, '').replace(/\s+/g, ' ').trim()
  : String(text).trim());

/**
 * Runs one user turn through the assistant.
 * @returns {{ reply: string, endCall: boolean, conversationId: number, outcome: string }}
 */
async function respond({ salon, channel, externalId, text, callerPhone = '', dryRun = false, humanOnly = false }) {
  const conv = loadConversation(salon.id, channel, externalId, callerPhone);
  const ctx = { channel: channel === 'test' ? 'chat' : channel, callerPhone, dryRun: dryRun || channel === 'test', endCall: false };
  const userText = String(text || '').trim().slice(0, 2000);
  conv.log.push({ from: 'client', text: userText, at: T.now().iso });

  // The team answers this chat itself (taken over, or AI chat switched off): just deliver the message.
  if (conv.human_mode || humanOnly) {
    // The model must still see these turns if the AI takes the conversation back later.
    conv.api.push({ role: 'user', content: userText });
    conv.unread = 1;
    if (!conv.outcome) conv.outcome = `Message : ${userText.slice(0, 200)}`;
    conv.status = 'to_handle';
    saveConversation(conv);
    return { reply: null, endCall: false, conversationId: conv.id, outcome: conv.outcome };
  }

  if (!ai.enabled()) {
    const reply = 'L’assistant n’est pas encore activé pour ce salon. Laissez votre nom et votre numéro, l’équipe vous rappellera.';
    conv.log.push({ from: 'assistant', text: reply, at: T.now().iso });
    conv.status = 'to_handle';
    conv.outcome = `Message : ${userText}`;
    saveConversation(conv);
    return { reply, endCall: false, conversationId: conv.id, outcome: conv.outcome };
  }

  // The current time changes on every call, so it goes in the message, not in the cached system prompt.
  const now = T.now();
  const stamp = `[${WEEKDAYS[T.weekday(now.date)]} ${now.date} ${now.time}${callerPhone && conv.api.length === 0 ? ` · numéro de l'appelant : ${callerPhone}` : ''}]`;
  conv.api.push({ role: 'user', content: `${stamp}\n${userText}` });

  const system = [{ type: 'text', text: systemPrompt(salon, ctx.channel), cache_control: { type: 'ephemeral' } }];
  const handlers = toolHandlers(conv, salon, ctx);
  let reply = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await ai.createMessage({ system, messages: conv.api, tools: TOOLS, effort: ctx.channel === 'phone' ? 'low' : 'medium' });
    conv.api.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'refusal') { reply = 'Je ne peux pas vous aider sur ce point. Souhaitez-vous laisser un message à l’équipe ?'; break; }
    const uses = res.content.filter((b) => b.type === 'tool_use');
    const said = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
    if (!uses.length || res.stop_reason === 'max_tokens') { reply = said; break; }
    const results = [];
    for (const u of uses) {
      try {
        if (!handlers[u.name]) throw new HttpError(400, 'Outil inconnu.');
        results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(handlers[u.name](u.input || {})) });
      } catch (err) {
        results.push({ type: 'tool_result', tool_use_id: u.id, is_error: true, content: err instanceof HttpError ? err.message : 'Erreur technique, réessayez.' });
        if (!(err instanceof HttpError)) console.error('[assistant]', err);
      }
    }
    conv.api.push({ role: 'user', content: results });
    if (ctx.endCall && said) { reply = said; break; }
  }
  reply = clean(reply || 'Pardon, pouvez-vous répéter ?', ctx.channel);
  conv.log.push({ from: 'assistant', text: reply, at: T.now().iso });
  if (conv.status === 'open' && ctx.endCall) conv.status = conv.outcome.startsWith('Message') ? 'to_handle' : 'done';
  saveConversation(conv);
  return { reply, endCall: ctx.endCall, conversationId: conv.id, outcome: conv.outcome };
}

/** A team member answers in the chat (the AI then stays silent in this conversation). */
function teamReply(conversationId, salonId, text, author) {
  const c = one('SELECT * FROM ai_conversations WHERE id = ? AND salon_id = ?', conversationId, salonId);
  if (!c) throw new HttpError(404, 'Conversation introuvable.');
  const msg = String(text || '').trim().slice(0, 2000);
  if (!msg) throw new HttpError(400, 'Message vide.');
  const conv = { ...c, api: JSON.parse(c.api_messages), log: JSON.parse(c.transcript) };
  conv.log.push({ from: 'team', text: msg, author: author || '', at: T.now().iso });
  // Keep the API history valid (alternating roles) in case the AI resumes the conversation.
  if (conv.api.length && conv.api.at(-1).role === 'user') conv.api.push({ role: 'assistant', content: `(réponse de l'équipe) ${msg}` });
  conv.status = 'done';
  conv.unread = 0;
  saveConversation(conv);
  run('UPDATE ai_conversations SET human_mode = 1 WHERE id = ?', c.id);
  return conv.log;
}

module.exports = { respond, teamReply, systemPrompt, TOOLS, earliestIso };
