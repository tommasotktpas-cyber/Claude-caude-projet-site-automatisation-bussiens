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

async function refreshCtx() {
  const [s, staff, services] = await Promise.all([api(P('/salon')), api(P('/staff')), api(P('/services'))]);
  ctx.salon = s.salon;
  ctx.salonFull = s;
  ctx.staff = staff;
  ctx.services = services;
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
    ${trialDays !== null ? `<div class="card" style="margin-bottom:16px;background:var(--brand-soft);border-color:transparent"><div class="row between"><span>Essai gratuit : <b>${trialDays} jour${trialDays > 1 ? 's' : ''} restant${trialDays > 1 ? 's' : ''}</b>. Aucune carte requise jusque-là.</span><a class="btn btn-sm btn-brand" href="#billing">Choisir une formule</a></div></div>` : ''}
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
        <b>${b.start_at.slice(11, 16)} · ${esc(b.client_name)}</b>${esc(b.service_name)}${b.source !== 'pro' ? ' <span title="Réservé en ligne">🌐</span>' : ''}${b.deposit_cents ? ' 💳' : ''}</div>`;
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
      { id: 'done', label: `Encaisser ${fmt.eur(b.price_cents - b.paid_cents)}`, cls: 'btn-ok', handler: patch({ status: 'completed' }, 'Rendez-vous terminé et encaissé.') },
    );
  } else if (b.status !== 'cancelled') {
    actions.push({ id: 'reopen', label: 'Repasser en confirmé', cls: 'btn-ghost', handler: patch({ status: 'confirmed' }, 'Statut mis à jour.') });
  }
  actions.push({ id: 'save', label: 'Enregistrer la note', cls: '', handler: async (d) => { await patch({ notes: $('#bd-notes', d).value }, 'Note enregistrée.')(); } });

  modal({
    title: `${b.client_name}`,
    body: `
      <div class="row" style="margin-bottom:12px"><span class="badge ${st.cls}">${st.label}</span><span class="badge">${{ online: 'Réservé en ligne', widget: 'Via widget site', pro: 'Saisi au salon' }[b.source]}</span>${b.deposit_cents ? `<span class="badge badge-ok">Acompte ${fmt.eur(b.deposit_cents)}</span>` : ''}</div>
      <div class="summary">
        <div><span class="muted">Prestation</span><b>${esc(b.service_name)}</b></div>
        <div><span class="muted">Quand</span><span>${fmt.dateTime(b.start_at)} – ${fmt.time(b.end_at)}</span></div>
        <div><span class="muted">Avec</span><span>${esc(b.staff_name)}</span></div>
        <div><span class="muted">Prix</span><b>${fmt.eur(b.price_cents)}</b></div>
        <div><span class="muted">Téléphone</span>${b.client_phone ? `<a href="tel:${esc(b.client_phone.replace(/\s/g, ''))}">${esc(b.client_phone)}</a>` : '—'}</div>
        <div><span class="muted">E-mail</span>${realEmail ? `<a href="mailto:${esc(b.client_email)}">${esc(b.client_email)}</a>` : '—'}</div>
      </div>
      <div class="field" style="margin-top:14px"><label for="bd-notes">Note</label><textarea id="bd-notes">${esc(b.notes)}</textarea></div>
      <button class="link small" id="bd-client">Voir la fiche client →</button>`,
    actions,
    onOpen: (d) => { $('#bd-client', d).onclick = () => { d.close(); d.remove(); clientDetail(b.client_id); }; },
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
    view.innerHTML = `${head('Clients', `<a class="btn btn-ghost" href="${P('/export/clients.csv')}">Exporter CSV</a>`)}
      <div class="card" style="padding:14px;margin-bottom:14px"><input id="client-q" placeholder="Rechercher par nom, e-mail ou téléphone…" value="${esc(q)}"></div>
      <div class="table-wrap"><table><thead><tr><th>Client</th><th>Contact</th><th>Visites</th><th>Dépensé</th><th>Absences</th><th>Dernier RDV</th></tr></thead><tbody id="client-rows"></tbody></table></div>`;
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
      <div class="field"><label for="cd-notes">Fiche technique / notes privées</label><textarea id="cd-notes" placeholder="Couleur, préférences, allergies…">${esc(c.notes)}</textarea></div>
      <h4>Historique</h4>
      ${c.history.map((h) => `<div class="list-item small"><div class="grow"><b>${esc(h.service_name)}</b> · ${esc(h.staff_name)}<div class="muted">${fmt.dateTime(h.start_at)}</div></div><span>${fmt.eur(h.price_cents)}</span><span class="badge ${STATUS[h.status].cls}">${STATUS[h.status].label}</span></div>`).join('') || '<p class="muted">Aucun rendez-vous.</p>'}`,
    actions: [
      { id: 'close', label: 'Fermer', cls: 'btn-ghost' },
      { id: 'save', label: 'Enregistrer', cls: 'btn-brand', handler: async (d) => { await api(P(`/clients/${id}`), { method: 'PUT', body: { notes: $('#cd-notes', d).value } }); toast('Fiche mise à jour.'); } },
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
        <div class="field"><label>Prix (€)</label><input name="price" type="number" min="0" step="0.5" value="${s ? s.price_cents / 100 : ''}"></div>
        <div class="field"><label>Catégorie</label><input name="category" list="cats" value="${esc(s?.category || 'Prestations')}"><datalist id="cats">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</datalist></div>
      </div>
      <div class="field"><label>Description <span class="muted">(facultatif)</span></label><input name="description" value="${esc(s?.description || '')}"></div>
      <label class="check"><input type="checkbox" name="active" ${!s || s.active ? 'checked' : ''}> Réservable en ligne</label></form>`,
    actions: [{ id: 'close', label: 'Annuler', cls: 'btn-ghost' }, {
      id: 'save', label: 'Enregistrer', cls: 'btn-brand',
      handler: async (d) => {
        const f = formData($('#sf', d));
        const body = { ...f, active: !!f.active };
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
        <div class="small muted" style="margin-top:12px">${[1, 2, 3, 4, 5, 6, 0].map((wd) => { const h = s.hours.filter((x) => x.weekday === wd); return h.length ? `${WEEKDAYS[wd].slice(0, 3)}. ${h[0].start}–${h[h.length - 1].end}` : ''; }).filter(Boolean).join(' · ') || 'Aucun horaire'}</div>
        <div class="small" style="margin-top:8px">${s.service_ids.length} prestation(s) · ${s.time_off.length} absence(s) prévue(s)</div>
        <div class="row" style="margin-top:14px"><button class="btn btn-ghost btn-sm" data-edit="${s.id}">Modifier</button><button class="btn btn-ghost btn-sm" data-off="${s.id}">Absences</button></div>
      </div>`).join('')}</div>`;
  $('#add-staff').onclick = () => staffForm();
  view.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => staffForm(staffById(Number(b.dataset.edit))); });
  view.querySelectorAll('[data-off]').forEach((b) => { b.onclick = () => timeOffForm(staffById(Number(b.dataset.off))); });
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
        };
        if (s) body.active = form.active.checked;
        await api(P(s ? `/staff/${s.id}` : '/staff'), { method: s ? 'PUT' : 'POST', body });
        toast('Équipe mise à jour.');
        renderTeam();
      },
    }],
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
  const KIND = { confirmation: 'Confirmation', reminder: 'Rappel J-1', rescheduled: 'Déplacement', cancelled: 'Annulation', review: 'Demande d’avis', new_booking_pro: 'Alerte salon', waitlist: 'Liste d’attente' };
  const flows = [
    ['Confirmation instantanée', 'E-mail (+ SMS) au client dès la réservation, avec lien pour gérer et fichier agenda.'],
    ['Rappel 24 h avant', 'Réduit les absences de 60 à 80 %. Lien de déplacement en 1 clic inclus.'],
    ['Demande d’avis', 'Envoyée 2 h après le rendez-vous. Seuls les clients venus peuvent noter.'],
    ['Liste d’attente', 'Dès qu’un créneau se libère, les clients inscrits pour ce jour sont prévenus.'],
    ['Alerte nouvelle réservation', 'Vous êtes notifié à chaque réservation en ligne.'],
    ['Fidélité', `1 point par euro crédité au client à l’encaissement${ctx.salon.loyalty_enabled ? '' : ' (désactivé dans Paramètres)'}.`],
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
        <label class="check"><input type="checkbox" name="loyalty_enabled" ${s.loyalty_enabled ? 'checked' : ''}> Programme de fidélité (1 pt / €)</label>
        <label class="check"><input type="checkbox" name="published" ${s.published ? 'checked' : ''}> Page visible sur la marketplace Lumea</label>
        <button class="btn btn-brand" style="margin-top:12px">Enregistrer</button>
      </form>
      <div class="stack">
        <form class="card" id="hours-form"><h3>Horaires d’ouverture</h3>${hoursEditor(ctx.salonFull.hours, 'open', 'close')}<button class="btn btn-brand" style="margin-top:12px">Enregistrer les horaires</button></form>
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
    try { await api(P('/salon'), { method: 'PUT', body: f }); toast('Paramètres enregistrés.'); await refreshCtx(); } catch (err) { toast(err.message, 'error'); }
  };
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
    <p class="small muted" style="margin-top:14px">Facturation mensuelle, résiliable à tout moment. Modèles de site premium : gérés dans <a href="#site">Mon site</a>. Le paiement par carte (Stripe) s’active en production — voir README.</p>`;
  view.querySelectorAll('[data-plan]').forEach((b) => {
    b.onclick = async () => {
      await api(P('/plan'), { method: 'POST', body: { plan: b.dataset.plan } });
      toast('Formule mise à jour.');
      renderBilling();
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
      { id: 'premium', label: 'Passer Premium', cls: 'btn-ghost', handler: async () => { await api(P('/plan'), { method: 'POST', body: { plan: 'premium' } }); toast('Formule Premium activée : tous les modèles sont inclus.'); setTimeout(saveSite, 50); } },
      { id: 'monthly', label: `Louer ${pricing.monthly} ${currency}/mois`, cls: 'btn-ghost', handler: () => buyLicense(t.id, 'monthly') },
      { id: 'once', label: `Acheter ${pricing.once} ${currency}`, cls: 'btn-brand', handler: () => buyLicense(t.id, 'once') },
    ],
  });
}

