'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lumea.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

/**
 * Rebuilds a table to change a CHECK constraint (SQLite cannot ALTER one), keeping every row.
 * Build-copy-swap: renaming the old table first would rewrite other tables' foreign keys.
 */
function rebuildTable(table, { from, to, select = {} }) {
  const current = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!current || !current.sql.includes(from)) return;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const quoted = cols.map((c) => `"${c}"`).join(', ');
  const exprs = cols.map((c) => select[c] || `"${c}"`).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(current.sql.replace(new RegExp(`CREATE TABLE (IF NOT EXISTS )?"?${table}"?`), `CREATE TABLE ${table}_rebuild`).replace(from, to));
    db.exec(`INSERT INTO ${table}_rebuild (${quoted}) SELECT ${exprs} FROM ${table}`);
    db.exec(`DROP TABLE ${table}`);
    db.exec(`ALTER TABLE ${table}_rebuild RENAME TO ${table}`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error(`Migration ${table} : contrôle des clés étrangères échoué.`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// v2: plans starter/pro/business became essentiel/premium.
rebuildTable('salons', {
  from: "'trial','starter','pro','business'", to: "'trial','essentiel','premium'",
  select: { plan: "CASE WHEN plan = 'business' THEN 'premium' WHEN plan IN ('starter','pro') THEN 'essentiel' ELSE plan END" },
});
// v3: staff accounts (employees log in and see their own agenda).
rebuildTable('users', { from: "'client','pro','admin')", to: "'client','pro','admin','staff')" });

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('client','pro','admin','staff')),
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

db.exec(`
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
`);

/** Additive migrations: new nullable / defaulted columns on existing databases. */
function addColumn(table, column, definition) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
addColumn('salons', 'stripe_customer_id', 'TEXT');
addColumn('salons', 'stripe_subscription_id', 'TEXT');
addColumn('salons', 'stripe_account_id', 'TEXT');
addColumn('salons', 'stripe_charges_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('bookings', 'payment_status', "TEXT NOT NULL DEFAULT 'none'"); // none | pending | paid | refunded
addColumn('bookings', 'stripe_session_id', 'TEXT');
addColumn('bookings', 'stripe_payment_intent', 'TEXT');
addColumn('template_licenses', 'stripe_subscription_id', 'TEXT');
addColumn('users', 'staff_id', 'INTEGER REFERENCES staff(id) ON DELETE SET NULL');
// 3D haircut studio: per-service switch, per-salon list of offered cuts, client's style sheet on the booking.
{
  const hadStudio = db.prepare('PRAGMA table_info(services)').all().some((c) => c.name === 'studio');
  addColumn('services', 'studio', 'INTEGER NOT NULL DEFAULT 0');
  if (!hadStudio) {
    const { STUDIO_SERVICE_RE } = require('./styles');
    const rows = db.prepare("SELECT sv.id, sv.name, sv.category FROM services sv JOIN salons s ON s.id = sv.salon_id WHERE s.category IN ('coiffure','barbier')").all();
    for (const r of rows) if (STUDIO_SERVICE_RE.test(`${r.name} ${r.category}`)) db.prepare('UPDATE services SET studio = 1 WHERE id = ?').run(r.id);
  }
}
addColumn('salons', 'style_catalog', "TEXT NOT NULL DEFAULT ''");
addColumn('bookings', 'style_json', 'TEXT');
addColumn('bookings', 'style_image', 'TEXT');
// Point of sale, stock and gift cards.
db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Produits',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  cost_cents INTEGER NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  low_stock INTEGER NOT NULL DEFAULT 3,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS gift_cards (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  code TEXT NOT NULL UNIQUE,
  initial_cents INTEGER NOT NULL,
  balance_cents INTEGER NOT NULL,
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_email TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'caisse' CHECK (source IN ('online','caisse')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','void')),
  stripe_session_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY,
  salon_id INTEGER NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  subtotal_cents INTEGER NOT NULL,
  discount_cents INTEGER NOT NULL DEFAULT 0,
  tip_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('cash','card','twint','gift_card','other')),
  gift_card_id INTEGER REFERENCES gift_cards(id) ON DELETE SET NULL,
  gift_card_cents INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  voided INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sales_salon_day ON sales (salon_id, day);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service','product','gift_card')),
  ref_id INTEGER,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
addColumn('salons', 'giftcards_enabled', 'INTEGER NOT NULL DEFAULT 1');
addColumn('sales', 'prepaid_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumn('salons', 'boost_until', "TEXT NOT NULL DEFAULT ''");
// Collaborators: employees or independents (chair rental / revenue share).
addColumn('staff', 'employment', "TEXT NOT NULL DEFAULT 'salarie'"); // salarie | independant
addColumn('staff', 'pay_model', "TEXT NOT NULL DEFAULT 'fixe'"); // fixe | commission | loyer
addColumn('staff', 'rate_percent', 'INTEGER NOT NULL DEFAULT 0');
addColumn('staff', 'chair_rent_cents', 'INTEGER NOT NULL DEFAULT 0');
addColumn('salons', 'boost_subscription_id', 'TEXT');
addColumn('design_requests', 'paid_chf', 'INTEGER NOT NULL DEFAULT 0');

// Retention & last-minute features.
{
  const had = db.prepare('PRAGMA table_info(services)').all().some((c) => c.name === 'rebook_weeks');
  addColumn('services', 'rebook_weeks', 'INTEGER NOT NULL DEFAULT 0');
  if (!had) {
    // Sensible defaults from the service name: haircut ~5 weeks, beard 3, nails 3, colour 7.
    const guess = (n) => (/barbe|rasage/i.test(n) ? 3 : /ongle|semi|gel|manucure|pieds/i.test(n) ? 3 : /couleur|balayage|racines/i.test(n) ? 7 : /coupe|d[ée]grad/i.test(n) ? 5 : 0);
    for (const r of db.prepare('SELECT id, name FROM services').all()) {
      const w = guess(r.name);
      if (w) db.prepare('UPDATE services SET rebook_weeks = ? WHERE id = ?').run(w, r.id);
    }
  }
}
addColumn('bookings', 'rebook_sent', 'INTEGER NOT NULL DEFAULT 0');
addColumn('clients', 'birthday', "TEXT NOT NULL DEFAULT ''");
addColumn('clients', 'birthday_sent_year', 'INTEGER NOT NULL DEFAULT 0');
addColumn('salons', 'birthday_offer', "TEXT NOT NULL DEFAULT '-15 % sur votre prochaine prestation, valable tout le mois'");
addColumn('salons', 'lastminute_percent', 'INTEGER NOT NULL DEFAULT 0');
addColumn('salons', 'lastminute_hours', 'INTEGER NOT NULL DEFAULT 24');
addColumn('bookings', 'deal_percent', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`CREATE TABLE IF NOT EXISTS user_identities (
  provider TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, subject)
)`);
db.exec(`CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))`);

/** Runs fn inside an IMMEDIATE transaction (serialises writers — prevents double booking). Re-entrant. */
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const out = fn();
    txDepth--;
    db.exec('COMMIT');
    return out;
  } catch (err) {
    txDepth--;
    db.exec('ROLLBACK');
    throw err;
  }
}

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

module.exports = { db, tx, one, all, run };
