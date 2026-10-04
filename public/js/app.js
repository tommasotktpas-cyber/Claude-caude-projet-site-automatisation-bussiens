/* Lumea Pro — back-office single-page app (hash routing, vanilla JS). */
'use strict';

const adminSalon = new URLSearchParams(location.search).get('salon');
/** Builds a pro API URL (admins can open any salon with ?salon=ID). */
const P = (path) => {
  const url = `/api/pro${path}`;
  return adminSalon ? `${url}${url.includes('?') ? '&' : '?'}salon=${encodeURIComponent(adminSalon)}` : url;
};

const ctx = { salon: null, staff: [], services: [], today: null };
const view = $('#view');

$$('[data-icon]').forEach((el) => { el.innerHTML = ICONS[el.dataset.icon]; });
$('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
$('#logout').onclick = async (e) => {
  e.preventDefault();
  await api('/api/auth/logout', { method: 'POST', body: {} });
  location.href = '/';
};

const STAFF_ROUTES = ['agenda', 'clients', 'caisse', 'gains', 'planning'];

async function refreshCtx() {
  const [s, staff, services] = await Promise.all([api(P('/salon')), api(P('/staff')), api(P('/services'))]);
  ctx.salon = s.salon;
  ctx.salonFull = s;
  ctx.staff = s.me ? staff.filter((m) => m.id === s.me.staff_id) : staff;
  ctx.services = services;
}

/** Plan change: redirects to Stripe Checkout when payments are live, otherwise switches instantly (demo). */
async function choosePlan(plan) {
  const r = await api(P('/plan'), { method: 'POST', body: { plan } });
  if (r.checkout_url) { location.href = r.checkout_url; return false; }
  return true;
}

const head = (title, actions = '') => `<div class="page-head"><h1>${esc(title)}</h1><div class="grow"></div>${actions}</div>`;
const staffById = (id) => ctx.staff.find((s) => s.id === id);

// =====================================================================
// Dashboard
// =====================================================================
async function renderDashboard() {
  const days = Number(sessionStorage.getItem('lumea_days') || 30);
  const [st, ag] = await Promise.all([api(P(`/stats?days=${days}`)), api(P('/agenda'))]);
  const max = Math.max(1, ...st.daily.map((d) => d.revenue_cents));
  const byDay = Object.fromEntries(st.daily.map((d) => [d.day, d]));
  const bars = Array.from({ length: st.days }, (_, i) => {
    const day = dateUtil.addDays(st.from, i);
    const d = byDay[day] || { revenue_cents: 0, n: 0 };
    return `<div class="bar" style="height:${(d.revenue_cents / max) * 100}%" data-tip="${fmt.date(day, { day: 'numeric', month: 'short' })} · ${fmt.eur(d.revenue_cents)} · ${d.n} RDV"></div>`;
  }).join('');
  const todays = ag.bookings.filter((b) => b.status !== 'cancelled');
  const maxStaff = Math.max(1, ...st.byStaff.map((s) => s.revenue_cents));
  const trialDays = ctx.salon.plan === 'trial' && ctx.salon.trial_ends_at
    ? Math.max(0, Math.round((new Date(ctx.salon.trial_ends_at) - new Date(ctx.today)) / 86400000)) : null;

  view.innerHTML = `
    ${head(`Bonjour ${esc(ctx.salon.name)}`, `
      <select id="period" style="width:auto">${[7, 30, 90, 365].map((d) => `<option value="${d}" ${d === days ? 'selected' : ''}>${d === 365 ? '12 mois' : `${d} derniers jours`}</option>`).join('')}</select>
      <button class="btn btn-brand" id="quick-book">+ Rendez-vous</button>`)}
    ${trialDays !== null && ctx.salon.trial_ends_at < ctx.today ? `<div class="card" style="margin-bottom:16px;background:var(--danger-soft);border-color:transparent"><div class="row between"><span><b>Votre essai est terminé.</b> La réservation en ligne et votre site sont en pause. Vos données sont conservées.</span><a class="btn btn-sm btn-danger" href="#billing">Réactiver mon compte</a></div></div>`
      : trialDays !== null ? `<div class="card" style="margin-bottom:16px;background:var(--brand-soft);border-color:transparent"><div class="row between"><span>Essai gratuit : <b>${trialDays} jour${trialDays > 1 ? 's' : ''} restant${trialDays > 1 ? 's' : ''}</b>. Aucune carte requise jusque-là.</span><a class="btn btn-sm btn-brand" href="#billing">Choisir une formule</a></div></div>` : ''}
    <div class="kpis">
      <div class="kpi"><div class="label">Chiffre d’affaires</div><div class="value">${fmt.eur(st.totals.revenue_cents)}</div><div class="sub">${st.totals.bookings} rendez-vous</div></div>
      <div class="kpi"><div class="label">Taux de remplissage</div><div class="value">${st.occupancy} %</div><div class="hbar"><span style="width:${Math.min(100, st.occupancy)}%"></span></div></div>
      <div class="kpi"><div class="label">Panier moyen</div><div class="value">${fmt.eur(st.totals.avg_ticket_cents)}</div><div class="sub">${st.newClients} nouveaux clients</div></div>
      <div class="kpi"><div class="label">Réservé en ligne</div><div class="value">${st.totals.bookings ? Math.round((st.totals.online / st.totals.bookings) * 100) : 0} %</div><div class="sub">appels évités : ${st.totals.online}</div></div>
      <div class="kpi"><div class="label">No-show</div><div class="value" style="color:${st.no_show_rate > 5 ? 'var(--danger)' : 'inherit'}">${String(st.no_show_rate).replace('.', ',')} %</div><div class="sub">${st.totals.no_shows} absence(s)</div></div>
      <div class="kpi"><div class="label">À venir</div><div class="value">${fmt.eur(st.upcoming.revenue_cents)}</div><div class="sub">${st.upcoming.n} rendez-vous confirmés</div></div>
    </div>
    <div class="two-col">
      <div class="card"><div class="row between"><h3 style="margin:0">Chiffre d’affaires par jour</h3><span class="small muted">${st.rating.avg ? `★ ${st.rating.avg} (${st.rating.n} avis)` : ''}</span></div><div class="bars">${bars}</div></div>
      <div class="card"><div class="row between"><h3 style="margin:0">Aujourd’hui</h3><a href="#agenda" class="small">Agenda →</a></div>
        ${todays.map((b) => `<div class="list-item" data-booking="${b.id}" style="cursor:pointer">
          <span class="avatar sm" style="--c:${esc(b.staff_color)}">${esc(fmt.initials(b.staff_name))}</span>
          <div class="grow"><b>${b.start_at.slice(11, 16)}</b> · ${esc(b.client_name)}<div class="small muted">${esc(b.service_name)}</div></div>
          <span class="badge ${STATUS[b.status].cls}">${STATUS[b.status].label}</span></div>`).join('') || '<div class="empty">Aucun rendez-vous aujourd’hui.</div>'}
      </div>
    </div>
    <div class="two-col" style="margin-top:18px">
      <div class="card"><h3>Prestations les plus rentables</h3>
        <table><thead><tr><th>Prestation</th><th>RDV</th><th style="text-align:right">CA</th></tr></thead><tbody>
        ${st.topServices.map((s) => `<tr><td>${esc(s.name)}</td><td>${s.n}</td><td style="text-align:right"><b>${fmt.eur(s.revenue_cents)}</b></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Pas encore de données.</td></tr>'}
        </tbody></table></div>
      <div class="card"><h3>Performance de l’équipe</h3>
        ${st.byStaff.map((s) => `<div style="margin-bottom:12px"><div class="row between small"><b>${esc(s.name)}</b><span>${fmt.eur(s.revenue_cents)} · ${s.n} RDV</span></div><div class="hbar"><span style="--c:${esc(s.color)};width:${(s.revenue_cents / maxStaff) * 100}%"></span></div></div>`).join('') || '<div class="empty">Pas encore de données.</div>'}
      </div>
    </div>`;
  $('#period').onchange = (e) => { sessionStorage.setItem('lumea_days', e.target.value); renderDashboard(); };
  $('#quick-book').onclick = () => bookingForm({ date: ctx.today });
  view.querySelectorAll('[data-booking]').forEach((el) => {
    el.onclick = () => bookingDetail(todays.find((b) => b.id === Number(el.dataset.booking)), renderDashboard);
  });
}

// =====================================================================
// Agenda
// =====================================================================
const agendaState = { date: null, mode: 'day', staff: '' };
const PX_PER_MIN = 1.6;

async function renderAgenda() {
  if (!agendaState.date) {
    // Open on the first working day (today, or the next open day if the salon is closed today).
    const open = new Set(ctx.salonFull.hours.map((h) => h.weekday));
    agendaState.date = ctx.today;
    for (let i = 0; i < 7 && open.size && !open.has(dateUtil.weekday(agendaState.date)); i++) agendaState.date = dateUtil.addDays(agendaState.date, 1);
  }
  const { date, mode } = agendaState;
  const from = mode === 'week' ? dateUtil.addDays(date, -((dateUtil.weekday(date) + 6) % 7)) : date;
  const to = mode === 'week' ? dateUtil.addDays(from, 6) : date;
  const data = await api(P(`/agenda?from=${from}&to=${to}`));
  const label = mode === 'week'
    ? `Semaine du ${fmt.date(from, { day: 'numeric', month: 'long' })}`
    : fmt.date(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  view.innerHTML = `
    ${head('Agenda', '<button class="btn btn-brand" id="new-booking">+ Rendez-vous</button>')}
    <div class="agenda-toolbar">
      <button class="btn btn-ghost btn-sm" data-nav="-1" aria-label="Précédent">‹</button>
      <button class="btn btn-ghost btn-sm" data-nav="0">Aujourd’hui</button>
      <button class="btn btn-ghost btn-sm" data-nav="1" aria-label="Suivant">›</button>
      <input type="date" id="agenda-date" value="${date}" style="width:auto;padding:6px 10px">
      <b>${label}</b>
      <div class="grow"></div>
      <select id="agenda-staff" style="width:auto;padding:6px 10px"><option value="">Toute l’équipe</option>${ctx.staff.filter((s) => s.active).map((s) => `<option value="${s.id}" ${String(s.id) === agendaState.staff ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <div class="row" style="gap:4px"><button class="chip ${mode === 'day' ? 'active' : ''}" data-mode="day">Jour</button><button class="chip ${mode === 'week' ? 'active' : ''}" data-mode="week">Semaine</button></div>
    </div>
    <div id="agenda-body"></div>`;

  const staff = ctx.staff.filter((s) => s.active && (!agendaState.staff || String(s.id) === agendaState.staff));
  const bookings = data.bookings.filter((b) => !agendaState.staff || String(b.staff_id) === agendaState.staff);
  if (mode === 'day') renderDayGrid(date, staff, bookings, data);
  else renderWeekList(from, bookings);

  view.querySelectorAll('[data-nav]').forEach((b) => {
    b.onclick = () => {
      const n = Number(b.dataset.nav);
      agendaState.date = n === 0 ? ctx.today : dateUtil.addDays(agendaState.date, n * (mode === 'week' ? 7 : 1));
      renderAgenda();
    };
  });
  view.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => { agendaState.mode = b.dataset.mode; renderAgenda(); }; });
  $('#agenda-date').onchange = (e) => { if (e.target.value) { agendaState.date = e.target.value; renderAgenda(); } };
  $('#agenda-staff').onchange = (e) => { agendaState.staff = e.target.value; renderAgenda(); };
  $('#new-booking').onclick = () => bookingForm({ date: agendaState.date });
}

function renderDayGrid(date, staff, bookings, data) {
  const wd = dateUtil.weekday(date);
  const open = data.hours.filter((h) => h.weekday === wd);
  const staffHours = staff.flatMap((s) => s.hours.filter((h) => h.weekday === wd));
  const starts = [...open.map((h) => h.open), ...staffHours.map((h) => h.start), ...bookings.map((b) => b.start_at.slice(11, 16))];
  const ends = [...open.map((h) => h.close), ...staffHours.map((h) => h.end), ...bookings.map((b) => b.end_at.slice(11, 16))];
  let startMin = starts.length ? Math.min(...starts.map(dateUtil.toMin)) : 9 * 60;
  let endMin = ends.length ? Math.max(...ends.map(dateUtil.toMin)) : 19 * 60;
  startMin = Math.floor(Math.min(startMin, 9 * 60) / 60) * 60;
  endMin = Math.ceil(Math.max(endMin, startMin + 8 * 60) / 60) * 60;
  const cells = (endMin - startMin) / 15;

  if (!staff.length) {
    $('#agenda-body').innerHTML = '<div class="card empty">Aucun collaborateur actif. <a href="#team">Ajouter un membre</a></div>';
    return;
  }

  const timesCol = Array.from({ length: (endMin - startMin) / 30 }, (_, i) => `<div class="agenda-time">${i === 0 ? '' : dateUtil.fromMin(startMin + i * 30)}</div>`).join('');
  const isWorking = (s, m) => s.hours.some((h) => h.weekday === wd && dateUtil.toMin(h.start) <= m && m < dateUtil.toMin(h.end));
  const cols = staff.map((s) => {
    const cellHtml = Array.from({ length: cells }, (_, i) => {
      const m = startMin + i * 15;
      return `<div class="cell ${isWorking(s, m) ? '' : 'off'}" data-staff="${s.id}" data-time="${dateUtil.fromMin(m)}"></div>`;
    }).join('');
    const appts = bookings.filter((b) => b.staff_id === s.id).map((b) => {
      const top = (dateUtil.toMin(b.start_at.slice(11, 16)) - startMin) * PX_PER_MIN;
      const height = Math.max(22, (dateUtil.toMin(b.end_at.slice(11, 16)) - dateUtil.toMin(b.start_at.slice(11, 16))) * PX_PER_MIN - 2);
      return `<div class="appt ${b.status}" style="--c:${esc(b.staff_color)};top:${top}px;height:${height}px" data-booking="${b.id}" title="${esc(b.client_name)} — ${esc(b.service_name)}">
        <b>${b.start_at.slice(11, 16)} · ${esc(b.client_name)}</b>${esc(b.service_name)}${b.source !== 'pro' ? ' <span title="Réservé en ligne">🌐</span>' : ''}${b.deposit_cents ? ' 💳' : ''}${b.has_style ? ' <span title="Fiche coupe 3D">✂️</span>' : ''}</div>`;
    }).join('');
    const offs = data.time_off.filter((t) => t.staff_id === s.id).map((t) => {
      const st = t.start_at.slice(0, 10) < date ? startMin : dateUtil.toMin(t.start_at.slice(11, 16));
      const en = t.end_at.slice(0, 10) > date ? endMin : dateUtil.toMin(t.end_at.slice(11, 16));
      return `<div class="appt timeoff" style="top:${(Math.max(st, startMin) - startMin) * PX_PER_MIN}px;height:${(Math.min(en, endMin) - Math.max(st, startMin)) * PX_PER_MIN}px"><b>Absent</b>${esc(t.reason)}</div>`;
    }).join('');
    return `<div><div class="agenda-col-head"><span class="avatar sm" style="--c:${esc(s.color)}">${esc(fmt.initials(s.name))}</span>${esc(s.name)}</div>
      <div class="agenda-col">${cellHtml}${offs}${appts}</div></div>`;
  }).join('');

  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const showNow = date === ctx.today && nowMin >= startMin && nowMin <= endMin;
  $('#agenda-body').innerHTML = `
    <div class="agenda"><div class="agenda-grid" style="grid-template-columns:56px repeat(${staff.length}, minmax(180px, 1fr))">
      <div class="agenda-times"><div class="agenda-col-head" style="min-width:0;padding:10px 0">&nbsp;</div>${timesCol}</div>
      ${cols}
    </div></div>
    <p class="small muted" style="margin-top:8px">Cliquez sur un créneau libre pour ajouter un rendez-vous. 🌐 réservé en ligne · 💳 acompte payé.</p>`;
  if (showNow) {
    const headH = $('.agenda-col-head').offsetHeight;
    $$('.agenda-col').forEach((col) => {
      const line = document.createElement('div');
      line.className = 'now-line';
      line.style.top = `${(nowMin - startMin) * PX_PER_MIN}px`;
      col.append(line);
    });
    $('.agenda').scrollTop = Math.max(0, (nowMin - startMin) * PX_PER_MIN - 120 + headH * 0);
  }

  $('#agenda-body').onclick = (e) => {
    const appt = e.target.closest('[data-booking]');
    if (appt) return bookingDetail(bookings.find((b) => b.id === Number(appt.dataset.booking)), renderAgenda);
    const cell = e.target.closest('.cell:not(.off)');
    if (cell) bookingForm({ date, time: cell.dataset.time, staff_id: Number(cell.dataset.staff) });
  };
}

function renderWeekList(from, bookings) {
  const days = Array.from({ length: 7 }, (_, i) => dateUtil.addDays(from, i));
  $('#agenda-body').innerHTML = `<div class="card week-list">${days.map((d) => {
    const list = bookings.filter((b) => b.start_at.startsWith(d));
    const ca = list.filter((b) => b.status !== 'cancelled').reduce((s, b) => s + b.price_cents, 0);
    return `<div class="day-block"><div class="row between"><h4>${fmt.date(d)}</h4><span class="small muted">${list.filter((b) => b.status !== 'cancelled').length} RDV · ${fmt.eur(ca)}</span></div>
      ${list.map((b) => `<div class="list-item" data-booking="${b.id}" style="cursor:pointer"><span class="avatar sm" style="--c:${esc(b.staff_color)}">${esc(fmt.initials(b.staff_name))}</span>
        <div class="grow"><b>${b.start_at.slice(11, 16)} – ${b.end_at.slice(11, 16)}</b> · ${esc(b.client_name)} <span class="muted small">· ${esc(b.service_name)}</span></div>
        <span class="badge ${STATUS[b.status].cls}">${STATUS[b.status].label}</span></div>`).join('') || '<p class="small muted">—</p>'}</div>`;
  }).join('')}</div>`;
  $('#agenda-body').onclick = (e) => {
    const el = e.target.closest('[data-booking]');
    if (el) bookingDetail(bookings.find((b) => b.id === Number(el.dataset.booking)), renderAgenda);
  };
}

/** Modal to create a booking from the back-office. */
function bookingForm({ date, time = '', staff_id = '' }) {
  const services = ctx.services.filter((s) => s.active);
  if (!services.length) return toast('Ajoutez d’abord une prestation.', 'error');
  const body = `
    <form id="bf">
      <div class="field"><label>Client</label><input name="name" list="client-list" placeholder="Nom du client" required autocomplete="off"><datalist id="client-list"></datalist></div>
      <div class="grid-2">
        <div class="field"><label>Téléphone</label><input name="phone" type="tel"></div>
        <div class="field"><label>E-mail <span class="muted">(pour confirmation)</span></label><input name="email" type="email"></div>
      </div>
      <div class="field"><label>Prestation</label><select name="service_id">${services.map((s) => `<option value="${s.id}">${esc(s.name)} · ${fmt.duration(s.duration_min)} · ${fmt.eur(s.price_cents)}</option>`).join('')}</select></div>
      <div class="grid-3">
        <div class="field"><label>Collaborateur</label><select name="staff_id"><option value="">Premier disponible</option>${ctx.staff.filter((s) => s.active).map((s) => `<option value="${s.id}" ${s.id === staff_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Date</label><input name="date" type="date" value="${date}" required></div>
        <div class="field"><label>Heure</label><select name="time" id="bf-time"></select></div>
      </div>
      <label class="check small"><input type="checkbox" name="force" id="bf-force"> Forcer un horaire libre (hors disponibilités)</label>
      <div class="field hidden" id="bf-free"><label>Heure libre</label><input name="free_time" type="time" step="300" value="${time}"></div>
      <div class="field"><label>Note interne</label><input name="notes" placeholder="Ex. : couleur 7.1, allergie…"></div>
    </form>`;
  modal({
    title: 'Nouveau rendez-vous',
    body,
    actions: [
      { id: 'close', label: 'Annuler', cls: 'btn-ghost' },
      {
        id: 'save', label: 'Enregistrer', cls: 'btn-brand',
        handler: async (d) => {
          const f = formData($('#bf', d));
          const force = !!f.force;
          if (force && !f.staff_id) throw new Error('Choisissez un collaborateur pour forcer un horaire.');
          const t = force ? f.free_time : f.time;
          if (!t) throw new Error('Choisissez une heure.');
          await api(P('/bookings'), {
            method: 'POST',
            body: { service_id: Number(f.service_id), staff_id: f.staff_id ? Number(f.staff_id) : null, date: f.date, time: t, force,
              customer: { name: f.name, phone: f.phone, email: f.email, notes: f.notes } },
          });
          toast('Rendez-vous enregistré.');
          route();
        },
      },
    ],
    onOpen: async (d) => {
      const form = $('#bf', d);
      const loadTimes = async () => {
        const f = formData(form);
        const sel = $('#bf-time', d);
        sel.innerHTML = '<option>…</option>';
        const { slots, reason } = await api(P(`/slots?service=${f.service_id}&date=${f.date}&staff=${f.staff_id}`));
        sel.innerHTML = slots.length ? slots.map((s) => `<option ${s === time ? 'selected' : ''}>${s}</option>`).join('') : `<option value="">${esc(reason || 'Complet')}</option>`;
      };
      form.addEventListener('change', (e) => {
        if (['service_id', 'staff_id', 'date'].includes(e.target.name)) loadTimes();
        if (e.target.name === 'force') $('#bf-free', d).classList.toggle('hidden', !e.target.checked);
      });
      let t;
      form.name.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = form.name.value.trim();
          if (q.length < 2) return;
          const list = await api(P(`/clients?q=${encodeURIComponent(q)}`));
          d._clients = list;
          $('#client-list', d).innerHTML = list.slice(0, 8).map((c) => `<option value="${esc(c.name)}">${esc(c.phone || c.email)}</option>`).join('');
          const exact = list.find((c) => c.name === q);
          if (exact) {
            if (!form.phone.value) form.phone.value = exact.phone;
            if (!form.email.value && !exact.email.endsWith('.invalid')) form.email.value = exact.email;
          }
        }, 250);
      });
      loadTimes();
    },
  });
}

/** Booking detail modal with status actions and rescheduling. */
function bookingDetail(b, after) {
  if (!b) return;
  const st = STATUS[b.status];
  const realEmail = b.client_email && !b.client_email.endsWith('.invalid');
  const actions = [{ id: 'close', label: 'Fermer', cls: 'btn-ghost' }];
  const patch = (body, msg) => async () => {
    await api(P(`/bookings/${b.id}`), { method: 'PATCH', body });
    toast(msg);
    after();
  };
  if (b.status === 'confirmed') {
    actions.push(
      { id: 'cancel', label: 'Annuler le RDV', cls: 'btn-ghost', handler: patch({ status: 'cancelled' }, 'Rendez-vous annulé, client prévenu.') },
      { id: 'noshow', label: 'Absent', cls: 'btn-danger', handler: patch({ status: 'no_show' }, 'Marqué absent.') },
      { id: 'move', label: 'Déplacer', cls: 'btn-ghost', handler: () => { setTimeout(() => moveBooking(b, after)); } },
      { id: 'done', label: 'Encaisser', cls: 'btn-ok', handler: () => { setTimeout(() => checkoutModal({ booking: b, after })); } },
    );
  } else if (b.status !== 'cancelled') {
    actions.push({ id: 'reopen', label: 'Repasser en confirmé', cls: 'btn-ghost', handler: patch({ status: 'confirmed' }, 'Statut mis à jour.') });
  }
  actions.push({ id: 'save', label: 'Enregistrer la note', cls: '', handler: async (d) => { await patch({ notes: $('#bd-notes', d).value }, 'Note enregistrée.')(); } });

  modal({
    title: `${b.client_name}`,
    body: `
      <div class="row" style="margin-bottom:12px"><span class="badge ${st.cls}">${st.label}</span><span class="badge">${{ online: 'Réservé en ligne', widget: 'Via widget site', pro: 'Saisi au salon' }[b.source]}</span>${b.deposit_cents ? `<span class="badge ${b.payment_status === 'pending' ? 'badge-warn' : b.payment_status === 'refunded' ? '' : 'badge-ok'}">Acompte ${fmt.eur(b.deposit_cents)} · ${{ pending: 'en attente de paiement', paid: 'payé', refunded: 'remboursé', none: 'enregistré' }[b.payment_status] || ''}</span>` : ''}</div>
      <div class="summary">
        <div><span class="muted">Prestation</span><b>${esc(b.service_name)}</b></div>
        <div><span class="muted">Quand</span><span>${fmt.dateTime(b.start_at)} – ${fmt.time(b.end_at)}</span></div>
        <div><span class="muted">Avec</span><span>${esc(b.staff_name)}</span></div>
        <div><span class="muted">Prix</span><b>${fmt.eur(b.price_cents)}</b></div>
        <div><span class="muted">Téléphone</span>${b.client_phone ? `<a href="tel:${esc(b.client_phone.replace(/\s/g, ''))}">${esc(b.client_phone)}</a>` : '—'}</div>
        <div><span class="muted">E-mail</span>${realEmail ? `<a href="mailto:${esc(b.client_email)}">${esc(b.client_email)}</a>` : '—'}</div>
      </div>
      <div class="field" style="margin-top:14px"><label for="bd-notes">Note</label><textarea id="bd-notes">${esc(b.notes)}</textarea></div>
      <div id="bd-style"></div>
      <button class="link small" id="bd-client">Voir la fiche client →</button>`,
    actions,
    onOpen: (d) => {
      $('#bd-client', d).onclick = () => { d.close(); d.remove(); clientDetail(b.client_id); };
      if (b.has_style) {
        api(P(`/bookings/${b.id}/style`)).then((st) => {
          if (!st.style) return;
          $('#bd-style', d).innerHTML = `<div class="style-sheet" style="margin:4px 0 12px">${st.image ? `<img src="${st.image}" alt="Coupe souhaitée en 3D">` : '<span></span>'}
            <div class="small"><b>Coupe souhaitée (studio 3D)</b><div style="margin-top:4px">${esc(st.summary)}</div>${st.style.note ? `<div class="muted" style="margin-top:6px">« ${esc(st.style.note)} »</div>` : ''}</div></div>`;
        }).catch(() => {});
      }
    },
  });
}

function moveBooking(b, after) {
  modal({
    title: 'Déplacer le rendez-vous',
    body: `<form id="mv"><div class="grid-2">
      <div class="field"><label>Date</label><input type="date" name="date" value="${b.start_at.slice(0, 10)}"></div>
      <div class="field"><label>Collaborateur</label><select name="staff_id"><option value="">Indifférent</option>${ctx.staff.filter((s) => s.active).map((s) => `<option value="${s.id}" ${s.id === b.staff_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Heure</label><select name="time" id="mv-time"></select></div>
      <p class="small muted">Le client reçoit automatiquement un e-mail avec le nouvel horaire.</p></form>`,
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'ok', label: 'Déplacer', cls: 'btn-brand',
      handler: async (d) => {
        const f = formData($('#mv', d));
        if (!f.time) throw new Error('Aucun créneau sélectionné.');
        await api(P(`/bookings/${b.id}`), { method: 'PATCH', body: { date: f.date, time: f.time, staff_id: f.staff_id ? Number(f.staff_id) : null } });
        toast('Rendez-vous déplacé, client prévenu.');
        after();
      },
    }],
    onOpen: (d) => {
      const form = $('#mv', d);
      const load = async () => {
        const f = formData(form);
        const { slots, reason } = await api(P(`/slots?service=${b.service_id}&date=${f.date}&staff=${f.staff_id}&exclude=${b.id}`));
        $('#mv-time', d).innerHTML = slots.length ? slots.map((s) => `<option>${s}</option>`).join('') : `<option value="">${esc(reason || 'Complet')}</option>`;
      };
      form.addEventListener('change', load);
      load();
    },
  });
}

