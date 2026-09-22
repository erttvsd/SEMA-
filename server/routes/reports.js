'use strict';
/** التقارير التحليلية والمؤشرات والمالية */
const express = require('express');
const { db } = require('../db');
const { can, requireAuth, hasPerm, log } = require('../auth');
const { buildList } = require('../query');
const R = require('../rules');

const r = express.Router();

/** لوحة المؤشرات الرئيسية */
r.get('/dashboard', requireAuth, (req, res) => {
  const u = req.user;
  const out = { role_view: u.roles.map((x) => x.name_ar), generated_at: new Date().toISOString() };

  // بوابة الشريك
  if (u.scopes.licensee.length && !hasPerm(u, 'licensee.view.all')) {
    const ids = u.scopes.licensee;
    const ph = ids.map(() => '?').join(',');
    out.scope = 'licensee';
    out.licensees = db.prepare(`SELECT l.id,l.license_no,l.legal_name,l.level,b.name_ar level_name,b.color_hex,
        l.status,l.start_date,l.end_date,l.tier_code FROM licensees l LEFT JOIN brand_levels b ON b.level=l.level
        WHERE l.id IN (${ph})`).all(...ids);
    out.commitment = db.prepare(`SELECT * FROM commitments WHERE licensee_id IN (${ph}) ORDER BY fiscal_year DESC LIMIT 1`).get(...ids);
    out.pending_declaration = db.prepare(`SELECT * FROM compliance_declarations WHERE licensee_id IN (${ph})
        AND status IN ('pending','deficient') ORDER BY due_at LIMIT 1`).get(...ids);
    out.docs_missing = db.prepare(`SELECT dt.code, dt.name_ar FROM document_types dt
        WHERE dt.applies_to IN ('licensee','both') AND dt.required=1 AND NOT EXISTS
        (SELECT 1 FROM documents d WHERE d.doc_type=dt.code AND d.owner_kind='licensee' AND d.owner_id IN (${ph}))`).all(...ids);
    out.open_designs = db.prepare(`SELECT COUNT(*) n FROM design_approvals WHERE licensee_id IN (${ph}) AND status='pending'`).get(...ids).n;
    out.open_sanctions = db.prepare(`SELECT COUNT(*) n FROM sanctions WHERE subject_kind='licensee' AND subject_id IN (${ph}) AND status='active'`).get(...ids).n;
    out.contributions_ytd = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE licensee_id IN (${ph})
        AND fiscal_year=? AND status IN ('documented','verified')`).get(...ids, new Date().getFullYear()).s;
  }

  // بوابة الجمعية
  if (u.scopes.association.length && !hasPerm(u, 'org.view.all')) {
    const ids = u.scopes.association;
    const ph = ids.map(() => '?').join(',');
    out.scope = 'association';
    out.associations = db.prepare(`SELECT a.*, c.name_ar admin_class_name FROM associations a
        LEFT JOIN admin_expense_classes c ON c.code=a.admin_class WHERE a.id IN (${ph})`).all(...ids);
    out.received_ytd = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE association_id IN (${ph})
        AND fiscal_year=? AND status IN ('documented','verified')`).get(...ids, new Date().getFullYear()).s;
    out.pending_receipts = db.prepare(`SELECT COUNT(*) n FROM contributions WHERE association_id IN (${ph}) AND receipt_confirmed=0`).get(...ids).n;
    out.pending_impact = db.prepare(`SELECT COUNT(*) n FROM contributions WHERE association_id IN (${ph})
        AND receipt_confirmed=1 AND impact_doc_id IS NULL`).get(...ids).n;
    out.absorption = out.associations.map((a) => ({ name: a.name,
      ...R.absorptionCheck(a.largest_budget_3y,
        db.prepare("SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE association_id=? AND fiscal_year=? AND status IN ('documented','verified')")
          .get(a.id, new Date().getFullYear()).s) }));
    out.docs_missing = db.prepare(`SELECT dt.code, dt.name_ar FROM document_types dt
        WHERE dt.applies_to IN ('association','both') AND dt.required=1 AND NOT EXISTS
        (SELECT 1 FROM documents d WHERE d.doc_type=dt.code AND d.owner_kind='association' AND d.owner_id IN (${ph}))`).all(...ids);
  }

  // لوحة المراقب — إحصاءات مجمَّعة فقط، دون أي ملف فردي (المادة 34/2)
  if (u.role_codes.includes('OBSERVER') && !hasPerm(u, 'licensee.view.all')) {
    out.scope = 'observer';
    const year = new Date().getFullYear();
    out.observer = {
      licensees_active: db.prepare("SELECT COUNT(*) n FROM licensees WHERE status='active'").get().n,
      associations_accredited: db.prepare("SELECT COUNT(*) n FROM associations WHERE status='accredited'").get().n,
      directed_total: db.prepare('SELECT COALESCE(SUM(total_paid),0) s FROM commitments').get().s,
      sanctions_published: db.prepare('SELECT COUNT(*) n FROM sanctions WHERE published=1').get().n,
      board_meetings: db.prepare("SELECT COUNT(*) n FROM meetings WHERE body='board'").get().n,
      observers_admitted: db.prepare("SELECT COUNT(*) n FROM observers WHERE status='admitted'").get().n,
      integrity_published: db.prepare('SELECT COUNT(*) n FROM integrity_notes WHERE public_disclosure=1').get().n,
      overhead_ratio: (() => {
        const rows = db.prepare('SELECT category, SUM(COALESCE(actual,budgeted)) a FROM secretariat_budget WHERE fiscal_year=? GROUP BY category').all(year);
        const t = rows.reduce((s, x) => s + x.a, 0);
        const o = rows.filter((x) => x.category !== 'program').reduce((s, x) => s + x.a, 0);
        return t ? R.round4(o / t) : null;
      })(),
    };
    out.observer_rights = 'للمراقب حق الحضور والمداخلة في اجتماعات مجلس الأمناء، ولا صوت له ولا حق في الاطلاع على ملف فردي قيد التقييم (المادة 34/2). ولذلك تُعرض له الإحصاءات المجمَّعة والمنشورة دون الملفات.';
    res.json(out);
    return;
  }

  // لوحة الأمانة والإدارة
  if (hasPerm(u, 'licensee.view.all') || hasPerm(u, 'finance.view.all') || hasPerm(u, 'report.export')) {
    out.scope = out.scope || 'admin';
    const year = new Date().getFullYear();
    out.totals = {
      licensees_active: db.prepare("SELECT COUNT(*) n FROM licensees WHERE status='active'").get().n,
      licensees_all: db.prepare('SELECT COUNT(*) n FROM licensees').get().n,
      suspended: db.prepare("SELECT COUNT(*) n FROM licensees WHERE status='suspended'").get().n,
      withdrawn: db.prepare("SELECT COUNT(*) n FROM licensees WHERE status='withdrawn'").get().n,
      associations_accredited: db.prepare("SELECT COUNT(*) n FROM associations WHERE status='accredited'").get().n,
      applications_open: db.prepare("SELECT COUNT(*) n FROM applications WHERE status NOT IN ('approved','rejected','shelved','withdrawn')").get().n,
      applications_overdue: db.prepare("SELECT COUNT(*) n FROM applications WHERE decided_at IS NULL AND sla_due_at < date('now')").get().n,
      docs_pending: db.prepare("SELECT COUNT(*) n FROM documents WHERE verification='pending'").get().n,
      audits_planned: db.prepare("SELECT COUNT(*) n FROM audits WHERE status='planned'").get().n,
      audits_done: db.prepare("SELECT COUNT(*) n FROM audits WHERE status IN ('facts_reported','closed')").get().n,
      sanctions_active: db.prepare("SELECT COUNT(*) n FROM sanctions WHERE status='active'").get().n,
      appeals_open: db.prepare("SELECT COUNT(*) n FROM appeals WHERE status!='decided'").get().n,
      complaints_open: db.prepare("SELECT COUNT(*) n FROM complaints WHERE status NOT IN ('closed','unsubstantiated')").get().n,
      integrity_open: db.prepare("SELECT COUNT(*) n FROM integrity_notes WHERE status='open'").get().n,
      designs_pending: db.prepare("SELECT COUNT(*) n FROM design_approvals WHERE status='pending'").get().n,
      observers_admitted: db.prepare("SELECT COUNT(*) n FROM observers WHERE status='admitted'").get().n,
    };
    out.money = {
      committed_year: db.prepare('SELECT COALESCE(SUM(commitment_due),0) s FROM commitments WHERE fiscal_year=?').get(year).s,
      paid_year: db.prepare('SELECT COALESCE(SUM(total_paid),0) s FROM commitments WHERE fiscal_year=?').get(year).s,
      committed_all: db.prepare('SELECT COALESCE(SUM(commitment_due),0) s FROM commitments').get().s,
      paid_all: db.prepare('SELECT COALESCE(SUM(total_paid),0) s FROM commitments').get().s,
      fees_issued: db.prepare('SELECT COALESCE(SUM(amount),0) s FROM invoices').get().s,
      fees_collected: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE status='paid'").get().s,
      fees_overdue: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE status='issued' AND due_at < date('now')").get().s,
    };
    out.money.per_dinar_of_fees = out.money.fees_collected > 0
      ? R.round2(out.money.paid_all / out.money.fees_collected) : null;
    out.by_level = db.prepare(`SELECT l.level, b.name_ar, b.color_hex, COUNT(*) n,
        COALESCE(SUM(c.commitment_due),0) committed, COALESCE(SUM(c.total_paid),0) paid
        FROM licensees l LEFT JOIN brand_levels b ON b.level=l.level
        LEFT JOIN commitments c ON c.licensee_id=l.id AND c.fiscal_year=?
        WHERE l.status='active' GROUP BY l.level ORDER BY l.level`).all(year);
    out.by_region = db.prepare(`SELECT l.region, COUNT(*) n, COALESCE(SUM(c.total_paid),0) paid
        FROM licensees l LEFT JOIN commitments c ON c.licensee_id=l.id
        WHERE l.status='active' GROUP BY l.region`).all();
    out.by_tier = db.prepare(`SELECT tier_code, COUNT(*) n FROM licensees WHERE status='active' GROUP BY tier_code`).all();
    out.by_sector = db.prepare(`SELECT sector, COUNT(*) n, COALESCE(SUM(c.total_paid),0) paid FROM licensees l
        LEFT JOIN commitments c ON c.licensee_id=l.id WHERE l.status='active' GROUP BY sector ORDER BY n DESC LIMIT 12`).all();
    out.admin_classes = db.prepare(`SELECT a.admin_class code, c.name_ar, COUNT(*) n FROM associations a
        LEFT JOIN admin_expense_classes c ON c.code=a.admin_class
        WHERE a.status='accredited' GROUP BY a.admin_class`).all();
    out.top_associations = db.prepare(`SELECT a.id, a.name, a.accreditation_no, a.admin_expense_ratio,
        COALESCE(SUM(c.amount),0) received, a.absorption_cap FROM associations a
        LEFT JOIN contributions c ON c.association_id=a.id AND c.status IN ('documented','verified')
        WHERE a.status='accredited' GROUP BY a.id ORDER BY received DESC LIMIT 10`).all();
    out.channel_mix = db.prepare(`SELECT c.channel, ec.name_ar, COALESCE(SUM(c.amount),0) s, COUNT(*) n
        FROM contributions c LEFT JOIN eligible_channels ec ON ec.code=c.channel
        WHERE c.status IN ('documented','verified') GROUP BY c.channel`).all();
    out.sla = db.prepare(`SELECT AVG(processing_days) avg_days, MIN(processing_days) min_days,
        MAX(processing_days) max_days, COUNT(*) n FROM applications WHERE processing_days IS NOT NULL`).get();
    out.pipeline = db.prepare(`SELECT stage, COUNT(*) n FROM applications
        WHERE status NOT IN ('approved','rejected','shelved','withdrawn') GROUP BY stage ORDER BY stage`).all();
    out.alerts = alerts();
  }
  res.json(out);
});

