'use strict';
/** مسار الطلب (المادة 17) — الإثباتات — الالتزام — الموافقة على التصاميم */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, UPLOAD_DIR } = require('../db');
const { can, requireAuth, hasPerm, ownsLicensee, ownsAssociation, log, notify } = require('../auth');
const { buildList } = require('../query');
const R = require('../rules');
const REF = require('../reference');
const S = require('../services');

const r = express.Router();
const upload = multer({
  storage: multer.diskStorage({
    destination: (_q, _f, cb) => cb(null, UPLOAD_DIR),
    filename: (_q, f, cb) => cb(null, Date.now() + '-' + crypto.randomBytes(6).toString('hex') + path.extname(f.originalname || '')),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const nextRef = (prefix, table, col) => {
  const n = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n + 1;
  return `${prefix}-${String(n).padStart(5, '0')}`;
};

// ================= الطلبات =================
r.get('/applications', requireAuth, (req, res) => {
  const all = hasPerm(req.user, 'app.view.all');
  const extra = [], params = [];
  if (!all) {
    const parts = ['a.applicant_user_id = ?']; params.push(req.user.id);
    if (req.user.scopes.licensee.length)
      { parts.push(`(a.subject_kind='licensee' AND a.subject_id IN (${req.user.scopes.licensee.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.licensee); }
    if (req.user.scopes.association.length)
      { parts.push(`(a.subject_kind='association' AND a.subject_id IN (${req.user.scopes.association.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.association); }
    extra.push('(' + parts.join(' OR ') + ')');
  }
  const out = buildList(db, {
    table: `applications a
            LEFT JOIN licensees l ON a.subject_kind='licensee' AND l.id=a.subject_id
            LEFT JOIN associations o ON a.subject_kind='association' AND o.id=a.subject_id
            LEFT JOIN users u ON u.id=a.decided_by`,
    columns: `a.id, a.reference, a.app_type, a.subject_kind, a.subject_id,
              COALESCE(l.legal_name, o.name) AS subject_name, a.requested_level, a.requested_tier,
              a.stage, a.status, a.submitted_at, a.completeness_due_at, a.assessment_due_at,
              a.sla_due_at, a.decision, a.granted_level, a.decision_reason, u.full_name AS decided_by_name,
              a.decided_at, a.processing_days, a.deficiencies`,
    filters: {
      app_type: { op: 'in', col: 'a.app_type' },
      status: { op: 'in', col: 'a.status' },
      stage: { op: 'in', col: 'a.stage' },
      subject_kind: { op: 'in', col: 'a.subject_kind' },
      decision: { op: 'in', col: 'a.decision' },
      requested_level: { op: 'in', col: 'a.requested_level' },
      submitted_from: { op: 'gte', col: 'a.submitted_at' },
      submitted_to: { op: 'lte', col: 'a.submitted_at' },
      overdue: { op: 'lte', col: 'a.sla_due_at' },
    },
    search: ['a.reference', 'l.legal_name', 'o.name'],
    allowSort: ['reference', 'submitted_at', 'stage', 'status', 'sla_due_at', 'processing_days'],
    defaultSort: 'a.submitted_at DESC', req, extraWhere: extra, params,
  });
  // تمييز المتأخر عن المدة المعيارية (90 يوم عمل)
  const today = new Date().toISOString().slice(0, 10);
  out.rows.forEach((x) => { x.sla_breached = x.sla_due_at && x.sla_due_at < today && !x.decided_at ? 1 : 0; });
  res.json(out);
});

r.get('/applications/:id', requireAuth, (req, res) => {
  const a = db.prepare(`SELECT a.*, COALESCE(l.legal_name,o.name) subject_name, u.full_name decided_by_name
      FROM applications a LEFT JOIN licensees l ON a.subject_kind='licensee' AND l.id=a.subject_id
      LEFT JOIN associations o ON a.subject_kind='association' AND o.id=a.subject_id
      LEFT JOIN users u ON u.id=a.decided_by WHERE a.id=?`).get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  const mine = a.applicant_user_id === req.user.id ||
    (a.subject_kind === 'licensee' && ownsLicensee(req.user, a.subject_id)) ||
    (a.subject_kind === 'association' && ownsAssociation(req.user, a.subject_id));
  if (!hasPerm(req.user, 'app.view.all') && !mine) return res.status(403).json({ error: 'الاطلاع مقصور على طلباتك' });
  a.stages = db.prepare(`SELECT s.*, u.full_name actor_name FROM application_stages s
      LEFT JOIN users u ON u.id=s.actor_id WHERE s.application_id=? ORDER BY s.stage`).all(a.id);
  a.documents = db.prepare(`SELECT d.*, dt.name_ar doc_type_name FROM documents d
      LEFT JOIN document_types dt ON dt.code=d.doc_type
      WHERE d.owner_kind='application' AND d.owner_id=?`).all(a.id);
  a.standard_path = REF.APP_STAGES.map(([stage, name, body, days]) => ({ stage, name, body, max_days: days }));
  res.json(a);
});

// تقديم طلب (الشريك / الجمعية)
r.post('/applications', requireAuth, can('app.create'), (req, res) => {
  const { app_type, subject_kind, subject_id, requested_level } = req.body;
  const TYPES = { licensee: ['license', 'license_renewal', 'level_upgrade'],
    association: ['accreditation', 'accreditation_renewal'] };
  if (!TYPES[subject_kind] || !TYPES[subject_kind].includes(app_type))
    return res.status(400).json({ error: 'نوع الطلب لا يطابق نوع الجهة' });
  if (subject_kind === 'licensee' && !ownsLicensee(req.user, subject_id) && !hasPerm(req.user, 'licensee.edit.all'))
    return res.status(403).json({ error: 'لا تملك هذا الملف' });
  if (subject_kind === 'association' && !ownsAssociation(req.user, subject_id) && !hasPerm(req.user, 'org.edit.all'))
    return res.status(403).json({ error: 'لا تملك هذا الملف' });
  const open = db.prepare(`SELECT reference FROM applications WHERE subject_kind=? AND subject_id=?
      AND status NOT IN ('approved','rejected','shelved','withdrawn')`).get(subject_kind, subject_id);
  if (open) return res.status(409).json({ error: `يوجد طلب مفتوح لهذا الملف (${open.reference}) — لا يُقدَّم طلب ثانٍ قبل الفصل فيه` });
  const subj = subject_kind === 'licensee'
    ? db.prepare('SELECT * FROM licensees WHERE id=?').get(subject_id)
    : db.prepare('SELECT * FROM associations WHERE id=?').get(subject_id);
  if (!subj) return res.status(404).json({ error: 'الملف غير موجود' });
  // حظر إعادة التقديم بعد السحب (المادة 31/3)
  const ban = db.prepare(`SELECT reapply_allowed_from d FROM sanctions WHERE subject_kind=? AND subject_id=?
      AND measure='withdrawal' AND status!='overturned' AND reapply_allowed_from > date('now')
      ORDER BY reapply_allowed_from DESC LIMIT 1`).get(subject_kind, subject_id);
  if (ban) return res.status(422).json({ error: `لا يجوز إعادة التقديم قبل ${ban.d} (المادة 31/3)` });
  if (subject_kind === 'licensee' && subj.excluded)
    return res.status(422).json({ error: `الجهة مدرجة على قائمة الاستبعاد — ${subj.exclusion_reason || 'المادة 10'}` });
  if (app_type === 'license_renewal') {
    if (!['active', 'expired'].includes(subj.status)) return res.status(422).json({ error: 'التجديد لترخيص ساري أو منتهٍ فقط' });
    // المادة 18/2: يُقدَّم طلب التجديد مع إقرار الامتثال السنوي
    const decl = db.prepare(`SELECT 1 FROM compliance_declarations WHERE licensee_id=? AND submitted_at IS NOT NULL
        AND fiscal_year >= ?`).get(subject_id, new Date().getFullYear() - 1);
    if (!decl) return res.status(422).json({ error: 'يُقدَّم طلب التجديد مع إقرار الامتثال السنوي (المادة 18/2) — قدّم الإقرار أولاً' });
  }
  if (app_type === 'level_upgrade') {
    if (subj.status !== 'active') return res.status(422).json({ error: 'رفع المستوى لترخيص ساري فقط' });
    if (!(Number(requested_level) > Number(subj.level)))
      return res.status(422).json({ error: 'المستوى المطلوب يجب أن يعلو المستوى الحالي (المادة 8/3)' });
  }
  if (app_type === 'accreditation_renewal' && !['accredited', 'expired'].includes(subj.status))
    return res.status(422).json({ error: 'التجديد لاعتماد ساري أو منتهٍ فقط' });
  const a = S.createApplication({ app_type, subject_kind, subject_id, applicant_user_id: req.user.id, requested_level });
  log(req, 'application.create', 'application', a.id, `تقديم طلب ${a.reference}`);
  res.status(201).json(a);
});

// المرحلة 2: فحص الاستيفاء الشكلي
r.post('/applications/:id/screen', requireAuth, can('app.screen'), (req, res) => {
  const id = Number(req.params.id);
  const { complete, deficiencies } = req.body;
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  if (!['submitted', 'completing'].includes(a.status))
    return res.status(409).json({ error: `لا يصح فحص الاستيفاء والطلب في حالة «${a.status}»` });
  const today = new Date().toISOString().slice(0, 10);
  if (complete) {
    db.prepare(`UPDATE applications SET stage=4, status='assessment', completeness_done_at=date('now'),
      assessment_due_at=? WHERE id=?`).run(R.addWorkDays(today, 20), id);
    S.closeStage(id, 2, req.user.id, 'مستوفى شكلياً');
    S.closeStage(id, 3, req.user.id, a.status === 'completing' ? 'استُكملت النواقص' : 'لا نواقص');
  } else {
    if (!deficiencies || deficiencies.trim().length < 5)
      return res.status(422).json({ error: 'بيان النواقص مطلوب ليُخطَر به الطالب' });
    db.prepare(`UPDATE applications SET stage=3, status='deficiencies', deficiencies=?,
      completeness_done_at=date('now') WHERE id=?`).run(deficiencies, id);
    S.closeStage(id, 2, req.user.id, 'إخطار بالنواقص');
    S.notify({ user_id: a.applicant_user_id, title: 'إخطار بنواقص في طلبك',
      body: `${a.reference}: ${deficiencies} — أمامك 20 يوم عمل وإلا حُفظ الطلب (المادة 17/3)`,
      severity: 'warning', link: `#/applications/${id}` });
  }
  log(req, 'application.screen', 'application', id, complete ? 'مستوفى' : 'نواقص');
  res.json(db.prepare('SELECT * FROM applications WHERE id=?').get(id));
});

// المرحلة 3: استكمال النواقص من الطالب
r.post('/applications/:id/resubmit', requireAuth, can('app.create'), (req, res) => {
  const id = Number(req.params.id);
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  const mine = a.applicant_user_id === req.user.id ||
    (a.subject_kind === 'licensee' && ownsLicensee(req.user, a.subject_id)) ||
    (a.subject_kind === 'association' && ownsAssociation(req.user, a.subject_id));
  if (!mine) return res.status(403).json({ error: 'الاستكمال من حق صاحب الطلب' });
  if (a.status !== 'deficiencies') return res.status(409).json({ error: 'لا نواقص مطلوبة على هذا الطلب' });
  const deadline = R.addWorkDays(String(a.completeness_done_at).slice(0, 10), 20);
  if (new Date().toISOString().slice(0, 10) > deadline) {
    db.prepare("UPDATE applications SET status='shelved' WHERE id=?").run(id);
    return res.status(422).json({ error: `انقضت مهلة العشرين يوم عمل في ${deadline} — حُفظ الطلب (المادة 17/3)` });
  }
  db.prepare(`UPDATE applications SET status='completing', stage=2, resubmitted_at=datetime('now') WHERE id=?`).run(id);
  db.prepare(`UPDATE application_stages SET note=? WHERE application_id=? AND stage=3`)
    .run(req.body.note ? String(req.body.note).slice(0, 400) : 'استُكملت النواقص', id);
  S.notify({ role_code: 'EVAL_DIRECTOR', title: 'طلب استُكملت نواقصه — بانتظار إعادة الفحص',
    body: a.reference, link: `#/applications/${id}` });
  log(req, 'application.resubmit', 'application', id, 'استكمال النواقص');
  res.json(db.prepare('SELECT * FROM applications WHERE id=?').get(id));
});

// المرحلة 4-6: التقييم ورفع تقرير الوقائع (بلا توصية)
r.post('/applications/:id/facts-report', requireAuth, can('app.facts_report'), (req, res) => {
  const id = Number(req.params.id);
  const { facts_summary, findings = [], recommendation } = req.body;
  if (recommendation)
    return res.status(422).json({ error: 'يجب أن يقتصر تقرير الوحدة على الوقائع والأدلة دون توصية بالمنح أو الرفض (المادة 20/3)' });
  if (!facts_summary || facts_summary.trim().length < 10) return res.status(400).json({ error: 'ملخص الوقائع مطلوب' });
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  if (!['assessment', 'field_visit'].includes(a.status))
    return res.status(409).json({ error: 'تقرير الوقائع يُرفع بعد اكتمال الفحص الشكلي وقبل القرار' });
  const auditId = db.prepare(`INSERT INTO audits (reference, subject_kind, subject_id, fiscal_year, audit_type, trigger,
      executed_date, assessor_id, status, facts_summary) VALUES (?,?,?,?,'desk','renewal',date('now'),?,'facts_reported',?)`)
    .run(S.nextRef('AUD', 'audits'), a.subject_kind, a.subject_id, new Date().getFullYear(), req.user.id, facts_summary).lastInsertRowid;
  const fst = db.prepare('INSERT INTO audit_findings (audit_id, area, fact, severity, violation_code) VALUES (?,?,?,?,?)');
  for (const f of findings) if (f && f.fact) fst.run(auditId, f.area || 'عام', f.fact, f.severity || 'info', f.violation_code || null);
  db.prepare(`UPDATE applications SET stage=7, status='decision_pending', facts_report_id=?, assessment_done_at=date('now') WHERE id=?`).run(auditId, id);
  [4, 5, 6].forEach((st) => S.closeStage(id, st, req.user.id, 'منفَّذ'));
  S.notify({ role_code: 'LICENSING_COMMITTEE', title: 'تقرير وقائع بانتظار القرار المسبَّب',
    body: `${a.reference} — أمام اللجنة 15 يوم عمل (المادة 17/7)`, severity: 'warning', link: `#/applications/${id}` });
  log(req, 'application.facts_report', 'application', id, 'رفع تقرير الوقائع');
  res.json({ application: db.prepare('SELECT * FROM applications WHERE id=?').get(id), audit_id: auditId });
});

// المرحلة 7: القرار المسبَّب — لجنة منح الترخيص وحدها
r.post('/applications/:id/decide', requireAuth, can('app.decide'), (req, res) => {
  const id = Number(req.params.id);
  const { decision, reason } = req.body;
  if (!['grant', 'reject', 'grant_lower_level'].includes(decision))
    return res.status(400).json({ error: 'decision غير صالح' });
  if (!reason || reason.trim().length < 10)
    return res.status(422).json({ error: 'تصدر القرارات مسبَّبة وكتابية (المادة 21/3) — التسبيب مطلوب' });
  const a = db.prepare('SELECT * FROM applications WHERE id=?').get(id);
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  if (!a.facts_report_id)
    return res.status(422).json({ error: 'لا يصح القرار قبل تقرير وقائع من وحدة التقييم' });
  if (a.status !== 'decision_pending') return res.status(409).json({ error: 'صدر قرار في هذا الطلب مسبقاً' });
  let granted = Number(req.body.granted_level) || a.requested_level || null;
  if (decision === 'grant_lower_level' && a.requested_level && !(granted < a.requested_level))
    return res.status(422).json({ error: 'المنح بمستوى أدنى يقتضي مستوى دون المطلوب' });

  const year = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const newInvoice = (l, feeType, base, amount, capped) => db.prepare(`INSERT INTO invoices (invoice_no, subject_kind,
      subject_id, subject_name, fee_type, fiscal_year, tier_code, level, base_amount, amount, capped, issued_at, due_at, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,date('now'),?,'issued')`).run(S.nextRef('INV', 'invoices'), 'licensee', l.id,
    l.legal_name, feeType, year, l.tier_code, l.level, base, amount, capped ? 1 : 0, R.addDays(today, 30));
  const ensureCommitment = (l, lvl) => {
    const c = R.computeCommitment({ revenue: l.annual_revenue, netProfit: l.net_profit, level: lvl });
    db.prepare(`INSERT INTO commitments (licensee_id, fiscal_year, level, tier_code, annual_revenue,
        net_profit, pct_amount, floor_amount, commitment_due, basis) VALUES (?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(licensee_id, fiscal_year) DO UPDATE SET level=excluded.level, pct_amount=excluded.pct_amount,
        floor_amount=excluded.floor_amount, commitment_due=excluded.commitment_due, basis=excluded.basis`)
      .run(l.id, year, lvl, c.tier_code, l.annual_revenue, l.net_profit, c.pct_amount, c.floor_amount, c.commitment_due, c.basis);
    const fye = `${year}-12-31`;
    db.prepare(`INSERT OR IGNORE INTO compliance_declarations (licensee_id, fiscal_year, fiscal_year_end, due_at, status)
        VALUES (?,?,?,?, 'pending')`).run(l.id, year, fye, R.addDays(fye, 120));
  };

  const tx = db.transaction(() => {
    db.prepare(`UPDATE applications SET status=?, decision=?, granted_level=?, decision_reason=?,
        decided_by=?, decided_at=date('now'), stage=?, processing_days=? WHERE id=?`)
      .run(decision === 'reject' ? 'rejected' : 'approved', decision, decision === 'reject' ? null : granted,
        reason, req.user.id, decision === 'reject' ? 7 : 8, R.daysBetween(a.submitted_at.slice(0, 10), today), id);
    S.closeStage(id, 7, req.user.id, reason.slice(0, 200));

    if (decision === 'reject') {
      // رفض التجديد أو الترقية لا يمسّ الترخيص القائم؛ رفض الطلب الأول يُقيَّد رفضاً
      if (a.app_type === 'license') db.prepare("UPDATE licensees SET status='rejected', status_reason=? WHERE id=?").run(reason, a.subject_id);
      if (a.app_type === 'license_renewal') db.prepare("UPDATE licensees SET status='expired', status_reason=? WHERE id=? AND end_date < date('now')").run('رفض التجديد: ' + reason, a.subject_id);
      if (a.app_type === 'accreditation') db.prepare("UPDATE associations SET status='rejected', status_reason=? WHERE id=?").run(reason, a.subject_id);
      return;
    }
    if (a.subject_kind === 'licensee') {
      const l = db.prepare('SELECT * FROM licensees WHERE id=?').get(a.subject_id);
      const lvl = granted || l.level;
      if (a.app_type === 'license') {
        let serial = db.prepare('SELECT COUNT(*) n FROM licensees WHERE license_no IS NOT NULL').get().n + 1;
        let no = l.license_no || R.licenseNo(serial, year);
        while (!l.license_no && db.prepare('SELECT 1 FROM licensees WHERE license_no=?').get(no)) no = R.licenseNo(++serial, year);
        db.prepare(`UPDATE licensees SET license_no=?, level=?, status='active', status_reason=NULL,
            start_date=date('now'), end_date=date('now','+1 year'), qr_token=COALESCE(qr_token,?) WHERE id=?`)
          .run(no, lvl, crypto.randomBytes(8).toString('hex'), l.id);
        const fees = R.computeFees({ revenue: l.annual_revenue, level: lvl, firstYearRemainingMonths: 12 - new Date().getMonth() });
        newInvoice({ ...l, level: lvl }, 'annual_prorated', fees.annual_fee, fees.annual_fee_prorated ?? fees.annual_fee, fees.capped);
      } else if (a.app_type === 'license_renewal') {
        // مدة الترخيص سنة تبدأ من انتهاء السابقة، أو من اليوم إن كانت قد انقضت (المادة 18/1)
        const base = l.end_date && l.end_date > today ? l.end_date : today;
        db.prepare(`UPDATE licensees SET level=?, status='active', status_reason=NULL, end_date=? WHERE id=?`)
          .run(lvl, R.addDays(base, 365), l.id);
        const fees = R.computeFees({ revenue: l.annual_revenue, level: lvl });
        newInvoice({ ...l, level: lvl }, 'annual', fees.annual_fee, fees.annual_fee, fees.capped);
      } else if (a.app_type === 'level_upgrade') {
        const before = R.computeFees({ revenue: l.annual_revenue, level: l.level }).annual_fee;
        const after = R.computeFees({ revenue: l.annual_revenue, level: lvl }).annual_fee;
        db.prepare('UPDATE licensees SET level=? WHERE id=?').run(lvl, l.id);
        // سداد فرق الرسم إن وُجد (المادة 8/3) — والمستويات العليا أرخص رسماً فقد لا يوجد فرق
        if (after > before) newInvoice({ ...l, level: lvl }, 'level_diff', after - before, after - before, false);
      }
      ensureCommitment(db.prepare('SELECT * FROM licensees WHERE id=?').get(l.id), lvl);
    }
    if (a.subject_kind === 'association') {
      const o = db.prepare('SELECT * FROM associations WHERE id=?').get(a.subject_id);
      if (a.app_type === 'accreditation_renewal') {
        const base = o.accredited_to && o.accredited_to > today ? o.accredited_to : today;
        db.prepare(`UPDATE associations SET status='accredited', status_reason=NULL, accredited_to=?, audit_tier=? WHERE id=?`)
          .run(R.addDays(base, 730), R.auditTierFor(o.annual_revenue), o.id);
      } else {
        let serial = db.prepare('SELECT COUNT(*) n FROM associations WHERE accreditation_no IS NOT NULL').get().n + 1;
        let no = o.accreditation_no || R.accreditationNo(serial, year);
        while (!o.accreditation_no && db.prepare('SELECT 1 FROM associations WHERE accreditation_no=?').get(no)) no = R.accreditationNo(++serial, year);
        db.prepare(`UPDATE associations SET accreditation_no=?, status='accredited', status_reason=NULL,
            accredited_from=date('now'), accredited_to=date('now','+2 years'), qr_token=COALESCE(qr_token,?),
            audit_tier=?, absorption_cap=COALESCE(largest_budget_3y,0)*2 WHERE id=?`)
          .run(no, crypto.randomBytes(8).toString('hex'), R.auditTierFor(o.annual_revenue), o.id);
      }
    }
    db.prepare('UPDATE applications SET stage=9 WHERE id=?').run(id);
    [8, 9].forEach((st) => S.closeStage(id, st, req.user.id, 'القيد في السجل وتسليم الأصول'));
  });
  tx();
  S.notify({ user_id: a.applicant_user_id,
    title: decision === 'reject' ? 'قرار برفض الطلب' : 'قرار بمنح الطلب',
    body: `${a.reference}: ${reason} — لك حق التظلم خلال ثلاثين يوماً (المادة 22/2)`,
    severity: decision === 'reject' ? 'danger' : 'success', link: `#/applications/${id}` });
  log(req, 'application.decide', 'application', id, `قرار: ${decision}`);
  res.json(db.prepare('SELECT * FROM applications WHERE id=?').get(id));
});

// ================= الإثباتات =================
r.get('/documents', requireAuth, (req, res) => {
  const all = hasPerm(req.user, 'doc.view.all');
  const extra = [], params = [];
  if (!all) {
    const parts = [];
    if (req.user.scopes.licensee.length) { parts.push(`(d.owner_kind='licensee' AND d.owner_id IN (${req.user.scopes.licensee.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.licensee); }
    if (req.user.scopes.association.length) { parts.push(`(d.owner_kind='association' AND d.owner_id IN (${req.user.scopes.association.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.association); }
    parts.push('d.uploaded_by = ?'); params.push(req.user.id);
    extra.push('(' + parts.join(' OR ') + ')');
  }
  if (!hasPerm(req.user, 'doc.view.confidential')) extra.push('d.confidential=0');
  const out = buildList(db, {
    table: `documents d LEFT JOIN document_types dt ON dt.code=d.doc_type
            LEFT JOIN licensees l ON d.owner_kind='licensee' AND l.id=d.owner_id
            LEFT JOIN associations o ON d.owner_kind='association' AND o.id=d.owner_id
            LEFT JOIN users u ON u.id=d.uploaded_by`,
    columns: `d.id, d.owner_kind, d.owner_id, COALESCE(l.legal_name,o.name) owner_name, d.doc_type,
              dt.name_ar doc_type_name, d.title, d.file_name, d.mime_type, d.size_bytes, d.pages,
              d.issued_on, d.expires_on, d.verification, d.verified_at, d.verify_note, d.is_public,
              d.confidential, u.full_name uploaded_by_name, d.uploaded_at`,
    filters: {
      owner_kind: { op: 'in', col: 'd.owner_kind' },
      owner_id: { op: 'eq', col: 'd.owner_id', num: true },
      doc_type: { op: 'in', col: 'd.doc_type' },
      verification: { op: 'in', col: 'd.verification' },
      is_public: { op: 'bool', col: 'd.is_public' },
      expiring_before: { op: 'lte', col: 'd.expires_on' },
      uploaded_from: { op: 'gte', col: 'd.uploaded_at' },
      uploaded_to: { op: 'lte', col: 'd.uploaded_at' },
    },
    search: ['d.title', 'd.file_name', 'l.legal_name', 'o.name'],
    allowSort: ['uploaded_at', 'title', 'verification', 'expires_on', 'size_bytes'],
    defaultSort: 'd.uploaded_at DESC', req, extraWhere: extra, params,
  });
  res.json(out);
});

r.post('/documents', requireAuth, upload.single('file'), (req, res) => {
  const { owner_kind, owner_id, doc_type, title, issued_on, expires_on, confidential } = req.body;
  if (!req.file) return res.status(400).json({ error: 'الملف مطلوب' });
  if (!S.uploadAllowed(req.file.originalname)) {
    S.discardUpload(req.file);
    return res.status(415).json({ error: 'نوع الملف غير مسموح — المقبول: PDF وصور وWord وExcel ونص', allowed: Object.keys(S.ALLOWED_UPLOADS) });
  }
  const own = (owner_kind === 'licensee' && ownsLicensee(req.user, owner_id)) ||
              (owner_kind === 'association' && ownsAssociation(req.user, owner_id));
  if (!hasPerm(req.user, 'doc.upload.any') && !(hasPerm(req.user, 'doc.upload.own') && own)) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'لا تملك صلاحية تحميل إثبات لهذا الملف' });
  }
  const buf = fs.readFileSync(req.file.path);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const dup = db.prepare('SELECT id,title FROM documents WHERE sha256=? AND owner_kind=? AND owner_id=?')
    .get(sha, owner_kind, Number(owner_id));
  const info = db.prepare(`INSERT INTO documents (owner_kind, owner_id, doc_type, title, file_name, stored_name,
      mime_type, size_bytes, sha256, issued_on, expires_on, uploaded_by, confidential)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    owner_kind, Number(owner_id) || null, doc_type || null, title || req.file.originalname,
    req.file.originalname, req.file.filename, S.ALLOWED_UPLOADS[path.extname(req.file.originalname).toLowerCase()] || req.file.mimetype,
    req.file.size, sha, issued_on || null, expires_on || null, req.user.id,
    confidential === '1' || confidential === 'true' ? 1 : 0);
  log(req, 'document.upload', owner_kind, Number(owner_id), `تحميل إثبات: ${title || req.file.originalname}`);
  notify({ role_code: 'EVAL_DIRECTOR', title: 'إثبات جديد بانتظار التحقق',
    body: title || req.file.originalname, link: `#/documents` });
  res.status(201).json({ id: info.lastInsertRowid, sha256: sha,
    duplicate_of: dup ? dup.id : null,
    note: dup ? 'هذا الملف مطابق لإثبات سابق بالبصمة نفسها' : null });
});

r.get('/documents/:id/file', (req, res) => {
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  // المستندات المنشورة في السجل (المعيار 14) متاحة للعموم؛ وما عداها يلزمه دخول وصلاحية
  const isPublic = d.is_public && !d.confidential;
  if (!isPublic) {
    if (!req.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
    const own = (d.owner_kind === 'licensee' && ownsLicensee(req.user, d.owner_id)) ||
                (d.owner_kind === 'association' && ownsAssociation(req.user, d.owner_id)) ||
                d.uploaded_by === req.user.id;
    if (!hasPerm(req.user, 'doc.view.all') && !own) return res.status(403).json({ error: 'غير مصرَّح' });
    if (d.confidential && !hasPerm(req.user, 'doc.view.confidential') && !own)
      return res.status(403).json({ error: 'مستند سرّي' });
  }
  const p = path.join(UPLOAD_DIR, d.stored_name);
  if (!fs.existsSync(p)) return res.status(410).json({ error: 'الملف غير متوفر على الخادم' });
  if (req.user) log(req, 'document.download', 'document', d.id, d.title);
  res.setHeader('Content-Type', d.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(d.file_name)}`);
  // عزل المحتوى: لا سكربت ولا تخمين نوع — يمنع أي مستند من التنفيذ في نطاق النظام
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(p).pipe(res);
});

r.post('/documents/:id/verify', requireAuth, can('doc.verify'), (req, res) => {
  const { verification, note } = req.body;
  if (!['verified', 'rejected', 'superseded', 'pending'].includes(verification))
    return res.status(400).json({ error: 'verification غير صالح' });
  const d = db.prepare('SELECT * FROM documents WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  db.prepare(`UPDATE documents SET verification=?, verified_by=?, verified_at=datetime('now'), verify_note=? WHERE id=?`)
    .run(verification, req.user.id, note || null, d.id);
  log(req, 'document.verify', 'document', d.id, `${verification}: ${note || ''}`);
  res.json(db.prepare('SELECT * FROM documents WHERE id=?').get(d.id));
});

// ================= الالتزام والمساهمات =================
r.get('/commitments', requireAuth, can('commitment.view.all', 'licensee.view.own'), (req, res) => {
  const scoped = !hasPerm(req.user, 'commitment.view.all');
  const extra = scoped ? [`c.licensee_id IN (${(req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]).map(()=>'?').join(',')})`] : [];
  const out = buildList(db, {
    table: `commitments c JOIN licensees l ON l.id=c.licensee_id LEFT JOIN brand_levels b ON b.level=c.level`,
    columns: `c.*, l.legal_name, l.license_no, l.region, l.sector, b.name_ar level_name, b.color_hex`,
    filters: {
      fiscal_year: { op: 'in', col: 'c.fiscal_year' },
      status: { op: 'in', col: 'c.status' },
      level: { op: 'in', col: 'c.level' },
      tier_code: { op: 'in', col: 'c.tier_code' },
      region: { op: 'in', col: 'l.region' },
      basis: { op: 'in', col: 'c.basis' },
      due_min: { op: 'gte', col: 'c.commitment_due', num: true },
      due_max: { op: 'lte', col: 'c.commitment_due', num: true },
      deficit_min: { op: 'gte', col: 'c.deficit_pct', num: true },
    },
    search: ['l.legal_name', 'l.license_no'],
    allowSort: ['fiscal_year', 'commitment_due', 'total_paid', 'deficit_pct', 'legal_name'],
    defaultSort: 'c.fiscal_year DESC, c.commitment_due DESC',
    req, extraWhere: extra, params: scoped ? (req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]) : [],
  });
  res.json(out);
});

r.get('/contributions', requireAuth, (req, res) => {
  const all = hasPerm(req.user, 'commitment.view.all') || hasPerm(req.user, 'contribution.verify') || hasPerm(req.user, 'org.view.all');
  const extra = [], params = [];
  if (!all) {
    const parts = [];
    if (req.user.scopes.licensee.length) { parts.push(`c.licensee_id IN (${req.user.scopes.licensee.map(()=>'?').join(',')})`); params.push(...req.user.scopes.licensee); }
    if (req.user.scopes.association.length) { parts.push(`c.association_id IN (${req.user.scopes.association.map(()=>'?').join(',')})`); params.push(...req.user.scopes.association); }
    extra.push(parts.length ? '(' + parts.join(' OR ') + ')' : '1=0');
  }
  const out = buildList(db, {
    table: `contributions c JOIN licensees l ON l.id=c.licensee_id
            LEFT JOIN associations a ON a.id=c.association_id
            LEFT JOIN eligible_channels ec ON ec.code=c.channel`,
    columns: `c.*, l.legal_name licensee_name, l.license_no, l.level, a.name association_name,
              a.accreditation_no, a.region association_region, ec.name_ar channel_name, ec.counts channel_counts,
              ec.max_share channel_max_share`,
    filters: {
      fiscal_year: { op: 'in', col: 'c.fiscal_year' },
      channel: { op: 'in', col: 'c.channel' },
      status: { op: 'in', col: 'c.status' },
      licensee_id: { op: 'eq', col: 'c.licensee_id', num: true },
      association_id: { op: 'eq', col: 'c.association_id', num: true },
      region: { op: 'in', col: 'a.region' },
      amount_min: { op: 'gte', col: 'c.amount', num: true },
      amount_max: { op: 'lte', col: 'c.amount', num: true },
      date_from: { op: 'gte', col: 'c.transfer_date' },
      date_to: { op: 'lte', col: 'c.transfer_date' },
      receipt_confirmed: { op: 'bool', col: 'c.receipt_confirmed' },
    },
    search: ['l.legal_name', 'a.name', 'c.reference', 'c.bank_ref', 'c.purpose'],
    allowSort: ['transfer_date', 'amount', 'fiscal_year', 'status', 'licensee_name'],
    defaultSort: 'c.transfer_date DESC', req, extraWhere: extra, params,
  });
  res.json(out);
});

r.post('/contributions', requireAuth, can('contribution.declare'), (req, res) => {
  const { licensee_id, association_id, fiscal_year, channel, amount, purpose, transfer_date,
          bank_ref, volunteer_hours, hour_rate, valuation_by } = req.body;
  if (!ownsLicensee(req.user, licensee_id) && !hasPerm(req.user, 'licensee.edit.all'))
    return res.status(403).json({ error: 'لا تملك هذا الملف' });
  if (!(Number(amount) > 0)) return res.status(400).json({ error: 'المبلغ يجب أن يكون موجباً' });
  const fy = Number(fiscal_year);
  if (!(fy >= 2020 && fy <= new Date().getFullYear())) return res.status(400).json({ error: 'السنة المالية غير صالحة' });
  const lic = db.prepare('SELECT status FROM licensees WHERE id=?').get(licensee_id);
  if (!lic || !['active', 'suspended'].includes(lic.status))
    return res.status(422).json({ error: 'تُسجَّل المساهمات على ترخيص ساري أو معلَّق فقط' });
  if (channel === 'volunteer' && !(Number(volunteer_hours) > 0))
    return res.status(422).json({ error: 'وقت التطوع يلزمه سجل ساعات معتمد (المادة 20)' });
  if (channel === 'inkind' && !valuation_by)
    return res.status(422).json({ error: 'التبرع العيني يلزمه تقييم بالقيمة السوقية من طرف ثالث مستقل (المادة 20)' });
  const ch = db.prepare('SELECT * FROM eligible_channels WHERE code=?').get(channel);
  if (!ch) return res.status(400).json({ error: 'مسار غير معروف' });
  if (!ch.counts) return res.status(422).json({ error: `«${ch.name_ar}» لا يُحتسب ضمن الالتزام — ${ch.condition_ar} (المادة 20)` });
  if (channel === 'cash' || channel === 'inkind') {
    const a = db.prepare('SELECT * FROM associations WHERE id=?').get(association_id);
    if (!a) return res.status(400).json({ error: 'يلزم تحديد منظمة معتمدة' });
    if (a.status !== 'accredited')
      return res.status(422).json({ error: `اعتماد «${a.name}» غير ساري (الحالة: ${a.status}) — تُخطَر الأمانة قبل التحويل للتأكد من سريان الاعتماد (المادة 22/3)` });
    const received = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE association_id=? AND fiscal_year=? AND status!='rejected'")
      .get(association_id, fiscal_year).s;
    const abs = R.absorptionCheck(a.largest_budget_3y, received + Number(amount));
    if (abs.breached) return res.status(422).json({ error: abs.message, absorption: abs });
  }
  const ref = nextRef('CON', 'contributions');
  const info = db.prepare(`INSERT INTO contributions (reference, licensee_id, association_id, fiscal_year, channel,
      amount, purpose, transfer_date, bank_ref, volunteer_hours, hour_rate, valuation_by, notified_secretariat, status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'declared')`).run(
    ref, licensee_id, association_id || null, fiscal_year, channel, Number(amount), purpose || null,
    transfer_date || null, bank_ref || null, volunteer_hours || null, hour_rate || null, valuation_by || null);
  recomputeCommitment(licensee_id, fiscal_year);
  const orgOwner = association_id ? S.ownerOf('association', association_id) : null;
  if (orgOwner) S.notify({ user_id: orgOwner, title: 'مساهمة جديدة بانتظار إقرار الاستلام',
    body: `${ref} — ${amount} د.ل`, link: '#/contributions' });
  if (channel === 'direct_program') S.notify({ role_code: 'STANDARDS_COMMITTEE',
    title: 'برنامج تنموي ذاتي بانتظار الموافقة المسبقة', body: `${ref} — ${purpose || ''}`, link: '#/contributions?channel=direct_program' });
  log(req, 'contribution.declare', 'contribution', info.lastInsertRowid, `${ref}: ${amount} د.ل`);
  const mixNow = currentMix(licensee_id, fiscal_year);
  res.status(201).json({ id: info.lastInsertRowid, reference: ref, mix: mixNow,
    warnings: mixNow.errors });
});

// إقرار استلام من المنظمة (نموذج 5) — مع إرفاق اختياري للإقرار الموقّع
r.post('/contributions/:id/confirm-receipt', requireAuth, can('contribution.confirm'), upload.single('file'), (req, res) => {
  const c = db.prepare('SELECT * FROM contributions WHERE id=?').get(Number(req.params.id));
  if (!c) { S.discardUpload(req.file); return res.status(404).json({ error: 'غير موجود' }); }
  if (!ownsAssociation(req.user, c.association_id) && !hasPerm(req.user, 'org.edit.all')) {
    S.discardUpload(req.file); return res.status(403).json({ error: 'إقرار الاستلام من حق المنظمة المتلقية' });
  }
  if (c.receipt_confirmed) { S.discardUpload(req.file); return res.status(409).json({ error: 'أُقرّ الاستلام مسبقاً' }); }
  let docId = req.body.receipt_doc_id ? Number(req.body.receipt_doc_id) : null;
  if (req.file) {
    if (!S.uploadAllowed(req.file.originalname)) { S.discardUpload(req.file); return res.status(415).json({ error: 'نوع الملف غير مسموح' }); }
    docId = S.storeUpload(req.file, { owner_kind: 'association', owner_id: c.association_id, doc_type: 'receipt_ack',
      title: `نموذج (5) إقرار استلام — ${c.reference}`, uploaded_by: req.user.id }).id;
  }
  db.prepare(`UPDATE contributions SET receipt_confirmed=1, receipt_doc_id=COALESCE(?,receipt_doc_id),
              status=CASE WHEN status='declared' THEN 'documented' ELSE status END WHERE id=?`).run(docId, c.id);
  recomputeCommitment(c.licensee_id, c.fiscal_year);
  const recv = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE association_id=? AND fiscal_year=?
      AND status IN ('documented','verified')`).get(c.association_id, c.fiscal_year).s;
  db.prepare('UPDATE associations SET absorption_used=? WHERE id=?').run(recv, c.association_id);
  const lo = S.ownerOf('licensee', c.licensee_id);
  if (lo) S.notify({ user_id: lo, severity: 'success', title: 'أقرّت المنظمة استلام مساهمتكم', body: c.reference, link: '#/contributions' });
  log(req, 'contribution.confirm', 'contribution', c.id, 'إقرار استلام');
  res.json(db.prepare('SELECT * FROM contributions WHERE id=?').get(c.id));
});

// تقرير الأثر عن مساهمات العلامة تحديداً (نموذج 6 / المادة 23/3)
r.post('/contributions/:id/impact', requireAuth, can('impact.submit'), upload.single('file'), (req, res) => {
  const c = db.prepare('SELECT * FROM contributions WHERE id=?').get(Number(req.params.id));
  if (!c) { S.discardUpload(req.file); return res.status(404).json({ error: 'غير موجود' }); }
  if (!ownsAssociation(req.user, c.association_id)) { S.discardUpload(req.file); return res.status(403).json({ error: 'تقرير الأثر من حق المنظمة المتلقية' }); }
  if (!c.receipt_confirmed) { S.discardUpload(req.file); return res.status(422).json({ error: 'يُقدَّم تقرير الأثر بعد إقرار الاستلام' }); }
  if (!req.file) return res.status(400).json({ error: 'ملف تقرير الأثر مطلوب' });
  if (!S.uploadAllowed(req.file.originalname)) { S.discardUpload(req.file); return res.status(415).json({ error: 'نوع الملف غير مسموح' }); }
  const { beneficiaries, spent_pct } = req.body;
  const docId = S.storeUpload(req.file, { owner_kind: 'association', owner_id: c.association_id, doc_type: 'impact_report',
    title: `نموذج (6) تقرير الأثر — ${c.reference}${beneficiaries ? ` — ${beneficiaries} مستفيد` : ''}${spent_pct ? ` — صرف ${spent_pct}%` : ''}`,
    uploaded_by: req.user.id, is_public: true }).id;
  db.prepare('UPDATE contributions SET impact_doc_id=? WHERE id=?').run(docId, c.id);
  S.notify({ role_code: 'ORG_RELATIONS', title: 'تقرير أثر جديد', body: c.reference, link: '#/contributions' });
  log(req, 'contribution.impact', 'contribution', c.id, 'تقديم تقرير الأثر');
  res.json(db.prepare('SELECT * FROM contributions WHERE id=?').get(c.id));
});

// الموافقة المسبقة على البرامج التنموية الذاتية — لجنة المعايير (المادة 19/2 والمادة 20)
r.post('/contributions/:id/preapprove', requireAuth, can('program.preapprove'), (req, res) => {
  const c = db.prepare('SELECT * FROM contributions WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'غير موجود' });
  if (c.channel !== 'direct_program') return res.status(422).json({ error: 'الموافقة المسبقة للبرامج التنموية الذاتية فقط' });
  const approve = req.body.approve !== false;
  if (!approve && !req.body.reason) return res.status(422).json({ error: 'سبب الرفض مطلوب' });
  db.prepare(`UPDATE contributions SET program_preapproved=?, reject_reason=?,
      status=CASE WHEN ?=1 THEN 'documented' ELSE 'rejected' END WHERE id=?`)
    .run(approve ? 1 : 0, approve ? null : req.body.reason, approve ? 1 : 0, c.id);
  recomputeCommitment(c.licensee_id, c.fiscal_year);
  log(req, 'contribution.preapprove', 'contribution', c.id, approve ? 'موافقة' : 'رفض');
  res.json(db.prepare('SELECT * FROM contributions WHERE id=?').get(c.id));
});

r.post('/contributions/:id/verify', requireAuth, can('contribution.verify'), (req, res) => {
  const { status, reject_reason } = req.body;
  if (!['verified', 'rejected', 'excluded', 'documented'].includes(status))
    return res.status(400).json({ error: 'status غير صالح' });
  const c = db.prepare('SELECT * FROM contributions WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'غير موجود' });
  if (status === 'verified' && c.channel === 'direct_program' && !c.program_preapproved)
    return res.status(422).json({ error: 'البرنامج التنموي الذاتي يلزمه موافقة مسبقة من لجنة المعايير (المادة 20)' });
  if (status === 'verified' && c.association_id && !c.receipt_confirmed)
    return res.status(422).json({ error: 'لا يُعتدّ بأي التزام لا يُسنده مستند خارجي (المادة 3/5) — إقرار الاستلام من المنظمة مطلوب' });
  db.prepare("UPDATE contributions SET status=?, reject_reason=?, verified_by=?, verified_at=datetime('now') WHERE id=?")
    .run(status, reject_reason || null, req.user.id, c.id);
  recomputeCommitment(c.licensee_id, c.fiscal_year);
  log(req, 'contribution.verify', 'contribution', c.id, status);
  res.json(db.prepare('SELECT * FROM contributions WHERE id=?').get(c.id));
});

function currentMix(licenseeId, year) {
  const rows = db.prepare(`SELECT channel, COALESCE(SUM(amount),0) s FROM contributions
      WHERE licensee_id=? AND fiscal_year=? AND status IN ('declared','documented','verified') GROUP BY channel`)
    .all(licenseeId, year);
  const g = (c) => rows.find((x) => x.channel === c)?.s || 0;
  return R.validateMix({ cash: g('cash'), inkind: g('inkind'), volunteer: g('volunteer'), direct_program: g('direct_program') });
}

function recomputeCommitment(licenseeId, year) {
  const c = db.prepare('SELECT * FROM commitments WHERE licensee_id=? AND fiscal_year=?').get(licenseeId, year);
  if (!c) return;
  const rows = db.prepare(`SELECT channel, COALESCE(SUM(amount),0) s FROM contributions
      WHERE licensee_id=? AND fiscal_year=? AND status IN ('documented','verified') GROUP BY channel`)
    .all(licenseeId, year);
  const g = (x) => rows.find((r) => r.channel === x)?.s || 0;
  const cash = g('cash'), inkind = g('inkind'), vol = g('volunteer'), dp = g('direct_program');
  const total = cash + inkind + vol + dp;
  const d = R.deficitAssessment(c.commitment_due, total);
  db.prepare(`UPDATE commitments SET cash_paid=?, inkind_paid=?, volunteer_paid=?, direct_program_paid=?,
      total_paid=?, cash_share=?, deficit_amount=?, deficit_pct=?, status=? WHERE id=?`)
    .run(cash, inkind, vol, dp, total, total > 0 ? R.round4(cash / total) : null,
      d.deficit, d.deficit_pct, d.status === 'fulfilled' ? 'fulfilled' : d.status, c.id);
}

// إقرار الامتثال السنوي (نموذج 4 / المادة 23)
r.get('/declarations', requireAuth, (req, res) => {
  const all = hasPerm(req.user, 'commitment.view.all');
  const extra = all ? [] : [`cd.licensee_id IN (${(req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]).map(()=>'?').join(',')})`];
  const out = buildList(db, {
    table: `compliance_declarations cd JOIN licensees l ON l.id=cd.licensee_id`,
    columns: `cd.*, l.legal_name, l.license_no, l.level, l.tier_code, l.region`,
    filters: {
      fiscal_year: { op: 'in', col: 'cd.fiscal_year' },
      status: { op: 'in', col: 'cd.status' },
      outcome: { op: 'in', col: 'cd.outcome' },
      due_before: { op: 'lte', col: 'cd.due_at' },
      late: { op: 'gte', col: 'cd.late_days', num: true },
      region: { op: 'in', col: 'l.region' },
    },
    search: ['l.legal_name', 'l.license_no'],
    allowSort: ['fiscal_year', 'due_at', 'submitted_at', 'late_days', 'status'],
    defaultSort: 'cd.due_at ASC', req, extraWhere: extra,
    params: all ? [] : (req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]),
  });
  res.json(out);
});

r.post('/declarations/:id/submit', requireAuth, can('commitment.declare'), (req, res) => {
  const d = db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  if (!ownsLicensee(req.user, d.licensee_id)) return res.status(403).json({ error: 'إقرارك فقط' });
  if (d.submitted_at) return res.status(409).json({ error: 'قُدِّم هذا الإقرار مسبقاً' });
  const { basis_type, basis_doc_id, declared_revenue, declared_net_profit, declared_total } = req.body;
  if (!['tax_return', 'audited_statements', 'bank_statement_accountant'].includes(basis_type))
    return res.status(400).json({ error: 'basis_type غير صالح — المادة 23/2(أ)' });
  const l = db.prepare('SELECT tier_code FROM licensees WHERE id=?').get(d.licensee_id);
  if (basis_type === 'bank_statement_accountant' && !['أ', 'ب'].includes(l.tier_code))
    return res.status(422).json({ error: 'كشف الحساب المصرفي مقبول للشريحتين أ وب فقط (المادة 23/2أ)' });
  const today = new Date().toISOString().slice(0, 10);
  const late = Math.max(0, R.daysBetween(d.due_at, today));
  db.prepare(`UPDATE compliance_declarations SET submitted_at=datetime('now'), late_days=?, basis_type=?,
      basis_doc_id=?, declared_revenue=?, declared_net_profit=?, declared_total=?,
      status=?, desk_review_due=date('now','+30 day'), field_audit_due=date('now','+60 day'),
      facts_report_due=date('now','+75 day'), decision_due=date('now','+90 day') WHERE id=?`)
    .run(late, basis_type, basis_doc_id || null, declared_revenue || null, declared_net_profit || null,
      declared_total || null, late > 0 ? 'late' : 'submitted', d.id);
  if (late > 0 && late < 30) {
    // المادة 29/1: تنبيه كتابي وغرامة تأخير 10% من الرسم السنوي — تُصدر آلياً مع فاتورتها
    const inv = db.prepare("SELECT amount FROM invoices WHERE subject_kind='licensee' AND subject_id=? AND fee_type LIKE 'annual%' ORDER BY issued_at DESC LIMIT 1").get(d.licensee_id);
    const fine = inv ? R.round2(inv.amount * 0.10) : 0;
    const snc = S.createSanction(null, { subject_kind: 'licensee', subject_id: d.licensee_id, violation_code: 1,
      measure: 'late_fine', fine_amount: fine,
      reason: `تأخر تقديم إقرار الامتثال ${late} يوماً (أقل من 30) — تنبيه كتابي وغرامة تأخير 10% من الرسم السنوي (المادة 29/1)` });
    const l = db.prepare('SELECT legal_name, tier_code, level FROM licensees WHERE id=?').get(d.licensee_id);
    if (fine > 0) db.prepare(`INSERT INTO invoices (invoice_no, subject_kind, subject_id, subject_name, fee_type, fiscal_year,
        tier_code, level, base_amount, amount, issued_at, due_at, status) VALUES (?,?,?,?,'late_fine',?,?,?,?,?,date('now'),date('now','+30 day'),'issued')`)
      .run(S.nextRef('INV', 'invoices'), 'licensee', d.licensee_id, l.legal_name, d.fiscal_year, l.tier_code, l.level, fine, fine);
    void snc;
  }
  notify({ role_code: 'EVAL_DIRECTOR', title: 'إقرار امتثال بانتظار التدقيق المكتبي',
    body: `المرخَّص ${d.licensee_id} — 30 يوماً للتدقيق المكتبي (المادة 24)`, link: '#/declarations' });
  log(req, 'declaration.submit', 'licensee', d.licensee_id, `إقرار امتثال ${d.fiscal_year}`);
  res.json(db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(d.id));
});

// معالجة الإقرار — وحدة التقييم تسجّل الوقائع (المادة 24)
r.post('/declarations/:id/process', requireAuth, can('app.assess', 'audit.execute'), (req, res) => {
  const d = db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  if (!d.submitted_at) return res.status(409).json({ error: 'لم يُقدَّم الإقرار بعد' });
  if (d.decided_at) return res.status(409).json({ error: 'صدر قرار في هذا الإقرار' });
  const { status, facts_note, recommendation } = req.body;
  if (recommendation) return res.status(422).json({ error: 'الوحدة ترفع وقائع بلا توصية (المادة 20/3)' });
  if (!['desk_review', 'field_audit', 'accepted', 'deficient'].includes(status))
    return res.status(400).json({ error: 'حالة غير صالحة' });
  if (!facts_note || facts_note.trim().length < 10) return res.status(422).json({ error: 'بيان الوقائع مطلوب' });
  const c = db.prepare('SELECT * FROM commitments WHERE licensee_id=? AND fiscal_year=?').get(d.licensee_id, d.fiscal_year);
  db.prepare(`UPDATE compliance_declarations SET status=?, facts_note=?, processed_by=?, processed_at=datetime('now') WHERE id=?`)
    .run(status, facts_note, req.user.id, d.id);
  if (['accepted', 'deficient'].includes(status))
    S.notify({ role_code: 'LICENSING_COMMITTEE', title: 'إقرار امتثال بانتظار قرار التجديد أو التعليق',
      body: `المرخَّص ${d.licensee_id} — السنة ${d.fiscal_year}`, link: '#/declarations' });
  log(req, 'declaration.process', 'licensee', d.licensee_id, `${status}: ${facts_note.slice(0, 100)}`);
  res.json({ declaration: db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(d.id),
    commitment_assessment: c ? R.deficitAssessment(c.commitment_due, c.total_paid) : null });
});

// قرار التجديد أو الخفض أو التعليق أو السحب — لجنة منح الترخيص (المادة 24)
r.post('/declarations/:id/decide', requireAuth, can('app.decide'), (req, res) => {
  const d = db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  if (!d.processed_at) return res.status(422).json({ error: 'لا قرار قبل وقائع وحدة التقييم (المادة 24)' });
  if (d.decided_at) return res.status(409).json({ error: 'صدر قرار في هذا الإقرار مسبقاً' });
  const { outcome, reason } = req.body;
  if (!['renew', 'downgrade', 'suspend', 'withdraw'].includes(outcome)) return res.status(400).json({ error: 'قرار غير صالح' });
  if (!reason || reason.trim().length < 10) return res.status(422).json({ error: 'التسبيب الكتابي مطلوب (المادة 21/3)' });
  const l = db.prepare('SELECT * FROM licensees WHERE id=?').get(d.licensee_id);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE compliance_declarations SET outcome=?, note=?, decided_by=?, decided_at=datetime('now'),
        status=CASE WHEN ?='renew' THEN 'accepted' ELSE status END WHERE id=?`).run(outcome, reason, req.user.id, outcome, d.id);
    if (outcome === 'renew' && l.status === 'active' && l.end_date) {
      const today = new Date().toISOString().slice(0, 10);
      if (R.daysBetween(today, l.end_date) < 120) db.prepare('UPDATE licensees SET end_date=? WHERE id=?').run(R.addDays(l.end_date, 365), l.id);
    }
    if (outcome === 'downgrade')
      S.createSanction(req.user.id, { subject_kind: 'licensee', subject_id: l.id, violation_code: 3, measure: 'level_downgrade', reason });
    if (outcome === 'suspend')
      S.createSanction(req.user.id, { subject_kind: 'licensee', subject_id: l.id, violation_code: 4, measure: 'suspension', reason });
    if (outcome === 'withdraw')
      S.createSanction(req.user.id, { subject_kind: 'licensee', subject_id: l.id, violation_code: req.body.violation_code || 8, measure: 'withdrawal', reason });
  });
  tx();
  log(req, 'declaration.decide', 'licensee', l.id, `${outcome}: ${reason.slice(0, 100)}`);
  res.json(db.prepare('SELECT * FROM compliance_declarations WHERE id=?').get(d.id));
});

// ================= الموافقة المسبقة على التصاميم (المادة 19) =================
r.get('/designs', requireAuth, (req, res) => {
  const all = hasPerm(req.user, 'design.decide') || hasPerm(req.user, 'licensee.view.all');
  const extra = all ? [] : [`da.licensee_id IN (${(req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]).map(()=>'?').join(',')})`];
  const out = buildList(db, {
    table: `design_approvals da JOIN licensees l ON l.id=da.licensee_id`,
    columns: `da.*, l.legal_name, l.license_no, l.level`,
    filters: { status: { op: 'in', col: 'da.status' }, decision: { op: 'in', col: 'da.decision' },
      material_type: { op: 'in', col: 'da.material_type' }, due_before: { op: 'lte', col: 'da.due_at' } },
    search: ['da.title', 'l.legal_name', 'da.reference'],
    allowSort: ['submitted_at', 'due_at', 'status'], defaultSort: 'da.submitted_at DESC',
    req, extraWhere: extra, params: all ? [] : (req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]),
  });
  const today = new Date().toISOString().slice(0, 10);
  out.rows.forEach((x) => {
    if (x.status === 'pending' && x.due_at < today) {
      x.implicit_approval = 1;
      x.note = 'مضت عشرة أيام عمل دون رد — يُعدّ ذلك موافقةً ضمنية (المادة 19/2)';
    }
  });
  res.json(out);
});

r.post('/designs', requireAuth, can('design.submit'), (req, res) => {
  const { licensee_id, material_type, title, logo_variant, shows_license_no, claim_text, file_doc_id } = req.body;
  if (!ownsLicensee(req.user, licensee_id)) return res.status(403).json({ error: 'لا تملك هذا الملف' });
  const l = db.prepare('SELECT * FROM licensees WHERE id=?').get(licensee_id);
  const screen = R.screenClaim(claim_text, l.level, l.license_no);
  const today = new Date().toISOString().slice(0, 10);
  const ref = nextRef('DSG', 'design_approvals');
  const info = db.prepare(`INSERT INTO design_approvals (reference, licensee_id, material_type, title, logo_variant,
      shows_license_no, claim_text, file_doc_id, due_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    ref, licensee_id, material_type, title, logo_variant || 'full',
    shows_license_no ? 1 : 0, claim_text || null, file_doc_id || null, R.designDecisionDue(today));
  notify({ role_code: 'STANDARDS_COMMITTEE', title: 'تصميم بانتظار الموافقة المسبقة',
    body: `${ref} — ${title}`, link: '#/designs' });
  log(req, 'design.submit', 'licensee', licensee_id, `طلب موافقة على تصميم: ${title}`);
  res.status(201).json({ id: info.lastInsertRowid, reference: ref, due_at: R.designDecisionDue(today),
    claim_screen: screen,
    rule: 'عدم الرد خلال عشرة أيام عمل يُعدّ موافقةً ضمنية (المادة 19/2)' });
});

r.post('/designs/:id/decide', requireAuth, can('design.decide'), (req, res) => {
  const { decision, notes } = req.body;
  if (!['approved', 'rejected', 'changes_required'].includes(decision))
    return res.status(400).json({ error: 'decision غير صالح' });
  const d = db.prepare('SELECT * FROM design_approvals WHERE id=?').get(Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'غير موجود' });
  db.prepare(`UPDATE design_approvals SET decision=?, decision_notes=?, decided_by=?, decided_at=datetime('now'),
              status='decided' WHERE id=?`).run(decision, notes || null, req.user.id, d.id);
  log(req, 'design.decide', 'design', d.id, `${decision}: ${notes || ''}`);
  res.json(db.prepare('SELECT * FROM design_approvals WHERE id=?').get(d.id));
});

module.exports = r;
