'use strict';
/** السجل العام — مفتوح للبحث دون تسجيل دخول (المادة 33 و37) */
const express = require('express');
const { db } = require('../db');
const { buildList } = require('../query');
const REF = require('../reference');
const R = require('../rules');

const r = express.Router();

r.get('/registry/licensees', (req, res) => {
  const out = buildList(db, {
    table: 'v_public_registry_licensees v',
    columns: `v.license_no, v.legal_name, v.trade_name, v.level, v.level_name, v.color_hex,
              v.scope_type, v.scope_desc, v.region, v.city, v.sector, v.start_date, v.end_date,
              v.status, v.status_reason, v.founding_partner, v.verified_commitment, v.commitment_year, v.qr_token`,
    filters: {
      status: { op: 'in', col: 'v.status' }, level: { op: 'in', col: 'v.level' },
      region: { op: 'in', col: 'v.region' }, sector: { op: 'in', col: 'v.sector' },
      city: { op: 'like', col: 'v.city' }, founding_partner: { op: 'bool', col: 'v.founding_partner' },
    },
    search: ['v.legal_name', 'v.trade_name', 'v.license_no', 'v.sector', 'v.city'],
    allowSort: ['legal_name', 'license_no', 'level', 'start_date', 'verified_commitment'],
    defaultSort: 'v.level DESC, v.legal_name', req,
  });
  res.json(out);
});

r.get('/registry/associations', (req, res) => {
  const out = buildList(db, {
    table: 'v_public_registry_associations v',
    columns: `v.accreditation_no, v.name, v.region, v.city, v.accredited_from, v.accredited_to,
              v.admin_expense_ratio, v.admin_class, v.admin_class_name, v.status, v.status_reason,
              v.absorption_cap, v.absorption_used, v.focus_areas, v.qr_token`,
    filters: { status: { op: 'in', col: 'v.status' }, admin_class: { op: 'in', col: 'v.admin_class' },
      region: { op: 'in', col: 'v.region' }, focus: { op: 'like', col: 'v.focus_areas' },
      ratio_max: { op: 'lte', col: 'v.admin_expense_ratio', num: true } },
    search: ['v.name', 'v.accreditation_no', 'v.city', 'v.focus_areas'],
    allowSort: ['name', 'admin_expense_ratio', 'accredited_to'], defaultSort: 'v.name', req,
  });
  res.json(out);
});

/** صفحة التحقق برقم الترخيص أو رمز QR (المادة 36) */
r.get('/verify/:key', (req, res) => {
  const key = req.params.key;
  const l = db.prepare(`SELECT l.license_no, l.legal_name, l.trade_name, l.level, b.name_ar level_name,
      b.color_hex, b.claim_ar, l.scope_type, l.scope_desc, l.region, l.city, l.sector,
      l.start_date, l.end_date, l.status, l.status_reason, l.founding_partner
      FROM licensees l LEFT JOIN brand_levels b ON b.level=l.level
      WHERE (l.license_no=? OR l.qr_token=?) AND l.status IN ('active','suspended','withdrawn','expired')`)
    .get(key, key);
  if (l) {
    const id = db.prepare('SELECT id FROM licensees WHERE license_no=?').get(l.license_no).id;
    l.kind = 'licensee';
    l.beneficiary_associations = db.prepare(`SELECT DISTINCT a.name, a.accreditation_no, a.region
        FROM contributions c JOIN associations a ON a.id=c.association_id
        WHERE c.licensee_id=? AND c.status IN ('documented','verified')`).all(id);
    const c = db.prepare(`SELECT c.fiscal_year, c.commitment_due,
        (SELECT COALESCE(SUM(amount),0) FROM contributions ct WHERE ct.licensee_id=c.licensee_id AND ct.fiscal_year=c.fiscal_year
          AND ct.status='verified') total_paid
        FROM commitments c WHERE c.licensee_id=? ORDER BY c.fiscal_year DESC LIMIT 1`).get(id);
    l.verified_commitment = c || null;
    l.allowed_claim = R.allowedClaim(l.level, l.license_no);
    l.published_sanctions = db.prepare(`SELECT s.case_no, v.case_ar violation, s.measure, s.reason, s.decided_at,
        s.publish_until FROM sanctions s LEFT JOIN violation_codes v ON v.code=s.violation_code
        WHERE s.subject_kind='licensee' AND s.subject_id=? AND s.published=1
        AND (s.publish_until IS NULL OR s.publish_until >= date('now'))`).all(id);
    l.valid = l.status === 'active';
    l.message = { active: 'ترخيص ساري', suspended: 'الترخيص معلَّق — يوقف كل استعمال جديد للعلامة',
      withdrawn: 'الترخيص مسحوب', expired: 'الترخيص منتهٍ' }[l.status];
    return res.json(l);
  }
  const a = db.prepare(`SELECT a.accreditation_no, a.name, a.region, a.city, a.accredited_from, a.accredited_to,
      a.admin_expense_ratio, a.admin_class, c.name_ar admin_class_name, a.status, a.status_reason,
      a.focus_areas, a.absorption_cap, a.absorption_used FROM associations a
      LEFT JOIN admin_expense_classes c ON c.code=a.admin_class
      WHERE (a.accreditation_no=? OR a.qr_token=?) AND a.status IN ('accredited','suspended','revoked','expired')`)
    .get(key, key);
  if (a) {
    const id = db.prepare('SELECT id FROM associations WHERE accreditation_no=?').get(a.accreditation_no).id;
    a.kind = 'association';
    a.public_documents = db.prepare(`SELECT d.id, d.title, dt.name_ar doc_type_name, d.issued_on
        FROM documents d LEFT JOIN document_types dt ON dt.code=d.doc_type
        WHERE d.owner_kind='association' AND d.owner_id=? AND d.is_public=1`).all(id);
    a.valid = a.status === 'accredited';
    a.message = { accredited: 'اعتماد ساري — يجوز توجيه المساهمات إليها', suspended: 'الاعتماد معلَّق',
      revoked: 'الاعتماد مسحوب', expired: 'الاعتماد منتهٍ' }[a.status];
    return res.json(a);
  }
  res.status(404).json({ found: false,
    error: 'لا يوجد قيد بهذا الرقم في السجل العام',
    warning: 'استعمال العلامة من غير مرخَّص مخالفة موجبة لخطاب كفٍّ وامتناع وغرامة تعادل خمسة أضعاف الرسم السنوي (المادة 29/11)' });
});