// =====================================================================
// Clients
// =====================================================================
async function renderClients(q = '') {
  const list = await api(P(`/clients?q=${encodeURIComponent(q)}`));
  if (!$('#client-q')) {
    view.innerHTML = `${head('Clients', `<button class="btn btn-ghost" id="import-clients">Importer</button><a class="btn btn-ghost" href="${P('/export/clients.csv')}">Exporter CSV</a>`)}
      <div class="card" style="padding:14px;margin-bottom:14px"><input id="client-q" placeholder="Rechercher par nom, e-mail ou téléphone…" value="${esc(q)}"></div>
      <div class="table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Visites</th><th>Dépensé</th><th>Absences</th><th>Dernier RDV</th></tr></thead><tbody id="client-rows"></tbody></table></div>`;
    $('#import-clients').onclick = importClients;
    let t;
    $('#client-q').oninput = (e) => { clearTimeout(t); t = setTimeout(() => renderClients(e.target.value), 250); };
  }
  $('#client-rows').innerHTML = list.map((c) => `
    <tr data-client="${c.id}" style="cursor:pointer">
      <td><b>${esc(c.name)}</b>${c.notes ? ' <span title="Note">📝</span>' : ''}${c.marketing_opt_in ? ' <span class="badge" title="Accepte les offres">Opt-in</span>' : ''}</td>
      <td class="small">${esc(c.phone || '')}<div class="muted">${c.email.endsWith('.invalid') ? '' : esc(c.email)}</div></td>
      <td>${c.visits}</td><td><b>${fmt.eur(c.spent_cents)}</b></td>
      <td>${c.no_shows ? `<span class="badge badge-danger">${c.no_shows}</span>` : '0'}</td>
      <td class="small">${c.last_visit ? fmt.date(c.last_visit, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">Aucun client.</td></tr>';
  $('#client-rows').onclick = (e) => {
    const tr = e.target.closest('[data-client]');
    if (tr) clientDetail(Number(tr.dataset.client));
  };
}

function importClients() {
  modal({
    title: 'Importer vos clients',
    body: `<p class="small">Récupérez votre fichier clients depuis votre ancien logiciel (Salonkee, Planity, Excel, Google Contacts…) au format <b>CSV</b>. La première ligne doit contenir les titres des colonnes : <i>Nom</i> (ou <i>Prénom</i> + <i>Nom de famille</i>), <i>E-mail</i>, <i>Téléphone</i>, <i>Notes</i>.</p>
      <input type="file" id="csv-file" accept=".csv,text/csv,.txt">
      <div id="csv-preview" class="small muted" style="margin-top:12px"></div>
      <p class="small muted">Les clients déjà présents (même e-mail ou même téléphone) ne sont pas dupliqués. Depuis Excel : Fichier › Enregistrer sous › CSV UTF-8.</p>`,
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'go', label: 'Importer', cls: 'btn-brand',
      handler: async (d) => {
        const file = $('#csv-file', d).files[0];
        if (!file) throw new Error('Choisissez un fichier CSV.');
        const r = await api(P('/clients/import'), { method: 'POST', body: { csv: await file.text() } });
        toast(`${r.imported} client(s) importé(s), ${r.updated} mis à jour, ${r.skipped} ignoré(s).`);
        renderClients();
      },
    }],
    onOpen: (d) => {
      $('#csv-file', d).onchange = async (e) => {
        const text = await e.target.files[0].text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        $('#csv-preview', d).innerHTML = `<b>${lines.length - 1} ligne(s)</b> détectée(s). Aperçu :<pre style="white-space:pre-wrap;background:var(--surface-2);padding:10px;border-radius:10px;max-height:140px;overflow:auto">${esc(lines.slice(0, 4).join('\n'))}</pre>`;
      };
    },
  });
}

async function clientDetail(id) {
  const c = await api(P(`/clients/${id}`));
  const spent = c.history.filter((h) => h.status === 'completed').reduce((s, h) => s + h.price_cents, 0);
  modal({
    title: c.name,
    body: `
      <div class="kpis" style="grid-template-columns:repeat(3,1fr)">
        <div class="kpi"><div class="label">Visites</div><div class="value" style="font-size:1.4rem">${c.history.filter((h) => h.status === 'completed').length}</div></div>
        <div class="kpi"><div class="label">Dépensé</div><div class="value" style="font-size:1.4rem">${fmt.eur(spent)}</div></div>
        <div class="kpi"><div class="label">Absences</div><div class="value" style="font-size:1.4rem">${c.history.filter((h) => h.status === 'no_show').length}</div></div>
      </div>
      <p class="small">${c.phone ? `📞 <a href="tel:${esc(c.phone.replace(/\s/g, ''))}">${esc(c.phone)}</a>` : ''} ${c.email.endsWith('.invalid') ? '' : `· ✉️ <a href="mailto:${esc(c.email)}">${esc(c.email)}</a>`}</p>
      <div class="field"><label for="cd-bday">Anniversaire (JJ/MM)</label><input id="cd-bday" value="${c.birthday ? c.birthday.split('-').reverse().join('/') : ''}" placeholder="14/07" style="max-width:140px"></div>
      <div class="field"><label for="cd-notes">Fiche technique / notes privées</label><textarea id="cd-notes" placeholder="Couleur, préférences, allergies…">${esc(c.notes)}</textarea></div>
      <h4>Historique</h4>
      ${c.history.map((h) => `<div class="list-item small"><div class="grow"><b>${esc(h.service_name)}</b> · ${esc(h.staff_name)}<div class="muted">${fmt.dateTime(h.start_at)}</div></div><span>${fmt.eur(h.price_cents)}</span><span class="badge ${STATUS[h.status].cls}">${STATUS[h.status].label}</span></div>`).join('') || '<p class="muted">Aucun rendez-vous.</p>'}`,
    actions: [
      { id: 'close', label: 'Fermer', cls: 'btn-ghost' },
      {
        id: 'save', label: 'Enregistrer', cls: 'btn-brand',
        handler: async (d) => {
          const m = $('#cd-bday', d).value.trim().match(/^(\d{1,2})[/.-](\d{1,2})$/);
          const birthday = m ? `${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
          await api(P(`/clients/${id}`), { method: 'PUT', body: { notes: $('#cd-notes', d).value, birthday } });
          toast('Fiche mise à jour.');
        },
      },
    ],
  });
}

// =====================================================================
// Services
// =====================================================================
async function renderServices() {
  await refreshCtx();
  const groups = {};
  for (const s of ctx.services) (groups[s.category] ||= []).push(s);
  view.innerHTML = `${head('Prestations', '<button class="btn btn-brand" id="add-service">+ Prestation</button>')}
    ${Object.entries(groups).map(([cat, list]) => `
      <h3 class="small muted" style="text-transform:uppercase;letter-spacing:.1em;margin-top:22px">${esc(cat)}</h3>
      <div class="table-wrap"><table><tbody>${list.map((s) => `
        <tr style="${s.active ? '' : 'opacity:.5'}"><td><b>${esc(s.name)}</b>${s.active ? '' : ' <span class="badge">Masquée</span>'}<div class="small muted">${esc(s.description)}</div></td>
          <td>${fmt.duration(s.duration_min)}</td><td><b>${fmt.eur(s.price_cents)}</b></td>
          <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-edit="${s.id}">Modifier</button> <button class="btn btn-ghost btn-sm" data-del="${s.id}">Supprimer</button></td></tr>`).join('')}
      </tbody></table></div>`).join('') || '<div class="card empty">Aucune prestation. Ajoutez votre première prestation pour ouvrir la réservation en ligne.</div>'}`;
  $('#add-service').onclick = () => serviceForm();
  view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => serviceForm(ctx.services.find((s) => s.id === Number(b.dataset.edit))); });
  view.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const ok = await modal({ title: 'Supprimer cette prestation ?', body: '<p>Si elle a déjà été réservée, elle sera simplement masquée pour conserver l’historique.</p>', actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, { id: 'ok', label: 'Supprimer', cls: 'btn-danger' }] });
      if (!ok) return;
      const r = await api(P(`/services/${b.dataset.del}`), { method: 'DELETE' });
      toast(r.archived ? 'Prestation masquée (historique conservé).' : 'Prestation supprimée.');
      renderServices();
    };
  });
}

function serviceForm(s = null) {
  const cats = [...new Set(ctx.services.map((x) => x.category))];
  modal({
    title: s ? 'Modifier la prestation' : 'Nouvelle prestation',
    body: `<form id="sf">
      <div class="field"><label>Nom</label><input name="name" required value="${esc(s?.name || '')}" placeholder="Ex. : Coupe & brushing"></div>
      <div class="grid-3">
        <div class="field"><label>Durée (min)</label><input name="duration_min" type="number" min="5" step="5" value="${s?.duration_min || 30}"></div>
        <div class="field"><label>Prix (${CURRENCY})</label><input name="price" type="number" min="0" step="0.5" value="${s ? s.price_cents / 100 : ''}"></div>
        <div class="field"><label>Catégorie</label><input name="category" list="cats" value="${esc(s?.category || 'Prestations')}"><datalist id="cats">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</datalist></div>
      </div>
      <div class="field"><label>Description <span class="muted">(facultatif)</span></label><input name="description" value="${esc(s?.description || '')}"></div>
      <label class="check"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Réservable en ligne</label>
      <label class="check"><input type="checkbox" name="studio" ${s?.studio ? 'checked' : ''}> Proposer le Studio coupe 3D au client lors de la réservation</label>
      <div class="field" style="margin-top:10px"><label>Rappel « c’est l’heure de revenir » après (semaines)</label><input name="rebook_weeks" type="number" min="0" max="52" value="${s?.rebook_weeks ?? 0}" style="max-width:120px"><div class="hint">0 = pas de rappel. Envoyé seulement si le client n’a rien réservé depuis.</div></div></form>`,
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'save', label: 'Enregistrer', cls: 'btn-brand',
      handler: async (d) => {
        const f = formData($('#sf', d));
        const body = { ...f, active: !!f.active, studio: !!f.studio };
        await api(P(s ? `/services/${s.id}` : '/services'), { method: s ? 'PUT' : 'POST', body });
        toast('Prestation enregistrée.');
        renderServices();
      },
    }],
  });
}

// =====================================================================
// Team
// =====================================================================
function hoursEditor(hours, keyStart = 'start', keyEnd = 'end') {
  return `<div class="hours-editor">${[1, 2, 3, 4, 5, 6, 0].map((wd) => {
    const h = hours.filter((x) => x.weekday === wd);
    const on = h.length > 0;
    return `<div class="hrow" data-wd="${wd}"><b>${WEEKDAYS[wd]}</b>
      <label class="check small" style="margin:0"><input type="checkbox" class="h-on" ${on ? 'checked' : ''}> Ouvert</label>
      <input type="time" class="h-start" value="${on ? h[0][keyStart] : '09:00'}" step="900">
      <input type="time" class="h-end" value="${on ? h[h.length - 1][keyEnd] : '18:00'}" step="900"></div>`;
  }).join('')}</div>`;
}
const readHours = (root) => $$('.hrow', root).filter((r) => $('.h-on', r).checked)
  .map((r) => ({ weekday: Number(r.dataset.wd), start: $('.h-start', r).value, end: $('.h-end', r).value }));