function alerts() {
  const a = [];
  const today = new Date().toISOString().slice(0, 10);
  const push = (severity, title, count, link) => { if (count) a.push({ severity, title, count, link }); };
  push('danger', 'طلبات تجاوزت المدة المعيارية (90 يوم عمل)',
    db.prepare("SELECT COUNT(*) n FROM applications WHERE decided_at IS NULL AND sla_due_at < date('now')").get().n, '#/applications?overdue=' + today);
  push('danger', 'تظلمات تجاوزت مهلة الستين يوماً',
    db.prepare("SELECT COUNT(*) n FROM appeals WHERE status!='decided' AND decision_due_at < date('now')").get().n, '#/appeals');
  push('warning', 'إقرارات امتثال قاربت موعدها أو تأخرت',
    db.prepare("SELECT COUNT(*) n FROM compliance_declarations WHERE status IN ('pending','late') AND due_at < date('now','+30 day')").get().n, '#/declarations');
  push('warning', 'تصاميم قاربت الموافقة الضمنية (10 أيام عمل)',
    db.prepare("SELECT COUNT(*) n FROM design_approvals WHERE status='pending' AND due_at < date('now','+3 day')").get().n, '#/designs');
  push('warning', 'مستندات ستنتهي صلاحيتها خلال 60 يوماً',
    db.prepare("SELECT COUNT(*) n FROM documents WHERE expires_on IS NOT NULL AND expires_on BETWEEN date('now') AND date('now','+60 day')").get().n, '#/documents');
  push('danger', 'منظمات تجاوزت سقف المصروفات الإدارية 25%',
    db.prepare("SELECT COUNT(*) n FROM associations WHERE status='accredited' AND admin_expense_ratio > 0.25").get().n, '#/associations?ratio_min=0.25');
  push('warning', 'منظمات نسبتها الإدارية أقل من 5% (تستوجب فحصاً إضافياً)',
    db.prepare("SELECT COUNT(*) n FROM associations WHERE status='accredited' AND admin_expense_ratio < 0.05").get().n, '#/associations?ratio_max=0.05');
  push('danger', 'التزامات بعجز يتجاوز 20% (موجب للتعليق)',
    db.prepare("SELECT COUNT(*) n FROM commitments WHERE deficit_pct > 0.20").get().n, '#/commitments?deficit_min=0.2');
  push('warning', 'مساهمات بلا إقرار استلام من المنظمة',
    db.prepare('SELECT COUNT(*) n FROM contributions WHERE receipt_confirmed=0').get().n, '#/contributions?receipt_confirmed=false');
  push('danger', 'بلاغات تستوجب تدقيقاً فورياً 100%',
    db.prepare("SELECT COUNT(*) n FROM complaints WHERE status IN ('received','triage')").get().n, '#/complaints');
  push('danger', 'ملاحظات نزاهة انقضت مهلة الرد عليها',
    db.prepare("SELECT COUNT(*) n FROM integrity_notes WHERE status='open' AND response_due_at < date('now')").get().n, '#/integrity');
  push('warning', 'اعتمادات منظمات تنتهي خلال 90 يوماً',
    db.prepare("SELECT COUNT(*) n FROM associations WHERE status='accredited' AND accredited_to < date('now','+90 day')").get().n, '#/associations');
  push('warning', 'تراخيص تنتهي خلال 60 يوماً',
    db.prepare("SELECT COUNT(*) n FROM licensees WHERE status='active' AND end_date < date('now','+60 day')").get().n, '#/licensees');
  push('warning', 'رسوم متأخرة السداد',
    db.prepare("SELECT COUNT(*) n FROM invoices WHERE status='issued' AND due_at < date('now')").get().n, '#/finance');
  return a;
}

