'use strict';
/**
 * المراسلات بين الجهة والأمانة — سجل مكتوب لكل استفسار ونقص وملاحظة بدل البريد والهاتف،
 * مربوط بالملف وبالطلب أو الفاتورة أو الإقرار موضوع المراسلة، ومحفوظ في سجل التتبع.
 * لجنة منح الترخيص لا تملك هذه الصلاحية: يُحظر عليها التفاوض مع الطالب (المادة 20).
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('../db');
const { requireAuth, hasPerm, ownsLicensee, ownsAssociation, log } = require('../auth');
const { buildList } = require('../query');
const S = require('../services');

const r = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => cb(null, UPLOAD_DIR),
    filename: (_q, f, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(f.originalname || '')),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const CATEGORIES = ['inquiry', 'deficiency', 'financial', 'technical', 'complaint_followup', 'other'];
const TOPICS = {
  application:  (s, id) => db.prepare('SELECT reference ref FROM applications WHERE id=? AND subject_kind=? AND subject_id=?').get(id, s.kind, s.id),
  invoice:      (s, id) => db.prepare('SELECT invoice_no ref FROM invoices WHERE id=? AND subject_kind=? AND subject_id=?').get(id, s.kind, s.id),
  sanction:     (s, id) => db.prepare('SELECT case_no ref FROM sanctions WHERE id=? AND subject_kind=? AND subject_id=?').get(id, s.kind, s.id),
  declaration:  (s, id) => s.kind === 'licensee' ? db.prepare("SELECT 'إقرار ' || fiscal_year ref FROM compliance_declarations WHERE id=? AND licensee_id=?").get(id, s.id) : null,
  design:       (s, id) => s.kind === 'licensee' ? db.prepare('SELECT reference ref FROM design_approvals WHERE id=? AND licensee_id=?').get(id, s.id) : null,
  contribution: (s, id) => db.prepare(`SELECT reference ref FROM contributions WHERE id=? AND
      ((? = 'licensee' AND licensee_id=?) OR (? = 'association' AND association_id=?))`).get(id, s.kind, s.id, s.kind, s.id),
};
const TOPIC_LINK = { application: 'applications/', invoice: null, sanction: 'sanctions', declaration: 'declarations',
  design: 'designs', contribution: 'contributions' };

const isStaff = (u) => hasPerm(u, 'thread.staff');
const ownsSubject = (u, kind, id) => (kind === 'licensee' && ownsLicensee(u, id)) ||
  (kind === 'association' && ownsAssociation(u, id)) || (kind === 'user' && Number(id) === u.id);
const subjectName = (kind, id) => kind === 'licensee' ? db.prepare('SELECT legal_name n FROM licensees WHERE id=?').get(id)?.n
  : kind === 'association' ? db.prepare('SELECT name n FROM associations WHERE id=?').get(id)?.n
  : db.prepare('SELECT full_name n FROM users WHERE id=?').get(id)?.n;
/** مستخدمو الجهة: كل من يحمل دوراً على ملفها — أو صاحب الحساب نفسه للمراقب */
const subjectUsers = (kind, id) => kind === 'user' ? [Number(id)]
  : db.prepare('SELECT DISTINCT user_id FROM user_roles WHERE scope_kind=? AND scope_id=?').all(kind, id).map((x) => x.user_id);
/** توجيه المراسلة الجديدة إلى الوحدة المختصة */
const routeRole = (t) => t.category === 'financial' || t.topic_kind === 'invoice' ? 'FINANCE_OFFICER'
  : t.category === 'deficiency' || t.topic_kind === 'application' ? 'EVAL_DIRECTOR'
  : t.subject_kind === 'association' ? 'ORG_RELATIONS' : 'REGISTRY_OFFICER';

