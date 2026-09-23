'use strict';
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.SEMA_DATA_DIR || path.join(__dirname, '..', 'storage');
const DB_PATH = path.join(DATA_DIR, 'sema.db');
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });

const fresh = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

if (fresh) {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}
migrate();

/** ترحيل تزايدي آمن للتكرار — يُضيف الجداول والأعمدة الجديدة دون المساس بالبيانات */
function migrate() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema-ext.sql'), 'utf8'));
  const addCol = (table, col, ddl) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  };
  addCol('users', 'password_changed_at', 'password_changed_at TEXT');
  addCol('users', 'token_version', 'token_version INTEGER NOT NULL DEFAULT 0');
  addCol('complaints', 'tracking_code', 'tracking_code TEXT');
  addCol('applications', 'resubmitted_at', 'resubmitted_at TEXT');
  addCol('applications', 'self_registered', 'self_registered INTEGER NOT NULL DEFAULT 0');
  addCol('compliance_declarations', 'facts_note', 'facts_note TEXT');
  addCol('compliance_declarations', 'decided_by', 'decided_by INTEGER');
  addCol('compliance_declarations', 'decided_at', 'decided_at TEXT');
  addCol('observers', 'contact_email', 'contact_email TEXT');
  addCol('observers', 'motivation', 'motivation TEXT');
  addCol('contributions', 'program_preapproved', 'program_preapproved INTEGER NOT NULL DEFAULT 0');
}

module.exports = { db, DATA_DIR, UPLOAD_DIR: path.join(DATA_DIR, 'uploads'), DB_PATH, wasFresh: fresh };
