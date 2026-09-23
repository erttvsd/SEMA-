'use strict';
const express = require('express');
const { db } = require('../db');
const { can, requireAuth, hasPerm, ownsLicensee, ownsAssociation, log } = require('../auth');
const { buildList } = require('../query');
const R = require('../rules');

const r = express.Router();

// ---------- المرخَّص لهم ----------
r.get('/licensees', requireAuth, (req, res) => {
  const scoped = !hasPerm(req.user, 'licensee.view.all');
  if (scoped && !req.user.scopes.licensee.length) return res.json({ rows: [], total: 0, page: 1, pages: 1 });
  const extra = scoped ? [`l.id IN (${req.user.scopes.licensee.map(() => '?').join(',')})`] : [];
  const out = buildList(db, {
    table: `licensees l LEFT JOIN brand_levels b ON b.level=l.level`,
    columns: `l.id, l.license_no, l.legal_name, l.trade_name, l.applicant_kind, l.sector, l.region, l.city,
              l.tier_code, l.level, b.name_ar AS level_name, b.color_hex, l.scope_type, l.scope_desc,
              l.annual_revenue, l.net_profit, l.status, l.status_reason, l.start_date, l.end_date,
              l.founding_partner, l.partner_class, l.excluded, l.created_at`,
    filters: {
      status: { op: 'in', col: 'l.status' },
      level: { op: 'in', col: 'l.level' },
      tier_code: { op: 'in', col: 'l.tier_code' },
      region: { op: 'in', col: 'l.region' },
      sector: { op: 'in', col: 'l.sector' },
      applicant_kind: { op: 'in', col: 'l.applicant_kind' },
      founding_partner: { op: 'bool', col: 'l.founding_partner' },
      revenue_min: { op: 'gte', col: 'l.annual_revenue', num: true },
      revenue_max: { op: 'lte', col: 'l.annual_revenue', num: true },
      start_from: { op: 'gte', col: 'l.start_date' },
      start_to: { op: 'lte', col: 'l.start_date' },
    },
    search: ['l.legal_name', 'l.trade_name', 'l.license_no', 'l.commercial_reg', 'l.city', 'l.sector'],
    allowSort: ['legal_name', 'license_no', 'level', 'annual_revenue', 'start_date', 'created_at', 'status'],
    defaultSort: 'l.created_at DESC',
    req, extraWhere: extra, params: scoped ? req.user.scopes.licensee : [],
  });
  res.json(out);
});

