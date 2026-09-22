'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { permissionsFor } = require('./rbac');

const SECRET = process.env.SEMA_JWT_SECRET || 'sema-alkhayr-dev-secret-change-in-production';
const TTL = '12h';

function loadUser(userId) {
  const u = db.prepare('SELECT id, full_name, email, phone, region, gender, job_title, status FROM users WHERE id=?').get(userId);
  if (!u) return null;
  const rows = db.prepare(`
    SELECT ur.role_code, ur.scope_kind, ur.scope_id, r.name_ar, r.category, r.sod_function, r.description
    FROM user_roles ur JOIN roles r ON r.code=ur.role_code WHERE ur.user_id=?`).all(userId);
  u.roles = rows;
  u.role_codes = rows.map((r) => r.role_code);
  u.permissions = permissionsFor(u.role_codes);
  u.scopes = {
    licensee: rows.filter((r) => r.scope_kind === 'licensee').map((r) => r.scope_id),
    association: rows.filter((r) => r.scope_kind === 'association').map((r) => r.scope_id),
  };
  return u;
}

function issueToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, SECRET, { expiresIn: TTL });
}

function login(email, password) {
  const row = db.prepare('SELECT id, password_hash, status FROM users WHERE lower(email)=lower(?)').get(String(email || '').trim());
  if (!row) return { error: 'بيانات الدخول غير صحيحة' };
  if (!bcrypt.compareSync(String(password || ''), row.password_hash)) return { error: 'بيانات الدخول غير صحيحة' };
  if (row.status !== 'active') return { error: 'الحساب موقوف — راجع الأمانة' };
  db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(row.id);
  const user = loadUser(row.id);
  return { token: issueToken(user), user };
}

/** يقرأ المستخدم من الترويسة إن وُجد، دون منع */
function attachUser(req, _res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (t) {
    try {
      const p = jwt.verify(t, SECRET);
      req.user = loadUser(p.uid);
    } catch { /* رمز غير صالح — يُعامل كزائر */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  next();
}

/** صلاحية واحدة أو أكثر (أي منها) */
function can(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
    if (perms.some((p) => req.user.permissions.includes(p))) return next();
    return res.status(403).json({
      error: 'لا تملك الصلاحية لهذا الإجراء',
      required: perms,
      hint: 'مصفوفة الصلاحيات في النظام الداخلي تحدد الجهة المختصة بهذا القرار',
    });
  };
}

function hasPerm(user, p) { return !!user && user.permissions.includes(p); }

/** نطاق الجهة: صاحب الملف يرى ملفه فقط ما لم يملك صلاحية عامة */
function ownsLicensee(user, id) { return user.scopes.licensee.includes(Number(id)); }
function ownsAssociation(user, id) { return user.scopes.association.includes(Number(id)); }

function log(req, action, entity_kind, entity_id, summary, before, after) {
  db.prepare(`INSERT INTO audit_log (actor_id, actor_name, actor_roles, action, entity_kind, entity_id, summary, before_json, after_json, ip)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    req.user ? req.user.id : null,
    req.user ? req.user.full_name : 'زائر',
    req.user ? req.user.role_codes.join(',') : '',
    action, entity_kind, entity_id || null, summary || null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    req.ip || null);
}

function notify({ user_id, role_code, title, body, severity = 'info', link = null }) {
  if (role_code && !user_id) {
    const users = db.prepare('SELECT DISTINCT user_id FROM user_roles WHERE role_code=?').all(role_code);
    const st = db.prepare('INSERT INTO notifications (user_id, role_code, title, body, severity, link) VALUES (?,?,?,?,?,?)');
    for (const u of users) st.run(u.user_id, role_code, title, body, severity, link);
    return;
  }
  db.prepare('INSERT INTO notifications (user_id, role_code, title, body, severity, link) VALUES (?,?,?,?,?,?)')
    .run(user_id || null, role_code || null, title, body, severity, link);
}

module.exports = { login, loadUser, attachUser, requireAuth, can, hasPerm, ownsLicensee, ownsAssociation, log, notify, bcrypt };
