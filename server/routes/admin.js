'use strict';
/** إدارة المستخدمين والأدوار وسجل التتبع والإعدادات */
const express = require('express');
const { db } = require('../db');
const { can, requireAuth, hasPerm, log, bcrypt, loadUser } = require('../auth');
const { buildList } = require('../query');
const { ROLES, PERMISSIONS, PERMISSION_GROUPS, SOD_FUNCTIONS, sodConflict, permissionsFor } = require('../rbac');

const r = express.Router();

/** مصفوفة الأدوار والصلاحيات — مرجع الواجهة */
r.get('/rbac', requireAuth, (_req, res) => {
  res.json({
    sod_functions: SOD_FUNCTIONS.map(([code, name_ar]) => ({ code, name_ar })),
    permission_groups: PERMISSION_GROUPS,
    permissions: PERMISSIONS.map(([code, name_ar, grp]) => ({ code, name_ar, grp })),
    roles: ROLES.map((x) => ({ code: x.code, name_ar: x.name_ar, category: x.category,
      sod_function: x.sod, scope_kind: x.scope_kind || 'global', description: x.description,
      permissions: x.perms, permission_count: x.perms.length })),
    decision_matrix: db.prepare('SELECT * FROM settings WHERE k=?').get('decision_matrix')?.v
      ? JSON.parse(db.prepare('SELECT * FROM settings WHERE k=?').get('decision_matrix').v) : null,
    rule: 'المادة (18): لا يجوز أن يجمع شخصٌ واحدٌ بين وظيفتين من الوظائف الأربع — وضع المعيار، والتقييم والتدقيق، وقرار الترخيص، والتظلم وحماية النزاهة.',
  });
});

r.get('/users', requireAuth, can('admin.users'), (req, res) => {
  const out = buildList(db, {
    table: 'users u', columns: 'u.id, u.full_name, u.email, u.phone, u.region, u.gender, u.job_title, u.status, u.last_login_at, u.created_at',
    filters: { status: { op: 'in', col: 'u.status' }, region: { op: 'in', col: 'u.region' } },
    search: ['u.full_name', 'u.email', 'u.job_title'],
    allowSort: ['full_name', 'created_at', 'last_login_at'], defaultSort: 'u.full_name', req,
  });
  for (const x of out.rows) {
    x.roles = db.prepare(`SELECT ur.role_code, r.name_ar, r.sod_function, ur.scope_kind, ur.scope_id,
        CASE ur.scope_kind WHEN 'licensee' THEN (SELECT legal_name FROM licensees WHERE id=ur.scope_id)
        WHEN 'association' THEN (SELECT name FROM associations WHERE id=ur.scope_id) END scope_name
        FROM user_roles ur JOIN roles r ON r.code=ur.role_code WHERE ur.user_id=?`).all(x.id);
    x.permission_count = permissionsFor(x.roles.map((y) => y.role_code)).length;
  }
  if (req.query.role) out.rows = out.rows.filter((x) => x.roles.some((y) => y.role_code === req.query.role));
  res.json(out);
});

r.post('/users', requireAuth, can('admin.users'), (req, res) => {
  const { full_name, email, phone, region, gender, job_title, password, roles = [] } = req.body;
  if (!full_name || !email || !password) return res.status(400).json({ error: 'الاسم والبريد وكلمة المرور مطلوبة' });
  const codes = roles.map((x) => (typeof x === 'string' ? x : x.role_code));
  const c = sodConflict(codes);
  if (c.conflict) return res.status(422).json({ error: c.message, sod: c });
  let id;
  try {
    id = db.prepare(`INSERT INTO users (full_name, email, phone, password_hash, region, gender, job_title)
        VALUES (?,?,?,?,?,?,?)`).run(full_name, email, phone || null,
      bcrypt.hashSync(password, 10), region || null, gender || null, job_title || null).lastInsertRowid;
  } catch (e) { return res.status(409).json({ error: 'البريد مستخدم مسبقاً' }); }
  const st = db.prepare('INSERT INTO user_roles (user_id, role_code, scope_kind, scope_id) VALUES (?,?,?,?)');
  for (const x of roles) {
    const code = typeof x === 'string' ? x : x.role_code;
    const rr = ROLES.find((y) => y.code === code);
    st.run(id, code, (typeof x === 'object' && x.scope_kind) || rr?.scope_kind || 'global',
      typeof x === 'object' ? x.scope_id || null : null);
  }
  log(req, 'user.create', 'user', id, `${full_name} — ${codes.join(',')}`);
  res.status(201).json(loadUser(id));
});