async function buyLicense(template, billing) {
  await api(P('/site/licenses'), { method: 'POST', body: { template, billing } });
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
      <h4 style="margin-top:0">Site sur mesure par notre équipe</h4>
      <p class="small muted">Décrivez votre univers (ambiance, couleurs, sites que vous aimez, photos disponibles). Un designer prépare votre site personnalisé.</p>
      <textarea id="design-brief" placeholder="Ex. : ambiance minérale, beige et noir, photos de l’équipe, mise en avant des balayages…" ${locked ? 'disabled' : ''}></textarea>
      <button class="btn btn-ghost" id="send-brief" style="margin-top:10px" ${locked ? 'disabled' : ''}>Envoyer ma demande</button>
      ${data.design_requests.map((r) => `<div class="list-item small"><div class="grow">${esc(r.brief.slice(0, 120))}${r.admin_note ? `<div class="muted">Réponse : ${esc(r.admin_note)}</div>` : ''}</div><span class="badge ${r.status === 'livre' ? 'badge-ok' : r.status === 'en_cours' ? 'badge-brand' : ''}">${{ nouveau: 'Reçue', en_cours: 'En cours', livre: 'Livrée' }[r.status]}</span></div>`).join('')}
    </div>`;
    $('#go-premium')?.addEventListener('click', async () => { await api(P('/plan'), { method: 'POST', body: { plan: 'premium' } }); toast('Formule Premium activée.'); renderSiteEditor(); });
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
// Router
// =====================================================================
const ROUTES = {
  dashboard: renderDashboard, agenda: renderAgenda, clients: () => renderClients(), services: renderServices,
  team: renderTeam, reviews: renderReviews, automations: renderAutomations, settings: renderSettings, billing: renderBilling, site: renderSiteEditor,
};

async function route() {
  const name = location.hash.slice(1) || 'dashboard';
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
  if (!me.user || (me.user.role !== 'pro' && !(me.user.role === 'admin' && adminSalon))) {
    location.href = me.user?.role === 'admin' ? '/admin' : '/connexion?next=/app';
    return;
  }
  $('#who').innerHTML = `<b style="color:#fff">${esc(me.user.name)}</b><div>${esc(me.user.email)}</div>`;
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
})();