function scopeWhere(u) {
  if (isStaff(u)) return { where: [], params: [] };
  const parts = [], params = [];
  if (u.scopes.licensee.length) { parts.push(`(t.subject_kind='licensee' AND t.subject_id IN (${u.scopes.licensee.map(() => '?').join(',')}))`); params.push(...u.scopes.licensee); }
  if (u.scopes.association.length) { parts.push(`(t.subject_kind='association' AND t.subject_id IN (${u.scopes.association.map(() => '?').join(',')}))`); params.push(...u.scopes.association); }
  parts.push("(t.subject_kind='user' AND t.subject_id=?)"); params.push(u.id);
  return { where: ['(' + parts.join(' OR ') + ')'], params };
}
const canUse = (u) => isStaff(u) || hasPerm(u, 'thread.own');
const unreadSql = (u) => `(SELECT COUNT(*) FROM thread_messages m WHERE m.thread_id=t.id AND m.author_id IS NOT ${Number(u.id)}
    ${isStaff(u) ? '' : 'AND m.internal=0'}
    AND m.id > COALESCE((SELECT last_read_id FROM thread_reads tr WHERE tr.thread_id=t.id AND tr.user_id=${Number(u.id)}),0))`;

function attach(req, t, internal) {
  if (!req.file) return null;
  if (!S.uploadAllowed(req.file.originalname)) { S.discardUpload(req.file); const e = new Error('نوع الملف غير مسموح'); e.status = 415; throw e; }
  // مرفق الملاحظة الداخلية يُقيَّد باسم الأمانة سرّياً، فلا يظهر في إثباتات الجهة
  const doc = S.storeUpload(req.file, internal
    ? { owner_kind: 'secretariat', owner_id: null, doc_type: 'correspondence', title: `مرفق داخلي — ${t.reference}`, uploaded_by: req.user.id, confidential: true }
    : { owner_kind: t.subject_kind, owner_id: t.subject_id, doc_type: 'correspondence', title: `مرفق مراسلة ${t.reference} — ${req.file.originalname}`, uploaded_by: req.user.id });
  return doc.id;
}
const markRead = (tid, uid) => {
  const last = db.prepare('SELECT MAX(id) m FROM thread_messages WHERE thread_id=?').get(tid).m || 0;
  db.prepare(`INSERT INTO thread_reads (thread_id, user_id, last_read_id) VALUES (?,?,?)
      ON CONFLICT(thread_id, user_id) DO UPDATE SET last_read_id=excluded.last_read_id`).run(tid, uid, last);
};
const cleanBody = (b) => String(b || '').trim().slice(0, 8000);
const guard = (fn) => (req, res, next) => { try { return fn(req, res, next); } catch (e) {
  if (req.file) S.discardUpload(req.file);
  if (e.status) return res.status(e.status).json({ error: e.message }); return next(e); } };

// ---------------- القائمة ----------------
r.get('/threads', requireAuth, (req, res) => {
  if (!canUse(req.user)) return res.status(403).json({ error: 'لا تملك صلاحية المراسلات' });
  const sc = scopeWhere(req.user);
  const extra = [...sc.where];
  if (req.query.mine === '1' && isStaff(req.user)) { extra.push('t.assigned_to=?'); sc.params.push(req.user.id); }
  if (req.query.unread === '1') extra.push(`${unreadSql(req.user)} > 0`);
  const out = buildList(db, {
    table: `threads t LEFT JOIN licensees l ON t.subject_kind='licensee' AND l.id=t.subject_id
            LEFT JOIN associations o ON t.subject_kind='association' AND o.id=t.subject_id
            LEFT JOIN users su ON t.subject_kind='user' AND su.id=t.subject_id
            LEFT JOIN users au ON au.id=t.assigned_to`,
    columns: `t.id, t.reference, t.subject_kind, t.subject_id, COALESCE(l.legal_name, o.name, su.full_name) subject_name,
              t.topic_kind, t.topic_id, t.title, t.category, t.status, t.assigned_to, au.full_name assigned_name,
              t.created_at, t.updated_at, t.closed_at,
              (SELECT COUNT(*) FROM thread_messages m WHERE m.thread_id=t.id ${isStaff(req.user) ? '' : 'AND m.internal=0'}) messages,
              ${unreadSql(req.user)} unread`,
    filters: { status: { op: 'in', col: 't.status' }, category: { op: 'in', col: 't.category' },
      subject_kind: { op: 'in', col: 't.subject_kind' }, subject_id: { op: 'eq', col: 't.subject_id', num: true },
      topic_kind: { op: 'in', col: 't.topic_kind' }, topic_id: { op: 'eq', col: 't.topic_id', num: true },
      // الإسناد شأن داخلي — لا تفلتر به الجهة فتستدلّ على الموظف
      ...(isStaff(req.user) ? { assigned_to: { op: 'eq', col: 't.assigned_to', num: true } } : {}) },
    search: ['t.reference', 't.title', 'l.legal_name', 'o.name', 'su.full_name'],
    allowSort: ['updated_at', 'created_at', 'status'], defaultSort: 't.updated_at DESC, t.id DESC',
    req, extraWhere: extra, params: sc.params,
  });
  const stat = db.prepare(`SELECT t.status, COUNT(*) n FROM threads t ${sc.where.length ? 'WHERE ' + sc.where.join(' AND ') : ''} GROUP BY t.status`)
    .all(...sc.params.slice(0, sc.params.length - (req.query.mine === '1' && isStaff(req.user) ? 1 : 0)));
  if (!isStaff(req.user)) for (const x of out.rows) { x.assigned_to = null; x.assigned_name = null; }
  res.json({ ...out, by_status: stat });
});