/** التقارير الجاهزة */
const REPORTS = {
  annual_registry: {
    title: 'التقرير السنوي — السجل والمستويات',
    note: 'المادة (6) من النظام الداخلي: النشر هو الأصل.',
    run: (p) => db.prepare(`SELECT l.license_no, l.legal_name, l.sector, l.region, l.tier_code, l.level,
        b.name_ar level_name, l.status, l.start_date, l.end_date, c.commitment_due, c.total_paid,
        c.deficit_pct, c.basis FROM licensees l LEFT JOIN brand_levels b ON b.level=l.level
        LEFT JOIN commitments c ON c.licensee_id=l.id AND c.fiscal_year=?
        WHERE (? IS NULL OR l.region=?) ORDER BY c.commitment_due DESC`)
      .all(p.year, p.region || null, p.region || null),
  },
  commitment_gap: {
    title: 'فجوة الالتزام — العجز والتدرّج الجزائي',
    note: 'المادة (29) بنود 1 و3 و4.',
    run: (p) => db.prepare(`SELECT l.license_no, l.legal_name, c.fiscal_year, c.level, c.commitment_due,
        c.total_paid, c.deficit_amount, c.deficit_pct, c.cash_share, c.status FROM commitments c
        JOIN licensees l ON l.id=c.licensee_id WHERE c.fiscal_year=? AND c.deficit_amount > 0
        ORDER BY c.deficit_pct DESC`).all(p.year).map((x) => ({ ...x,
          assessment: R.deficitAssessment(x.commitment_due, x.total_paid).message })),
  },
  admin_ratio: {
    title: 'المنظمات المعتمدة — نسبة المصروفات الإدارية وتصنيفها',
    note: 'المادة (15): يُنشر التصنيف في السجل. ما دون 5% يستوجب فحصاً إضافياً.',
    run: () => db.prepare(`SELECT a.accreditation_no, a.name, a.region, a.annual_revenue, a.total_expenses,
        a.admin_expenses, a.admin_expense_ratio, a.admin_class, c.name_ar class_name, a.fundraising_cost_ratio,
        a.absorption_cap, a.absorption_used, a.status FROM associations a
        LEFT JOIN admin_expense_classes c ON c.code=a.admin_class ORDER BY a.admin_expense_ratio DESC`).all()
      .map((x) => ({ ...x, flag: R.classifyAdminRatio(x.admin_expense_ratio).flag })),
  },
  audit_coverage: {
    title: 'تغطية التدقيق الميداني مقابل النسب المقررة',
    note: 'المادة (25) و(26): 10% على الأقل من الزيارات غير معلنة.',
    run: (p) => {
      const rows = db.prepare(`SELECT l.level, l.tier_code, COUNT(DISTINCT l.id) active,
          COUNT(DISTINCT CASE WHEN a.audit_type IN ('field','unannounced') AND a.status!='cancelled' THEN l.id END) audited,
          COUNT(DISTINCT CASE WHEN a.audit_type='unannounced' THEN a.id END) unannounced
          FROM licensees l LEFT JOIN audits a ON a.subject_kind='licensee' AND a.subject_id=l.id AND a.fiscal_year=?
          WHERE l.status IN ('active','suspended') GROUP BY l.level, l.tier_code`).all(p.year);
      return rows.map((x) => {
        const req = R.fieldAuditRate({ level: x.level, tierCode: x.tier_code });
        return { ...x, required_rate: req.rate, required_reason: req.reason,
          actual_rate: x.active ? R.round4(x.audited / x.active) : 0,
          compliant: x.active ? x.audited / x.active >= req.rate - 0.001 : true };
      });
    },
  },
  sanctions_ledger: {
    title: 'سجل الجزاءات المنشورة',
    note: 'المادة (31): يبقى السحب منشوراً اثني عشر شهراً.',
    run: () => db.prepare(`SELECT s.case_no, COALESCE(l.legal_name,o.name,s.subject_name) name,
        v.case_ar violation, s.measure, s.fine_amount, s.reason, s.decided_at, s.effective_to,
        s.published, s.publish_until, s.reapply_allowed_from, s.status FROM sanctions s
        LEFT JOIN violation_codes v ON v.code=s.violation_code
        LEFT JOIN licensees l ON s.subject_kind='licensee' AND l.id=s.subject_id
        LEFT JOIN associations o ON s.subject_kind='association' AND o.id=s.subject_id
        ORDER BY s.decided_at DESC`).all(),
  },
  contribution_flow: {
    title: 'تدفق المساهمات — من المرخَّص لهم إلى المنظمات',
    note: 'المادة (22): سقف 60% للمنظمة الواحدة إذا تجاوز الالتزام مئة ألف دينار.',
    run: (p) => db.prepare(`SELECT l.legal_name licensee, l.license_no, l.level, a.name association,
        a.accreditation_no, a.region, ec.name_ar channel, SUM(c.amount) amount, COUNT(*) transfers
        FROM contributions c JOIN licensees l ON l.id=c.licensee_id
        LEFT JOIN associations a ON a.id=c.association_id
        LEFT JOIN eligible_channels ec ON ec.code=c.channel
        WHERE c.fiscal_year=? AND c.status IN ('documented','verified')
        GROUP BY l.id, a.id, c.channel ORDER BY amount DESC`).all(p.year),
  },
  sla_performance: {
    title: 'أداء المواعيد المعيارية لمراحل الطلب',
    note: 'المادة (17): تُنشر مدة المعالجة الفعلية المتوسطة في التقرير السنوي.',
    run: () => db.prepare(`SELECT s.stage, s.stage_name_ar, s.responsible_body, s.max_days,
        COUNT(*) n, SUM(s.breached_sla) breached,
        AVG(julianday(s.completed_at) - julianday(s.started_at)) avg_days
        FROM application_stages s WHERE s.completed_at IS NOT NULL
        GROUP BY s.stage ORDER BY s.stage`).all(),
  },
  transparency: {
    title: 'لوحة الشفافية — إنفاق الأمانة على الفئات الثلاث',
    note: 'المادة (31): تصنيف الإنفاق برامجي / جمع تمويل / إدارة عامة.',
    run: (p) => {
      const rows = db.prepare(`SELECT category, SUM(COALESCE(actual,budgeted)) amount FROM secretariat_budget
          WHERE fiscal_year=? GROUP BY category`).all(p.year);
      const total = rows.reduce((s, x) => s + x.amount, 0);
      const admin = rows.find((x) => x.category === 'admin')?.amount || 0;
      const fr = rows.find((x) => x.category === 'fundraising')?.amount || 0;
      return { rows: rows.map((x) => ({ ...x, share: total ? R.round4(x.amount / total) : 0 })),
        total, overhead_ratio: total ? R.round4((admin + fr) / total) : 0,
        cap: 0.25, compliant: total ? (admin + fr) / total <= 0.25 : true,
        note: 'سقف الإدارة العامة وجمع التمويل 25% كمتوسط ثلاث سنوات — السويد تشترط 75% للغرض وألمانيا تصنّف ما فوق 30% غير مقبول.' };
    },
  },
  founding_partners: {
    title: 'الشركاء المؤسسون وفئات الشركاء',
    note: 'المادة (39): أولوية في المعالجة دون أي تخفيف في المعايير أو التدقيق.',
    run: () => ({
      licensees: db.prepare(`SELECT license_no, legal_name, partner_class, level, status, start_date
          FROM licensees WHERE partner_class!='none' ORDER BY partner_class, legal_name`).all(),
      associations: db.prepare(`SELECT accreditation_no, name, partner_class, status, accredited_from
          FROM associations WHERE partner_class!='none' ORDER BY partner_class, name`).all(),
    }),
  },
};

