'use strict';
/** خدمات مشتركة بين المسارات والمهام الآلية — مصدر واحد لكل أثر جانبي نظامي */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, UPLOAD_DIR } = require('./db');
const R = require('./rules');
const REF = require('./reference');

const today = () => new Date().toISOString().slice(0, 10);

function nextRef(prefix, table) {
  const n = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n + 1;
  let ref = `${prefix}-${String(n).padStart(5, '0')}`;
  // تفادي التصادم إن حُذف سجل سابقاً
  const col = { applications: 'reference', audits: 'reference', sanctions: 'case_no', appeals: 'reference',
    invoices: 'invoice_no', contributions: 'reference', design_approvals: 'reference', observers: 'reference',
    integrity_notes: 'reference', complaints: 'reference', standards_proposals: 'reference' }[table];
  if (col) { let k = n; while (db.prepare(`SELECT 1 FROM ${table} WHERE ${col}=?`).get(ref)) ref = `${prefix}-${String(++k).padStart(5, '0')}`; }
  return ref;
}

// ---------- الملفات ----------
/** الأنواع المسموح بتحميلها من المستخدمين — لا HTML ولا SVG منعاً لحقن السكربت */
const ALLOWED_UPLOADS = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.txt': 'text/plain', '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
function uploadAllowed(originalName) {
  return Object.prototype.hasOwnProperty.call(ALLOWED_UPLOADS, path.extname(originalName || '').toLowerCase());
}