/** الجزاءات المنشورة والمرخَّص لهم السابقون (المادة 37) */
r.get('/registry/sanctions', (req, res) => {
  const out = buildList(db, {
    table: `sanctions s LEFT JOIN violation_codes v ON v.code=s.violation_code
            LEFT JOIN licensees l ON s.subject_kind='licensee' AND l.id=s.subject_id
            LEFT JOIN associations o ON s.subject_kind='association' AND o.id=s.subject_id`,
    columns: `s.case_no, COALESCE(l.legal_name,o.name,s.subject_name) name, s.subject_kind,
              v.case_ar violation, s.measure, s.reason, s.decided_at, s.effective_to,
              s.publish_until, s.reapply_allowed_from, s.status`,
    filters: { measure: { op: 'in', col: 's.measure' }, subject_kind: { op: 'in', col: 's.subject_kind' } },
    search: ['l.legal_name', 'o.name', 's.subject_name', 's.reason'],
    allowSort: ['decided_at'], defaultSort: 's.decided_at DESC',
    req, extraWhere: ['s.published=1', "(s.publish_until IS NULL OR s.publish_until >= date('now'))"],
  });
  res.json(out);
});

r.get('/registry/former', (_req, res) => {
  res.json({ rows: db.prepare(`SELECT l.license_no, l.legal_name, l.level, l.end_date, l.status, l.status_reason,
      CASE l.status WHEN 'expired' THEN 'عدم طلب التجديد' WHEN 'rejected' THEN 'رفض التجديد'
      WHEN 'withdrawn' THEN 'السحب' END category FROM licensees l
      WHERE l.status IN ('expired','withdrawn','rejected') AND l.end_date >= date('now','-12 month')
      ORDER BY l.end_date DESC`).all(),
    note: 'تبقى بيانات المرخَّص لهم السابقين منشورةً اثني عشر شهراً مصنَّفةً بحسب السبب (المادة 37/3).' });
});

