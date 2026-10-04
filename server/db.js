'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lumea.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

// Migration v1 -> v2: plans starter/pro/business became essentiel/premium (CHECK constraint must be rebuilt).
{
  const legacy = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'salons'").get();
  if (legacy && legacy.sql.includes("'starter'")) {
    const cols = db.prepare('PRAGMA table_info(salons)').all().map((c) => c.name);
    const select = cols.map((c) => (c === 'plan'
      ? "CASE WHEN plan = 'business' THEN 'premium' WHEN plan IN ('starter','pro') THEN 'essentiel' ELSE plan END"
      : `"${c}"`)).join(', ');
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN');
    try {
      // Build-copy-swap (renaming the old table first would rewrite other tables' foreign keys).
      db.exec(legacy.sql
        .replace(/CREATE TABLE (IF NOT EXISTS )?"?salons"?/, 'CREATE TABLE salons_v2')
        .replace("'trial','starter','pro','business'", "'trial','essentiel','premium'"));
      db.exec(`INSERT INTO salons_v2 (${cols.map((c) => `"${c}"`).join(', ')}) SELECT ${select} FROM salons`);
      db.exec('DROP TABLE salons');
      db.exec('ALTER TABLE salons_v2 RENAME TO salons');
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Migration v2 : contrôle des clés étrangères échoué.');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON');
    }
  }
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('client','pro','admin')),
  loyalty_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS salons (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'coiffure',
  description TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  cover_url TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '#7c3aed',
  plan TEXT NOT NULL DEFAULT 'trial' CHECK (plan IN ('trial','essentiel','premium')),
  trial_ends_at TEXT,
  deposit_percent INTEGER NOT NULL DEFAULT 0,
  cancel_hours INTEGER NOT NULL DEFAULT 24,
  buffer_min INTEGER NOT NULL DEFAULT 0,
  slot_step INTEGER NOT NULL DEFAULT 15,
  min_notice_min INTEGER NOT NULL DEFAULT 60,
  max_days_ahead INTEGER NOT NULL DEFAULT 60,
  loyalty_enabled INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 1,
  ical_token TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opening_hours (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  open TEXT NOT NULL,
  close TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Prestations',
  description TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#7c3aed',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS staff_hours (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start TEXT NOT NULL,
  end TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_services (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE IF NOT EXISTS time_off (
  id INTEGER PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  phone TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  marketing_opt_in INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (salon_id, email)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled','completed','no_show')),
  price_cents INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'online' CHECK (source IN ('online','widget','pro')),
  token TEXT NOT NULL UNIQUE,
  notes TEXT NOT NULL DEFAULT '',
  reminder_sent INTEGER NOT NULL DEFAULT 0,
  review_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_bookings_staff_time ON bookings (staff_id, start_at);
CREATE INDEX IF NOT EXISTS idx_bookings_salon_time ON bookings (salon_id, start_at);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  reply TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER REFERENCES salons(id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

db.exec(`
-- Each salon owns one public website, rendered at /s/<slug> (or on its own domain for Premium).
CREATE TABLE IF NOT EXISTS sites (
  salon_id INTEGER PRIMARY KEY REFERENCES salons(id) ON DELETE CASCADE,
  template TEXT NOT NULL DEFAULT 'classique',
  published INTEGER NOT NULL DEFAULT 1,
  content TEXT NOT NULL DEFAULT '{}',
  custom_css TEXT NOT NULL DEFAULT '',
  custom_domain TEXT UNIQUE,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Premium templates unlocked by a salon: one-off purchase or monthly rental.
CREATE TABLE IF NOT EXISTS template_licenses (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  template TEXT NOT NULL,
  billing TEXT NOT NULL CHECK (billing IN ('once','monthly')),
  price_chf INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  cancelled_at TEXT
);

-- Premium plan: tailor-made design requests handled by the platform team.
CREATE TABLE IF NOT EXISTS design_requests (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  brief TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'nouveau' CHECK (status IN ('nouveau','en_cours','livre')),
  admin_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

/** Runs fn inside an IMMEDIATE transaction (serialises writers — prevents double booking). */
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

module.exports = { db, tx, one, all, run };
