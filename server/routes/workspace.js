'use strict';
/** أدوات مساحة العمل: البحث الشامل · تقويم المواعيد النظامية · النسخ الاحتياطي */
const express = require('express');
const fs = require('fs');
const { db } = require('../db');
const { can, requireAuth, hasPerm, log } = require('../auth');
const B = require('../backup');
const S = require('../services');

const r = express.Router();
const today = () => new Date().toISOString().slice(0, 10);
const inList = (arr) => arr.map(() => '?').join(',') || 'NULL';

/**
 * نطاق الجهة لكل جدول: من يملك الصلاحية العامة يرى الكل، وصاحب الملف يرى ما يخص ملفه فقط.
 * يُرجع [شرط, معاملات] أو null إن لم يكن له أن يرى شيئاً.
 */
function scope(u, perm, { lic, org, user } = {}) {
  if (perm && hasPerm(u, perm)) return ['1=1', []];
  const parts = [], params = [];
  if (lic && u.scopes.licensee.length) { parts.push(`${lic} IN (${inList(u.scopes.licensee)})`); params.push(...u.scopes.licensee); }
  if (org && u.scopes.association.length) { parts.push(`${org} IN (${inList(u.scopes.association)})`); params.push(...u.scopes.association); }
  if (user) { parts.push(`${user} = ?`); params.push(u.id); }
  return parts.length ? ['(' + parts.join(' OR ') + ')', params] : null;
}
const subjScope = (u, perm, kindCol, idCol) => {
  if (hasPerm(u, perm)) return ['1=1', []];
  const parts = [], params = [];
  if (u.scopes.licensee.length) { parts.push(`(${kindCol}='licensee' AND ${idCol} IN (${inList(u.scopes.licensee)}))`); params.push(...u.scopes.licensee); }
  if (u.scopes.association.length) { parts.push(`(${kindCol}='association' AND ${idCol} IN (${inList(u.scopes.association)}))`); params.push(...u.scopes.association); }
  return parts.length ? ['(' + parts.join(' OR ') + ')', params] : null;
};