async function renderTeam() {
  await refreshCtx();
  view.innerHTML = `${head('Équipe', '<button class="btn btn-brand" id="add-staff">+ Collaborateur</button>')}
    <div class="features">${ctx.staff.map((s) => `
      <div class="card" style="${s.active ? '' : 'opacity:.6'}">
        <div class="row"><span class="avatar" style="--c:${esc(s.color)}">${esc(fmt.initials(s.name))}</span><div class="grow"><b>${esc(s.name)}</b><div class="small muted">${esc(s.title)}</div></div>${s.active ? '' : '<span class="badge">Inactif</span>'}</div>
        <div class="row" style="gap:6px;margin-top:10px"><span class="badge ${s.employment === 'independant' ? 'badge-brand' : ''}">${s.employment === 'independant' ? 'Indépendant·e' : 'Salarié·e'}</span>
          <span class="badge">${s.pay_model === 'loyer' ? `Fauteuil ${fmt.eur(s.chair_rent_cents)}/mois` : s.pay_model === 'commission' ? `${s.rate_percent} % des prestations` : `Fixe${s.rate_percent ? ` + ${s.rate_percent} % produits` : ''}`}</span></div>
        <div class="small muted" style="margin-top:12px">${[1, 2, 3, 4, 5, 6, 0].map((wd) => { const h = s.hours.filter((x) => x.weekday === wd); return h.length ? `${WEEKDAYS[wd].slice(0, 3)}. ${h[0].start}–${h[h.length - 1].end}` : ''; }).filter(Boolean).join(' · ') || 'Aucun horaire'}</div>
        <div class="small" style="margin-top:8px">${s.service_ids.length} prestation(s) · ${s.time_off.length} absence(s) prévue(s)</div>
        <div class="row" style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-edit="${s.id}">Modifier</button><button class="btn btn-ghost btn-sm" data-off="${s.id}">Absences</button><button class="btn btn-ghost btn-sm" data-access="${s.id}">${s.access ? 'Accès ✓' : 'Donner un accès'}</button></div>
        ${s.access ? `<div class="small muted" style="margin-top:8px">Connexion : ${esc(s.access)}</div>` : ''}
      </div>`).join('')}</div>`;
  $('#add-staff').onclick = () => staffForm();
  view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => staffForm(staffById(Number(b.dataset.edit))); });
  view.querySelectorAll('[data-off]').forEach((b) => { b.onclick = () => timeOffForm(staffById(Number(b.dataset.off))); });
  view.querySelectorAll('[data-access]').forEach((b) => { b.onclick = () => staffAccess(staffById(Number(b.dataset.access))); });
}

function staffForm(s = null) {
  const hours = s ? s.hours : ctx.salonFull.hours.map((h) => ({ weekday: h.weekday, start: h.open, end: h.close }));
  modal({
    title: s ? `Modifier ${s.name}` : 'Nouveau collaborateur',
    body: `<form id="stf">
      <div class="grid-3">
        <div class="field"><label>Nom</label><input name="name" required value="${esc(s?.name || '')}"></div>
        <div class="field"><label>Poste</label><input name="title" value="${esc(s?.title || '')}" placeholder="Coiffeur·se"></div>
        <div class="field"><label>Couleur agenda</label><input name="color" type="color" value="${esc(s?.color || '#0ea5e9')}"></div>
      </div>
      <h4>Statut & rémunération</h4>
      <div class="grid-2">
        <div class="field"><label>Statut</label><select name="employment"><option value="salarie" ${s?.employment !== 'independant' ? 'selected' : ''}>Salarié·e</option><option value="independant" ${s?.employment === 'independant' ? 'selected' : ''}>Indépendant·e</option></select><div class="hint">Un·e indépendant·e gère ses propres horaires et absences depuis son accès.</div></div>
        <div class="field"><label>Modèle</label><select name="pay_model">
          <option value="fixe" ${!s || s.pay_model === 'fixe' ? 'selected' : ''}>Salaire fixe (+ % sur les produits)</option>
          <option value="commission" ${s?.pay_model === 'commission' ? 'selected' : ''}>Pourcentage des prestations</option>
          <option value="loyer" ${s?.pay_model === 'loyer' ? 'selected' : ''}>Location de fauteuil (indépendant)</option></select></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Pourcentage pour le collaborateur (%)</label><input name="rate_percent" type="number" min="0" max="100" value="${s?.rate_percent ?? 0}"></div>
        <div class="field"><label>Loyer de fauteuil (${CURRENCY} / mois)</label><input name="chair_rent" type="number" min="0" step="10" value="${s ? s.chair_rent_cents / 100 : 0}"></div>
      </div>
      <h4>Horaires de travail</h4>${hoursEditor(hours)}
      <h4 style="margin-top:16px">Prestations réalisées</h4>
      <div class="grid-2">${ctx.services.map((sv) => `<label class="check small"><input type="checkbox" name="svc" value="${sv.id}" ${!s || s.service_ids.includes(sv.id) ? 'checked' : ''}> ${esc(sv.name)}</label>`).join('')}</div>
      ${s ? `<label class="check" style="margin-top:12px"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Actif (visible à la réservation)</label>` : ''}
    </form>`,
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'save', label: 'Enregistrer', cls: 'btn-brand',
      handler: async (d) => {
        const form = $('#stf', d);
        const body = {
          name: form.name.value, title: form.title.value, color: form.color.value, hours: readHours(form),
          service_ids: $$('[name="svc"]:checked', form).map((c) => Number(c.value)),
          employment: form.employment.value, pay_model: form.pay_model.value, rate_percent: Number(form.rate_percent.value), chair_rent: Number(form.chair_rent.value),
        };
        if (s) body.active = form.active.checked;
        await api(P(s ? `/staff/${s.id}` : '/staff'), { method: s ? 'PUT' : 'POST', body });
        toast('Équipe mise à jour.');
        renderTeam();
      },
    }],
  });
}

function staffAccess(s) {
  modal({
    title: `Accès employé — ${s.name}`,
    body: `<p class="small">${esc(s.name)} pourra se connecter pour voir <b>son propre agenda</b>, ajouter ou déplacer ses rendez-vous et consulter les fiches clients. Pas d’accès au chiffre d’affaires, aux réglages ni à l’abonnement.</p>
      <div class="field"><label>E-mail de ${esc(s.name.split(' ')[0])}</label><input id="acc-email" type="email" value="${esc(s.access || '')}" placeholder="prenom@exemple.ch"></div>
      <div id="acc-result"></div>`,
    actions: [
      { id: 'close', label: 'Fermer', cls: 'btn-ghost' },
      ...(s.access ? [{ id: 'revoke', label: 'Retirer l’accès', cls: 'btn-danger', handler: async () => { await api(P(`/staff/${s.id}/access`), { method: 'DELETE' }); toast('Accès retiré.'); renderTeam(); } }] : []),
      {
        id: 'invite', label: s.access ? 'Renvoyer l’invitation' : 'Envoyer l’invitation', cls: 'btn-brand',
        handler: async (d) => {
          const r = await api(P(`/staff/${s.id}/access`), { method: 'POST', body: { email: $('#acc-email', d).value } });
          $('#acc-result', d).innerHTML = `<p class="small badge-ok" style="padding:10px;border-radius:10px">Invitation envoyée par e-mail. Vous pouvez aussi transmettre ce lien (valable 7 jours) :</p><input readonly value="${esc(r.invite_url)}" onclick="this.select()">`;
          renderTeam();
          return false;
        },
      },
    ],
  });
}

function timeOffForm(s) {
  modal({
    title: `Absences — ${s.name}`,
    body: `
      ${s.time_off.map((t) => `<div class="list-item small"><div class="grow"><b>${fmt.date(t.start_at, { day: 'numeric', month: 'short' })} ${t.start_at.slice(11)}</b> → <b>${fmt.date(t.end_at, { day: 'numeric', month: 'short' })} ${t.end_at.slice(11)}</b> <span class="muted">${esc(t.reason)}</span></div><button class="btn btn-ghost btn-sm" data-del-off="${t.id}">Supprimer</button></div>`).join('') || '<p class="muted">Aucune absence prévue.</p>'}
      <hr class="divider"><form id="tof"><div class="grid-2">
        <div class="field"><label>Début</label><input type="datetime-local" name="start_at" value="${ctx.today}T09:00" required></div>
        <div class="field"><label>Fin</label><input type="datetime-local" name="end_at" value="${ctx.today}T19:00" required></div></div>
        <div class="field"><label>Motif</label><input name="reason" placeholder="Congés, formation…"></div></form>`,
    actions: [{ id: 'close', label: 'Fermer', cls: 'btn-ghost' }, {
      id: 'add', label: 'Ajouter l’absence', cls: 'btn-brand',
      handler: async (d) => {
        await api(P(`/staff/${s.id}/time-off`), { method: 'POST', body: formData($('#tof', d)) });
        toast('Absence ajoutée — les créneaux sont bloqués.');
        renderTeam();
      },
    }],
    onOpen: (d) => d.querySelectorAll('[data-del-off]').forEach((b) => {
      b.onclick = async () => { await api(P(`/time-off/${b.dataset.delOff}`), { method: 'DELETE' }); b.closest('.list-item').remove(); toast('Absence supprimée.'); renderTeam(); };
    }),
  });
}