r.get('/licensees/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!hasPerm(req.user, 'licensee.view.all') && !ownsLicensee(req.user, id))
    return res.status(403).json({ error: 'الاطلاع مقصور على ملفك' });
  const row = db.prepare(`SELECT l.*, b.name_ar level_name, b.color_hex, b.claim_ar, t.name_ar tier_name
                          FROM licensees l LEFT JOIN brand_levels b ON b.level=l.level
                          LEFT JOIN revenue_tiers t ON t.code=l.tier_code WHERE l.id=?`).get(id);
  if (!row) return res.status(404).json({ error: 'غير موجود' });

  const confidential = hasPerm(req.user, 'doc.view.confidential');
  row.documents = db.prepare(`SELECT d.id,d.doc_type,dt.name_ar doc_type_name,d.title,d.file_name,d.mime_type,d.size_bytes,
      d.pages,d.issued_on,d.expires_on,d.verification,d.verified_at,d.verify_note,d.is_public,d.confidential,d.uploaded_at
      FROM documents d LEFT JOIN document_types dt ON dt.code=d.doc_type
      WHERE d.owner_kind='licensee' AND d.owner_id=? ${confidential ? '' : 'AND d.confidential=0'}
      ORDER BY d.uploaded_at DESC`).all(id);
  row.commitments = db.prepare('SELECT * FROM commitments WHERE licensee_id=? ORDER BY fiscal_year DESC').all(id);
  row.contributions = db.prepare(`SELECT c.*, a.name association_name, ec.name_ar channel_name
      FROM contributions c LEFT JOIN associations a ON a.id=c.association_id
      LEFT JOIN eligible_channels ec ON ec.code=c.channel
      WHERE c.licensee_id=? ORDER BY c.fiscal_year DESC, c.transfer_date DESC`).all(id);
  row.declarations = db.prepare('SELECT * FROM compliance_declarations WHERE licensee_id=? ORDER BY fiscal_year DESC').all(id);
  row.applications = db.prepare('SELECT * FROM applications WHERE subject_kind=\'licensee\' AND subject_id=? ORDER BY submitted_at DESC').all(id);
  // المادة 26/3: لا يُخطَر المرخَّص له بموعد أي زيارة غير معلنة — فلا تظهر له قبل تنفيذها
  const hideUnannounced = !hasPerm(req.user, 'audit.view.all') ? "AND (a.audit_type != 'unannounced' OR a.executed_date IS NOT NULL)" : '';
  row.audits = db.prepare(`SELECT a.*, u.full_name assessor_name FROM audits a LEFT JOIN users u ON u.id=a.assessor_id
      WHERE a.subject_kind='licensee' AND a.subject_id=? ${hideUnannounced} ORDER BY a.scheduled_date DESC`).all(id);
  row.sanctions = db.prepare(`SELECT s.*, v.case_ar violation_text FROM sanctions s LEFT JOIN violation_codes v ON v.code=s.violation_code
      WHERE s.subject_kind='licensee' AND s.subject_id=? ORDER BY s.decided_at DESC`).all(id);
  row.invoices = db.prepare('SELECT * FROM invoices WHERE subject_kind=\'licensee\' AND subject_id=? ORDER BY issued_at DESC').all(id);
  row.designs = db.prepare('SELECT * FROM design_approvals WHERE licensee_id=? ORDER BY submitted_at DESC').all(id);
  row.appeals = db.prepare('SELECT * FROM appeals WHERE appellant_kind=\'licensee\' AND appellant_id=? ORDER BY filed_at DESC').all(id);

  // حسابات مشتقّة
  const cur = row.commitments[0];
  if (cur) {
    row.mix = R.validateMix({ cash: cur.cash_paid, inkind: cur.inkind_paid,
      volunteer: cur.volunteer_paid, direct_program: cur.direct_program_paid });
    row.deficit = R.deficitAssessment(cur.commitment_due, cur.total_paid);
    const byOrg = {};
    for (const c of row.contributions.filter((c) => c.fiscal_year === cur.fiscal_year && c.status !== 'rejected'))
      byOrg[c.association_name || '—'] = (byOrg[c.association_name || '—'] || 0) + c.amount;
    row.concentration = R.concentrationCheck(cur.commitment_due, byOrg);
  }
  row.fees = R.computeFees({ revenue: row.annual_revenue, level: row.level });
  row.audit_rate = R.fieldAuditRate({ level: row.level, tierCode: row.tier_code,
    hasComplaint: !!db.prepare("SELECT 1 FROM complaints WHERE subject_kind='licensee' AND subject_id=? AND status NOT IN ('closed','unsubstantiated')").get(id),
    pilotYear: db.prepare("SELECT v FROM settings WHERE k='pilot_year'").get()?.v === '1' });
  row.allowed_claim = R.allowedClaim(row.level, row.license_no);
  row.required_docs = db.prepare("SELECT code,name_ar,required,expires FROM document_types WHERE applies_to IN ('licensee','both')").all()
    .map((d) => ({ ...d, uploaded: row.documents.some((x) => x.doc_type === d.code),
      verified: row.documents.some((x) => x.doc_type === d.code && x.verification === 'verified') }));
  res.json(row);
});