// ================= البحث الشامل =================
r.get('/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q.length < 2) return res.status(400).json({ error: 'حرفان على الأقل' });
  const like = `%${q}%`, u = req.user, groups = [];
  const add = (key, title, sc, sql, map, n = 3) => {
    if (!sc) return;
    const rows = db.prepare(sql.replace('{SCOPE}', sc[0])).all(...Array(n).fill(like), ...sc[1]).map(map);
    if (rows.length) groups.push({ key, title, rows });
  };
  add('licensees', 'المرخَّص لهم', scope(u, 'licensee.view.all', { lic: 'id' }),
    `SELECT id, legal_name, trade_name, license_no, status FROM licensees WHERE (legal_name LIKE ? OR trade_name LIKE ? OR license_no LIKE ? OR commercial_reg LIKE ?) AND {SCOPE} ORDER BY legal_name LIMIT 8`,
    (x) => ({ title: x.legal_name, sub: [x.license_no, x.trade_name].filter(Boolean).join(' · '), status: x.status, link: `#/licensees/${x.id}` }), 4);
  add('associations', 'المنظمات', scope(u, 'org.view.all', { org: 'id' }),
    `SELECT id, name, accreditation_no, registration_no, status FROM associations WHERE (name LIKE ? OR accreditation_no LIKE ? OR registration_no LIKE ?) AND {SCOPE} ORDER BY name LIMIT 8`,
    (x) => ({ title: x.name, sub: x.accreditation_no || x.registration_no, status: x.status, link: `#/associations/${x.id}` }));
  // من لا يرى الملفات كلها يجد السجل العام — وهو مفتوح للعموم أصلاً
  if (!hasPerm(u, 'licensee.view.all')) add('registry', 'السجل العام', ['1=1', []],
    `SELECT license_no, legal_name, trade_name, status FROM v_public_registry_licensees WHERE (legal_name LIKE ? OR trade_name LIKE ? OR license_no LIKE ?) AND {SCOPE} LIMIT 8`,
    (x) => ({ title: x.legal_name, sub: x.license_no, status: x.status, link: `#/verify/${encodeURIComponent(x.license_no)}` }));
  const appSc = hasPerm(u, 'app.view.all') ? ['1=1', []] : (() => { const s = subjScope(u, 'app.view.all', 'a.subject_kind', 'a.subject_id');
    return s ? [`(${s[0]} OR a.applicant_user_id=?)`, [...s[1], u.id]] : ['a.applicant_user_id=?', [u.id]]; })();
  add('applications', 'الطلبات', appSc,
    `SELECT a.id, a.reference, a.app_type, a.status, COALESCE(l.legal_name, o.name) nm FROM applications a
       LEFT JOIN licensees l ON a.subject_kind='licensee' AND l.id=a.subject_id LEFT JOIN associations o ON a.subject_kind='association' AND o.id=a.subject_id
     WHERE (a.reference LIKE ? OR l.legal_name LIKE ? OR o.name LIKE ?) AND {SCOPE} ORDER BY a.id DESC LIMIT 8`,
    (x) => ({ title: x.reference, sub: x.nm, status: x.status, link: `#/applications/${x.id}` }));
  add('invoices', 'الفواتير', subjScope(u, 'finance.view.all', 'subject_kind', 'subject_id'),
    `SELECT id, invoice_no, subject_name, amount, status FROM invoices WHERE (invoice_no LIKE ? OR subject_name LIKE ?) AND {SCOPE} ORDER BY id DESC LIMIT 8`,
    (x) => ({ title: x.invoice_no, sub: `${x.subject_name} · ${Math.round(x.amount).toLocaleString('ar-LY')} د.ل`, status: x.status, link: hasPerm(u, 'finance.view.all') ? `#/finance?q=${encodeURIComponent(x.invoice_no)}` : '#/my-licensee' }), 2);
  add('sanctions', 'الجزاءات', subjScope(u, 'sanction.view.all', 'subject_kind', 'subject_id'),
    `SELECT id, case_no, subject_name, measure, status FROM sanctions WHERE (case_no LIKE ? OR subject_name LIKE ?) AND {SCOPE} ORDER BY id DESC LIMIT 8`,
    (x) => ({ title: x.case_no, sub: x.subject_name, status: x.status, link: `#/sanctions?q=${encodeURIComponent(x.case_no)}` }), 2);
  add('appeals', 'التظلمات', subjScope(u, 'appeal.view.all', 'appellant_kind', 'appellant_id'),
    `SELECT id, reference, appellant_name, status FROM appeals WHERE (reference LIKE ? OR appellant_name LIKE ?) AND {SCOPE} ORDER BY id DESC LIMIT 8`,
    (x) => ({ title: x.reference, sub: x.appellant_name, status: x.status, link: `#/appeals?q=${encodeURIComponent(x.reference)}` }), 2);
  add('contributions', 'المساهمات', hasPerm(u, 'contribution.verify') ? ['1=1', []] : scope(u, 'commitment.view.all', { lic: 'c.licensee_id', org: 'c.association_id' }),
    `SELECT c.id, c.reference, c.amount, c.status, l.legal_name ln, o.name onm FROM contributions c
       LEFT JOIN licensees l ON l.id=c.licensee_id LEFT JOIN associations o ON o.id=c.association_id
     WHERE (c.reference LIKE ? OR l.legal_name LIKE ? OR o.name LIKE ?) AND {SCOPE} ORDER BY c.id DESC LIMIT 8`,
    (x) => ({ title: x.reference, sub: `${x.ln || ''} ← ${x.onm || ''}`, status: x.status, link: `#/contributions?q=${encodeURIComponent(x.reference)}` }));
  if (hasPerm(u, 'complaint.triage')) add('complaints', 'البلاغات', ['1=1', []],
    `SELECT id, reference, subject_name, status FROM complaints WHERE (reference LIKE ? OR subject_name LIKE ?) AND {SCOPE} ORDER BY id DESC LIMIT 8`,
    (x) => ({ title: x.reference, sub: x.subject_name, status: x.status, link: `#/complaints?q=${encodeURIComponent(x.reference)}` }), 2);
  if (hasPerm(u, 'audit.view.all')) add('audits', 'عمليات التدقيق', ['1=1', []],
    `SELECT id, reference, audit_type, status FROM audits WHERE (reference LIKE ?) AND {SCOPE} ORDER BY id DESC LIMIT 8`,
    (x) => ({ title: x.reference, sub: x.audit_type, status: x.status, link: `#/audits?q=${encodeURIComponent(x.reference)}` }), 1);
  if (hasPerm(u, 'doc.view.all')) add('documents', 'الإثباتات', (() => { const cf = S.correspondenceFilter(u, 'documents');
      return [`${hasPerm(u, 'doc.view.confidential') ? '1=1' : 'confidential=0'} AND ${cf.sql}`, cf.params]; })(),
    `SELECT id, title, verification FROM documents WHERE (title LIKE ? OR sha256 LIKE ?) AND {SCOPE} ORDER BY id DESC LIMIT 8`,
    (x) => ({ title: x.title, sub: 'إثبات', status: x.verification, link: `#/documents?q=${encodeURIComponent(x.title)}` }), 2);
  if (hasPerm(u, 'admin.users')) add('users', 'المستخدمون', ['1=1', []],
    `SELECT id, full_name, email, status FROM users WHERE (full_name LIKE ? OR email LIKE ?) AND {SCOPE} ORDER BY full_name LIMIT 8`,
    (x) => ({ title: x.full_name, sub: x.email, status: x.status, link: `#/users?q=${encodeURIComponent(x.email)}` }), 2);
  if (hasPerm(u, 'thread.staff') || hasPerm(u, 'thread.own')) {
    const s = hasPerm(u, 'thread.staff') ? ['1=1', []] : (() => { const x = subjScope(u, '-', 'subject_kind', 'subject_id');
      return x ? [`(${x[0]} OR (subject_kind='user' AND subject_id=?))`, [...x[1], u.id]] : ["(subject_kind='user' AND subject_id=?)", [u.id]]; })();
    add('threads', 'المراسلات', s, `SELECT id, reference, title, status FROM threads WHERE (reference LIKE ? OR title LIKE ?) AND {SCOPE} ORDER BY id DESC LIMIT 8`,
      (x) => ({ title: x.title, sub: x.reference, status: x.status, link: `#/messages/${x.id}` }), 2);
  }
  res.json({ q, groups, total: groups.reduce((a, g) => a + g.rows.length, 0) });
});