/** الشفافية العامة */
r.get('/transparency', (_req, res) => {
  const year = new Date().getFullYear();
  const budget = db.prepare('SELECT category, SUM(COALESCE(actual,budgeted)) amount FROM secretariat_budget WHERE fiscal_year=? GROUP BY category').all(year);
  const total = budget.reduce((s, x) => s + x.amount, 0);
  res.json({
    year,
    spending: budget.map((b) => ({ ...b, share: total ? R.round4(b.amount / total) : 0,
      label: { program: 'برامجي', fundraising: 'جمع تمويل', admin: 'إدارة عامة' }[b.category] })),
    totals: {
      licensees: db.prepare("SELECT COUNT(*) n FROM licensees WHERE status='active'").get().n,
      associations: db.prepare("SELECT COUNT(*) n FROM associations WHERE status='accredited'").get().n,
      directed_total: db.prepare('SELECT COALESCE(SUM(total_paid),0) s FROM commitments').get().s,
      withdrawals_published: db.prepare("SELECT COUNT(*) n FROM sanctions WHERE measure='withdrawal' AND published=1").get().n,
      unannounced_visits: db.prepare("SELECT COUNT(*) n FROM audits WHERE audit_type='unannounced' AND executed_date IS NOT NULL").get().n,
      field_audits: db.prepare("SELECT COUNT(*) n FROM audits WHERE audit_type IN ('field','unannounced') AND executed_date IS NOT NULL").get().n,
      avg_processing_days: db.prepare('SELECT ROUND(AVG(processing_days),1) d FROM applications WHERE processing_days IS NOT NULL').get().d,
    },
    integrity_disclosures: db.prepare("SELECT reference, title, body, published_at FROM integrity_notes WHERE public_disclosure=1").all(),
    market_tests: db.prepare('SELECT * FROM market_tests WHERE published=1 ORDER BY conducted_on DESC').all(),
    observers: db.prepare("SELECT person_name, nominating_entity, entity_kind, term_start FROM observers WHERE status='admitted'").all(),
    note: 'الأصل هو النشر. ولا يجوز حجب معلومة عن السجل العام إلا بنصٍّ صريح (المادة 6 من النظام الداخلي).',
  });
});

/** البيانات المرجعية العامة — تخدم الواجهة والحاسبة */
r.get('/reference', (_req, res) => {
  res.json({
    tiers: db.prepare('SELECT * FROM revenue_tiers ORDER BY sort_order').all(),
    levels: db.prepare('SELECT * FROM brand_levels ORDER BY level').all(),
    criteria: db.prepare('SELECT * FROM accreditation_criteria ORDER BY no').all(),
    channels: db.prepare('SELECT * FROM eligible_channels').all(),
    violations: db.prepare('SELECT * FROM violation_codes ORDER BY code').all(),
    admin_classes: db.prepare('SELECT * FROM admin_expense_classes').all(),
    document_types: db.prepare('SELECT * FROM document_types').all(),
    audit_tiers: REF.AUDIT_TIERS,
    app_stages: REF.APP_STAGES.map(([stage, name, body, days]) => ({ stage, name, body, max_days: days })),
    regions: ['الغربية', 'الشرقية', 'الجنوبية'],
    sectors: db.prepare('SELECT DISTINCT sector FROM licensees WHERE sector IS NOT NULL ORDER BY sector').all().map((x) => x.sector),
    statuses: {
      licensee: ['draft','submitted','under_review','approved','active','suspended','withdrawn','expired','rejected'],
      association: ['draft','submitted','under_review','accredited','suspended','revoked','expired','rejected'],
    },
  });
});

/** حاسبة عامة بلا تسجيل دخول — أداة بيع للشركات */
r.post('/calculator', (req, res) => {
  const { revenue, net_profit, level, scope_net_profit } = req.body;
  if (revenue == null || level == null) return res.status(400).json({ error: 'الإيراد والمستوى مطلوبان' });
  const c = R.computeCommitment({ revenue, netProfit: net_profit, level, scopeNetProfit: scope_net_profit });
  const f = R.computeFees({ revenue, level });
  const taxCap = Math.max(0, (Number(net_profit) || 0) * 0.02);
  const deductible = Math.min(c.commitment_due, taxCap);
  res.json({
    commitment: c, fees: f,
    tax: { deduction_cap: R.round2(taxCap), deductible: R.round2(deductible),
      corporate_rate: 0.20, net_cost: R.round2(c.commitment_due - deductible * 0.20),
      note: 'سقف الخصم الضريبي في ليبيا 2% من صافي الدخل. هذا تقدير توضيحي — الرجوع إلى المستشار الضريبي واجب (ملحق 1 من اللائحة).' },
    field_audit: R.fieldAuditRate({ level, tierCode: c.tier_code }),
    claim: R.allowedClaim(level, 'LY-KH-XXXX-YY'),
  });
});

module.exports = r;