r.get('/reports', requireAuth, can('report.view'), (_req, res) => {
  res.json({ reports: Object.entries(REPORTS).map(([k, v]) => ({ key: k, title: v.title, note: v.note })) });
});

r.get('/reports/:key', requireAuth, can('report.view'), (req, res) => {
  const rep = REPORTS[req.params.key];
  if (!rep) return res.status(404).json({ error: 'تقرير غير معروف' });
  const params = { year: Number(req.query.year) || new Date().getFullYear(), region: req.query.region || null };
  const data = rep.run(params);
  log(req, 'report.view', 'report', null, rep.title);
  res.json({ key: req.params.key, title: rep.title, note: rep.note, params, data });
});

r.get('/reports/:key/export.csv', requireAuth, can('report.export'), (req, res) => {
  const rep = REPORTS[req.params.key];
  if (!rep) return res.status(404).json({ error: 'تقرير غير معروف' });
  const params = { year: Number(req.query.year) || new Date().getFullYear(), region: req.query.region || null };
  let rows = rep.run(params);
  if (!Array.isArray(rows)) rows = rows.rows || [rows];
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v) => v == null ? '' : `"${String(v).replace(/"/g, '""')}"`;
  const csv = '﻿' + [cols.join(','), ...rows.map((r0) => cols.map((c) => esc(r0[c])).join(','))].join('\n');
  log(req, 'report.export', 'report', null, rep.title);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.key}.csv"`);
  res.send(csv);
});

