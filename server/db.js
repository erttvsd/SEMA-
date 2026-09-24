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
  // المرحلة الثالثة: التحقق بخطوتين والبريد
  addCol('users', 'totp_secret', 'totp_secret TEXT');
  addCol('users', 'totp_pending', 'totp_pending TEXT');
  addCol('users', 'totp_enabled', 'totp_enabled INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'totp_last_counter', 'totp_last_counter INTEGER NOT NULL DEFAULT 0');
  addCol('users', 'totp_recovery', 'totp_recovery TEXT');
  addCol('users', 'email_notifications', 'email_notifications INTEGER NOT NULL DEFAULT 1');
  syncReference();
}

/** مزامنة المراجع المضافة لاحقاً مع قاعدة قائمة: الصلاحيات الجديدة وأنواع المستندات والإعدادات */
function syncReference() {
  if (!db.prepare('SELECT 1 FROM roles LIMIT 1').get()) return;   // قاعدة لم تُبنَ بعد — البناء يتولاها
  const { PERMISSIONS, ROLES } = require('./rbac');
  const pm = db.prepare('INSERT OR IGNORE INTO permissions (code,name_ar,grp) VALUES (?,?,?)');
  PERMISSIONS.forEach(([c, n, g]) => pm.run(c, n, g));
  const rp = db.prepare('INSERT OR IGNORE INTO role_permissions (role_code,permission_code) VALUES (?,?)');
  ROLES.forEach((x) => x.perms.forEach((p) => rp.run(x.code, p)));
  // وما سُحب من دور في الشيفرة يُسحب من الجدول كذلك — مصدر الحقيقة rbac.js
  const valid = new Set(ROLES.flatMap((x) => x.perms.map((p) => x.code + '|' + p)));
  for (const r of db.prepare('SELECT role_code, permission_code FROM role_permissions').all())
    if (!valid.has(r.role_code + '|' + r.permission_code)) db.prepare('DELETE FROM role_permissions WHERE role_code=? AND permission_code=?').run(r.role_code, r.permission_code);
  const REF = require('./reference');
  const dt = db.prepare('INSERT OR IGNORE INTO document_types (code,name_ar,applies_to,required,expires,form_no) VALUES (?,?,?,?,?,?)');
  REF.DOC_TYPES.forEach((x) => dt.run(...x));
  const st = db.prepare('INSERT OR IGNORE INTO settings (k,v,note) VALUES (?,?,?)');
  st.run('require_2fa_internal', '0', 'إلزام حسابات الحوكمة والأمانة بالتحقق بخطوتين (1 = مُلزِم)');
  st.run('mail_from', 'سِيمَا الخَيْر <no-reply@sema.ly>', 'مُرسِل البريد الصادر');
  st.run('backup_keep', '14', 'عدد النسخ الاحتياطية المحتفَظ بها');
}

module.exports = { db, DATA_DIR, UPLOAD_DIR: path.join(DATA_DIR, 'uploads'), DB_PATH, wasFresh: fresh };