r.post('/users/:id/roles', requireAuth, can('admin.users'), (req, res) => {
  const id = Number(req.params.id);
  const { roles = [] } = req.body;
  const codes = roles.map((x) => (typeof x === 'string' ? x : x.role_code));
  const c = sodConflict(codes);
  if (c.conflict) return res.status(422).json({ error: c.message, sod: c });
  const before = loadUser(id);
  if (!before) return res.status(404).json({ error: 'غير موجود' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM user_roles WHERE user_id=?').run(id);
    const st = db.prepare('INSERT INTO user_roles (user_id, role_code, scope_kind, scope_id) VALUES (?,?,?,?)');
    for (const x of roles) {
      const code = typeof x === 'string' ? x : x.role_code;
      const rr = ROLES.find((y) => y.code === code);
      st.run(id, code, (typeof x === 'object' && x.scope_kind) || rr?.scope_kind || 'global',
        typeof x === 'object' ? x.scope_id || null : null);
    }
  });
  tx();
  const after = loadUser(id);
  log(req, 'user.roles', 'user', id, `الأدوار: ${codes.join(',')}`, before.role_codes, after.role_codes);
  res.json(after);
});

r.post('/users/:id/status', requireAuth, can('admin.users'), (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended', 'disabled'].includes(status)) return res.status(400).json({ error: 'status غير صالح' });
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, Number(req.params.id));
  log(req, 'user.status', 'user', Number(req.params.id), status);
  res.json({ ok: true });
});

/** فحص الفصل الوظيفي قبل التعيين */
r.post('/rbac/check', requireAuth, (req, res) => {
  const codes = req.body.roles || [];
  res.json({ ...sodConflict(codes), permissions: permissionsFor(codes) });
});

/** سجل التتبع */
r.get('/audit-log', requireAuth, can('admin.log'), (req, res) => {
  const out = buildList(db, {
    table: 'audit_log a', columns: 'a.*',
    filters: { action: { op: 'like', col: 'a.action' }, entity_kind: { op: 'in', col: 'a.entity_kind' },
      entity_id: { op: 'eq', col: 'a.entity_id', num: true }, actor_id: { op: 'eq', col: 'a.actor_id', num: true },
      from: { op: 'gte', col: 'a.at' }, to: { op: 'lte', col: 'a.at' } },
    search: ['a.summary', 'a.actor_name', 'a.action'],
    allowSort: ['at', 'action'], defaultSort: 'a.at DESC', req,
  });
  res.json(out);
});

/** الإشعارات */
r.get('/notifications', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT * FROM notifications WHERE user_id=? OR role_code IN
      (SELECT role_code FROM user_roles WHERE user_id=?) ORDER BY created_at DESC LIMIT 100`)
    .all(req.user.id, req.user.id);
  res.json({ rows, unread: rows.filter((x) => !x.read_at).length });
});

r.post('/notifications/read', requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE (user_id=? OR role_code IN (SELECT role_code FROM user_roles WHERE user_id=?)) AND read_at IS NULL")
    .run(req.user.id, req.user.id);
  res.json({ ok: true });
});

/** الإعدادات */
r.get('/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  res.json({ rows: hasPerm(req.user, 'admin.settings') ? rows : rows.filter((x) => !x.k.startsWith('_')) });
});

r.put('/settings/:k', requireAuth, can('admin.settings'), (req, res) => {
  db.prepare('INSERT INTO settings (k,v,note) VALUES (?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v')
    .run(req.params.k, String(req.body.value), req.body.note || null);
  log(req, 'setting.update', 'setting', null, `${req.params.k} = ${req.body.value}`);
  res.json({ ok: true });
});

/** إقرار المصالح السنوي (نموذج 12) */
r.post('/pledges', requireAuth, (req, res) => {
  const { kind, year, has_conflict, details } = req.body;
  db.prepare(`INSERT INTO integrity_pledges (user_id, kind, year, has_conflict, details) VALUES (?,?,?,?,?)`)
    .run(req.user.id, kind || 'annual_interests', year || new Date().getFullYear(),
      has_conflict ? 1 : 0, details || null);
  log(req, 'pledge.sign', 'user', req.user.id, kind || 'annual_interests');
  res.status(201).json({ ok: true });
});

r.get('/pledges', requireAuth, can('admin.users', 'integrity.note'), (_req, res) => {
  res.json({ rows: db.prepare(`SELECT p.*, u.full_name, u.email FROM integrity_pledges p
      JOIN users u ON u.id=p.user_id ORDER BY p.signed_at DESC`).all() });
});

module.exports = r;