r.patch('/licensees/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const all = hasPerm(req.user, 'licensee.edit.all');
  if (!all && !(hasPerm(req.user, 'licensee.edit.own') && ownsLicensee(req.user, id)))
    return res.status(403).json({ error: 'لا تملك صلاحية تحديث هذا الملف' });
  const before = db.prepare('SELECT * FROM licensees WHERE id=?').get(id);
  if (!before) return res.status(404).json({ error: 'غير موجود' });
  // الشريك لا يعدّل حالته ولا مستواه ولا رقم ترخيصه
  // صاحب الملف يعدّل بيانات التواصل فقط؛ الأرقام التي تحدد الشريحة والرسم والمستوى تُعدَّل من الأمانة بعد التحقق
  // من الإثبات المالي (المادة 23) — وإلا خفّض الشريك شريحته ورسمه بنفسه
  const selfFields = ['trade_name','city','address','contact_name','contact_email','contact_phone','website'];
  const adminFields = [...selfFields,'sector','annual_revenue','net_profit','fiscal_year','scope_desc','legal_name','legal_form',
    'commercial_reg','tax_file_no','social_sec_no','region','scope_type','excluded','exclusion_reason','partner_class'];
  // الحقول غير المسموحة للمستدعي تُهمَل قبل أي تحقق أو أثر جانبي (مثل إعادة احتساب الشريحة)
  const fields = all ? adminFields : selfFields;
  const ignored = Object.keys(req.body).filter((k) => !fields.includes(k));
  req.body = Object.fromEntries(Object.entries(req.body).filter(([k]) => fields.includes(k)));
  const NUM = { annual_revenue: [0.01, 1e12], net_profit: [-1e12, 1e12], fiscal_year: [2000, 2100] };
  for (const [k, [lo, hi]] of Object.entries(NUM)) if (k in req.body) {
    const v = Number(req.body[k]);
    if (req.body[k] === '' || req.body[k] == null || !Number.isFinite(v) || v < lo || v > hi) return res.status(400).json({ error: `قيمة ${k} غير صالحة` });
    req.body[k] = v;
  }
  if ('region' in req.body && !['الغربية','الشرقية','الجنوبية'].includes(req.body.region)) return res.status(400).json({ error: 'المنطقة غير صالحة' });
  if ('scope_type' in req.body && !['enterprise','brand','product_line'].includes(req.body.scope_type)) return res.status(400).json({ error: 'النطاق غير صالح' });
  if ('partner_class' in req.body && !['none','founding','working','honorary'].includes(req.body.partner_class)) return res.status(400).json({ error: 'صفة الشراكة غير صالحة' });
  if ('excluded' in req.body) req.body.excluded = req.body.excluded ? 1 : 0;
  const sets = [], vals = [];
  for (const f of fields) if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  if (!sets.length) return res.status(400).json({ error: 'لا توجد حقول مسموح لك بتحديثها', ignored });
  // إعادة احتساب الشريحة من الإيراد
  if ('annual_revenue' in req.body) { sets.push('tier_code=?'); vals.push(R.tierFor(req.body.annual_revenue).code); }
  sets.push("updated_at=datetime('now')");
  db.prepare(`UPDATE licensees SET ${sets.join(',')} WHERE id=?`).run(...vals, id);
  const after = db.prepare('SELECT * FROM licensees WHERE id=?').get(id);
  log(req, 'licensee.update', 'licensee', id, 'تحديث بيانات مرخَّص له', before, after);
  res.json({ ...after, ignored_fields: ignored.length ? ignored : undefined });
});