r.get('/threads/unread', requireAuth, (req, res) => {
  if (!canUse(req.user)) return res.json({ unread: 0, awaiting: 0 });
  const sc = scopeWhere(req.user);
  const w = sc.where.length ? 'AND ' + sc.where.join(' AND ') : '';
  const unread = db.prepare(`SELECT COUNT(*) n FROM threads t WHERE ${unreadSql(req.user)} > 0 ${w}`).get(...sc.params).n;
  const awaiting = db.prepare(`SELECT COUNT(*) n FROM threads t WHERE t.status=? ${w}`)
    .get(isStaff(req.user) ? 'awaiting_staff' : 'awaiting_entity', ...sc.params).n;
  res.json({ unread, awaiting });
});

// ---------------- الإنشاء ----------------
r.post('/threads', requireAuth, upload.single('file'), guard((req, res) => {
  const b = req.body, staff = isStaff(req.user);
  if (!canUse(req.user)) { S.discardUpload(req.file); return res.status(403).json({ error: 'لا تملك صلاحية المراسلات' }); }
  let kind = b.subject_kind, id = Number(b.subject_id);
  if (!staff && !kind) {
    // الجهة لا تحتاج إلى تحديد ملفها: ملفها الوحيد، أو حسابها هي إن لم يكن لها ملف
    if (req.user.scopes.licensee[0]) { kind = 'licensee'; id = req.user.scopes.licensee[0]; }
    else if (req.user.scopes.association[0]) { kind = 'association'; id = req.user.scopes.association[0]; }
    else { kind = 'user'; id = req.user.id; }
  }
  if (!['licensee', 'association', 'user'].includes(kind) || !Number.isInteger(id) || id < 1) { S.discardUpload(req.file); return res.status(400).json({ error: 'الجهة غير محددة' }); }
  if (!subjectName(kind, id)) { S.discardUpload(req.file); return res.status(404).json({ error: 'الجهة غير موجودة' }); }
  if (!staff && !ownsSubject(req.user, kind, id)) { S.discardUpload(req.file); return res.status(403).json({ error: 'لا تراسل إلا بشأن ملفك' }); }
  const title = String(b.title || '').trim().slice(0, 200), body = cleanBody(b.body);
  if (title.length < 4) { S.discardUpload(req.file); return res.status(422).json({ error: 'اكتب عنواناً واضحاً للمراسلة' }); }
  if (body.length < 5) { S.discardUpload(req.file); return res.status(422).json({ error: 'اكتب نص الرسالة' }); }
  const category = CATEGORIES.includes(b.category) ? b.category : 'inquiry';
  let topic_kind = null, topic_id = null;
  if (b.topic_kind) {
    if (!Object.hasOwn(TOPICS, String(b.topic_kind)) || kind === 'user') { S.discardUpload(req.file); return res.status(400).json({ error: 'موضوع غير صالح' }); }
    topic_id = Number(b.topic_id);
    if (!Number.isInteger(topic_id) || !TOPICS[b.topic_kind]({ kind, id }, topic_id)) { S.discardUpload(req.file); return res.status(422).json({ error: 'الموضوع المحدد لا يخص هذا الملف' }); }
    topic_kind = b.topic_kind;
  }
  let t;
  const tx = db.transaction(() => {
    const tid = db.prepare(`INSERT INTO threads (reference, subject_kind, subject_id, topic_kind, topic_id, title, category, status, created_by, assigned_to)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(S.nextRef('MSG', 'threads'), kind, id, topic_kind, topic_id, title, category,
      staff ? 'awaiting_entity' : 'awaiting_staff', req.user.id, staff ? req.user.id : null).lastInsertRowid;
    t = db.prepare('SELECT * FROM threads WHERE id=?').get(tid);
    const doc = attach(req, t, false);
    db.prepare('INSERT INTO thread_messages (thread_id, author_id, author_side, body, document_id) VALUES (?,?,?,?,?)')
      .run(tid, req.user.id, staff ? 'staff' : 'entity', body, doc);
    markRead(tid, req.user.id);
  });
  tx();
  if (staff) for (const u of subjectUsers(kind, id)) S.notify({ user_id: u, title: `مراسلة من الأمانة: ${title}`, body: `${t.reference} — ${body.slice(0, 160)}`, link: `#/messages/${t.id}` });
  else S.notify({ role_code: routeRole(t), title: `مراسلة جديدة من ${subjectName(kind, id)}`, body: `${t.reference}: ${title}`, link: `#/messages/${t.id}` });
  log(req, 'thread.create', 'thread', t.id, `${t.reference}: ${title}`);
  res.status(201).json(t);
}));

// ---------------- العرض ----------------
function loadThread(req, res) {
  if (!canUse(req.user)) { res.status(403).json({ error: 'لا تملك صلاحية المراسلات' }); return null; }
  const t = db.prepare('SELECT * FROM threads WHERE id=?').get(Number(req.params.id));
  if (!t) { res.status(404).json({ error: 'غير موجود' }); return null; }
  if (!isStaff(req.user) && !ownsSubject(req.user, t.subject_kind, t.subject_id)) { res.status(403).json({ error: 'غير مصرَّح' }); return null; }
  return t;
}

r.get('/threads/:id', requireAuth, (req, res) => {
  const t = loadThread(req, res); if (!t) return;
  const staff = isStaff(req.user);
  const msgs = db.prepare(`SELECT m.id, m.author_side, m.internal, m.body, m.created_at, m.document_id, m.author_id,
        u.full_name author_name, d.title doc_title, d.file_name doc_file, d.size_bytes doc_size
      FROM thread_messages m LEFT JOIN users u ON u.id=m.author_id LEFT JOIN documents d ON d.id=m.document_id
      WHERE m.thread_id=? ${staff ? '' : 'AND m.internal=0'} ORDER BY m.id`).all(t.id)
    // الجهة ترى «الأمانة التنفيذية» لا الموظف: لا اسمه ولا رقم حسابه — والأمانة ترى الاسم كاملاً
    .map((m) => (m.author_side === 'staff' && !staff ? { ...m, author_name: 'الأمانة التنفيذية', author_id: null } : m));
  const topic = t.topic_kind ? { kind: t.topic_kind, id: t.topic_id, ref: TOPICS[t.topic_kind]({ kind: t.subject_kind, id: t.subject_id }, t.topic_id)?.ref,
    link: TOPIC_LINK[t.topic_kind] ? '#/' + TOPIC_LINK[t.topic_kind] + (TOPIC_LINK[t.topic_kind].endsWith('/') ? t.topic_id : '') : null } : null;
  markRead(t.id, req.user.id);
  const masked = staff ? t : { ...t, assigned_to: null, closed_by: null, created_by: t.created_by === req.user.id ? t.created_by : null };
  res.json({ ...masked, subject_name: subjectName(t.subject_kind, t.subject_id), topic, messages: msgs,
    assigned_name: staff && t.assigned_to ? db.prepare('SELECT full_name n FROM users WHERE id=?').get(t.assigned_to)?.n : null,
    staff_view: staff,
    staff_users: staff ? db.prepare(`SELECT DISTINCT u.id, u.full_name FROM users u JOIN user_roles ur ON ur.user_id=u.id
        WHERE u.status='active' AND ur.role_code IN (${require('../rbac').ROLES.filter((x) => x.perms.includes('thread.staff')).map((x) => `'${x.code}'`).join(',')})
        ORDER BY u.full_name`).all() : undefined });
});

// ---------------- الرد ----------------
r.post('/threads/:id/messages', requireAuth, upload.single('file'), guard((req, res) => {
  const t = loadThread(req, res); if (!t) { S.discardUpload(req.file); return; }
  const staff = isStaff(req.user);
  const internal = staff && (req.body.internal === true || req.body.internal === '1' || req.body.internal === 'true');
  const body = cleanBody(req.body.body);
  if (body.length < 2) { S.discardUpload(req.file); return res.status(422).json({ error: 'اكتب نص الرسالة' }); }
  if (t.status === 'closed' && !staff) { S.discardUpload(req.file); return res.status(409).json({ error: 'المراسلة مغلقة — افتح مراسلة جديدة' }); }
  let mid;
  const tx = db.transaction(() => {
    const doc = attach(req, t, internal);
    mid = db.prepare('INSERT INTO thread_messages (thread_id, author_id, author_side, internal, body, document_id) VALUES (?,?,?,?,?,?)')
      .run(t.id, req.user.id, staff ? 'staff' : 'entity', internal ? 1 : 0, body, doc).lastInsertRowid;
    if (!internal) db.prepare(`UPDATE threads SET status=?, updated_at=datetime('now'), closed_at=NULL, closed_by=NULL,
        assigned_to=COALESCE(assigned_to, ?) WHERE id=?`).run(staff ? 'awaiting_entity' : 'awaiting_staff', staff ? req.user.id : null, t.id);
    // الملاحظة الداخلية لا تغيّر ما تراه الجهة — ولا حتى وقت آخر تحديث
    markRead(t.id, req.user.id);
  });
  tx();
  if (!internal) {
    if (staff) for (const u of subjectUsers(t.subject_kind, t.subject_id)) S.notify({ user_id: u, title: `رد الأمانة: ${t.title}`, body: `${t.reference} — ${body.slice(0, 160)}`, link: `#/messages/${t.id}` });
    else if (t.assigned_to) S.notify({ user_id: t.assigned_to, title: `رد من ${subjectName(t.subject_kind, t.subject_id)}`, body: `${t.reference}: ${body.slice(0, 160)}`, link: `#/messages/${t.id}` });
    else S.notify({ role_code: routeRole(t), title: `رد من ${subjectName(t.subject_kind, t.subject_id)}`, body: `${t.reference}: ${t.title}`, link: `#/messages/${t.id}` });
  }
  log(req, internal ? 'thread.note' : 'thread.reply', 'thread', t.id, `${t.reference}${internal ? ' (ملاحظة داخلية)' : ''}`);
  res.status(201).json({ id: mid });
}));

r.post('/threads/:id/assign', requireAuth, (req, res) => {
  const t = loadThread(req, res); if (!t) return;
  if (!isStaff(req.user)) return res.status(403).json({ error: 'الإسناد للأمانة' });
  const uid = Number(req.body.user_id);
  const target = uid && require('../auth').loadUser(uid);
  if (!target || target.status !== 'active' || !hasPerm(target, 'thread.staff')) return res.status(422).json({ error: 'يُسند إلى موظف يملك صلاحية المراسلات' });
  db.prepare('UPDATE threads SET assigned_to=? WHERE id=?').run(uid, t.id);
  if (uid !== req.user.id) S.notify({ user_id: uid, title: 'أُسندت إليك مراسلة', body: `${t.reference}: ${t.title}`, link: `#/messages/${t.id}` });
  log(req, 'thread.assign', 'thread', t.id, `إسناد إلى ${target.full_name}`);
  res.json({ ok: true });
});

r.post('/threads/:id/close', requireAuth, (req, res) => {
  const t = loadThread(req, res); if (!t) return;
  if (t.status === 'closed') return res.status(409).json({ error: 'المراسلة مغلقة بالفعل' });
  db.prepare("UPDATE threads SET status='closed', closed_at=datetime('now'), closed_by=?, updated_at=datetime('now') WHERE id=?").run(req.user.id, t.id);
  log(req, 'thread.close', 'thread', t.id, t.reference);
  res.json({ ok: true });
});

r.post('/threads/:id/reopen', requireAuth, (req, res) => {
  const t = loadThread(req, res); if (!t) return;
  if (!isStaff(req.user)) return res.status(403).json({ error: 'إعادة الفتح للأمانة — أو افتح مراسلة جديدة' });
  if (t.status !== 'closed') return res.status(409).json({ error: 'المراسلة مفتوحة' });
  db.prepare("UPDATE threads SET status='awaiting_staff', closed_at=NULL, closed_by=NULL, updated_at=datetime('now') WHERE id=?").run(t.id);
  log(req, 'thread.reopen', 'thread', t.id, t.reference);
  res.json({ ok: true });
});

module.exports = r;
