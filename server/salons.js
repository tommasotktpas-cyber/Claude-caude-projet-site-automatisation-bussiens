'use strict';
const { one, run } = require('./db');
const T = require('./time');
const { randomToken } = require('./auth');

const CATEGORIES = ['coiffure', 'barbier', 'esthetique', 'ongles', 'spa', 'massage'];
const TRIAL_DAYS = 30;

function slugify(name) {
  const base = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'salon';
  let slug = base;
  for (let i = 2; one('SELECT id FROM salons WHERE slug = ?', slug); i++) slug = `${base}-${i}`;
  return slug;
}

const DEFAULT_HOURS = [2, 3, 4, 5, 6].map((wd) => ({ weekday: wd, open: '09:00', close: '19:00' }));

/** Creates a salon with sensible defaults: opening hours, the owner as first staff member, starter services. */
function createSalon(ownerId, data) {
  const category = CATEGORIES.includes(data.category) ? data.category : 'coiffure';
  const salonId = Number(run(
    `INSERT INTO salons (owner_id, slug, name, category, description, address, city, zip, phone, email, cover_url, accent,
       trial_ends_at, deposit_percent, ical_token)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ownerId, slugify(data.name), data.name, category, data.description || '', data.address || '', data.city || '',
    data.zip || '', data.phone || '', data.email || '', data.cover_url || '', data.accent || '#7c3aed',
    T.addDays(T.now().date, TRIAL_DAYS), data.deposit_percent || 0, randomToken(),
  ).lastInsertRowid);

  for (const h of data.hours || DEFAULT_HOURS) {
    run('INSERT INTO opening_hours (salon_id, weekday, open, close) VALUES (?,?,?,?)', salonId, h.weekday, h.open, h.close);
  }

  const services = data.services || [
    { name: 'Prestation découverte', category: 'Prestations', duration_min: 30, price_cents: 3000 },
  ];
  const serviceIds = services.map((s, i) => Number(run(
    'INSERT INTO services (salon_id, name, category, description, duration_min, price_cents, position) VALUES (?,?,?,?,?,?,?)',
    salonId, s.name, s.category || 'Prestations', s.description || '', s.duration_min, s.price_cents, i,
  ).lastInsertRowid));

  const staff = data.staff || [{ name: data.owner_name || 'Gérant(e)', title: 'Fondateur·rice' }];
  const palette = ['#7c3aed', '#0ea5e9', '#f97316', '#10b981', '#e11d48', '#eab308'];
  staff.forEach((p, i) => {
    const staffId = Number(run('INSERT INTO staff (salon_id, name, title, color) VALUES (?,?,?,?)',
      salonId, p.name, p.title || '', p.color || palette[i % palette.length]).lastInsertRowid);
    for (const h of p.hours || data.hours || DEFAULT_HOURS) {
      run('INSERT INTO staff_hours (staff_id, weekday, start, end) VALUES (?,?,?,?)', staffId, h.weekday, h.open ?? h.start, h.close ?? h.end);
    }
    const offered = p.services ? p.services.map((idx) => serviceIds[idx]) : serviceIds;
    for (const sid of offered) run('INSERT INTO staff_services (staff_id, service_id) VALUES (?,?)', staffId, sid);
  });
  return one('SELECT * FROM salons WHERE id = ?', salonId);
}

module.exports = { createSalon, slugify, CATEGORIES };