// ---------- المنظمات ----------
r.get('/associations', requireAuth, (req, res) => {
  const scoped = !hasPerm(req.user, 'org.view.all');
  if (scoped && !req.user.scopes.association.length) return res.json({ rows: [], total: 0, page: 1, pages: 1 });
  const extra = scoped ? [`a.id IN (${req.user.scopes.association.map(() => '?').join(',')})`] : [];
  const out = buildList(db, {
    table: `associations a LEFT JOIN admin_expense_classes c ON c.code=a.admin_class`,
    columns: `a.id, a.accreditation_no, a.name, a.registration_no, a.region, a.city, a.established_year,
              a.board_size, a.annual_revenue, a.total_expenses, a.admin_expenses, a.admin_expense_ratio,
              a.admin_class, c.name_ar AS admin_class_name, a.admin_ratio_3y_avg, a.fundraising_cost_ratio,
              a.largest_budget_3y, a.absorption_cap, a.absorption_used, a.audit_tier, a.focus_areas,
              a.status, a.status_reason, a.accredited_from, a.accredited_to, a.partner_class, a.created_at`,
    filters: {
      status: { op: 'in', col: 'a.status' },
      admin_class: { op: 'in', col: 'a.admin_class' },
      region: { op: 'in', col: 'a.region' },
      ratio_max: { op: 'lte', col: 'a.admin_expense_ratio', num: true },
      ratio_min: { op: 'gte', col: 'a.admin_expense_ratio', num: true },
      revenue_min: { op: 'gte', col: 'a.annual_revenue', num: true },
      revenue_max: { op: 'lte', col: 'a.annual_revenue', num: true },
      expiring_before: { op: 'lte', col: 'a.accredited_to' },
      focus: { op: 'like', col: 'a.focus_areas' },
    },
    search: ['a.name', 'a.accreditation_no', 'a.registration_no', 'a.city', 'a.focus_areas'],
    allowSort: ['name', 'accreditation_no', 'admin_expense_ratio', 'annual_revenue', 'accredited_to', 'created_at', 'status'],
    defaultSort: 'a.created_at DESC',
    req, extraWhere: extra, params: scoped ? req.user.scopes.association : [],
  });
  res.json(out);
});

r.get('/associations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!hasPerm(req.user, 'org.view.all') && !ownsAssociation(req.user, id))
    return res.status(403).json({ error: 'الاطلاع مقصور على ملف منظمتك' });
  const row = db.prepare(`SELECT a.*, c.name_ar admin_class_name FROM associations a
      LEFT JOIN admin_expense_classes c ON c.code=a.admin_class WHERE a.id=?`).get(id);
  if (!row) return res.status(404).json({ error: 'غير موجود' });
  const confidential = hasPerm(req.user, 'doc.view.confidential');
  row.documents = db.prepare(`SELECT d.id,d.doc_type,dt.name_ar doc_type_name,d.title,d.file_name,d.mime_type,d.size_bytes,
      d.pages,d.issued_on,d.expires_on,d.verification,d.verified_at,d.verify_note,d.is_public,d.confidential,d.uploaded_at
      FROM documents d LEFT JOIN document_types dt ON dt.code=d.doc_type
      WHERE d.owner_kind='association' AND d.owner_id=? ${confidential ? '' : 'AND d.confidential=0'}
      ORDER BY d.uploaded_at DESC`).all(id);
  row.criteria = db.prepare(`SELECT ca.*, ac.name_ar, ac.requirement_ar, ac.threshold
      FROM criteria_assessments ca JOIN accreditation_criteria ac ON ac.no=ca.criterion_no
      WHERE ca.association_id=? ORDER BY ca.cycle_year DESC, ca.criterion_no`).all(id);
  row.contributions = db.prepare(`SELECT c.*, l.legal_name licensee_name, l.license_no, l.level,
      ec.name_ar channel_name FROM contributions c JOIN licensees l ON l.id=c.licensee_id
      LEFT JOIN eligible_channels ec ON ec.code=c.channel
      WHERE c.association_id=? ORDER BY c.transfer_date DESC`).all(id);
  row.applications = db.prepare("SELECT * FROM applications WHERE subject_kind='association' AND subject_id=? ORDER BY submitted_at DESC").all(id);
  const hideUnannounced = !hasPerm(req.user, 'audit.view.all') ? "AND (a.audit_type != 'unannounced' OR a.executed_date IS NOT NULL)" : '';
  row.audits = db.prepare(`SELECT a.*, u.full_name assessor_name FROM audits a LEFT JOIN users u ON u.id=a.assessor_id
      WHERE a.subject_kind='association' AND a.subject_id=? ${hideUnannounced} ORDER BY a.scheduled_date DESC`).all(id);
  row.sanctions = db.prepare(`SELECT s.*, v.case_ar violation_text FROM sanctions s LEFT JOIN violation_codes v ON v.code=s.violation_code
      WHERE s.subject_kind='association' AND s.subject_id=? ORDER BY s.decided_at DESC`).all(id);

  const received = row.contributions.filter((c) => c.status === 'verified')
    .reduce((s, c) => s + c.amount, 0);
  row.absorption = R.absorptionCheck(row.largest_budget_3y, received);
  row.admin_classification = R.classifyAdminRatio(row.admin_expense_ratio);
  row.required_audit_tier = R.auditTierFor(row.annual_revenue);
  row.fees_note = 'لا تُحصَّل من منظمة المجتمع المدني أي رسوم في أي مرحلة (المادة 12) — وتُموَّل كلفة الاعتماد من رسوم ترخيص قطاع الأعمال.';
  row.required_docs = db.prepare("SELECT code,name_ar,required,expires FROM document_types WHERE applies_to IN ('association','both')").all()
    .map((d) => ({ ...d, uploaded: row.documents.some((x) => x.doc_type === d.code),
      verified: row.documents.some((x) => x.doc_type === d.code && x.verification === 'verified') }));
  res.json(row);
});