// =====================================================================
// Reviews
// =====================================================================
async function renderReviews() {
  const list = await api(P('/reviews'));
  const avg = list.length ? (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(1) : '—';
  const dist = [5, 4, 3, 2, 1].map((n) => ({ n, c: list.filter((r) => r.rating === n).length }));
  view.innerHTML = `${head('Avis clients')}
    <div class="two-col">
      <div class="card">${list.map((r) => `
        <div class="review"><div class="row between"><b>${esc(r.author_name)}</b><span class="small muted">${esc(r.service_name)} · ${fmt.date(r.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
          <div class="stars">${fmt.stars(r.rating)}</div>${r.comment ? `<p style="margin:6px 0">${esc(r.comment)}</p>` : ''}
          ${r.reply ? `<div class="reply"><b>Votre réponse :</b> ${esc(r.reply)}</div>` : `<button class="link small" data-reply="${r.id}">Répondre publiquement</button>`}</div>`).join('') || '<div class="empty">Pas encore d’avis. Les demandes d’avis partent automatiquement 2 h après chaque rendez-vous.</div>'}</div>
      <div class="card"><div class="center"><div class="display" style="font-size:3.4rem">${avg}</div><div class="stars">${fmt.stars(Number(avg) || 0)}</div><p class="muted">${list.length} avis vérifiés</p></div>
        ${dist.map((d) => `<div class="row small" style="gap:8px"><span style="width:24px">${d.n}★</span><div class="hbar grow" style="margin:0"><span style="--c:#f5a623;width:${list.length ? (d.c / list.length) * 100 : 0}%"></span></div><span style="width:28px;text-align:right">${d.c}</span></div>`).join('')}</div>
    </div>`;
  view.querySelectorAll('[data-reply]').forEach((b) => {
    b.onclick = () => modal({
      title: 'Répondre à l’avis',
      body: '<textarea id="reply-text" placeholder="Merci pour votre visite…"></textarea>',
      actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, { id: 'ok', label: 'Publier', cls: 'btn-brand', handler: async (d) => { await api(P(`/reviews/${b.dataset.reply}/reply`), { method: 'PUT', body: { reply: $('#reply-text', d).value } }); toast('Réponse publiée.'); renderReviews(); } }],
    });
  });
}

// =====================================================================
// Automations
// =====================================================================
async function renderAutomations() {
  const [notifs, waitlist] = await Promise.all([api(P('/notifications')), api(P('/waitlist'))]);
  const KIND = { rebook: 'Rappel retour', birthday: 'Anniversaire', gift_card: 'Carte cadeau', staff_invite: 'Invitation employé', confirmation: 'Confirmation', reminder: 'Rappel J-1', rescheduled: 'Déplacement', cancelled: 'Annulation', review: 'Demande d’avis', new_booking_pro: 'Alerte salon', waitlist: 'Liste d’attente' };
  const flows = [
    ['Confirmation instantanée', 'E-mail (+ SMS) au client dès la réservation, avec lien pour gérer et fichier agenda.'],
    ['Rappel 24 h avant', 'Réduit les absences de 60 à 80 %. Lien de déplacement en 1 clic inclus.'],
    ['Demande d’avis', 'Envoyée 2 h après le rendez-vous. Seuls les clients venus peuvent noter.'],
    ['Liste d’attente', 'Dès qu’un créneau se libère, les clients inscrits pour ce jour sont prévenus.'],
    ['Alerte nouvelle réservation', 'Vous êtes notifié à chaque réservation en ligne.'],
    ['C’est l’heure de revenir', 'Après une coupe, une couleur ou des ongles, le client reçoit un rappel au bon moment (réglable par prestation) s’il n’a rien réservé.'],
    ['Anniversaire', `Message avec votre cadeau le jour J${ctx.salon.birthday_offer ? ` : « ${esc(ctx.salon.birthday_offer)} »` : ' (désactivé dans Paramètres)'}.`],
    ['Dernière minute', ctx.salon.lastminute_percent ? `−${ctx.salon.lastminute_percent} % automatique sur les créneaux libres dans les ${ctx.salon.lastminute_hours} h.` : 'Désactivé : réglez un pourcentage dans Paramètres pour remplir les trous de l’agenda.'],
    ['Fidélité', `1 point par franc crédité au client à l’encaissement${ctx.salon.loyalty_enabled ? '' : ' (désactivé dans Paramètres)'}.`],
  ];
  view.innerHTML = `${head('Automatisations', '<button class="btn btn-ghost" id="run-now">Exécuter maintenant</button>')}
    <div class="features">${flows.map(([t, d]) => `<div class="card"><div class="row between"><h3 style="margin:0">${t}</h3><span class="badge badge-ok"><span class="dot"></span>Actif</span></div><p class="small muted" style="margin:8px 0 0">${d}</p></div>`).join('')}</div>
    <div class="card" style="margin-top:18px"><h3>Connecter vos outils (SMS, e-mail, CRM)</h3>
      <p class="small muted">Chaque notification est envoyée en JSON au webhook défini par la variable <code>NOTIFY_WEBHOOK_URL</code>. Branchez-le sur Make, Zapier, n8n, Twilio ou Brevo pour envoyer les SMS et e-mails avec votre propre expéditeur.</p>
      <code class="block">{ "kind": "reminder", "channel": "sms", "to": "+352 691 000 000", "subject": "…", "body": "…", "booking_id": 42, "salon_id": 1 }</code></div>
    <div class="two-col" style="margin-top:18px">
      <div class="card"><h3>Journal des envois</h3>
        <div class="table-wrap" style="border:0"><table><thead><tr><th>Type</th><th>Canal</th><th>Destinataire</th><th>Date</th></tr></thead><tbody>
        ${notifs.map((n) => `<tr title="${esc(n.body)}"><td>${esc(KIND[n.kind] || n.kind)}</td><td><span class="badge">${n.channel.toUpperCase()}</span></td><td class="small">${esc(n.recipient)}</td><td class="small muted">${esc(n.created_at.slice(0, 16))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Aucun envoi pour le moment.</td></tr>'}
        </tbody></table></div></div>
      <div class="card"><h3>Liste d’attente</h3>
        ${waitlist.map((w) => `<div class="list-item small"><div class="grow"><b>${esc(w.name)}</b> · ${esc(w.service_name)}<div class="muted">${fmt.date(w.date)} · ${esc(w.email)}</div></div>${w.notified ? '<span class="badge badge-ok">Prévenu</span>' : '<span class="badge">En attente</span>'}</div>`).join('') || '<div class="empty">Personne en liste d’attente.</div>'}</div>
    </div>`;
  $('#run-now').onclick = async () => {
    const r = await api(P('/automations/run'), { method: 'POST', body: {} });
    toast(`${r.reminders} rappel(s) et ${r.reviews} demande(s) d’avis envoyés.`);
    renderAutomations();
  };
}

// =====================================================================
// Settings
// =====================================================================
async function renderSettings() {
  await refreshCtx();
  const s = ctx.salon;
  const { links, categories } = ctx.salonFull;
  view.innerHTML = `${head('Paramètres')}
    <div class="two-col">
      <form class="card" id="salon-form">
        <h3>Votre établissement</h3>
        <div class="grid-2">
          <div class="field"><label>Nom</label><input name="name" value="${esc(s.name)}" required></div>
          <div class="field"><label>Activité</label><select name="category">${categories.map((c) => `<option value="${c}" ${c === s.category ? 'selected' : ''}>${CATEGORY_LABELS[c]}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Description</label><textarea name="description">${esc(s.description)}</textarea></div>
        <div class="field"><label>Adresse</label><input name="address" value="${esc(s.address)}"></div>
        <div class="grid-2"><div class="field"><label>Code postal</label><input name="zip" value="${esc(s.zip)}"></div><div class="field"><label>Ville</label><input name="city" value="${esc(s.city)}"></div></div>
        <div class="grid-2"><div class="field"><label>Téléphone</label><input name="phone" value="${esc(s.phone)}"></div><div class="field"><label>E-mail (alertes)</label><input name="email" type="email" value="${esc(s.email)}"></div></div>
        <div class="grid-2"><div class="field"><label>Couleur de marque</label><input name="accent" type="color" value="${esc(s.accent)}"></div><div class="field"><label>Image de couverture (URL)</label><input name="cover_url" value="${esc(s.cover_url)}" placeholder="https://…"></div></div>
        <h3 style="margin-top:12px">Règles de réservation</h3>
        <div class="grid-3">
          <div class="field"><label>Acompte (%)</label><input name="deposit_percent" type="number" min="0" max="100" value="${s.deposit_percent}"><div class="hint">0 = pas d’acompte</div></div>
          <div class="field"><label>Annulation (h avant)</label><input name="cancel_hours" type="number" min="0" max="168" value="${s.cancel_hours}"></div>
          <div class="field"><label>Pause entre RDV (min)</label><input name="buffer_min" type="number" min="0" max="120" step="5" value="${s.buffer_min}"></div>
          <div class="field"><label>Pas des créneaux</label><select name="slot_step">${[5, 10, 15, 20, 30, 60].map((n) => `<option ${n === s.slot_step ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="field"><label>Délai min. (min)</label><input name="min_notice_min" type="number" min="0" value="${s.min_notice_min}"></div>
          <div class="field"><label>Réservable à (jours)</label><input name="max_days_ahead" type="number" min="1" max="365" value="${s.max_days_ahead}"></div>
        </div>
        <h3 style="margin-top:12px">Remplir l’agenda & fidéliser</h3>
        <div class="grid-2">
          <div class="field"><label>Offre dernière minute (%)</label><input name="lastminute_percent" type="number" min="0" max="50" value="${s.lastminute_percent}"><div class="hint">Remise automatique sur les créneaux encore libres. 0 = désactivé.</div></div>
          <div class="field"><label>… dans les prochaines (heures)</label><input name="lastminute_hours" type="number" min="1" max="72" value="${s.lastminute_hours}"></div>
        </div>
        <div class="field"><label>Cadeau d’anniversaire envoyé aux clients</label><input name="birthday_offer" value="${esc(s.birthday_offer)}" placeholder="-15 % sur votre prochaine prestation"><div class="hint">E-mail envoyé le jour de l’anniversaire du client. Laisser vide pour désactiver.</div></div>
        <label class="check"><input type="checkbox" name="giftcards_enabled" ${s.giftcards_enabled ? 'checked' : ''}> Vendre des cartes cadeaux en ligne</label>
        <label class="check"><input type="checkbox" name="loyalty_enabled" ${s.loyalty_enabled ? 'checked' : ''}> Programme de fidélité (1 point par franc)</label>
        <label class="check"><input type="checkbox" name="published" ${s.published ? 'checked' : ''}> Page visible sur la marketplace Lumea</label>
        <button class="btn btn-brand" style="margin-top:12px">Enregistrer</button>
      </form>
      <div class="stack">
        <form class="card" id="hours-form"><h3>Horaires d’ouverture</h3>${hoursEditor(ctx.salonFull.hours, 'open', 'close')}<button class="btn btn-brand" style="margin-top:12px">Enregistrer les horaires</button></form>
        <div class="card" id="studio-card"><h3>Studio coupe 3D</h3><p class="small muted">Chargement…</p></div>
        <div class="card" id="payments-card"><h3>Paiements en ligne (acomptes)</h3><p class="small muted">Chargement…</p></div>
        <div class="card"><h3>Partager & intégrer</h3>
          <div class="field"><label>Lien de réservation (Instagram, Google, SMS)</label><div class="row" style="flex-wrap:nowrap"><input readonly value="${esc(links.page)}" id="l-page"><button class="btn btn-ghost btn-sm" data-copy="l-page">Copier</button></div></div>
          <div class="field"><label>Widget pour votre site web</label><code class="block" id="l-widget">${esc(links.widget)}</code><button class="btn btn-ghost btn-sm" style="margin-top:8px" data-copy="l-widget">Copier le code</button></div>
          <div class="field"><label>Synchroniser avec Google / Apple Calendar</label><div class="row" style="flex-wrap:nowrap"><input readonly value="${esc(links.ical)}" id="l-ical"><button class="btn btn-ghost btn-sm" data-copy="l-ical">Copier</button></div><div class="hint">Ajoutez cette URL comme « agenda par URL ». Gardez-la privée.</div></div>
        </div>
      </div>
    </div>`;
  $('#salon-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    f.loyalty_enabled = !!f.loyalty_enabled;
    f.published = !!f.published;
    f.giftcards_enabled = !!f.giftcards_enabled;
    try { await api(P('/salon'), { method: 'PUT', body: f }); toast('Paramètres enregistrés.'); await refreshCtx(); } catch (err) { toast(err.message, 'error'); }
  };
  api(P('/studio')).then((st) => {
    const card = $('#studio-card');
    if (!card) return;
    const groups = {};
    for (const x of st.styles) (groups[x.group] ||= []).push(x);
    card.innerHTML = `<h3>Studio coupe 3D</h3>
      <p class="small muted">Vos clients règlent leur coupe sur une tête 3D au moment de réserver, parmi les coupes que vous proposez. Vous recevez l’image et les longueurs dans l’agenda. Activez-le par prestation dans <a href="#services">Prestations</a>.</p>
      <div class="stack">${Object.entries(groups).map(([g, list]) => `<div><div class="small muted" style="font-weight:600">${esc(g)}</div>
        <div class="grid-2">${list.map((x) => `<label class="check small"><input type="checkbox" data-style-id="${x.id}" ${st.offered.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div></div>`).join('')}</div>
      <div class="row" style="margin-top:12px"><button class="btn btn-brand btn-sm" id="save-styles">Enregistrer mes coupes</button><button class="btn btn-ghost btn-sm" id="try-studio">Essayer le studio</button></div>`;
    $('#save-styles').onclick = async () => {
      try {
        await api(P('/studio'), { method: 'PUT', body: { offered: $$('[data-style-id]:checked', card).map((c) => c.dataset.styleId) } });
        toast('Coupes proposées enregistrées.');
      } catch (err) { toast(err.message, 'error'); }
    };
    $('#try-studio').onclick = () => {
      let ui;
      modal({
        title: 'Studio coupe 3D — aperçu client',
        body: '<div id="studio-preview"></div>',
        actions: [{ id: 'close', label: 'Fermer', cls: 'btn-ghost' }],
        onOpen: async (d) => {
          d.style.width = 'min(980px, 96vw)';
          const offered = st.styles.filter((x) => $$('[data-style-id]:checked', card).some((c) => c.dataset.styleId === x.id));
          ui = await window.LumeaStudio.mount($('#studio-preview', d), { styles: offered.length ? offered : st.styles, colors: st.colors, fades: st.fades, beards: st.beards });
          $('.studio', d).classList.add('wide');
          d.addEventListener('close', () => ui?.dispose());
        },
      });
    };
  }).catch(() => {});
  api(P('/payments')).then((p) => {
    const card = $('#payments-card');
    if (!card) return;
    const status = {
      simulated: '<span class="badge badge-warn">Mode démonstration</span><p class="small muted">Les acomptes sont enregistrés mais aucun paiement réel n’est encaissé (clé Stripe non configurée sur la plateforme).</p>',
      off: '<span class="badge">Non connecté</span><p class="small muted">Connectez votre compte Stripe pour encaisser les acomptes directement sur votre compte bancaire. <b>Lumea ne prend aucune commission</b> : seuls les frais Stripe s’appliquent (≈ 2,9 % + 0.30 CHF par carte, TWINT ≈ 1,3 %).</p>',
      stripe: '<span class="badge badge-ok">● Actif</span><p class="small muted">Les acomptes sont payés par carte, TWINT, Apple Pay ou Google Pay et versés directement sur votre compte. Remboursement automatique si le client annule dans les délais.</p>',
    }[p.mode];
    card.innerHTML = `<h3>Paiements en ligne (acomptes)</h3>${status}${p.stripe && p.mode !== 'stripe' ? `<button class="btn btn-brand btn-sm" id="connect-stripe">${p.connected ? 'Terminer la configuration Stripe' : 'Connecter mon compte Stripe'}</button>` : ''}`;
    $('#connect-stripe')?.addEventListener('click', async () => {
      try { location.href = (await api(P('/payments/connect'), { method: 'POST', body: {} })).url; } catch (err) { toast(err.message, 'error'); }
    });
  }).catch(() => {});
  $('#hours-form').onsubmit = async (e) => {
    e.preventDefault();
    try { await api(P('/hours'), { method: 'PUT', body: { hours: readHours(e.target) } }); toast('Horaires enregistrés.'); } catch (err) { toast(err.message, 'error'); }
  };
  view.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      const el = $(`#${b.dataset.copy}`);
      try { await navigator.clipboard.writeText(el.value ?? el.textContent); toast('Copié !'); } catch { toast('Copie impossible, sélectionnez le texte.', 'error'); }
    };
  });
}

// =====================================================================
// Billing
// =====================================================================
async function renderBilling() {
  await refreshCtx();
  const { plans } = ctx.salonFull;
  const s = ctx.salon;
  view.innerHTML = `${head('Abonnement')}
    <div class="card" style="margin-bottom:18px"><div class="row between">
      <div>Formule actuelle : <b>${s.plan === 'trial' ? 'Essai gratuit' : esc(plans.find((p) => p.id === s.plan)?.name)}</b>${s.plan === 'trial' ? ` · jusqu’au ${fmt.date(s.trial_ends_at, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</div>
      <span class="badge badge-ok">0 % de commission, toujours</span></div></div>
    <div class="pricing">${plans.map((p) => `
      <div class="card pad-lg plan ${p.id === s.plan ? 'popular' : ''}">
        ${p.id === s.plan ? '<span class="ribbon">Votre formule</span>' : p.popular ? '<span class="ribbon" style="background:var(--ink)">Recommandé</span>' : ''}
        <h3>${esc(p.name)}</h3><div><span class="price">${p.price}</span><span class="muted"> ${CURRENCY} HT / mois</span></div><p class="small muted" style="margin:4px 0 0">${esc(p.tagline || '')}</p>
        <ul>${p.features.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <button class="btn ${p.id === s.plan ? 'btn-ghost' : 'btn-brand'} btn-block" data-plan="${p.id}" ${p.id === s.plan ? 'disabled' : ''}>${p.id === s.plan ? 'Formule active' : 'Choisir'}</button>
      </div>`).join('')}</div>
    <div class="card" style="margin-top:18px"><div class="row between">
      <div><h3 style="margin:0">Mise en avant sur Lumea</h3><p class="small muted" style="margin:4px 0 0">Votre salon apparaît en premier dans les recherches de votre ville, avec le badge « Sponsorisé ». Aucune publicité n’est jamais affichée sur votre propre page ni sur votre site.</p></div>
      ${s.boost_until && s.boost_until >= ctx.today
        ? `<div class="stack" style="text-align:right"><span class="badge badge-ok">Active jusqu’au ${fmt.date(s.boost_until, { day: 'numeric', month: 'long' })}</span><button class="btn btn-ghost btn-sm" id="boost-stop">Arrêter</button></div>`
        : `<button class="btn btn-brand" id="boost-start">Mettre en avant — ${window.LUMEA_CONFIG?.boost_price || 29} ${CURRENCY} / mois</button>`}
    </div></div>
    ${s.stripe_customer_id ? '<button class="btn btn-ghost" id="billing-portal" style="margin-top:14px">Factures, carte bancaire et résiliation</button>' : ''}
    <p class="small muted" style="margin-top:14px">Facturation mensuelle, résiliable à tout moment. Modèles de site premium : gérés dans <a href="#site">Mon site</a>. Le paiement par carte (Stripe) s’active en production — voir README.</p>`;
  $('#boost-start')?.addEventListener('click', async () => {
    try {
      const r = await api(P('/boost'), { method: 'POST', body: {} });
      if (r.checkout_url) { location.href = r.checkout_url; return; }
      toast('Votre salon est mis en avant pour 31 jours.'); renderBilling();
    } catch (err) { toast(err.message, 'error'); }
  });
  $('#boost-stop')?.addEventListener('click', async () => {
    await api(P('/boost'), { method: 'DELETE' }); toast('Mise en avant arrêtée.'); renderBilling();
  });
  $('#billing-portal')?.addEventListener('click', async () => {
    try { location.href = (await api(P('/billing/portal'), { method: 'POST', body: {} })).url; } catch (err) { toast(err.message, 'error'); }
  });
  view.querySelectorAll('[data-plan]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        if (await choosePlan(b.dataset.plan)) { toast('Formule mise à jour.'); renderBilling(); }
      } catch (err) { toast(err.message, 'error'); b.disabled = false; }
    };
  });
}


// =====================================================================
// Website editor (each salon has its own site)
// =====================================================================
const siteState = { data: null, draft: null, tab: 'modele', device: 'desktop' };
const ACCESS_LABEL = {
  free: ['Inclus', 'badge-ok'], included: ['Inclus Premium', 'badge-ok'], trial: ['Inclus pendant l’essai', 'badge-brand'],
  licensed: ['Débloqué', 'badge-ok'], locked: ['Premium', ''],
};
const SECTION_LABELS = { about: 'À propos', services: 'Prestations & tarifs', team: 'Équipe', gallery: 'Galerie photos', reviews: 'Avis clients', infos: 'Horaires & accès' };

async function renderSiteEditor() {
  const d = await api(P('/site'));
  siteState.data = d;
  siteState.draft = {
    template: d.site.template, published: !!d.site.published, content: d.site.content || {},
    custom_css: d.site.custom_css || '', custom_domain: d.site.custom_domain || '',
  };
  view.innerHTML = `${head('Mon site', `
      <span class="badge ${d.site.published ? 'badge-ok' : ''}" id="site-status">${d.site.published ? '● En ligne' : 'Hors ligne'}</span>
      <a class="btn btn-ghost" href="${esc(d.url)}" target="_blank" rel="noopener">Voir mon site</a>
      <button class="btn btn-brand" id="site-save">Enregistrer & publier</button>`)}
    <div class="card" style="margin-bottom:16px;padding:14px 18px"><div class="row between">
      <span class="small">Adresse de votre site : <a href="${esc(d.url)}" target="_blank" rel="noopener"><b>${esc(d.url)}</b></a>${d.site.custom_domain ? ` · domaine : <b>${esc(d.site.custom_domain)}</b>` : ''}</span>
      <span class="small muted">Formule : <b>${d.plan === 'trial' ? 'Essai (tout inclus)' : d.plan === 'premium' ? 'Premium' : 'Essentiel'}</b></span></div></div>
    <div class="site-editor">
      <div>
        <div class="tabs">${[['modele', 'Modèle'], ['contenu', 'Contenu'], ['style', 'Style & sections'], ['avance', 'Premium']].map(([k, l]) => `<button class="chip ${siteState.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>
        <div id="site-panel"></div>
      </div>
      <div>
        <div class="row between" style="margin-bottom:8px"><span class="small muted">Aperçu en direct (non publié tant que vous n’enregistrez pas)</span>
          <div class="row" style="gap:4px"><button class="chip ${siteState.device === 'desktop' ? 'active' : ''}" data-device="desktop">Ordinateur</button><button class="chip ${siteState.device === 'mobile' ? 'active' : ''}" data-device="mobile">Mobile</button></div></div>
        <div class="site-preview ${siteState.device}"><iframe id="site-frame" title="Aperçu du site"></iframe></div>
      </div>
    </div>`;
  view.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { siteState.tab = b.dataset.tab; view.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('active', x === b)); renderSitePanel(); }; });
  view.querySelectorAll('[data-device]').forEach((b) => {
    b.onclick = () => {
      siteState.device = b.dataset.device;
      view.querySelectorAll('[data-device]').forEach((x) => x.classList.toggle('active', x === b));
      $('.site-preview').classList.toggle('mobile', siteState.device === 'mobile');
    };
  });
  $('#site-save').onclick = saveSite;
  renderSitePanel();
  refreshPreview();
}

let previewTimer;
function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    const res = await api(P('/site/preview'), { method: 'POST', body: siteState.draft, raw: true });
    const frame = $('#site-frame');
    if (frame) frame.srcdoc = await res.text();
  }, 350);
}

function templateMeta(id) { return siteState.data.templates.find((t) => t.id === id); }

async function saveSite() {
  const t = templateMeta(siteState.draft.template);
  if (t.access === 'locked') return unlockTemplate(t);
  try {
    await api(P('/site'), { method: 'PUT', body: siteState.draft });
    toast('Site enregistré et publié.');
    renderSiteEditor();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function unlockTemplate(t) {
  const { pricing, currency } = siteState.data;
  modal({
    title: `Débloquer le modèle « ${t.name} »`,
    body: `<p>${esc(t.description)}</p>
      <div class="grid-2" style="gap:12px;margin-top:12px">
        <div class="card"><b>Achat</b><div class="display" style="font-size:2rem">${pricing.once} ${currency}</div><p class="small muted" style="margin:0">Paiement unique, le modèle vous appartient définitivement.</p></div>
        <div class="card"><b>Location</b><div class="display" style="font-size:2rem">${pricing.monthly} ${currency}<span class="small muted"> / mois</span></div><p class="small muted" style="margin:0">Sans engagement, résiliable à tout moment.</p></div>
      </div>
      <p class="small muted" style="margin-top:14px">Ou passez en <b>Premium (158 ${currency} / mois)</b> : tous les modèles, un site personnalisé par notre équipe et votre nom de domaine.</p>`,
    actions: [
      { id: 'close', label: 'Plus tard', cls: 'btn-ghost' },
      { id: 'premium', label: 'Passer Premium', cls: 'btn-ghost', handler: async () => { if (await choosePlan('premium')) { toast('Formule Premium activée : tous les modèles sont inclus.'); setTimeout(saveSite, 50); } } },
      { id: 'monthly', label: `Louer ${pricing.monthly} ${currency}/mois`, cls: 'btn-ghost', handler: () => buyLicense(t.id, 'monthly') },
      { id: 'once', label: `Acheter ${pricing.once} ${currency}`, cls: 'btn-brand', handler: () => buyLicense(t.id, 'once') },
    ],
  });
}

async function buyLicense(template, billing) {
  // Save the draft first so the chosen texts survive the round-trip to the payment page.
  const saved = { ...siteState.draft, template: siteState.data.site.template };
  await api(P('/site'), { method: 'PUT', body: saved }).catch(() => {});
  const r = await api(P('/site/licenses'), { method: 'POST', body: { template, billing } });
  if (r.checkout_url) { location.href = r.checkout_url; return; }
  toast(billing === 'once' ? 'Modèle acheté.' : 'Modèle loué.');
  const fresh = await api(P('/site'));
  siteState.data.templates = fresh.templates;
  siteState.data.licenses = fresh.licenses;
  await api(P('/site'), { method: 'PUT', body: siteState.draft });
  toast('Site enregistré et publié.');
  renderSiteEditor();
}

function renderSitePanel() {
  const { draft, data } = siteState;
  const c = draft.content;
  c.socials ||= {};
  c.sections ||= {};
  const panel = $('#site-panel');
  const field = (key, label, { type = 'text', placeholder = '', hint = '' } = {}) => `<div class="field"><label>${label}</label>${type === 'textarea'
    ? `<textarea data-c="${key}" placeholder="${esc(placeholder)}">${esc(c[key] || '')}</textarea>`
    : `<input data-c="${key}" type="${type}" value="${esc(c[key] || '')}" placeholder="${esc(placeholder)}">`}${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;

  if (siteState.tab === 'modele') {
    panel.innerHTML = `<div class="tpl-grid" style="grid-template-columns:1fr 1fr">${data.templates.map((t) => {
      const [label, cls] = ACCESS_LABEL[t.access];
      const priceTag = t.access === 'locked' ? `${data.pricing.once} ${data.currency} ou ${data.pricing.monthly}/mois` : label;
      return `<button class="card tpl-card ${t.id === draft.template ? 'selected' : ''}" data-tpl="${t.id}" style="text-align:left;cursor:pointer;font:inherit;color:inherit">
        <div class="tpl-thumb"><iframe src="/modeles/${t.id}" loading="lazy" tabindex="-1" title="${esc(t.name)}"></iframe></div>
        <div class="tpl-body"><b>${esc(t.name)}</b><span class="badge ${cls}" style="margin-top:6px;align-self:flex-start">${esc(priceTag)}</span></div></button>`;
    }).join('')}</div>
    <p class="small muted" style="margin-top:12px">Cliquez pour prévisualiser n’importe quel modèle avec vos propres données. Les modèles premium se débloquent à l’enregistrement.</p>
    ${data.licenses.length ? `<div class="card" style="margin-top:12px"><h4 style="margin-top:0">Mes modèles</h4>${data.licenses.map((l) => `<div class="list-item small"><div class="grow"><b>${esc(templateMeta(l.template)?.name || l.template)}</b> · ${l.billing === 'once' ? `acheté ${l.price_chf} ${data.currency}` : `loué ${l.price_chf} ${data.currency}/mois`}${l.active ? '' : ' · résilié'}</div>${l.active && l.billing === 'monthly' ? `<button class="btn btn-ghost btn-sm" data-cancel-lic="${l.id}">Résilier</button>` : ''}</div>`).join('')}</div>` : ''}`;
    scaleThumbs(panel);
    panel.querySelectorAll('[data-tpl]').forEach((b) => {
      b.onclick = () => {
        draft.template = b.dataset.tpl;
        panel.querySelectorAll('[data-tpl]').forEach((x) => x.classList.toggle('selected', x === b));
        refreshPreview();
        const t = templateMeta(draft.template);
        if (t.access === 'locked') toast(`Aperçu de « ${t.name} » — modèle premium à débloquer à l’enregistrement.`);
      };
    });
    panel.querySelectorAll('[data-cancel-lic]').forEach((b) => {
      b.onclick = async () => {
        const ok = await modal({ title: 'Résilier la location ?', body: '<p>Votre site repassera sur le modèle Classique à la fin de la période.</p>', actions: [{ id: 'close', label: 'Garder', cls: 'btn-ghost' }, { id: 'ok', label: 'Résilier', cls: 'btn-danger' }] });
        if (!ok) return;
        await api(P(`/site/licenses/${b.dataset.cancelLic}`), { method: 'DELETE' });
        toast('Location résiliée.');
        renderSiteEditor();
      };
    });
    return;
  }

  if (siteState.tab === 'contenu') {
    panel.innerHTML = `<div class="card">
      ${field('announcement', 'Bandeau d’annonce', { placeholder: 'Ex. : -15 % sur les soins en octobre' })}
      ${field('tagline', 'Accroche courte', { placeholder: 'Coiffure · Genève' })}
      ${field('hero_title', 'Grand titre', { placeholder: ctx.salon.name })}
      ${field('hero_subtitle', 'Sous-titre', { type: 'textarea', placeholder: 'Une phrase qui donne envie de réserver.' })}
      ${field('cta_label', 'Texte du bouton', { placeholder: 'Prendre rendez-vous' })}
      ${field('hero_image', 'Photo principale (URL)', { placeholder: 'https://…', hint: 'Lien vers une photo (Instagram, Unsplash, votre hébergement…).' })}
      <hr class="divider">
      ${field('about_title', 'Titre « À propos »', { placeholder: 'Notre maison' })}
      ${field('about_text', 'Texte « À propos »', { type: 'textarea', placeholder: 'Votre histoire, votre savoir-faire, vos produits…' })}
      <div class="field"><label>Galerie photos (une URL par ligne)</label><textarea data-gallery placeholder="https://…">${esc((c.gallery || []).join('\n'))}</textarea></div>
      <hr class="divider">
      <div class="grid-2">${[['instagram', 'Instagram', '@votre.salon'], ['facebook', 'Facebook', 'votre.page'], ['tiktok', 'TikTok', '@votre.salon'], ['whatsapp', 'WhatsApp', '+41 79 …']].map(([k, l, ph]) => `<div class="field"><label>${l}</label><input data-social="${k}" value="${esc(c.socials[k] || '')}" placeholder="${ph}"></div>`).join('')}</div>
    </div>`;
  } else if (siteState.tab === 'style') {
    panel.innerHTML = `<div class="card">
      <div class="field"><label>Couleur principale</label><div class="row" style="flex-wrap:nowrap"><input type="color" data-c="accent" value="${esc(c.accent || templateMeta(draft.template).colors.accent || ctx.salon.accent)}" style="max-width:90px"><label class="check small" style="margin:0"><input type="checkbox" id="accent-default" ${c.accent ? '' : 'checked'}> Couleur du modèle</label></div></div>
      <h4>Sections affichées</h4>
      ${Object.entries(SECTION_LABELS).map(([k, l]) => `<label class="check"><input type="checkbox" data-section="${k}" ${c.sections[k] !== false ? 'checked' : ''}> ${l}</label>`).join('')}
      <hr class="divider">
      <label class="check"><input type="checkbox" id="site-published" ${draft.published ? 'checked' : ''}> Site en ligne</label>
    </div>`;
  } else {
    const locked = !data.premium;
    panel.innerHTML = `<div class="card" ${locked ? 'style="opacity:.75"' : ''}>
      ${locked ? `<div class="card" style="background:var(--brand-soft);border:0;margin-bottom:14px"><b>Formule Premium — 158 ${data.currency} / mois</b><p class="small" style="margin:6px 0 10px">Site personnalisé par notre équipe, tous les modèles, votre domaine, CSS sur mesure et suppression de la mention Lumea.</p><button class="btn btn-brand btn-sm" id="go-premium">Passer Premium</button></div>` : ''}
      <div class="field"><label>Nom de domaine personnalisé</label><input id="custom-domain" value="${esc(draft.custom_domain)}" placeholder="mon-salon.ch" ${locked ? 'disabled' : ''}>
        <div class="hint">Chez votre registrar, créez un enregistrement <b>CNAME</b> de <code>www</code> vers <code>${esc(location.host)}</code>, puis saisissez votre domaine ici.</div></div>
      <label class="check"><input type="checkbox" id="hide-branding" ${c.hide_branding ? 'checked' : ''} ${locked ? 'disabled' : ''}> Masquer « Réservation propulsée par Lumea »</label>
      <div class="field" style="margin-top:12px"><label>CSS personnalisé</label><textarea id="custom-css" style="font-family:monospace;min-height:140px" placeholder=".hero h1 { letter-spacing: .02em; }" ${locked ? 'disabled' : ''}>${esc(draft.custom_css)}</textarea></div>
      <hr class="divider">
      ${locked ? `<div class="card" style="background:var(--surface-2);border:0;margin-bottom:14px"><b>On crée votre site pour vous — ${data.custom_site_price} ${data.currency}, une seule fois</b>
        <p class="small" style="margin:6px 0 10px">Un designer réalise votre site à partir de vos photos, de vos couleurs et de vos envies. Il vous appartient ensuite, sans abonnement supplémentaire.</p>
        <textarea id="custom-brief" placeholder="Votre univers, vos couleurs, les sites que vous aimez, les photos que vous avez…"></textarea>
        <button class="btn btn-brand btn-sm" id="buy-custom" style="margin-top:8px">Commander mon site (${data.custom_site_price} ${data.currency})</button></div>` : ''}
      <h4 style="margin-top:0">Site sur mesure par notre équipe</h4>
      <p class="small muted">Décrivez votre univers (ambiance, couleurs, sites que vous aimez, photos disponibles). Un designer prépare votre site personnalisé.</p>
      <textarea id="design-brief" placeholder="Ex. : ambiance minérale, beige et noir, photos de l’équipe, mise en avant des balayages…" ${locked ? 'disabled' : ''}></textarea>
      <button class="btn btn-ghost" id="send-brief" style="margin-top:10px" ${locked ? 'disabled' : ''}>Envoyer ma demande</button>
      ${data.design_requests.map((r) => `<div class="list-item small"><div class="grow">${esc(r.brief.slice(0, 120))}${r.admin_note ? `<div class="muted">Réponse : ${esc(r.admin_note)}</div>` : ''}</div><span class="badge ${r.status === 'livre' ? 'badge-ok' : r.status === 'en_cours' ? 'badge-brand' : ''}">${{ nouveau: 'Reçue', en_cours: 'En cours', livre: 'Livrée' }[r.status]}</span></div>`).join('')}
    </div>`;
    $('#buy-custom')?.addEventListener('click', async () => {
      try {
        const r = await api(P('/site/custom'), { method: 'POST', body: { brief: $('#custom-brief').value } });
        if (r.checkout_url) { location.href = r.checkout_url; return; }
        toast('Commande enregistrée : notre équipe vous contacte sous 48 h.'); renderSiteEditor();
      } catch (err) { toast(err.message, 'error'); }
    });
    $('#go-premium')?.addEventListener('click', async () => { if (await choosePlan('premium')) { toast('Formule Premium activée.'); renderSiteEditor(); } });
    $('#send-brief')?.addEventListener('click', async () => {
      try {
        await api(P('/site/design-requests'), { method: 'POST', body: { brief: $('#design-brief').value } });
        toast('Demande envoyée : notre équipe vous recontacte sous 48 h.');
        renderSiteEditor();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  panel.oninput = (e) => {
    const el = e.target;
    if (el.dataset.c) {
      c[el.dataset.c] = el.value;
      if (el.dataset.c === 'accent') { const cb = $('#accent-default'); if (cb) cb.checked = false; }
    } else if (el.dataset.social) c.socials[el.dataset.social] = el.value;
    else if (el.hasAttribute('data-gallery')) c.gallery = el.value.split(/\s+/).filter(Boolean);
    else if (el.dataset.section) c.sections[el.dataset.section] = el.checked;
    else if (el.id === 'accent-default') { if (el.checked) c.accent = ''; else c.accent = $('[data-c="accent"]').value; }
    else if (el.id === 'site-published') draft.published = el.checked;
    else if (el.id === 'custom-domain') draft.custom_domain = el.value;
    else if (el.id === 'custom-css') draft.custom_css = el.value;
    else if (el.id === 'hide-branding') c.hide_branding = el.checked;
    else return;
    refreshPreview();
  };
  panel.onchange = panel.oninput;
}


// =====================================================================
// Till (caisse), stock, gift cards
// =====================================================================
const METHOD_LABEL = { cash: 'Espèces', card: 'Carte', twint: 'TWINT', gift_card: 'Carte cadeau', other: 'Autre', online: 'Acompte en ligne' };
const toCents = (v) => Math.round(Number(String(v).replace(',', '.')) * 100) || 0;

/** Checkout screen: from a booking (prefilled) or a walk-in sale. */
async function checkoutModal({ booking = null, after = () => route() } = {}) {
  const [products, services] = await Promise.all([api(P('/products')), Promise.resolve(ctx.services)]);
  const lines = [];
  if (booking) lines.push({ kind: 'service', ref_id: booking.service_id, name: booking.service_name, qty: 1, unit_cents: booking.price_cents });
  const st = { discount: 0, tip: 0, method: 'card', gift: null, staff: booking?.staff_id || (ctx.staff[0]?.id ?? '') };
  const deposit = booking && booking.payment_status === 'paid' ? booking.deposit_cents : 0;

  const totals = () => {
    const sub = lines.reduce((a, l) => a + l.unit_cents * l.qty, 0);
    const discount = Math.min(sub, st.discount);
    const total = sub - discount + st.tip;
    const giftUse = st.gift ? Math.min(st.gift.balance_cents, total) : 0;
    return { sub, discount, total, giftUse, due: Math.max(0, total - giftUse - deposit) };
  };

  const render = (d) => {
    const t = totals();
    $('#co-lines', d).innerHTML = lines.map((l, i) => `
      <div class="list-item small"><div class="grow"><b>${esc(l.name)}</b>${l.kind === 'gift_card' ? ' <span class="badge">Carte cadeau</span>' : ''}</div>
        ${l.kind === 'product' ? `<input type="number" min="1" max="99" value="${l.qty}" data-qty="${i}" style="width:64px;padding:6px">` : ''}
        ${l.kind === 'product' ? `<span>${fmt.eur(l.unit_cents)}</span>` : `<input type="number" min="0" step="0.5" value="${l.unit_cents / 100}" data-price="${i}" style="width:96px;padding:6px" aria-label="Prix">`}
        <b style="width:84px;text-align:right">${fmt.eur(l.unit_cents * l.qty)}</b>
        <button type="button" class="icon-btn" data-rm="${i}" aria-label="Retirer">×</button></div>`).join('') || '<p class="muted small">Aucun article.</p>';
    $('#co-sum', d).innerHTML = `
      <div><span>Sous-total</span><span>${fmt.eur(t.sub)}</span></div>
      ${t.discount ? `<div><span>Remise</span><span>− ${fmt.eur(t.discount)}</span></div>` : ''}
      ${st.tip ? `<div><span>Pourboire</span><span>${fmt.eur(st.tip)}</span></div>` : ''}
      ${t.giftUse ? `<div><span>Carte cadeau ${esc(st.gift.code)}</span><span>− ${fmt.eur(t.giftUse)}</span></div>` : ''}
      ${deposit ? `<div><span>Acompte déjà payé en ligne</span><span>− ${fmt.eur(deposit)}</span></div>` : ''}
      <div style="border-top:1px solid var(--line);margin-top:6px;padding-top:8px;font-size:1.15rem"><b>À encaisser</b><b>${fmt.eur(t.due)}</b></div>`;
    $('#co-change', d).hidden = st.method !== 'cash';
    const given = toCents($('#co-given', d).value);
    $('#co-change-out', d).textContent = given >= t.due && given ? `Rendu : ${fmt.eur(given - t.due)}` : '';
    $('[data-act="pay"]', d.closest('dialog') || d).textContent = `Encaisser ${fmt.eur(t.due)}`;
  };

  modal({
    title: booking ? `Encaisser — ${booking.client_name}` : 'Nouvelle vente',
    body: `
      <div id="co-lines"></div>
      <div class="grid-3" style="margin-top:12px">
        <div class="field"><label>Produit</label><select id="co-add-product"><option value="">+ Ajouter</option>${products.filter((p) => p.active).map((p) => `<option value="${p.id}" ${p.stock < 1 ? 'disabled' : ''}>${esc(p.name)} · ${fmt.eur(p.price_cents)} (${p.stock})</option>`).join('')}</select></div>
        <div class="field"><label>Prestation</label><select id="co-add-service"><option value="">+ Ajouter</option>${services.filter((x) => x.active).map((x) => `<option value="${x.id}">${esc(x.name)} · ${fmt.eur(x.price_cents)}</option>`).join('')}</select></div>
        <div class="field"><label>Carte cadeau à vendre</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input id="co-gift-amount" type="number" min="10" step="10" placeholder="Montant"><button type="button" class="btn btn-ghost btn-sm" id="co-add-gift">+</button></div></div>
      </div>
      <div class="grid-2">
        <div class="field"><label>Remise (${CURRENCY})</label><input id="co-discount" type="number" min="0" step="0.5" value="0"></div>
        <div class="field"><label>Pourboire</label><div class="row" style="gap:6px">${[0, 5, 10, 15].map((p) => `<button type="button" class="chip ${p === 0 ? 'active' : ''}" data-tip="${p}">${p ? `${p} %` : 'Aucun'}</button>`).join('')}<input id="co-tip" type="number" min="0" step="0.5" placeholder="${CURRENCY}" style="width:90px;padding:6px"></div></div>
      </div>
      <div class="field"><label>Carte cadeau du client</label><div class="row" style="flex-wrap:nowrap;gap:6px"><input id="co-gift-code" placeholder="LUM-XXXX-XXXX" style="text-transform:uppercase"><button type="button" class="btn btn-ghost btn-sm" id="co-gift-check">Appliquer</button></div><div class="hint" id="co-gift-info"></div></div>
      <div class="grid-2">
        <div class="field"><label>Moyen de paiement</label><div class="row" style="gap:6px">${['card', 'twint', 'cash', 'other'].map((m) => `<button type="button" class="chip ${m === st.method ? 'active' : ''}" data-method="${m}">${METHOD_LABEL[m]}</button>`).join('')}</div></div>
        <div class="field"><label>Collaborateur</label><select id="co-staff">${ctx.staff.filter((x) => x.active).map((x) => `<option value="${x.id}" ${x.id === st.staff ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      </div>
      <div class="field" id="co-change" hidden><label>Montant reçu en espèces</label><div class="row" style="flex-wrap:nowrap"><input id="co-given" type="number" min="0" step="0.05" style="max-width:160px"><b id="co-change-out"></b></div></div>
      <div class="summary" id="co-sum"></div>`,
    actions: [
      { id: 'close', label: 'Annuler', cls: 'btn-ghost' },
      {
        id: 'pay', label: 'Encaisser', cls: 'btn-ok',
        handler: async () => {
          const t = totals();
          if (!lines.length) throw new Error('Ajoutez au moins un article.');
          const method = st.gift && t.giftUse >= t.total ? 'gift_card' : st.method;
          const r = await api(P('/sales'), {
            method: 'POST',
            body: {
              booking_id: booking?.id, staff_id: Number(st.staff) || undefined, method, discount_cents: st.discount, tip_cents: st.tip,
              gift_card_code: st.gift?.code, items: lines.map((l) => ({ kind: l.kind, ref_id: l.ref_id, qty: l.qty, unit_cents: l.unit_cents, recipient_name: l.recipient_name })),
            },
          });
          toast(`Vente enregistrée : ${fmt.eur(r.total_cents)}.`);
          if (r.issued_gift_cards.length) {
            setTimeout(() => modal({ title: 'Carte(s) cadeau émise(s)', body: r.issued_gift_cards.map((g) => `<p>${fmt.eur(g.amount_cents)} — code <b style="font-size:1.2rem;letter-spacing:.06em">${esc(g.code)}</b></p>`).join('') + '<p class="small muted">Le client peut retrouver sa carte avec ce code sur la page « carte cadeau » du salon.</p>' }));
          }
          after();
        },
      },
    ],
    onOpen: (d) => {
      const rerender = () => render(d);
      $('#co-add-product', d).onchange = (e) => {
        const p = products.find((x) => x.id === Number(e.target.value));
        if (p) {
          const ex = lines.find((l) => l.kind === 'product' && l.ref_id === p.id);
          if (ex) ex.qty++; else lines.push({ kind: 'product', ref_id: p.id, name: p.brand ? `${p.brand} — ${p.name}` : p.name, qty: 1, unit_cents: p.price_cents });
        }
        e.target.value = ''; rerender();
      };
      $('#co-add-service', d).onchange = (e) => {
        const x = services.find((y) => y.id === Number(e.target.value));
        if (x) lines.push({ kind: 'service', ref_id: x.id, name: x.name, qty: 1, unit_cents: x.price_cents });
        e.target.value = ''; rerender();
      };
      $('#co-add-gift', d).onclick = () => {
        const v = toCents($('#co-gift-amount', d).value);
        if (v < 1000) return toast('Montant minimum : 10.', 'error');
        lines.push({ kind: 'gift_card', ref_id: null, name: `Carte cadeau ${fmt.eur(v)}`, qty: 1, unit_cents: v });
        $('#co-gift-amount', d).value = ''; rerender();
      };
      $('#co-gift-check', d).onclick = async () => {
        try {
          const g = await api(P(`/gift-cards/${encodeURIComponent($('#co-gift-code', d).value.trim().toUpperCase())}`));
          st.gift = g;
          $('#co-gift-info', d).innerHTML = `<span class="badge badge-ok">Solde ${fmt.eur(g.balance_cents)}</span> valable jusqu’au ${esc(g.expires_at)}`;
        } catch (err) { st.gift = null; $('#co-gift-info', d).innerHTML = `<span class="badge badge-danger">${esc(err.message)}</span>`; }
        rerender();
      };
      d.addEventListener('input', (e) => {
        if (e.target.dataset.qty) lines[e.target.dataset.qty].qty = Math.max(1, Number(e.target.value) || 1);
        if (e.target.dataset.price) lines[e.target.dataset.price].unit_cents = toCents(e.target.value);
        if (e.target.id === 'co-discount') st.discount = toCents(e.target.value);
        if (e.target.id === 'co-tip') { st.tip = toCents(e.target.value); $$('[data-tip]', d).forEach((c) => c.classList.remove('active')); }
        if (e.target.id === 'co-staff') st.staff = e.target.value;
        if (['co-gift-code', 'co-gift-amount'].includes(e.target.id)) return;
        rerender();
      });
      $('#co-staff', d).onchange = (e) => { st.staff = e.target.value; };
      d.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.rm) { lines.splice(Number(b.dataset.rm), 1); rerender(); }
        if (b.dataset.tip !== undefined) {
          const sub = totals().sub - Math.min(totals().sub, st.discount);
          st.tip = Math.round(sub * Number(b.dataset.tip) / 100 / 50) * 50;
          $('#co-tip', d).value = '';
          $$('[data-tip]', d).forEach((c) => c.classList.toggle('active', c === b)); rerender();
        }
        if (b.dataset.method) { st.method = b.dataset.method; $$('[data-method]', d).forEach((c) => c.classList.toggle('active', c === b)); rerender(); }
      });
      d.style.width = 'min(760px, 96vw)';
      rerender();
    },
  });
}

const tillState = { day: null, tab: 'jour' };
async function renderTill() {
  tillState.day ||= ctx.today;
  const r = await api(P(`/sales?day=${tillState.day}`));
  const t = r.totals;
  const tabs = ctx.isStaff ? '' : `<div class="row" style="gap:4px">${[['jour', 'Journée'], ['cartes', 'Cartes cadeaux']].map(([k, l]) => `<button class="chip ${tillState.tab === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</div>`;
  view.innerHTML = `${head('Caisse', `${tabs}<button class="btn btn-ok" id="new-sale">+ Nouvelle vente</button>`)}<div id="till-body"></div>`;
  $('#new-sale').onclick = () => checkoutModal({ after: renderTill });
  view.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { tillState.tab = b.dataset.tab; renderTill(); }; });
  const body = $('#till-body');
  if (tillState.tab === 'cartes' && !ctx.isStaff) {
    const cards = await api(P('/gift-cards'));
    const out = cards.filter((g) => g.status === 'active').reduce((a, g) => a + g.balance_cents, 0);
    body.innerHTML = `
      <div class="kpis"><div class="kpi"><div class="label">Cartes actives</div><div class="value">${cards.filter((g) => g.status === 'active' && g.balance_cents > 0).length}</div></div>
        <div class="kpi"><div class="label">Solde restant à honorer</div><div class="value">${fmt.eur(out)}</div></div>
        <div class="kpi"><div class="label">Vendues (total)</div><div class="value">${fmt.eur(cards.reduce((a, g) => a + g.initial_cents, 0))}</div></div></div>
      <div class="card" style="margin-bottom:14px"><div class="row between"><div><b>Vente en ligne</b><div class="small muted">Lien à partager (Instagram, site, vitrine) : vos clients achètent une carte cadeau 24 h/24.</div></div>
        <a class="btn btn-ghost btn-sm" href="/carte-cadeau.html?s=${encodeURIComponent(ctx.salon.slug)}" target="_blank">Voir la page</a></div></div>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>Pour</th><th>Acheteur</th><th>Montant</th><th>Solde</th><th>Expire</th><th>Origine</th></tr></thead><tbody>
      ${cards.map((g) => `<tr><td><b>${esc(g.code)}</b></td><td>${esc(g.recipient_name || '—')}</td><td class="small">${esc(g.buyer_name || '—')}<div class="muted">${esc(g.buyer_email)}</div></td><td>${fmt.eur(g.initial_cents)}</td><td><b>${fmt.eur(g.balance_cents)}</b></td><td class="small">${esc(g.expires_at)}</td><td><span class="badge">${g.source === 'online' ? 'En ligne' : 'Caisse'}</span></td></tr>`).join('') || '<tr><td colspan="7" class="empty">Aucune carte cadeau pour le moment.</td></tr>'}
      </tbody></table></div>`;
    return;
  }
  body.innerHTML = `
    <div class="agenda-toolbar">
      <button class="btn btn-ghost btn-sm" data-day="-1">‹</button><input type="date" id="till-day" value="${tillState.day}" style="width:auto;padding:6px 10px"><button class="btn btn-ghost btn-sm" data-day="1">›</button>
      <b>${fmt.date(tillState.day)}</b><div class="grow"></div>
      ${ctx.isStaff ? '' : `<a class="btn btn-ghost btn-sm" href="${P(`/export/sales.csv?from=${dateUtil.addDays(tillState.day, -30)}&to=${tillState.day}`)}">Export comptable (CSV)</a><button class="btn btn-ghost btn-sm" id="z-report">Clôture de caisse</button>`}
    </div>
    <div class="kpis">
      <div class="kpi"><div class="label">Encaissé</div><div class="value">${fmt.eur(t.collected_cents)}</div><div class="sub">${t.count} vente(s)</div></div>
      <div class="kpi"><div class="label">Prestations</div><div class="value">${fmt.eur(t.services_cents)}</div></div>
      <div class="kpi"><div class="label">Produits</div><div class="value">${fmt.eur(t.products_cents)}</div></div>
      <div class="kpi"><div class="label">Pourboires</div><div class="value">${fmt.eur(t.tips_cents)}</div></div>
      ${Object.entries(r.by_method).filter(([, v]) => v).map(([m, v]) => `<div class="kpi"><div class="label">${METHOD_LABEL[m]}</div><div class="value">${fmt.eur(v)}</div></div>`).join('')}
    </div>
    <div class="two-col">
      <div class="card"><h3>Ventes</h3>${r.sales.map((s) => `
        <div class="list-item" style="${s.voided ? 'opacity:.5;text-decoration:line-through' : ''}">
          <div class="grow"><b>${s.created_at.slice(11, 16)}</b> · ${esc(s.client_name || 'Client de passage')} <span class="muted small">· ${esc(s.staff_name || '')}</span>
            <div class="small muted">${s.items.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${esc(i.name)}`).join(', ')}${s.tip_cents ? ` · pourboire ${fmt.eur(s.tip_cents)}` : ''}</div></div>
          <span class="badge">${METHOD_LABEL[s.method]}</span><b>${fmt.eur(s.total_cents)}</b>
          ${!s.voided && !ctx.isStaff ? `<button class="btn btn-ghost btn-sm" data-invoice="${s.id}" data-client="${esc(s.client_name || '')}">Facture</button><button class="btn btn-ghost btn-sm" data-void="${s.id}">Annuler</button>` : ''}
        </div>`).join('') || '<div class="empty">Aucune vente ce jour-là.</div>'}</div>
      <div class="stack">
        <div class="card"><h3>Articles vendus</h3>${r.items.map((i) => `<div class="list-item small"><div class="grow">${esc(i.name)}</div><span class="muted">${i.qty}×</span><b>${fmt.eur(i.total_cents)}</b></div>`).join('') || '<p class="muted small">—</p>'}</div>
        <div class="card"><h3>Pourboires par collaborateur</h3>${Object.entries(r.tips_by_staff).map(([n, v]) => `<div class="list-item small"><div class="grow">${esc(n)}</div><b>${fmt.eur(v)}</b></div>`).join('') || '<p class="muted small">—</p>'}</div>
      </div>
    </div>`;
  body.querySelectorAll('[data-day]').forEach((b) => { b.onclick = () => { tillState.day = dateUtil.addDays(tillState.day, Number(b.dataset.day)); renderTill(); }; });
  $('#till-day').onchange = (e) => { if (e.target.value) { tillState.day = e.target.value; renderTill(); } };
  body.querySelectorAll('[data-invoice]').forEach((b) => {
    b.onclick = async () => {
      const name = b.dataset.client || prompt('Nom du client sur la facture :');
      if (!name) return;
      try {
        const inv = await api(P('/invoices'), { method: 'POST', body: { sale_id: Number(b.dataset.invoice), customer_name: name } });
        window.open(`/facture/${inv.token}`, '_blank', 'noopener');
      } catch (err) { toast(err.message, 'error'); }
    };
  });
  body.querySelectorAll('[data-void]').forEach((b) => {
    b.onclick = async () => {
      const ok = await modal({ title: 'Annuler cette vente ?', body: '<p>Le stock et le solde des cartes cadeaux utilisées sont rétablis. À utiliser en cas d’erreur de saisie.</p>', actions: [{ id: 'close', label: 'Garder', cls: 'btn-ghost' }, { id: 'ok', label: 'Annuler la vente', cls: 'btn-danger' }] });
      if (!ok) return;
      await api(P(`/sales/${b.dataset.void}/void`), { method: 'POST', body: {} });
      toast('Vente annulée.'); renderTill();
    };
  });
  $('#z-report')?.addEventListener('click', () => modal({
    title: `Clôture de caisse — ${fmt.date(tillState.day, { day: 'numeric', month: 'long', year: 'numeric' })}`,
    body: `<div class="summary">
      ${Object.entries(r.by_method).map(([m, v]) => `<div><span>${METHOD_LABEL[m]}</span><b>${fmt.eur(v)}</b></div>`).join('')}
      <div style="border-top:1px solid var(--line);margin-top:6px;padding-top:6px"><span>Total encaissé</span><b>${fmt.eur(t.collected_cents)}</b></div>
      <div><span>dont pourboires</span><span>${fmt.eur(t.tips_cents)}</span></div>
      <div><span>Remises accordées</span><span>${fmt.eur(t.discounts_cents)}</span></div>
      <div><span>Nombre de ventes</span><span>${t.count}</span></div></div>
      <p class="small muted" style="margin-top:12px">Comptez votre fond de caisse : les espèces attendues sont de <b>${fmt.eur(r.by_method.cash)}</b> (hors fond de caisse).</p>`,
    actions: [{ id: 'close', label: 'Fermer', cls: 'btn-ghost' }, { id: 'print', label: 'Imprimer', cls: 'btn-brand', handler: () => { window.print(); return false; } }],
  }));
}

async function renderStock() {
  const list = await api(P('/products'));
  const low = list.filter((p) => p.active && p.stock <= p.low_stock);
  const value = list.filter((p) => p.active).reduce((a, p) => a + p.stock * (p.cost_cents || p.price_cents), 0);
  view.innerHTML = `${head('Stock', '<button class="btn btn-brand" id="add-product">+ Produit</button>')}
    <div class="kpis">
      <div class="kpi"><div class="label">Produits actifs</div><div class="value">${list.filter((p) => p.active).length}</div></div>
      <div class="kpi"><div class="label">À commander</div><div class="value" style="color:${low.length ? 'var(--danger)' : 'inherit'}">${low.length}</div><div class="sub">${low.map((p) => esc(p.name)).slice(0, 3).join(', ')}</div></div>
      <div class="kpi"><div class="label">Valeur du stock</div><div class="value">${fmt.eur(value)}</div><div class="sub">au prix d’achat</div></div>
    </div>
    <div class="table-wrap"><table><thead><tr><th>Produit</th><th>Prix</th><th>Marge</th><th>Stock</th><th style="text-align:right">Ajuster</th></tr></thead><tbody>
    ${list.map((p) => `<tr style="${p.active ? '' : 'opacity:.5'}">
      <td><b>${esc(p.name)}</b><div class="small muted">${esc(p.brand)} · ${esc(p.category)}</div></td>
      <td>${fmt.eur(p.price_cents)}</td>
      <td class="small">${p.cost_cents ? `${Math.round(((p.price_cents - p.cost_cents) / p.price_cents) * 100)} %` : '—'}</td>
      <td><span class="badge ${p.stock <= 0 ? 'badge-danger' : p.stock <= p.low_stock ? 'badge-warn' : 'badge-ok'}">${p.stock} en stock</span></td>
      <td style="text-align:right;white-space:nowrap"><button class="btn btn-ghost btn-sm" data-adj="${p.id}" data-d="-1">−1</button> <button class="btn btn-ghost btn-sm" data-adj="${p.id}" data-d="1">+1</button> <button class="btn btn-ghost btn-sm" data-restock="${p.id}">Réassort</button> <button class="btn btn-ghost btn-sm" data-edit="${p.id}">Modifier</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Ajoutez les produits que vous vendez (shampoings, soins, cires…) pour les encaisser et suivre le stock.</td></tr>'}
    </tbody></table></div>`;
  $('#add-product').onclick = () => productForm();
  view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => productForm(list.find((p) => p.id === Number(b.dataset.edit))); });
  view.querySelectorAll('[data-adj]').forEach((b) => {
    b.onclick = async () => {
      try { await api(P(`/products/${b.dataset.adj}/stock`), { method: 'POST', body: { delta: Number(b.dataset.d), reason: 'correction' } }); renderStock(); } catch (err) { toast(err.message, 'error'); }
    };
  });
  view.querySelectorAll('[data-restock]').forEach((b) => {
    b.onclick = () => modal({
      title: 'Réassort', body: '<div class="field"><label>Quantité reçue</label><input id="rs-qty" type="number" min="1" value="6"></div>',
      actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, { id: 'ok', label: 'Ajouter au stock', cls: 'btn-brand', handler: async (d) => { await api(P(`/products/${b.dataset.restock}/stock`), { method: 'POST', body: { delta: Number($('#rs-qty', d).value), reason: 'réassort' } }); toast('Stock mis à jour.'); renderStock(); } }],
    });
  });
}