/** المؤشرات والمستهدفات الخمسية */
r.get('/kpis', requireAuth, can('report.view'), (_req, res) => {
  const kpis = db.prepare('SELECT * FROM kpis').all();
  const vals = db.prepare('SELECT * FROM kpi_values').all();
  res.json({ kpis: kpis.map((k) => ({ ...k,
    targets: [1, 2, 3, 4, 5].map((y) => vals.find((v) => v.kpi_code === k.code && v.year_no === y && v.kind === 'target')?.value ?? null),
    actuals: [1, 2, 3, 4, 5].map((y) => vals.find((v) => v.kpi_code === k.code && v.year_no === y && v.kind === 'actual')?.value ?? null),
  })) });
});

r.put('/kpis/:code/:year', requireAuth, can('kpi.manage'), (req, res) => {
  const { value, kind } = req.body;
  db.prepare(`INSERT INTO kpi_values (kpi_code, year_no, kind, value) VALUES (?,?,?,?)
    ON CONFLICT(kpi_code,year_no,kind) DO UPDATE SET value=excluded.value`)
    .run(req.params.code, Number(req.params.year), kind || 'actual', value);
  log(req, 'kpi.update', 'kpi', null, `${req.params.code} س${req.params.year} = ${value}`);
  res.json({ ok: true });
});