r.patch('/associations/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const all = hasPerm(req.user, 'org.edit.all');
  if (!all && !(hasPerm(req.user, 'org.edit.own') && ownsAssociation(req.user, id)))
    return res.status(403).json({ error: 'لا تملك صلاحية تحديث هذا الملف' });
  const before = db.prepare('SELECT * FROM associations WHERE id=?').get(id);
  if (!before) return res.status(404).json({ error: 'غير موجود' });
  // المنظمة تعدّل بيانات التواصل فقط؛ الأرقام التي يُحسب منها التصنيف المنشور وسقف الاستيعاب والمعايير
  // تُعدَّل من الأمانة بعد مطابقتها مع القوائم المالية المدققة (المادة 14 و15)
  const selfFields = ['city','address','contact_name','contact_email','contact_phone','focus_areas'];
  const adminFields = [...selfFields,'board_size','paid_board_members','board_meetings_last_year','annual_revenue','total_expenses',
    'admin_expenses','fundraising_cost_ratio','largest_budget_3y','name','registration_no','registration_authority','region',
    'established_year','partner_class'];
  const fields = all ? adminFields : selfFields;
  req.body = Object.fromEntries(Object.entries(req.body).filter(([k]) => fields.includes(k)));
  const NUM = { board_size: [0, 100], paid_board_members: [0, 100], board_meetings_last_year: [0, 100], annual_revenue: [0, 1e12],
    total_expenses: [0, 1e12], admin_expenses: [0, 1e12], fundraising_cost_ratio: [0, 1], largest_budget_3y: [0, 1e12], established_year: [1900, 2100] };
  for (const [k, [lo, hi]] of Object.entries(NUM)) if (k in req.body) {
    const v = Number(req.body[k]);
    if (req.body[k] === '' || req.body[k] == null || !Number.isFinite(v) || v < lo || v > hi) return res.status(400).json({ error: `قيمة ${k} غير صالحة` });
    req.body[k] = v;
  }
  const merged = { ...before, ...req.body };
  if (all && Number(merged.admin_expenses) > Number(merged.total_expenses)) return res.status(422).json({ error: 'المصروفات الإدارية لا تتجاوز الإجمالي' });
  if ('region' in req.body && !['الغربية','الشرقية','الجنوبية'].includes(req.body.region)) return res.status(400).json({ error: 'المنطقة غير صالحة' });
  if ('partner_class' in req.body && !['none','founding','working','honorary'].includes(req.body.partner_class)) return res.status(400).json({ error: 'صفة الشراكة غير صالحة' });
  const sets = [], vals = [];
  for (const f of fields) if (f in req.body) { sets.push(`${f}=?`); vals.push(req.body[f]); }
  if (!sets.length) return res.status(400).json({ error: 'لا توجد حقول للتحديث' });
  db.prepare(`UPDATE associations SET ${sets.join(',')}, updated_at=datetime('now') WHERE id=?`).run(...vals, id);
  // إعادة احتساب النسبة والتصنيف وسقف الاستيعاب
  const a = db.prepare('SELECT * FROM associations WHERE id=?').get(id);
  if (a.total_expenses > 0) {
    const ratio = a.admin_expenses / a.total_expenses;
    const cls = R.classifyAdminRatio(ratio);
    db.prepare('UPDATE associations SET admin_expense_ratio=?, admin_class=?, absorption_cap=?, audit_tier=? WHERE id=?')
      .run(R.round4(ratio), cls.code, (a.largest_budget_3y || 0) * 2, R.auditTierFor(a.annual_revenue), id);
  }
  const after = db.prepare('SELECT * FROM associations WHERE id=?').get(id);
  log(req, 'association.update', 'association', id, 'تحديث بيانات منظمة', before, after);
  res.json(after);
});

