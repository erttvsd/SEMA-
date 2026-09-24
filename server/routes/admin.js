'use strict';
/** إدارة المستخدمين والأدوار وسجل التتبع والإعدادات */
const express = require('express');
const { db } = require('../db');
const { can, requireAuth, hasPerm, log, bcrypt, loadUser } = require('../auth');
const { buildList } = require('../query');
const { ROLES, PERMISSIONS, PERMISSION_GROUPS, SOD_FUNCTIONS, sodConflict, permissionsFor, assignmentProblems } = require('../rbac');
const { passwordProblem } = require('../auth');

/** يطبّع مدخلات الأدوار ويتحقق منها: رموز معروفة، ونطاق مطابق لطبيعة الدور، وملف موجود، وقواعد التعارض */
function normalizeRoles(input) {
  if (!Array.isArray(input)) return { error: 'roles يجب أن تكون قائمة' };
  const out = [];
  for (const x of input) {
    const code = typeof x === 'string' ? x : (x && typeof x === 'object' ? x.role_code : null);
    const role = ROLES.find((r) => r.code === code);
    if (!role) return { error: `دور غير معروف: ${String(code)}` };
    const kind = role.scope_kind || 'global';
    let scope_id = null;
    if (kind !== 'global') {
      scope_id = Number(typeof x === 'object' ? x.scope_id : NaN);
      const table = kind === 'licensee' ? 'licensees' : 'associations';
      if (!Number.isInteger(scope_id) || !db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).get(scope_id))
        return { error: `الدور «${role.name_ar}» يلزمه ملف ${kind === 'licensee' ? 'مرخَّص له' : 'منظمة'} موجود` };
    }
    if (out.some((o) => o.role_code === code)) continue;
    out.push({ role_code: code, scope_kind: kind, scope_id });
  }
  const problems = assignmentProblems(out.map((o) => o.role_code));
  if (problems.length) return { error: problems.join(' '), problems, status: 422 };
  return { roles: out };
}

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
    table: 'users u', columns: 'u.id, u.full_name, u.email, u.phone, u.region, u.gender, u.job_title, u.status, u.last_login_at, u.created_at, u.totp_enabled',
    filters: { status: { op: 'in', col: 'u.status' }, region: { op: 'in', col: 'u.region' } },
    search: ['u.full_name', 'u.email', 'u.job_title'],
    allowSort: ['full_name', 'created_at', 'last_login_at'], defaultSort: 'u.full_name', req,
    extraWhere: req.query.role ? ['EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id=u.id AND x.role_code=?)'] : [],
    params: req.query.role ? [String(req.query.role)] : [],
  });
  for (const x of out.rows) {
    x.roles = db.prepare(`SELECT ur.role_code, r.name_ar, r.sod_function, ur.scope_kind, ur.scope_id,
        CASE ur.scope_kind WHEN 'licensee' THEN (SELECT legal_name FROM licensees WHERE id=ur.scope_id)
        WHEN 'association' THEN (SELECT name FROM associations WHERE id=ur.scope_id) END scope_name
        FROM user_roles ur JOIN roles r ON r.code=ur.role_code WHERE ur.user_id=?`).all(x.id);
    x.permission_count = permissionsFor(x.roles.map((y) => y.role_code)).length;
  }
  res.json(out);
});

r.post('/users', requireAuth, can('admin.users'), (req, res) => {
  const { full_name, email, phone, region, gender, job_title, password } = req.body || {};
  if (!full_name || !email || !password) return res.status(400).json({ error: 'الاسم والبريد وكلمة المرور مطلوبة' });
  const pw = passwordProblem(password);
  if (pw) return res.status(422).json({ error: pw });
  const nr = normalizeRoles(req.body.roles || []);
  if (nr.error) return res.status(nr.status || 400).json({ error: nr.error, problems: nr.problems });
  if (region && !['الغربية', 'الشرقية', 'الجنوبية'].includes(region)) return res.status(400).json({ error: 'المنطقة غير صالحة' });
  let id;
  try {
    // كلمة المرور التي تضعها الإدارة مؤقتة: يُلزَم صاحبها بتغييرها عند أول دخول
    id = db.prepare(`INSERT INTO users (full_name, email, phone, password_hash, region, gender, job_title, must_reset)
        VALUES (?,?,?,?,?,?,?,1)`).run(String(full_name).slice(0, 160), String(email).trim(), phone || null,
      bcrypt.hashSync(String(password), 10), region || null, ['م', 'أ'].includes(gender) ? gender : null, job_title || null).lastInsertRowid;
  } catch (e) { return res.status(409).json({ error: 'البريد مستخدم مسبقاً' }); }
  const st = db.prepare('INSERT INTO user_roles (user_id, role_code, scope_kind, scope_id) VALUES (?,?,?,?)');
  for (const x of nr.roles) st.run(id, x.role_code, x.scope_kind, x.scope_id);
  log(req, 'user.create', 'user', id, `${full_name} — ${nr.roles.map((x) => x.role_code).join(',')}`);
  res.status(201).json(loadUser(id));
});