r.get('/risks', requireAuth, can('report.view'), (_req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM risk_register ORDER BY id').all() });
});

/** المالية */
r.get('/invoices', requireAuth, can('finance.view.all', 'licensee.view.own'), (req, res) => {
  const all = hasPerm(req.user, 'finance.view.all');
  const extra = all ? [] : [`(i.subject_kind='licensee' AND i.subject_id IN (${(req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]).map(()=>'?').join(',')}))`];
  const out = buildList(db, {
    table: `invoices i LEFT JOIN licensees l ON i.subject_kind='licensee' AND l.id=i.subject_id`,
    columns: `i.*, COALESCE(l.legal_name, i.subject_name) resolved_name, l.license_no`,
    filters: { fee_type: { op: 'in', col: 'i.fee_type' }, status: { op: 'in', col: 'i.status' },
      fiscal_year: { op: 'in', col: 'i.fiscal_year' }, tier_code: { op: 'in', col: 'i.tier_code' },
      issued_from: { op: 'gte', col: 'i.issued_at' }, issued_to: { op: 'lte', col: 'i.issued_at' },
      overdue_before: { op: 'lte', col: 'i.due_at' } },
    search: ['i.invoice_no', 'l.legal_name', 'i.subject_name'],
    allowSort: ['issued_at', 'amount', 'due_at', 'status'], defaultSort: 'i.issued_at DESC',
    req, extraWhere: extra, params: all ? [] : (req.user.scopes.licensee.length ? req.user.scopes.licensee : [0]),
  });
  out.summary = db.prepare(`SELECT status, COUNT(*) n, COALESCE(SUM(amount),0) s FROM invoices GROUP BY status`).all();
  res.json(out);
});