// ================= تقويم المواعيد =================
r.get('/calendar', requireAuth, (req, res) => {
  const d = /^\d{4}-\d{2}-\d{2}$/;
  const from = d.test(req.query.from) ? req.query.from : new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const to = d.test(req.query.to) ? req.query.to : new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  if (to < from) return res.status(400).json({ error: 'نهاية المدى قبل بدايته' });
  const u = req.user, ev = [], t = today();
  const push = (kind, rows, map) => rows.forEach((x) => { const e = map(x); if (e && e.date) ev.push({ kind, ...e, overdue: e.date < t && !e.done }); });
  const q = (sql, sc, ...extra) => sc ? db.prepare(sql.replace('{SCOPE}', sc[0])).all(...extra, ...sc[1]) : [];

  // الطلبات: موعد المرحلة الجارية والمدة المعيارية الكلية (المادة 17)
  const appSc = hasPerm(u, 'app.view.all') ? ['1=1', []] : (() => { const s = subjScope(u, 'app.view.all', 'a.subject_kind', 'a.subject_id');
    return s ? [`(${s[0]} OR a.applicant_user_id=?)`, [...s[1], u.id]] : ['a.applicant_user_id=?', [u.id]]; })();
  push('application', q(`SELECT a.id, a.reference, a.status, a.completeness_due_at, a.assessment_due_at, a.sla_due_at, COALESCE(l.legal_name, o.name) nm
      FROM applications a LEFT JOIN licensees l ON a.subject_kind='licensee' AND l.id=a.subject_id LEFT JOIN associations o ON a.subject_kind='association' AND o.id=a.subject_id
      WHERE a.status NOT IN ('approved','rejected','shelved','withdrawn') AND {SCOPE}`, appSc), (x) => {
    const due = ['submitted', 'completing'].includes(x.status) ? [x.completeness_due_at, 'فحص الاستيفاء']
      : ['assessment', 'field_visit'].includes(x.status) ? [x.assessment_due_at, 'التقييم الموضوعي'] : [x.sla_due_at, 'المدة المعيارية الكلية'];
    return { date: String(due[0] || x.sla_due_at || '').slice(0, 10), title: `${x.reference} — ${due[1]}`, sub: x.nm, link: `#/applications/${x.id}`, severity: 'info' };
  });
  push('license_expiry', q(`SELECT id, legal_name, license_no, end_date FROM licensees WHERE status='active' AND end_date BETWEEN ? AND ? AND {SCOPE}`,
    scope(u, 'licensee.view.all', { lic: 'id' }), from, to),
  (x) => ({ date: x.end_date, title: `انتهاء ترخيص ${x.license_no}`, sub: x.legal_name, link: `#/licensees/${x.id}`, severity: 'warn' }));
  push('accreditation_expiry', q(`SELECT id, name, accredited_to FROM associations WHERE status='accredited' AND accredited_to BETWEEN ? AND ? AND {SCOPE}`,
    scope(u, 'org.view.all', { org: 'id' }), from, to),
  (x) => ({ date: x.accredited_to, title: 'انتهاء الاعتماد', sub: x.name, link: `#/associations/${x.id}`, severity: 'warn' }));
  push('declaration', q(`SELECT cd.id, cd.fiscal_year, cd.due_at, cd.decision_due, cd.submitted_at, cd.status, l.legal_name, l.id lid
      FROM compliance_declarations cd JOIN licensees l ON l.id=cd.licensee_id
      WHERE ((cd.submitted_at IS NULL AND cd.due_at BETWEEN ? AND ?) OR (cd.status='submitted' AND cd.decision_due BETWEEN ? AND ?)) AND {SCOPE}`,
    scope(u, 'commitment.view.all', { lic: 'cd.licensee_id' }), from, to, from, to),
  (x) => x.submitted_at ? { date: x.decision_due, title: `القرار في إقرار ${x.fiscal_year}`, sub: x.legal_name, link: '#/declarations', severity: 'info' }
    : { date: x.due_at, title: `موعد إقرار الامتثال ${x.fiscal_year}`, sub: x.legal_name, link: hasPerm(u, 'commitment.view.all') ? '#/declarations' : '#/commitments', severity: 'warn' });
  push('invoice', q(`SELECT id, invoice_no, subject_name, amount, due_at FROM invoices WHERE status IN ('issued','overdue') AND due_at <= ? AND {SCOPE}`,
    subjScope(u, 'finance.view.all', 'subject_kind', 'subject_id'), to),
  (x) => ({ date: x.due_at, title: `استحقاق ${x.invoice_no} (${Math.round(x.amount).toLocaleString('ar-LY')} د.ل)`, sub: x.subject_name,
    link: hasPerm(u, 'finance.view.all') ? '#/finance' : '#/my-licensee', severity: 'warn' }));
  push('design', q(`SELECT d.id, d.reference, d.title, d.due_at, l.legal_name FROM design_approvals d JOIN licensees l ON l.id=d.licensee_id
      WHERE d.status='pending' AND {SCOPE}`, hasPerm(u, 'design.decide') ? ['1=1', []] : scope(u, null, { lic: 'd.licensee_id' })),
  (x) => ({ date: String(x.due_at || '').slice(0, 10), title: `${x.reference} — تصير الموافقة ضمنية`, sub: `${x.legal_name}: ${x.title}`, link: '#/designs', severity: 'warn' }));
  push('appeal', q(`SELECT id, reference, appellant_name, decision_due_at FROM appeals WHERE status NOT IN ('decided','inadmissible') AND {SCOPE}`,
    subjScope(u, 'appeal.view.all', 'appellant_kind', 'appellant_id')),
  (x) => ({ date: String(x.decision_due_at || '').slice(0, 10), title: `البتّ في التظلم ${x.reference}`, sub: x.appellant_name, link: '#/appeals', severity: 'info' }));
  push('suspension', q(`SELECT id, case_no, subject_name, effective_to FROM sanctions WHERE measure='suspension' AND status IN ('active','appealed')
      AND effective_to BETWEEN ? AND ? AND {SCOPE}`, subjScope(u, 'sanction.view.all', 'subject_kind', 'subject_id'), from, to),
  (x) => ({ date: x.effective_to, title: `${x.case_no} — يتحول التعليق إلى سحب`, sub: x.subject_name, link: '#/sanctions', severity: 'danger' }));
  if (hasPerm(u, 'integrity.note') || hasPerm(u, 'integrity.publish') || hasPerm(u, 'gov.appoint'))
    push('integrity', db.prepare("SELECT id, reference, title, response_due_at FROM integrity_notes WHERE status='open' AND responded_at IS NULL").all(),
      (x) => ({ date: String(x.response_due_at || '').slice(0, 10), title: `${x.reference} — مهلة رد المجلس`, sub: x.title, link: '#/integrity', severity: 'warn' }));
  // التدقيق المجدول: صاحب الملف لا يرى الزيارة غير المعلنة قبل تنفيذها (المادة 26/3)
  const audSc = hasPerm(u, 'audit.view.all') ? ['1=1', []] : (() => { const s = subjScope(u, '-', 'subject_kind', 'subject_id');
    return s ? [`(${s[0]} AND audit_type!='unannounced')`, s[1]] : null; })();
  push('audit', q(`SELECT id, reference, audit_type, scheduled_date FROM audits WHERE status='planned' AND scheduled_date BETWEEN ? AND ? AND {SCOPE}`, audSc, from, to),
    (x) => ({ date: x.scheduled_date, title: `${x.reference} — ${x.audit_type === 'unannounced' ? 'زيارة غير معلنة' : x.audit_type === 'field' ? 'تدقيق ميداني' : 'تدقيق مكتبي'}`,
      link: hasPerm(u, 'audit.view.all') ? '#/audits' : '#/my-licensee', severity: 'info' }));
  if (hasPerm(u, 'gov.meetings.view') || hasPerm(u, 'gov.attend')) {
    const obsOnly = !hasPerm(u, 'gov.meetings.view');
    push('meeting', db.prepare(`SELECT id, body, title, held_on FROM meetings WHERE held_on BETWEEN ? AND ? ${obsOnly ? "AND body='board'" : ''}`).all(from, to),
      (x) => ({ date: x.held_on, title: x.title, link: '#/meetings', severity: 'info', done: x.held_on < t }));
  }
  push('consultation', db.prepare("SELECT id, reference, title, consultation_end FROM standards_proposals WHERE status='consultation' AND consultation_end BETWEEN ? AND ?").all(from, to),
    (x) => ({ date: x.consultation_end, title: `نهاية المشاورة ${x.reference}`, sub: x.title, link: `#/consultations`, severity: 'info' }));

  const inRange = ev.filter((e) => (e.date >= from && e.date <= to) || e.overdue).sort((a, b) => a.date.localeCompare(b.date));
  res.json({ from, to, today: t, events: inRange,
    counts: { total: inRange.length, overdue: inRange.filter((e) => e.overdue).length, next7: inRange.filter((e) => e.date >= t && e.date <= new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).length } });
});