/** يحفظ ملفاً مرفوعاً (multer) ويقيّده في جدول الإثباتات */
function storeUpload(file, meta) {
  const buf = fs.readFileSync(file.path);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const ext = path.extname(file.originalname || '').toLowerCase();
  const info = db.prepare(`INSERT INTO documents (owner_kind, owner_id, doc_type, title, file_name, stored_name,
      mime_type, size_bytes, sha256, issued_on, expires_on, uploaded_by, confidential, is_public)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    meta.owner_kind, meta.owner_id ?? null, meta.doc_type || null, meta.title || file.originalname,
    file.originalname, file.filename, ALLOWED_UPLOADS[ext] || file.mimetype, file.size, sha,
    meta.issued_on || null, meta.expires_on || null, meta.uploaded_by || null,
    meta.confidential ? 1 : 0, meta.is_public ? 1 : 0);
  return { id: info.lastInsertRowid, sha256: sha };
}
function discardUpload(file) { try { if (file?.path) fs.unlinkSync(file.path); } catch { /* تجاهل */ } }

// ---------- الإشعارات ----------
function notify({ user_id, role_code, title, body, severity = 'info', link = null }) {
  const st = db.prepare('INSERT INTO notifications (user_id, role_code, title, body, severity, link) VALUES (?,?,?,?,?,?)');
  if (role_code && !user_id) {
    for (const u of db.prepare('SELECT DISTINCT user_id FROM user_roles WHERE role_code=?').all(role_code))
      st.run(u.user_id, role_code, title, body, severity, link);
    return;
  }
  st.run(user_id || null, role_code || null, title, body, severity, link);
}
const ownerOf = (kind, id) => db.prepare(
  'SELECT user_id FROM user_roles WHERE scope_kind=? AND scope_id=? LIMIT 1').get(kind, id)?.user_id;

// ---------- مسار الطلب ----------
function openStages(appId, actorId) {
  const st = db.prepare(`INSERT INTO application_stages (application_id, stage, stage_name_ar, responsible_body,
      max_days, started_at, completed_at, actor_id) VALUES (?,?,?,?,?,?,?,?)`);
  const t = today();
  REF.APP_STAGES.forEach(([stage, name, body, days]) =>
    st.run(appId, stage, name, body, days, stage <= 2 ? t : null, stage === 1 ? t : null, stage === 1 ? actorId : null));
}

function closeStage(appId, stage, actorId, note) {
  const s = db.prepare('SELECT * FROM application_stages WHERE application_id=? AND stage=?').get(appId, stage);
  if (!s) return;
  const started = s.started_at || today();
  const breached = s.max_days ? R.daysBetween(started, today()) > Math.ceil(s.max_days * 7 / 5) : false;
  db.prepare(`UPDATE application_stages SET started_at=COALESCE(started_at, date('now')), completed_at=date('now'),
      actor_id=?, note=?, breached_sla=? WHERE id=?`).run(actorId, note || null, breached ? 1 : 0, s.id);
  const nxt = db.prepare('SELECT * FROM application_stages WHERE application_id=? AND stage=?').get(appId, stage + 1);
  if (nxt && !nxt.started_at) db.prepare("UPDATE application_stages SET started_at=date('now') WHERE id=?").run(nxt.id);
}

/** إنشاء طلب مع مراحله التسع وفاتورة رسم الطلب (للمنشآت فقط — المنظمات معفاة، المادة 12) */
function createApplication({ app_type, subject_kind, subject_id, applicant_user_id, requested_level, self_registered }) {
  const t = today();
  const ref = nextRef('APP', 'applications');
  const id = db.prepare(`INSERT INTO applications (reference, app_type, subject_kind, subject_id, applicant_user_id,
      requested_level, stage, status, completeness_due_at, sla_due_at, self_registered)
      VALUES (?,?,?,?,?,?,2,'submitted',?,?,?)`).run(ref, app_type, subject_kind, subject_id || null,
    applicant_user_id || null, requested_level || null, R.addWorkDays(t, 10), R.addWorkDays(t, 90),
    self_registered ? 1 : 0).lastInsertRowid;
  openStages(id, applicant_user_id);
  if (subject_kind === 'licensee' && ['license', 'level_upgrade', 'license_renewal'].includes(app_type)) {
    if (!['license_renewal', 'level_upgrade'].includes(app_type))
      db.prepare("UPDATE licensees SET status='submitted' WHERE id=? AND status IN ('draft','rejected','expired')").run(subject_id);
    if (app_type === 'license') {
      const l = db.prepare('SELECT * FROM licensees WHERE id=?').get(subject_id);
      const fees = R.computeFees({ revenue: l.annual_revenue, level: requested_level || l.level });
      db.prepare(`INSERT INTO invoices (invoice_no, subject_kind, subject_id, subject_name, fee_type, fiscal_year, tier_code,
          level, base_amount, amount, issued_at, due_at, status, refundable)
          VALUES (?,?,?,?,'application',?,?,?,?,?,date('now'),?,'issued',0)`).run(nextRef('INV', 'invoices'),
        'licensee', subject_id, l.legal_name, Number(t.slice(0, 4)), l.tier_code, requested_level || l.level,
        fees.application_fee, fees.application_fee, R.addDays(t, 14));
    }
  }
  if (subject_kind === 'association' && app_type === 'accreditation')
    db.prepare("UPDATE associations SET status='submitted' WHERE id=? AND status IN ('draft','rejected','expired')").run(subject_id);
  notify({ role_code: 'EVAL_DIRECTOR', title: 'طلب جديد بانتظار فحص الاستيفاء',
    body: `${ref} — أمام الوحدة عشرة أيام عمل (المادة 17/2)`, link: `#/applications/${id}` });
  return db.prepare('SELECT * FROM applications WHERE id=?').get(id);
}

// ---------- الجزاءات ----------
/**
 * يُصدر جزاءً بكامل آثاره النظامية: حالة الجهة في السجل، مدد التعليق والتصعيد،
 * النشر وحظر إعادة التقديم، وإخطار المنظمات المتلقية (المواد 29–32).
 */
function createSanction(actorId, { subject_kind, subject_id, subject_name, violation_code, measure, reason,
  source_audit_id, fine_amount, grace_days, auto = false }) {
  const v = db.prepare('SELECT * FROM violation_codes WHERE code=?').get(violation_code);
  const m = measure || v?.default_measure;
  const t = today();
  let effective_to = null, escalate = null, publish = v?.publish ? 1 : 0, publishUntil = null, reapply = null;
  if (m === 'suspension') { effective_to = R.addDays(t, 180); escalate = 'withdrawal'; publish = 1; }
  if (m === 'withdrawal') {
    publish = 1; publishUntil = R.addDays(t, 365);
    reapply = R.addDays(t, (v?.reapply_ban_months || 12) * 30);
  }
  if (m === 'grace_period' && !grace_days) grace_days = violation_code === 3 ? 60 : 30;
  const id = db.prepare(`INSERT INTO sanctions (case_no, subject_kind, subject_id, subject_name, violation_code,
      measure, fine_amount, grace_days, reason, source_audit_id, decided_by, effective_from, effective_to,
      auto_escalate_to, published, publish_until, reapply_allowed_from)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,date('now'),?,?,?,?,?)`).run(
    nextRef('SNC', 'sanctions'), subject_kind, subject_id || null, subject_name || null, violation_code || null,
    m, fine_amount || null, grace_days || null, reason, source_audit_id || null, actorId || null,
    effective_to, escalate, publish, publishUntil, reapply).lastInsertRowid;

  if (subject_kind === 'licensee' && subject_id) {
    if (m === 'suspension') db.prepare("UPDATE licensees SET status='suspended', status_reason=? WHERE id=?").run(reason, subject_id);
    if (m === 'withdrawal') db.prepare("UPDATE licensees SET status='withdrawn', status_reason=? WHERE id=?").run(reason, subject_id);
    if (m === 'level_downgrade') db.prepare('UPDATE licensees SET level=MAX(1, level-1) WHERE id=? AND level>1').run(subject_id);
    if (['suspension', 'withdrawal'].includes(m)) {
      for (const o of db.prepare('SELECT DISTINCT association_id a FROM contributions WHERE licensee_id=? AND association_id IS NOT NULL').all(subject_id)) {
        const u = ownerOf('association', o.a);
        if (u) notify({ user_id: u, severity: 'warning', title: `إخطار بـ${m === 'suspension' ? 'تعليق' : 'سحب'} ترخيص أحد المساهمين إليكم`,
          body: 'يوقف كل استعمال جديد للعلامة من المرخَّص له (المادة 30/1)' });
      }
    }
    const u = ownerOf('licensee', subject_id);
    if (u) notify({ user_id: u, severity: 'danger', title: 'قرار جزائي على ملفكم',
      body: `${reason.slice(0, 180)} — لكم حق التظلم خلال ثلاثين يوماً (المادة 22/2)`, link: '#/sanctions' });
  }
  if (subject_kind === 'association' && subject_id) {
    if (m === 'suspension') db.prepare("UPDATE associations SET status='suspended', status_reason=? WHERE id=?").run(reason, subject_id);
    if (m === 'withdrawal') db.prepare("UPDATE associations SET status='revoked', status_reason=? WHERE id=?").run(reason, subject_id);
    const u = ownerOf('association', subject_id);
    if (u) notify({ user_id: u, severity: 'danger', title: 'قرار جزائي على منظمتكم',
      body: `${reason.slice(0, 180)} — لكم حق التظلم خلال ثلاثين يوماً`, link: '#/sanctions' });
  }
  return db.prepare('SELECT * FROM sanctions WHERE id=?').get(id);
}

module.exports = { today, nextRef, ALLOWED_UPLOADS, uploadAllowed, storeUpload, discardUpload, notify, ownerOf,
  openStages, closeStage, createApplication, createSanction };
