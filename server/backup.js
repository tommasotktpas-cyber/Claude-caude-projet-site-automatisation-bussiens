'use strict';
// Nightly SQLite snapshot (consistent copy taken while the app runs) with rotation.
// Copy BACKUP_DIR off the server too (rclone to kDrive / S3, see DEPLOIEMENT.md): a backup on the same disk is not a backup.
const fs = require('node:fs');
const path = require('node:path');
const { db } = require('./db');
const T = require('./time');

const DIR = process.env.BACKUP_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lumea.db')), 'backups');
const KEEP = Number(process.env.BACKUP_KEEP || 14);

function backupNow() {
  if (process.env.DB_PATH === ':memory:') return null;
  fs.mkdirSync(DIR, { recursive: true });
  const now = T.now();
  const file = path.join(DIR, `lumea-${now.date}-${now.time.replace(':', '')}.db`);
  if (fs.existsSync(file)) return file;
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = fs.readdirSync(DIR).filter((f) => /^lumea-.*\.db$/.test(f)).sort().reverse().slice(KEEP);
  for (const f of old) fs.rmSync(path.join(DIR, f), { force: true });
  return file;
}

let lastDay = '';
/** Called every few minutes: one snapshot per night, after 03:00. */
function maybeBackup() {
  const now = T.now();
  if (now.min < 180 || lastDay === now.date) return null;
  lastDay = now.date;
  if (fs.existsSync(DIR) && fs.readdirSync(DIR).some((f) => f.startsWith(`lumea-${now.date}-`))) return null;
  return backupNow();
}

module.exports = { backupNow, maybeBackup, DIR };

if (require.main === module) console.log(backupNow() || 'Base en mémoire : rien à sauvegarder.');