// تقييم المعايير الخمسة عشر
r.post('/associations/:id/criteria', requireAuth, can('org.assess_criteria'), (req, res) => {
  const id = Number(req.params.id);
  const { cycle_year, items } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'items مطلوبة' });
  if (!db.prepare('SELECT 1 FROM associations WHERE id=?').get(id)) return res.status(404).json({ error: 'غير موجود' });
  for (const it of items)
    if (!it || !(Number.isInteger(Number(it.criterion_no)) && it.criterion_no >= 1 && it.criterion_no <= 15) || !['met','not_met','partial','na'].includes(it.result))
      return res.status(400).json({ error: 'كل بند: رقم معيار من 1 إلى 15 ونتيجة (met/not_met/partial/na)' });
  const st = db.prepare(`INSERT INTO criteria_assessments
    (association_id, criterion_no, cycle_year, result, measured_value, note, evidence_doc_id, assessed_by)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(association_id,criterion_no,cycle_year) DO UPDATE SET
      result=excluded.result, measured_value=excluded.measured_value, note=excluded.note,
      evidence_doc_id=excluded.evidence_doc_id, assessed_by=excluded.assessed_by, assessed_at=datetime('now')`);
  const tx = db.transaction(() => {
    for (const it of items)
      st.run(id, it.criterion_no, cycle_year || new Date().getFullYear(), it.result,
        it.measured_value ?? null, it.note ?? null, it.evidence_doc_id ?? null, req.user.id);
  });
  tx();
  log(req, 'criteria.assess', 'association', id, `تقييم ${items.length} معياراً`);
  const rows = db.prepare('SELECT * FROM criteria_assessments WHERE association_id=? AND cycle_year=?')
    .all(id, cycle_year || new Date().getFullYear());
  const notMet = rows.filter((x) => x.result === 'not_met').map((x) => x.criterion_no);
  res.json({ saved: rows.length, not_met: notMet,
    verdict: notMet.length ? 'لا يستوفي المعايير مجتمعةً — المعايير الخمسة عشر تُستوفى مجتمعةً' : 'يستوفي المعايير الخمسة عشر' });
});

// ---------- حاسبة الالتزام والرسوم (متاحة لكل مسجَّل) ----------
r.post('/calc/commitment', requireAuth, (req, res) => {
  const { revenue, net_profit, level, scope_net_profit, pilot_discount, first_year_remaining_months } = req.body;
  if (revenue == null || level == null) return res.status(400).json({ error: 'revenue و level مطلوبان' });
  res.json({
    commitment: R.computeCommitment({ revenue, netProfit: net_profit, level, scopeNetProfit: scope_net_profit }),
    fees: R.computeFees({ revenue, level, pilotDiscount: pilot_discount, firstYearRemainingMonths: first_year_remaining_months }),
    field_audit: R.fieldAuditRate({ level, tierCode: R.tierFor(revenue).code }),
    tax_note: 'سقف الخصم الضريبي في ليبيا 2% من صافي الدخل — الرجوع إلى المستشار الضريبي واجب (ملحق 1 من اللائحة).',
  });
});

module.exports = r;