function productForm(p = null) {
  modal({
    title: p ? 'Modifier le produit' : 'Nouveau produit',
    body: `<form id="pf">
      <div class="grid-2"><div class="field"><label>Nom</label><input name="name" required value="${esc(p?.name || '')}" placeholder="Shampoing nutritif 250 ml"></div>
        <div class="field"><label>Marque</label><input name="brand" value="${esc(p?.brand || '')}"></div></div>
      <div class="grid-3"><div class="field"><label>Prix de vente (${CURRENCY})</label><input name="price" type="number" min="0" step="0.5" value="${p ? p.price_cents / 100 : ''}"></div>
        <div class="field"><label>Prix d’achat (${CURRENCY})</label><input name="cost" type="number" min="0" step="0.5" value="${p ? p.cost_cents / 100 : ''}"></div>
        <div class="field"><label>Alerte sous</label><input name="low_stock" type="number" min="0" value="${p?.low_stock ?? 3}"></div></div>
      ${p ? '' : '<div class="grid-2"><div class="field"><label>Stock initial</label><input name="stock" type="number" min="0" value="0"></div><div class="field"><label>Catégorie</label><input name="category" value="Produits"></div></div>'}
      ${p ? `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> En vente</label>` : ''}</form>`,
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'save', label: 'Enregistrer', cls: 'btn-brand',
      handler: async (d) => {
        const f = formData($('#pf', d));
        await api(P(p ? `/products/${p.id}` : '/products'), { method: p ? 'PUT' : 'POST', body: { ...f, category: f.category || p?.category, active: p ? !!f.active : true } });
        toast('Produit enregistré.'); renderStock();
      },
    }],
  });
}