r.post('/invoices/:id/pay', requireAuth, can('finance.invoice'), (req, res) => {
  const i = db.prepare('SELECT * FROM invoices WHERE id=?').get(Number(req.params.id));
  if (!i) return res.status(404).json({ error: 'غير موجود' });
  db.prepare("UPDATE invoices SET status='paid', paid_at=date('now'), payment_ref=? WHERE id=?")
    .run(req.body.payment_ref || null, i.id);
  log(req, 'invoice.pay', 'invoice', i.id, `${i.amount} د.ل`);
  res.json(db.prepare('SELECT * FROM invoices WHERE id=?').get(i.id));
});

r.get('/budget', requireAuth, can('finance.view.all'), (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = db.prepare('SELECT * FROM secretariat_budget WHERE fiscal_year=? ORDER BY category, line_item').all(year);
  const sources = db.prepare('SELECT * FROM funding_sources WHERE fiscal_year=? ORDER BY amount DESC').all(year);
  const total = sources.reduce((s, x) => s + x.amount, 0);
  res.json({ year, rows, sources: sources.map((s) => ({ ...s, share: total ? R.round4(s.amount / total) : 0 })),
    total_funding: total,
    limits_note: 'المادة (28): حدود التمويل — لا يجوز أن يتجاوز أي ممول واحد النسبة المقررة دون موافقة مجلس الأمناء.' });
});

module.exports = r;