// ================= النسخ الاحتياطي =================
r.get('/backups', requireAuth, can('admin.backup'), (_req, res) => {
  res.json({ rows: B.list(), keep: Number(db.prepare("SELECT v FROM settings WHERE k='backup_keep'").get()?.v) || 14 });
});
r.post('/backups', requireAuth, can('admin.backup'), (req, res) => {
  // كل نسخة تحجز القاعدة لحظات — فلا أكثر من نسخة في الدقيقة (SEMA_BACKUP_MIN_SECONDS)
  const gap = Math.max(1, Number(process.env.SEMA_BACKUP_MIN_SECONDS) || 60);
  if (db.prepare('SELECT 1 FROM backups WHERE created_at > datetime(\'now\', ?)').get(`-${gap} seconds`))
    return res.status(429).json({ error: 'أُنشئت نسخة قبل قليل — أعد المحاولة بعد دقيقة' });
  const b = B.makeBackup(req.user.full_name);
  log(req, 'backup.create', 'backup', b.id, `${b.file_name} · ${b.integrity}`);
  res.status(201).json(b);
});
r.get('/backups/:id/download', requireAuth, can('admin.backup'), (req, res) => {
  const b = db.prepare('SELECT * FROM backups WHERE id=?').get(Number(req.params.id));
  if (!b || b.deleted_at || !fs.existsSync(B.fileOf(b))) return res.status(404).json({ error: 'النسخة غير متاحة' });
  log(req, 'backup.download', 'backup', b.id, b.file_name);
  res.setHeader('Content-Type', 'application/vnd.sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="${b.file_name}"`);
  fs.createReadStream(B.fileOf(b)).pipe(res);
});

module.exports = r;