// =====================================================================
// Earnings (owner: everyone · collaborator: own) and independents' planning
// =====================================================================
const earnState = { month: null };
async function renderEarnings() {
  earnState.month ||= ctx.today.slice(0, 7);
  const r = await api(P(`/earnings?month=${earnState.month}`));
  const label = new Date(`${earnState.month}-15T12:00:00Z`).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const shift = (n) => { const d = new Date(`${earnState.month}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };
  const explain = (x) => (x.pay_model === 'loyer'
    ? `Garde tout son chiffre d’affaires et paie ${fmt.eur(x.chair_rent_cents)} de loyer de fauteuil.`
    : x.pay_model === 'commission' ? `Reçoit ${x.rate_percent} % des prestations, plus ses pourboires.`
      : `Salaire fixe${x.rate_percent ? `, plus ${x.rate_percent} % des produits vendus` : ''}, plus ses pourboires.`);
  view.innerHTML = `${head(ctx.isStaff ? 'Mes gains' : 'Rémunérations', `<button class="btn btn-ghost btn-sm" data-m="-1">‹</button><b style="text-transform:capitalize">${label}</b><button class="btn btn-ghost btn-sm" data-m="1">›</button>`)}
    ${ctx.isStaff && r.rows[0] ? (() => {
      const x = r.rows[0];
      return `<div class="kpis">
        <div class="kpi"><div class="label">${x.pay_model === 'loyer' ? 'Votre résultat (après loyer)' : 'Vous revient'}</div><div class="value">${fmt.eur(x.collaborator_cents)}</div><div class="sub">${esc(explain(x))}</div></div>
        <div class="kpi"><div class="label">Prestations</div><div class="value">${fmt.eur(x.services_cents)}</div><div class="sub">${x.visits} client(s)</div></div>
        <div class="kpi"><div class="label">Produits vendus</div><div class="value">${fmt.eur(x.products_cents)}</div></div>
        <div class="kpi"><div class="label">Pourboires</div><div class="value">${fmt.eur(x.tips_cents)}</div></div></div>
        <p class="small muted">Calcul indicatif à partir de la caisse. Les charges sociales et impôts ne sont pas inclus.</p>`;
    })() : `<div class="table-wrap"><table><thead><tr><th>Collaborateur</th><th>Modèle</th><th>Clients</th><th>Prestations</th><th>Produits</th><th>Pourboires</th><th>Pour le collaborateur</th><th>Pour le salon</th></tr></thead><tbody>
      ${r.rows.map((x) => `<tr><td><b>${esc(x.name)}</b><div class="small muted">${x.employment === 'independant' ? 'Indépendant·e' : 'Salarié·e'}</div></td>
        <td class="small">${esc(x.pay_label)}${x.pay_model === 'loyer' ? ` · ${fmt.eur(x.chair_rent_cents)}` : x.rate_percent ? ` · ${x.rate_percent} %` : ''}</td>
        <td>${x.visits}</td><td>${fmt.eur(x.services_cents)}</td><td>${fmt.eur(x.products_cents)}</td><td>${fmt.eur(x.tips_cents)}</td>
        <td><b>${fmt.eur(x.collaborator_cents)}</b></td><td><b>${fmt.eur(x.salon_cents)}</b></td></tr>`).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-top:10px">Pour le salon : marge sur les prestations et produits, ou loyer de fauteuil des indépendants. Les salaires fixes ne sont pas déduits. Réglez le modèle de chacun dans <a href="#team">Équipe</a>.</p>`}`;
  view.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { earnState.month = shift(Number(b.dataset.m)); renderEarnings(); }; });
}

async function renderMyPlanning() {
  const me = await api(P('/me'));
  view.innerHTML = `${head('Mes horaires')}
    ${me.can_edit ? '' : '<div class="card" style="margin-bottom:14px;background:var(--surface-2);border:0">Vos horaires et absences sont gérés par le salon. Demandez au gérant pour toute modification.</div>'}
    <div class="two-col">
      <form class="card" id="my-hours"><h3>Mes jours et heures de travail</h3>${hoursEditor(me.hours)}
        ${me.can_edit ? '<button class="btn btn-brand" style="margin-top:12px">Enregistrer</button>' : ''}</form>
      <div class="card"><h3>Mes absences</h3>
        ${me.time_off.map((t) => `<div class="list-item small"><div class="grow"><b>${fmt.date(t.start_at, { day: 'numeric', month: 'short' })} ${t.start_at.slice(11)}</b> → <b>${fmt.date(t.end_at, { day: 'numeric', month: 'short' })} ${t.end_at.slice(11)}</b> <span class="muted">${esc(t.reason)}</span></div>${me.can_edit ? `<button class="btn btn-ghost btn-sm" data-del="${t.id}">Supprimer</button>` : ''}</div>`).join('') || '<p class="muted small">Aucune absence prévue.</p>'}
        ${me.can_edit ? `<hr class="divider"><form id="my-off"><div class="grid-2"><div class="field"><label>Début</label><input type="datetime-local" name="start_at" value="${ctx.today}T09:00" required></div>
          <div class="field"><label>Fin</label><input type="datetime-local" name="end_at" value="${ctx.today}T19:00" required></div></div>
          <div class="field"><label>Motif</label><input name="reason" placeholder="Vacances, formation…"></div><button class="btn btn-ghost">Bloquer cette période</button></form>` : ''}
      </div></div>`;
  if (!me.can_edit) { $$('#my-hours input').forEach((i) => { i.disabled = true; }); return; }
  $('#my-hours').onsubmit = async (e) => { e.preventDefault(); try { await api(P('/me/hours'), { method: 'PUT', body: { hours: readHours(e.target) } }); toast('Horaires enregistrés : votre agenda en ligne est à jour.'); } catch (err) { toast(err.message, 'error'); } };
  $('#my-off').onsubmit = async (e) => { e.preventDefault(); try { await api(P('/me/time-off'), { method: 'POST', body: formData(e.target) }); toast('Période bloquée.'); renderMyPlanning(); } catch (err) { toast(err.message, 'error'); } };
  view.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await api(P(`/me/time-off/${b.dataset.del}`), { method: 'DELETE' }); renderMyPlanning(); }; });
}

// =====================================================================
// Messages (calls & chats handled by the assistant, or by the team)
// =====================================================================
const msgState = { filter: '', open: null, timer: null };
const CONV_STATUS = { open: ['En cours', ''], to_handle: ['À traiter', 'badge-warn'], done: ['Traité', 'badge-ok'] };
const FROM_LABEL = { client: 'Client', assistant: 'Assistant IA', team: 'Équipe' };

async function updateMsgCount() {
  if (ctx.isStaff) return;
  try {
    const r = await api(P('/conversations?status=to_handle'));
    const el = $('#msg-count');
    el.textContent = r.to_handle;
    el.hidden = !r.to_handle;
  } catch { /* badge only */ }
}

async function renderMessages() {
  clearInterval(msgState.timer);
  const q = msgState.filter ? `?status=${msgState.filter}` : '';
  const { conversations, to_handle } = await api(P(`/conversations${q}`));
  view.innerHTML = `${head('Messages', `<div class="seg">${[['', 'Tous'], ['to_handle', `À traiter (${to_handle})`], ['done', 'Traités']].map(([k, l]) => `<button class="btn btn-sm ${msgState.filter === k ? 'btn-brand' : 'btn-ghost'}" data-filter="${k}">${l}</button>`).join(' ')}</div>`)}
    <p class="small muted" style="margin-top:-6px">Appels pris par l’assistant IA et messages du chat de votre site. Répondez vous-même dans le chat : l’IA se retire de la conversation.</p>
    <div class="two-col" style="grid-template-columns:minmax(260px,1fr) 2fr">
      <div class="card" style="padding:8px 16px">${conversations.map((c) => `
        <div class="list-item conv-item ${msgState.open === c.id ? 'active' : ''}" data-conv="${c.id}" style="cursor:pointer">
          <span data-icon-inline="${c.channel === 'phone' ? 'phone' : 'chat'}" class="muted" style="width:18px"></span>
          <div class="grow" style="min-width:0"><div class="row between"><b>${esc(c.customer_name || c.customer_phone || (c.channel === 'phone' ? 'Appel' : 'Visiteur du site'))}</b>${c.unread ? '<span class="badge badge-brand">Nouveau</span>' : ''}</div>
            <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.outcome || c.last)}</div>
            <div class="small muted">${esc(c.updated_at.slice(0, 16).replace('T', ' '))} · <span class="badge ${CONV_STATUS[c.status][1]}">${CONV_STATUS[c.status][0]}</span></div></div>
        </div>`).join('') || '<div class="empty">Aucune conversation pour le moment. Activez l’assistant dans <a href="#assistant">Assistant IA</a>.</div>'}</div>
      <div class="card" id="conv-pane"><div class="empty">Sélectionnez une conversation.</div></div>
    </div>`;
  $$('[data-icon-inline]').forEach((el) => { el.innerHTML = ICONS[el.dataset.iconInline]; });
  view.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { msgState.filter = b.dataset.filter; renderMessages(); }; });
  view.querySelectorAll('[data-conv]').forEach((el) => { el.onclick = () => { msgState.open = Number(el.dataset.conv); openConversation(); }; });
  if (msgState.open && conversations.some((c) => c.id === msgState.open)) openConversation();
  updateMsgCount();
  // Light polling so new chat messages appear without reloading.
  msgState.timer = setInterval(() => { if (location.hash === '#messages' && !document.hidden && !$('#conv-reply')?.value) renderMessages(); else if (location.hash !== '#messages') clearInterval(msgState.timer); }, 20000);
}

async function openConversation() {
  const pane = $('#conv-pane');
  const { conversation: c, messages } = await api(P(`/conversations/${msgState.open}`));
  $$('.conv-item').forEach((el) => el.classList.toggle('active', Number(el.dataset.conv) === c.id));
  pane.innerHTML = `<div class="row between"><div><h3 style="margin:0">${esc(c.customer_name || (c.channel === 'phone' ? 'Appel entrant' : 'Visiteur du site'))}</h3>
      <div class="small muted">${c.channel === 'phone' ? 'Appel téléphonique' : 'Chat du site'}${c.customer_phone ? ` · <a href="tel:${esc(c.customer_phone)}">${esc(c.customer_phone)}</a>` : ''}</div></div>
      <div class="row" style="gap:6px">${c.status !== 'done' ? '<button class="btn btn-ghost btn-sm" id="conv-done">Marquer traité</button>' : '<button class="btn btn-ghost btn-sm" id="conv-reopen">Rouvrir</button>'}
      ${c.human_mode ? '<button class="btn btn-ghost btn-sm" id="conv-ai">Rendre la main à l’IA</button>' : ''}</div></div>
    ${c.outcome ? `<div class="note-box" style="margin:12px 0"><b>Résultat :</b> ${esc(c.outcome)}${c.booking_id ? ' · <a href="#agenda">voir l’agenda</a>' : ''}</div>` : ''}
    <div class="chat-log">${messages.map((m) => `<div class="bubble from-${m.from}"><div class="small muted">${FROM_LABEL[m.from] || m.from}${m.author ? ` · ${esc(m.author)}` : ''} · ${esc((m.at || '').slice(11, 16))}</div>${esc(m.text)}</div>`).join('')}</div>
    ${c.channel === 'chat' ? `<form id="conv-form" class="row" style="flex-wrap:nowrap;margin-top:12px"><input id="conv-reply" placeholder="Votre réponse au client…" autocomplete="off"><button class="btn btn-brand">Envoyer</button></form>` : '<p class="small muted" style="margin-top:12px">Pour un appel, rappelez le client au numéro ci-dessus.</p>'}`;
  const log = $('.chat-log', pane);
  log.scrollTop = log.scrollHeight;
  const patch = async (body) => { await api(P(`/conversations/${c.id}`), { method: 'PATCH', body }); renderMessages(); };
  if ($('#conv-done')) $('#conv-done').onclick = () => patch({ status: 'done' });
  if ($('#conv-reopen')) $('#conv-reopen').onclick = () => patch({ status: 'to_handle' });
  if ($('#conv-ai')) $('#conv-ai').onclick = () => patch({ human_mode: false });
  if ($('#conv-form')) {
    $('#conv-form').onsubmit = async (e) => {
      e.preventDefault();
      const text = $('#conv-reply').value.trim();
      if (!text) return;
      try { await api(P(`/conversations/${c.id}/reply`), { method: 'POST', body: { text } }); renderMessages(); } catch (err) { toast(err.message, 'error'); }
    };
  }
}

// =====================================================================
// AI assistant (phone receptionist + website chat)
// =====================================================================
const simState = { session: null, mode: 'chat', log: [] };

async function renderAssistant() {
  const d = await api(P('/assistant'));
  const s = d.settings;
  const st = d.stats || {};
  view.innerHTML = `${head('Assistant IA')}
    <div class="kpis">
      <div class="kpi"><div class="label">Appels pris (30 j)</div><div class="value">${st.calls || 0}</div></div>
      <div class="kpi"><div class="label">Chats (30 j)</div><div class="value">${st.chats || 0}</div></div>
      <div class="kpi"><div class="label">RDV pris par l’IA</div><div class="value">${st.bookings || 0}</div></div>
      <div class="kpi"><div class="label">Statut</div><div style="margin-top:8px">${d.ai_ready ? '<span class="badge badge-ok"><span class="dot"></span>IA connectée</span>' : '<span class="badge badge-warn">Clé IA manquante</span>'}
        ${d.voice_ready ? '<span class="badge badge-ok">Téléphonie OK</span>' : '<span class="badge">Téléphonie non configurée</span>'}</div></div>
    </div>
    <div class="two-col" style="margin-top:18px">
      <form class="card" id="ai-form">
        <h3>Réglages</h3>
        <label class="check"><input type="checkbox" name="ai_phone_enabled" ${s.ai_phone_enabled ? 'checked' : ''}> Standard téléphonique IA : si personne ne décroche, l’assistant répond</label>
        <label class="check"><input type="checkbox" name="ai_chat_enabled" ${s.ai_chat_enabled ? 'checked' : ''}> Chat IA sur votre site (sinon, les messages arrivent dans « Messages » et vous répondez vous-même)</label>
        <div class="grid-2" style="margin-top:10px">
          <div class="field"><label>Numéro Lumea du salon (Twilio)</label><input name="ai_twilio_number" value="${esc(s.ai_twilio_number)}" placeholder="+41 22 555 00 00"><div class="hint">Le numéro que vos clients appellent (ou vers lequel vous renvoyez votre ligne).</div></div>
          <div class="field"><label>Faire d’abord sonner</label><input name="ai_forward_phone" value="${esc(s.ai_forward_phone)}" placeholder="+41 79 123 45 67"><div class="hint">Votre portable ou fixe. Vide = l’IA répond directement.</div></div>
          <div class="field"><label>L’IA décroche après (secondes)</label><input name="ai_ring_seconds" type="number" min="5" max="60" value="${s.ai_ring_seconds}"></div>
          <div class="field"><label>Délai minimum d’un RDV pris par l’IA (min)</label><input name="ai_min_notice_min" type="number" min="15" max="1440" value="${s.ai_min_notice_min}"><div class="hint">Jamais moins de 15 minutes après l’appel.</div></div>
        </div>
        <div class="field"><label>Ce que l’assistant doit savoir</label><textarea name="ai_instructions" rows="5" placeholder="Parking gratuit derrière le salon. Paiement TWINT accepté. Pas de coloration le samedi. Pour les enfants de moins de 10 ans, coupe enfant uniquement.">${esc(s.ai_instructions)}</textarea>
          <div class="hint">Prestations, prix, équipe et horaires sont déjà connus de l’assistant.</div></div>
        <button class="btn btn-brand">Enregistrer</button>
      </form>
      <div class="stack">
        <div class="card"><h3>Tester l’assistant</h3>
          <p class="small muted">Parlez-lui comme un client. Mode test : aucun rendez-vous n’est réellement créé.</p>
          <div class="row" style="gap:6px;margin-bottom:8px"><button class="btn btn-sm ${simState.mode === 'chat' ? 'btn-brand' : 'btn-ghost'}" data-sim-mode="chat">Chat</button><button class="btn btn-sm ${simState.mode === 'phone' ? 'btn-brand' : 'btn-ghost'}" data-sim-mode="phone">Téléphone</button><div class="grow"></div><button class="btn btn-ghost btn-sm" id="sim-reset">Recommencer</button></div>
          <div class="chat-log" id="sim-log" style="max-height:320px">${simState.log.map((m) => `<div class="bubble from-${m.from}">${esc(m.text)}</div>`).join('') || '<div class="small muted">Ex. : « Bonjour, vous auriez de la place jeudi vers 16 h pour une coupe ? »</div>'}</div>
          <form id="sim-form" class="row" style="flex-wrap:nowrap;margin-top:10px"><input id="sim-text" placeholder="Votre message…" autocomplete="off"><button class="btn btn-brand">Envoyer</button></form>
        </div>
        <div class="card"><h3>Brancher votre ligne (Twilio)</h3>
          <ol class="small" style="padding-left:18px;margin:0">
            <li>Achetez un numéro suisse sur Twilio (≈ 1 CHF/mois) ou renvoyez votre ligne actuelle vers lui en cas de non-réponse.</li>
            <li>Dans Twilio › Phone Numbers › votre numéro › <i>A call comes in</i> : Webhook, POST<br><code class="block" id="wh-voice">${esc(d.webhooks.voice)}</code></li>
            <li><i>Call status changes</i> : <code>${esc(d.webhooks.status)}</code></li>
            <li>Indiquez ce numéro ci-contre et activez le standard IA.</li>
          </ol>
          <p class="small muted" style="margin-bottom:0">L’assistant se présente toujours comme une intelligence artificielle, consulte votre agenda en temps réel, ne réserve jamais dans le passé ni trop tôt, et vous transmet les demandes qu’il ne peut pas traiter.</p>
        </div>
      </div>
    </div>`;
  $('#ai-form').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    f.ai_phone_enabled = !!f.ai_phone_enabled;
    f.ai_chat_enabled = !!f.ai_chat_enabled;
    try { await api(P('/assistant'), { method: 'PUT', body: f }); toast('Assistant enregistré.'); } catch (err) { toast(err.message, 'error'); }
  };
  view.querySelectorAll('[data-sim-mode]').forEach((b) => { b.onclick = () => { simState.mode = b.dataset.simMode; simState.session = null; simState.log = []; renderAssistant(); }; });
  $('#sim-reset').onclick = () => { simState.session = null; simState.log = []; renderAssistant(); };
  $('#sim-form').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#sim-text');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    simState.log.push({ from: 'client', text });
    const log = $('#sim-log');
    log.innerHTML = `${simState.log.map((m) => `<div class="bubble from-${m.from}">${esc(m.text)}</div>`).join('')}<div class="bubble from-assistant typing">…</div>`;
    log.scrollTop = log.scrollHeight;
    try {
      const r = await api(P('/assistant/test'), { method: 'POST', body: { text, session: simState.session, mode: simState.mode } });
      simState.session = r.session;
      simState.log.push({ from: 'assistant', text: r.reply + (r.endCall ? ' 📞 (fin d’appel)' : '') });
    } catch (err) { simState.log.push({ from: 'assistant', text: `Erreur : ${err.message}` }); }
    log.innerHTML = simState.log.map((m) => `<div class="bubble from-${m.from}">${esc(m.text)}</div>`).join('');
    log.scrollTop = log.scrollHeight;
    $('#sim-text').focus();
  };
}

// =====================================================================
// E-mails (Gmail / Outlook, sorted and summarised)
// =====================================================================
const mailState = { category: '', done: false };
const MAIL_CAT = { client: ['Clients', 'badge-brand'], facture: ['Factures', 'badge-warn'], fournisseur: ['Fournisseurs', ''], administration: ['Administration', ''], autre: ['Autres', ''], promo: ['Publicités', ''] };
const PRIO = { haute: '<span class="badge badge-danger">Urgent</span>', normale: '', basse: '' };

async function renderEmails() {
  const q = new URLSearchParams();
  if (mailState.category) q.set('category', mailState.category);
  if (mailState.done) q.set('done', '1');
  const d = await api(P(`/mail?${q}`));
  const count = (c) => d.counts.find((x) => x.category === c)?.n || 0;
  const connectBtns = d.providers.map((p) => `<button class="btn btn-ghost btn-sm" data-connect="${p.id}" ${p.enabled ? '' : 'disabled title="À configurer sur le serveur"'}>Connecter ${esc(p.name)}</button>`).join(' ');
  view.innerHTML = `${head('E-mails', d.accounts.length ? '<button class="btn btn-ghost" id="mail-sync">Actualiser</button> <button class="btn btn-brand" id="mail-digest">Résumé IA</button>' : '')}
    ${d.accounts.length ? '' : `<div class="card center" style="padding:36px">
      <h3>Toute votre boîte mail, triée pour vous</h3>
      <p class="muted" style="max-width:560px;margin:0 auto 16px">Connectez Gmail ou Outlook : chaque e-mail est classé (clients, factures, fournisseurs, administration, publicité), résumé en une phrase avec l’action à faire. Les publicités disparaissent. Accès en lecture seule.</p>
      ${connectBtns}</div>`}
    ${d.accounts.length ? `<div class="row" style="gap:8px;flex-wrap:wrap;margin-bottom:14px">
      ${d.accounts.map((a) => `<span class="badge ${a.status === 'ok' || a.status === 'demo' ? 'badge-ok' : 'badge-warn'}" title="${esc(a.error)}">${esc(a.email)}${a.status === 'reconnect' ? ' · à reconnecter' : ''} <button class="link small" data-unlink="${a.id}" aria-label="Déconnecter" style="margin-left:4px">✕</button></span>`).join('')}
      <span class="grow"></span>${connectBtns}</div>
      <div class="card note-box" id="mail-brief" style="white-space:pre-line" hidden></div>
      <div class="row" style="gap:6px;flex-wrap:wrap;margin:14px 0">
        <button class="btn btn-sm ${!mailState.category ? 'btn-brand' : 'btn-ghost'}" data-cat="">Tout</button>
        ${Object.entries(MAIL_CAT).filter(([k]) => k !== 'promo').map(([k, [l]]) => `<button class="btn btn-sm ${mailState.category === k ? 'btn-brand' : 'btn-ghost'}" data-cat="${k}">${l} (${count(k)})</button>`).join('')}
        <span class="grow"></span><label class="check small"><input type="checkbox" id="mail-done" ${mailState.done ? 'checked' : ''}> Afficher les traités</label>
      </div>
      <div class="card" style="padding:4px 18px">${d.messages.map((m) => `
        <div class="list-item" style="align-items:flex-start">
          <div class="grow" style="min-width:0">
            <div class="row" style="gap:6px;flex-wrap:wrap"><b>${esc(m.from_name || m.from_email)}</b>${PRIO[m.priority] || ''}<span class="badge ${MAIL_CAT[m.category]?.[1] || ''}">${MAIL_CAT[m.category]?.[0] || 'Non trié'}</span><span class="small muted">${esc(m.received_at.replace('T', ' '))}</span></div>
            <div style="margin-top:4px">${esc(m.summary || m.subject)}</div>
            <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.subject)} — ${esc(m.snippet)}</div>
            ${m.action ? `<div class="small" style="margin-top:4px"><b>À faire :</b> ${esc(m.action)}</div>` : ''}
          </div>
          <div class="row" style="gap:6px;flex-wrap:nowrap">${m.category === 'facture' && !m.done ? `<button class="btn btn-ghost btn-sm" data-expense="${m.id}">→ Dépense</button>` : ''}${m.web_link ? `<a class="btn btn-ghost btn-sm" href="${esc(m.web_link)}" target="_blank" rel="noopener">Ouvrir</a>` : ''}
            <button class="btn btn-ghost btn-sm" data-done="${m.id}" data-val="${m.done ? 0 : 1}">${m.done ? 'Rouvrir' : 'Traité'}</button></div>
        </div>`).join('') || '<div class="empty">Rien en attente. 🎉</div>'}</div>` : ''}`;
  view.querySelectorAll('[data-connect]').forEach((b) => {
    b.onclick = async () => { try { location.href = (await api(P(`/mail/connect/${b.dataset.connect}`))).url; } catch (err) { toast(err.message, 'error'); } };
  });
  view.querySelectorAll('[data-cat]').forEach((b) => { b.onclick = () => { mailState.category = b.dataset.cat; renderEmails(); }; });
  view.querySelectorAll('[data-done]').forEach((b) => { b.onclick = async () => { await api(P(`/mail/messages/${b.dataset.done}`), { method: 'PATCH', body: { done: b.dataset.val === '1' } }); renderEmails(); }; });
  view.querySelectorAll('[data-unlink]').forEach((b) => {
    b.onclick = () => modal({
      title: 'Déconnecter cette boîte mail ?', body: '<p>Les e-mails importés seront supprimés de Lumea (rien n’est supprimé dans votre messagerie).</p>',
      actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, { id: 'ok', label: 'Déconnecter', cls: 'btn-danger', handler: async () => { await api(P(`/mail/accounts/${b.dataset.unlink}`), { method: 'DELETE' }); renderEmails(); } }],
    });
  });
  view.querySelectorAll('[data-expense]').forEach((b) => {
    b.onclick = async () => {
      const m = d.messages.find((x) => x.id === Number(b.dataset.expense));
      const acc = await api(P('/accounting'));
      const amount = (/(\d[\d' ]*[.,]\d{2})\s*(?:CHF|Fr)/i.exec(`${m.summary} ${m.snippet}`) || [])[1];
      await expenseForm(acc, { supplier: m.from_name || m.from_email, description: m.subject, amount: amount ? amount.replace(/['\s]/g, '').replace(',', '.') : '', mail_message_id: m.id });
      renderEmails();
    };
  });
  if ($('#mail-done')) $('#mail-done').onchange = (e) => { mailState.done = e.target.checked; renderEmails(); };
  if ($('#mail-sync')) {
    $('#mail-sync').onclick = async (e) => {
      e.target.disabled = true;
      try { const r = await api(P('/mail/sync'), { method: 'POST', body: {} }); toast(`${r.added} nouvel(s) e-mail(s).`); renderEmails(); } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    };
    $('#mail-digest').onclick = async (e) => {
      e.target.disabled = true;
      const box = $('#mail-brief');
      box.hidden = false;
      box.textContent = 'Lecture de vos e-mails…';
      try { box.textContent = (await api(P('/mail/digest'), { method: 'POST', body: {} })).text; } catch (err) { box.textContent = err.message; }
      e.target.disabled = false;
    };
  }
}

// =====================================================================
// Accounting: overview, invoices, expenses, VAT
// =====================================================================
const comptaState = { tab: 'apercu', year: null };
const MONTHS_FR = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const INV_STATUS = { issued: ['Ouverte', 'badge-warn'], paid: ['Payée', 'badge-ok'], cancelled: ['Annulée', ''] };
const EXP_METHOD = { virement: 'Virement', carte: 'Carte', especes: 'Espèces', twint: 'TWINT', prelevement: 'Prélèvement' };

const chfRound = (c) => fmt.eur(Math.round(c / 100) * 100);

async function renderCompta() {
  comptaState.year ||= ctx.today.slice(0, 4);
  const d = await api(P(`/accounting?year=${comptaState.year}`));
  const t = d.report.totals;
  const tabs = [['apercu', 'Vue d’ensemble'], ['factures', 'Factures'], ['depenses', 'Dépenses'], ['reglages', 'Réglages']];
  const years = [0, 1, 2].map((i) => String(Number(ctx.today.slice(0, 4)) - i));
  view.innerHTML = `${head('Comptabilité', `<select id="cp-year" style="width:auto">${years.map((y) => `<option ${y === comptaState.year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      <a class="btn btn-ghost" href="${P(`/export/journal.csv?from=${comptaState.year}-01-01&to=${comptaState.year}-12-31`)}">Export fiduciaire (CSV)</a>`)}
    <div class="kpis">
      <div class="kpi"><div class="label">Chiffre d’affaires</div><div class="value">${chfRound(t.revenue_cents)}</div><div class="sub">${comptaState.year}</div></div>
      <div class="kpi"><div class="label">Dépenses</div><div class="value">${chfRound(t.expenses_cents + t.commissions_cents)}</div><div class="sub">dont commissions ${chfRound(t.commissions_cents)}</div></div>
      <div class="kpi"><div class="label">Résultat</div><div class="value" style="color:${t.result_cents >= 0 ? 'var(--ok)' : 'var(--danger)'}">${chfRound(t.result_cents)}</div><div class="sub">avant impôts</div></div>
      <div class="kpi"><div class="label">${d.report.vat_registered ? 'TVA à payer' : 'TVA'}</div><div class="value">${d.report.vat_registered ? chfRound(t.vat_due_cents) : '—'}</div><div class="sub">${d.report.vat_registered ? `${d.report.vat_rate} %, méthode effective` : 'non assujetti'}</div></div>
      <div class="kpi"><div class="label">Factures ouvertes</div><div class="value">${chfRound(d.report.invoices_open.cents)}</div><div class="sub">${d.report.invoices_open.n} facture(s)${d.report.invoices_open.overdue ? ` · <b style="color:var(--danger)">${d.report.invoices_open.overdue} en retard</b>` : ''}</div></div>
    </div>
    <div class="row" style="gap:6px;margin-bottom:14px">${tabs.map(([k, l]) => `<button class="btn btn-sm ${comptaState.tab === k ? 'btn-brand' : 'btn-ghost'}" data-tab="${k}">${l}</button>`).join('')}</div>
    <div id="cp-body"></div>`;
  $('#cp-year').onchange = (e) => { comptaState.year = e.target.value; renderCompta(); };
  view.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { comptaState.tab = b.dataset.tab; renderCompta(); }; });
  const body = $('#cp-body');
  if (comptaState.tab === 'apercu') comptaOverview(body, d);
  else if (comptaState.tab === 'factures') comptaInvoices(body);
  else if (comptaState.tab === 'depenses') comptaExpenses(body, d);
  else comptaSettings(body, d);
}

function comptaOverview(body, d) {
  const rows = d.report.months;
  const max = Math.max(1, ...rows.map((m) => Math.max(m.revenue_cents, m.expenses_cents + m.commissions_cents)));
  body.innerHTML = `<div class="card"><h3>Mois par mois</h3>
      <div class="row" style="align-items:flex-end;gap:10px;height:160px;margin:10px 0 18px">${rows.map((m) => `
        <div class="grow center" title="${MONTHS_FR[Number(m.month.slice(5)) - 1]} : CA ${fmt.eur(m.revenue_cents)}, résultat ${fmt.eur(m.result_cents)}">
          <div class="row" style="align-items:flex-end;justify-content:center;gap:3px;height:130px">
            <span style="width:12px;border-radius:4px 4px 0 0;background:var(--brand);height:${(m.revenue_cents / max) * 100}%"></span>
            <span style="width:12px;border-radius:4px 4px 0 0;background:var(--accent);opacity:.7;height:${((m.expenses_cents + m.commissions_cents) / max) * 100}%"></span></div>
          <div class="small muted">${MONTHS_FR[Number(m.month.slice(5)) - 1]}</div></div>`).join('')}</div>
      <div class="small muted" style="margin-bottom:10px"><span style="color:var(--brand)">■</span> Chiffre d’affaires · <span style="color:var(--accent)">■</span> Dépenses et commissions</div>
      <div class="table-wrap" style="border:0"><table><thead><tr><th>Mois</th><th>Encaissé caisse</th><th>Part indépendants</th><th>Factures</th><th>CA salon</th><th>Commissions</th><th>Dépenses</th><th>Résultat</th>${d.report.vat_registered ? '<th>TVA due</th>' : ''}</tr></thead><tbody>
      ${rows.slice().reverse().map((m) => `<tr><td>${MONTHS_FR[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}</td><td>${fmt.eur(m.cash_cents)}</td><td>${m.independents_cents > 0 ? `−${fmt.eur(m.independents_cents)}` : m.independents_cents < 0 ? `+${fmt.eur(-m.independents_cents)}` : '—'}</td><td>${fmt.eur(m.invoiced_cents)}</td>
        <td><b>${fmt.eur(m.revenue_cents)}</b></td><td>${fmt.eur(m.commissions_cents)}</td><td>${fmt.eur(m.expenses_cents)}</td><td><b style="color:${m.result_cents >= 0 ? 'var(--ok)' : 'var(--danger)'}">${fmt.eur(m.result_cents)}</b></td>
        ${d.report.vat_registered ? `<td title="Collectée ${fmt.eur(m.vat.collected_cents)} − déductible ${fmt.eur(m.vat.deductible_cents)}">${fmt.eur(m.vat.due_cents)}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>
      <p class="small muted" style="margin-bottom:0">Encaissé caisse = ventes hors pourboires et hors paiements par carte cadeau (déjà comptés à la vente de la carte). Part indépendants = leurs ventes encaissées par le salon, moins la location de fauteuil. Chiffres de gestion, à valider par votre fiduciaire.</p></div>`;
}

async function comptaInvoices(body) {
  const list = await api(P('/invoices'));
  body.innerHTML = `<div class="card"><div class="row between"><h3 style="margin:0">Factures</h3><button class="btn btn-brand btn-sm" id="inv-new">+ Nouvelle facture</button></div>
    <div class="table-wrap" style="border:0;margin-top:10px"><table><thead><tr><th>N°</th><th>Client</th><th>Date</th><th>Échéance</th><th>Montant</th><th>Statut</th><th></th></tr></thead><tbody>
    ${list.map((i) => `<tr><td><a href="/facture/${esc(i.token)}" target="_blank" rel="noopener">${esc(i.number)}</a></td><td>${esc(i.customer_name)}</td><td class="small">${esc(i.issued_on)}</td>
      <td class="small" style="${i.status === 'issued' && i.due_on < ctx.today ? 'color:var(--danger);font-weight:600' : ''}">${i.status === 'issued' ? esc(i.due_on) : '—'}</td><td>${fmt.eur(i.total_cents)}</td>
      <td><span class="badge ${INV_STATUS[i.status][1]}">${INV_STATUS[i.status][0]}</span></td>
      <td class="row" style="gap:4px;flex-wrap:nowrap;justify-content:flex-end">${i.status === 'issued' ? `<button class="btn btn-ghost btn-sm" data-paid="${i.id}">Payée</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-send="${i.id}" data-email="${esc(i.customer_email)}">Envoyer</button>
        ${i.status !== 'cancelled' ? `<button class="btn btn-ghost btn-sm" data-cancel="${i.id}" title="Annuler la facture">✕</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Aucune facture. Créez-en une, ou depuis la Caisse pour une vente.</td></tr>'}
    </tbody></table></div><p class="small muted" style="margin-bottom:0">Numérotation continue par année (obligatoire). Une facture émise ne se supprime pas : on l’annule.</p></div>`;
  const patch = async (id, status) => { await api(P(`/invoices/${id}`), { method: 'PATCH', body: { status } }); renderCompta(); };
  body.querySelectorAll('[data-paid]').forEach((b) => { b.onclick = () => patch(b.dataset.paid, 'paid'); });
  body.querySelectorAll('[data-cancel]').forEach((b) => { b.onclick = () => modal({ title: 'Annuler cette facture ?', body: '<p>Elle restera dans la liste avec le statut « Annulée ».</p>', actions: [{ id: 'close', label: 'Retour', cls: 'btn-ghost' }, { id: 'ok', label: 'Annuler la facture', cls: 'btn-danger', handler: () => patch(b.dataset.cancel, 'cancelled') }] }); });
  body.querySelectorAll('[data-send]').forEach((b) => {
    b.onclick = () => modal({
      title: 'Envoyer la facture', body: `<div class="field"><label>E-mail du client</label><input id="inv-mail" type="email" value="${esc(b.dataset.email)}"></div>`,
      actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, { id: 'ok', label: 'Envoyer', cls: 'btn-brand', handler: async (dlg) => { await api(P(`/invoices/${b.dataset.send}/send`), { method: 'POST', body: { email: $('#inv-mail', dlg).value } }); toast('Facture envoyée.'); } }],
    });
  });
  $('#inv-new').onclick = () => invoiceForm();
}

function invoiceForm() {
  const line = (l = {}) => `<div class="row inv-line" style="gap:6px;flex-wrap:nowrap;margin-bottom:6px"><input class="grow" name="label" placeholder="Désignation" value="${esc(l.label || '')}"><input name="qty" type="number" min="1" value="${l.qty || 1}" style="width:70px"><input name="unit" placeholder="Prix TTC" value="${l.unit || ''}" style="width:110px" inputmode="decimal"></div>`;
  modal({
    title: 'Nouvelle facture',
    body: `<div class="grid-2"><div class="field"><label>Client</label><input id="inv-name" list="inv-clients" placeholder="Nom ou société"></div><div class="field"><label>E-mail</label><input id="inv-email" type="email"></div></div>
      <datalist id="inv-clients"></datalist>
      <div class="field"><label>Adresse</label><textarea id="inv-addr" rows="2"></textarea></div>
      <label>Lignes</label><div id="inv-lines">${line()}</div><button type="button" class="link small" id="inv-add">+ Ajouter une ligne</button>
      <div class="grid-2" style="margin-top:10px"><div class="field"><label>Payable sous (jours)</label><input id="inv-due" type="number" min="0" max="90" value="30"></div><div class="field"><label>Note</label><input id="inv-note" placeholder="Merci pour votre confiance"></div></div>`,
    onOpen: (dlg) => {
      $('#inv-add', dlg).onclick = () => $('#inv-lines', dlg).insertAdjacentHTML('beforeend', line());
      api(P('/clients')).then((r) => { const list = Array.isArray(r) ? r : r.clients || []; $('#inv-clients', dlg).innerHTML = list.slice(0, 300).map((c) => `<option value="${esc(c.name)}">`).join(''); dlg._clients = list; }).catch(() => {});
      $('#inv-name', dlg).onchange = (e) => { const c = (dlg._clients || []).find((x) => x.name === e.target.value); if (c && c.email) $('#inv-email', dlg).value = c.email; };
    },
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'ok', label: 'Créer la facture', cls: 'btn-brand',
      handler: async (dlg) => {
        const items = $$('.inv-line', dlg).map((r) => ({ label: $('[name=label]', r).value, qty: $('[name=qty]', r).value, unit: $('[name=unit]', r).value })).filter((it) => it.label.trim());
        const inv = await api(P('/invoices'), { method: 'POST', body: { customer_name: $('#inv-name', dlg).value, customer_email: $('#inv-email', dlg).value, customer_address: $('#inv-addr', dlg).value, items, due_days: $('#inv-due', dlg).value, note: $('#inv-note', dlg).value } });
        toast(`Facture ${inv.number} créée.`);
        window.open(`/facture/${inv.token}`, '_blank', 'noopener');
        renderCompta();
      },
    }],
  });
}

async function comptaExpenses(body, d) {
  const list = await api(P(`/expenses?year=${comptaState.year}`));
  const byCat = {};
  for (const e of list) byCat[e.category] = (byCat[e.category] || 0) + e.amount_cents;
  const total = list.reduce((a, e) => a + e.amount_cents, 0);
  body.innerHTML = `<div class="two-col" style="grid-template-columns:2fr 1fr">
    <div class="card"><div class="row between"><h3 style="margin:0">Dépenses ${comptaState.year}</h3><button class="btn btn-brand btn-sm" id="exp-new">+ Ajouter une dépense</button></div>
      <div class="table-wrap" style="border:0;margin-top:10px"><table><thead><tr><th>Date</th><th>Catégorie</th><th>Fournisseur</th><th>Montant TTC</th><th>TVA</th><th></th></tr></thead><tbody>
      ${list.map((e) => `<tr><td class="small">${esc(e.day)}</td><td>${esc(d.categories[e.category] || e.category)}</td><td>${esc(e.supplier)}<div class="small muted">${esc(e.description)}</div></td><td>${fmt.eur(e.amount_cents)}</td><td class="small">${e.vat_cents ? fmt.eur(e.vat_cents) : '—'}</td>
        <td><button class="btn btn-ghost btn-sm" data-del="${e.id}" aria-label="Supprimer">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Aucune dépense. Ajoutez loyer, produits, assurances… ou directement depuis vos e-mails de factures.</td></tr>'}
      </tbody></table></div></div>
    <div class="card"><h3>Par catégorie</h3>${Object.entries(byCat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<div class="row small" style="gap:8px;margin:6px 0"><span style="width:130px">${esc(d.categories[k] || k)}</span><div class="hbar grow" style="margin:0"><span style="--c:var(--accent);width:${(v / Math.max(1, total)) * 100}%"></span></div><span style="width:90px;text-align:right">${fmt.eur(v)}</span></div>`).join('') || '<p class="small muted">—</p>'}</div></div>`;
  $('#exp-new').onclick = () => expenseForm(d);
  body.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => { await api(P(`/expenses/${b.dataset.del}`), { method: 'DELETE' }); renderCompta(); }; });
}

function expenseForm(d, preset = {}) {
  return modal({
    title: 'Nouvelle dépense',
    body: `<div class="grid-2"><div class="field"><label>Date</label><input id="ex-day" type="date" value="${esc(preset.day || ctx.today)}"></div>
      <div class="field"><label>Catégorie</label><select id="ex-cat">${Object.entries(d.categories).map(([k, l]) => `<option value="${k}" ${k === (preset.category || 'produits') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <div class="field"><label>Fournisseur</label><input id="ex-sup" value="${esc(preset.supplier || '')}"></div>
      <div class="field"><label>Montant TTC (${CURRENCY})</label><input id="ex-amt" inputmode="decimal" value="${esc(preset.amount || '')}" required></div>
      <div class="field"><label>TVA récupérable</label><input id="ex-vat" inputmode="decimal" placeholder="${d.settings.vat_registered ? `auto ${d.settings.vat_rate} %` : '0'}"></div>
      <div class="field"><label>Paiement</label><select id="ex-meth">${d.methods.map((m) => `<option value="${m}">${EXP_METHOD[m]}</option>`).join('')}</select></div></div>
      <div class="field"><label>Description</label><input id="ex-desc" value="${esc(preset.description || '')}"></div>`,
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'ok', label: 'Enregistrer', cls: 'btn-brand',
      handler: async (dlg) => {
        await api(P('/expenses'), { method: 'POST', body: { day: $('#ex-day', dlg).value, category: $('#ex-cat', dlg).value, supplier: $('#ex-sup', dlg).value, amount: $('#ex-amt', dlg).value, vat: $('#ex-vat', dlg).value, method: $('#ex-meth', dlg).value, description: $('#ex-desc', dlg).value, mail_message_id: preset.mail_message_id } });
        toast('Dépense enregistrée.');
        if (location.hash === '#compta') renderCompta();
      },
    }],
  });
}

function comptaSettings(body, d) {
  const s = d.settings;
  body.innerHTML = `<form class="card" id="cp-set" style="max-width:720px"><h3>Informations légales & TVA</h3>
    <div class="grid-2"><div class="field"><label>Raison sociale</label><input name="legal_name" value="${esc(s.legal_name)}" placeholder="Salon Exemple Sàrl"></div>
      <div class="field"><label>IBAN (pour les factures)</label><input name="iban" value="${esc(s.iban)}" placeholder="CH93 0076 2011 6238 5295 7"></div></div>
    <label class="check"><input type="checkbox" name="vat_registered" ${s.vat_registered ? 'checked' : ''}> Assujetti à la TVA (obligatoire dès 100 000 CHF de chiffre d’affaires annuel)</label>
    <div class="grid-2"><div class="field"><label>N° TVA</label><input name="vat_number" value="${esc(s.vat_number)}" placeholder="CHE-123.456.789 TVA"></div>
      <div class="field"><label>Taux (%)</label><input name="vat_rate" inputmode="decimal" value="${s.vat_rate}"><div class="hint">Taux normal suisse : 8.1 %</div></div></div>
    <div class="field"><label>Pied de facture</label><input name="invoice_footer" value="${esc(s.invoice_footer)}" placeholder="Merci de votre confiance. Conditions : paiement à 30 jours."></div>
    <button class="btn btn-brand">Enregistrer</button></form>`;
  $('#cp-set').onsubmit = async (e) => {
    e.preventDefault();
    const f = formData(e.target);
    f.vat_registered = !!f.vat_registered;
    try { await api(P('/accounting/settings'), { method: 'PUT', body: f }); toast('Réglages enregistrés.'); renderCompta(); } catch (err) { toast(err.message, 'error'); }
  };
}

// =====================================================================
// Router
// =====================================================================
const ROUTES = {
  dashboard: renderDashboard, agenda: renderAgenda, clients: () => renderClients(), services: renderServices,
  team: renderTeam, reviews: renderReviews, automations: renderAutomations, settings: renderSettings, billing: renderBilling, site: renderSiteEditor, caisse: renderTill, stock: renderStock, messages: renderMessages, assistant: renderAssistant, emails: renderEmails, compta: renderCompta, gains: renderEarnings, planning: renderMyPlanning,
};

async function route() {
  let name = location.hash.slice(1) || (ctx.isStaff ? 'agenda' : 'dashboard');
  if (ctx.isStaff && !STAFF_ROUTES.includes(name)) name = 'agenda';
  const fn = ROUTES[name] || renderDashboard;
  $$('[data-route]').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  $('#sidebar').classList.remove('open');
  $('#mobile-title').textContent = $(`[data-route="${name}"]`)?.textContent || 'Lumea Pro';
  try {
    await fn();
  } catch (err) {
    view.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
  }
}

(async function boot() {
  const me = await api('/api/auth/me');
  if (!me.user || (!['pro', 'staff'].includes(me.user.role) && !(me.user.role === 'admin' && adminSalon))) {
    location.href = me.user?.role === 'admin' ? '/admin' : '/connexion?next=/app';
    return;
  }
  $('#who').innerHTML = `<b style="color:#fff">${esc(me.user.name)}</b><div>${esc(me.user.email)}</div>`;
  ctx.isStaff = me.user.role === 'staff';
  if (ctx.isStaff) {
    // Employee access: own agenda and client file only.
    $$('[data-route]').forEach((a) => { if (!STAFF_ROUTES.includes(a.dataset.route)) a.remove(); });
    $$('[data-staff-only]').forEach((a) => { a.hidden = false; });
    $('[data-route="gains"]').lastChild.textContent = 'Mes gains';
    if (!location.hash) location.hash = '#agenda';
  }
  try {
    await refreshCtx();
  } catch (err) {
    view.innerHTML = `<div class="card empty">${esc(err.message)}</div>`;
    return;
  }
  ctx.today = (await api('/api/health')).now.slice(0, 10);
  $('#public-link').href = `/salon.html?s=${encodeURIComponent(ctx.salon.slug)}`;
  addEventListener('hashchange', route);
  route();
  updateMsgCount();
  setInterval(updateMsgCount, 60000);
  // Back from the Gmail / Outlook consent screen.
  const qs = new URLSearchParams(location.search);
  if (qs.get('mail') === 'ok') toast('Boîte mail connectée.');
  if (qs.get('mail_error')) toast(qs.get('mail_error'), 'error');
  if (qs.has('mail') || qs.has('mail_error')) history.replaceState(null, '', `/app${adminSalon ? `?salon=${adminSalon}` : ''}${location.hash}`);
})();
