'use strict';
/**
 * النسخ الاحتياطي — لقطة متّسقة لقاعدة البيانات بـ VACUUM INTO والخادم يعمل، مع فحص سلامتها وبصمتها،
 * والاحتفاظ بآخر N نسخة (الإعداد backup_keep). الملفات المحمَّلة تُنسخ بمزامنة مجلد uploads — انظر docs/05.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { db, DATA_DIR } = require('./db');

const BACKUP_DIR = process.env.SEMA_BACKUP_DIR || path.join(DATA_DIR, 'backups');
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function makeBackup(triggeredBy = 'يدوي') {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  let name = `sema-${stamp()}.db`, k = 1;
  while (fs.existsSync(path.join(BACKUP_DIR, name))) name = `sema-${stamp()}-${k++}.db`;
  const file = path.join(BACKUP_DIR, name);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const check = new Database(file, { readonly: true });
  const integrity = check.pragma('integrity_check', { simple: true });
  check.close();
  const buf = fs.readFileSync(file);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const id = db.prepare('INSERT INTO backups (file_name, size_bytes, sha256, integrity, triggered_by) VALUES (?,?,?,?,?)')
    .run(name, buf.length, sha256, String(integrity), triggeredBy).lastInsertRowid;
  prune();
  return db.prepare('SELECT * FROM backups WHERE id=?').get(id);
}

function prune() {
  const keep = Math.max(1, Number(db.prepare("SELECT v FROM settings WHERE k='backup_keep'").get()?.v) || 14);
  const old = db.prepare('SELECT * FROM backups WHERE deleted_at IS NULL ORDER BY id DESC LIMIT -1 OFFSET ?').all(keep);
  for (const b of old) {
    try { fs.unlinkSync(path.join(BACKUP_DIR, b.file_name)); } catch { /* حُذف يدوياً */ }
    db.prepare("UPDATE backups SET deleted_at=datetime('now') WHERE id=?").run(b.id);
  }
  return old.length;
}

const lastWithin = (hours) => !!db.prepare(`SELECT 1 FROM backups WHERE deleted_at IS NULL AND created_at > datetime('now', ?)`).get(`-${hours} hours`);
function list() {
  return db.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT 100').all()
    .map((b) => ({ ...b, available: !b.deleted_at && fs.existsSync(path.join(BACKUP_DIR, path.basename(b.file_name))) }));
}
const fileOf = (b) => path.join(BACKUP_DIR, path.basename(b.file_name));

module.exports = { makeBackup, prune, lastWithin, list, fileOf, BACKUP_DIR };