r.post('/users/:id/roles', requireAuth, can('admin.users'), (req, res) => {
  const id = Number(req.params.id);
  // لا يعدّل أحد أدواره بنفسه — منعاً لرفع الصلاحيات الذاتي
  if (id === req.user.id) return res.status(403).json({ error: 'لا يجوز تعديل أدوارك بنفسك — يعدّلها مستخدم آخر مخوَّل' });
  const before = loadUser(id);
  if (!before) return res.status(404).json({ error: 'غير موجود' });
  const nr = normalizeRoles((req.body || {}).roles || []);
  if (nr.error) return res.status(nr.status || 400).json({ error: nr.error, problems: nr.problems });
  db.transaction(() => {
    db.prepare('DELETE FROM user_roles WHERE user_id=?').run(id);
    const st = db.prepare('INSERT INTO user_roles (user_id, role_code, scope_kind, scope_id) VALUES (?,?,?,?)');
    for (const x of nr.roles) st.run(id, x.role_code, x.scope_kind, x.scope_id);
    // تغيير الأدوار يُسقط رموز الدخول القائمة فتُطبَّق الصلاحيات الجديدة فوراً
    db.prepare('UPDATE users SET token_version=token_version+1 WHERE id=?').run(id);
  })();
  const after = loadUser(id);
  log(req, 'user.roles', 'user', id, `الأدوار: ${nr.roles.map((x) => x.role_code).join(',')}`, before.role_codes, after.role_codes);
  res.json(after);
});

r.post('/users/:id/status', requireAuth, can('admin.users'), (req, res) => {
  const { status } = req.body || {};
  if (!['active', 'suspended', 'disabled'].includes(status)) return res.status(400).json({ error: 'status غير صالح' });
  if (Number(req.params.id) === req.user.id) return res.status(403).json({ error: 'لا يجوز تغيير حالة حسابك بنفسك' });
  if (!db.prepare('SELECT 1 FROM users WHERE id=?').get(Number(req.params.id))) return res.status(404).json({ error: 'غير موجود' });
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, Number(req.params.id));
  log(req, 'user.status', 'user', Number(req.params.id), status);
  res.json({ ok: true });
});

/** فحص الفصل الوظيفي قبل التعيين */
r.post('/rbac/check', requireAuth, (req, res) => {
  const codes = Array.isArray((req.body || {}).roles) ? req.body.roles.filter((c) => typeof c === 'string') : [];
  const problems = assignmentProblems(codes);
  res.json({ ...sodConflict(codes), conflict: problems.length > 0, message: problems.join(' ') || undefined,
    problems, permissions: permissionsFor(codes) });
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
  // الإشعار يُنشأ نسخة لكل مستخدم — فيُقرأ بمعرّفه وحده (لا تكرار ولا تعليم نسخ الآخرين مقروءة)
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 100').all(req.user.id);
  res.json({ rows, unread: rows.filter((x) => !x.read_at).length });
});

r.post('/notifications/read', requireAuth, (req, res) => {
  db.prepare("UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL").run(req.user.id);
  res.json({ ok: true });
});

/** الإعدادات */
r.get('/settings', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  res.json({ rows: hasPerm(req.user, 'admin.settings') ? rows : rows.filter((x) => !x.k.startsWith('_')) });
});

// قيم يحكمها نص اللائحة ومنطق القواعد: لا تُعدَّل إعداداً، بل بمقترح معتمد من المجلس (المادة 5 و34/7)
const LOCKED_SETTINGS = ['annual_fee_cap', 'single_org_cap', 'absorption_multiple', 'overhead_cap', 'unannounced_min',
  'volunteer_hour_rate', 'decision_matrix'];
r.put('/settings/:k', requireAuth, can('admin.settings'), (req, res) => {
  if (LOCKED_SETTINGS.includes(req.params.k))
    return res.status(422).json({ error: 'قيمة تحكمها اللائحة — تُعدَّل بمقترح تعديل معتمد من مجلس الأمناء بعد المشاورة، لا من الإعدادات' });
  if (!db.prepare('SELECT 1 FROM settings WHERE k=?').get(req.params.k)) return res.status(404).json({ error: 'إعداد غير معروف' });
  if (req.body == null || req.body.value == null || String(req.body.value).length > 500) return res.status(400).json({ error: 'قيمة غير صالحة' });
  if (req.params.k === 'require_2fa_internal') {
    if (!['0', '1'].includes(String(req.body.value))) return res.status(400).json({ error: 'القيمة 0 أو 1' });
    // من يُلزم غيره يبدأ بنفسه — وإلا حُجب عن النظام فور الحفظ
    if (String(req.body.value) === '1' && !req.user.totp_enabled)
      return res.status(422).json({ error: 'فعّل التحقق بخطوتين لحسابك أولاً من «حسابي»، ثم ألزم به الآخرين' });
  }
  if (req.params.k === 'backup_keep' && !(Number.isInteger(Number(req.body.value)) && Number(req.body.value) >= 1 && Number(req.body.value) <= 365))
    return res.status(400).json({ error: 'عدد النسخ بين 1 و365' });
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
