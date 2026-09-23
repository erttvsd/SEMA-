'use strict';
/** التدقيق والتفتيش — الجزاءات — التظلمات — المراقبون — النزاهة — الشكاوى — الحوكمة */
const express = require('express');
const crypto = require('crypto');
const { db } = require('../db');
const { can, requireAuth, hasPerm, ownsLicensee, ownsAssociation, log, notify } = require('../auth');
const { buildList } = require('../query');
const R = require('../rules');
const S = require('../services');

const r = express.Router();
const nextRef = (prefix, table) => `${prefix}-${String(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n + 1).padStart(5, '0')}`;

// ================= التدقيق (الفصل الثامن) =================
r.get('/audits', requireAuth, (req, res) => {
  const all = hasPerm(req.user, 'audit.view.all');
  const extra = [], params = [];
  if (!all) {
    const parts = [];
    if (req.user.scopes.licensee.length) { parts.push(`(a.subject_kind='licensee' AND a.subject_id IN (${req.user.scopes.licensee.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.licensee); }
    if (req.user.scopes.association.length) { parts.push(`(a.subject_kind='association' AND a.subject_id IN (${req.user.scopes.association.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.association); }
    extra.push(parts.length ? '(' + parts.join(' OR ') + ')' : '1=0');
    // لا يُخطَر المرخَّص له بموعد أي زيارة غير معلنة (المادة 26/3)
    extra.push("(a.audit_type != 'unannounced' OR a.executed_date IS NOT NULL)");
  }
  const out = buildList(db, {
    table: `audits a LEFT JOIN licensees l ON a.subject_kind='licensee' AND l.id=a.subject_id
            LEFT JOIN associations o ON a.subject_kind='association' AND o.id=a.subject_id
            LEFT JOIN users u ON u.id=a.assessor_id`,
    columns: `a.id, a.reference, a.subject_kind, a.subject_id, COALESCE(l.legal_name,o.name) subject_name,
              l.license_no, o.accreditation_no, l.level, l.tier_code, l.region, a.fiscal_year, a.audit_type,
              a.trigger, a.scheduled_date, a.executed_date, a.assessor_id, u.full_name assessor_name,
              a.status, a.facts_summary, a.hours_spent, a.created_at,
              (SELECT COUNT(*) FROM audit_findings f WHERE f.audit_id=a.id) findings_count,
              (SELECT COUNT(*) FROM audit_findings f WHERE f.audit_id=a.id AND f.severity IN ('major','critical')) major_findings`,
    filters: {
      audit_type: { op: 'in', col: 'a.audit_type' },
      trigger: { op: 'in', col: 'a.trigger' },
      status: { op: 'in', col: 'a.status' },
      subject_kind: { op: 'in', col: 'a.subject_kind' },
      fiscal_year: { op: 'in', col: 'a.fiscal_year' },
      assessor_id: { op: 'eq', col: 'a.assessor_id', num: true },
      region: { op: 'in', col: 'l.region' },
      level: { op: 'in', col: 'l.level' },
      date_from: { op: 'gte', col: 'a.executed_date' },
      date_to: { op: 'lte', col: 'a.executed_date' },
    },
    search: ['a.reference', 'l.legal_name', 'o.name', 'a.facts_summary'],
    allowSort: ['executed_date', 'scheduled_date', 'reference', 'status', 'audit_type'],
    defaultSort: 'COALESCE(a.executed_date, a.scheduled_date) DESC', req, extraWhere: extra, params,
  });
  res.json(out);
});

r.get('/audits/:id', requireAuth, can('audit.view.all', 'audit.view.own'), (req, res) => {
  const a = db.prepare(`SELECT a.*, COALESCE(l.legal_name,o.name) subject_name, u.full_name assessor_name
      FROM audits a LEFT JOIN licensees l ON a.subject_kind='licensee' AND l.id=a.subject_id
      LEFT JOIN associations o ON a.subject_kind='association' AND o.id=a.subject_id
      LEFT JOIN users u ON u.id=a.assessor_id WHERE a.id=?`).get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  if (!hasPerm(req.user, 'audit.view.all')) {
    const own = (a.subject_kind === 'licensee' && ownsLicensee(req.user, a.subject_id)) ||
                (a.subject_kind === 'association' && ownsAssociation(req.user, a.subject_id));
    if (!own) return res.status(403).json({ error: 'غير مصرَّح' });
    if (a.audit_type === 'unannounced' && !a.executed_date)
      return res.status(403).json({ error: 'لا يُخطَر المرخَّص له بموعد الزيارة غير المعلنة (المادة 26/3)' });
  }
  a.findings = db.prepare(`SELECT f.*, v.case_ar violation_text, v.measure_ar
      FROM audit_findings f LEFT JOIN violation_codes v ON v.code=f.violation_code
      WHERE f.audit_id=? ORDER BY f.id`).all(a.id);
  a.documents = db.prepare("SELECT * FROM documents WHERE owner_kind='audit' AND owner_id=?").all(a.id);
  a.note = 'يقتصر تقرير وحدة التقييم على الوقائع والأدلة دون توصية بالمنح أو الرفض (المادة 20/3).';
  res.json(a);
});

/** المادة (25)+(26): توليد خطة العيّنة عشوائياً بآلية موثّقة */
r.post('/audits/plan', requireAuth, can('audit.plan'), (req, res) => {
  const { fiscal_year, seed, commit } = req.body;
  const year = Number(fiscal_year) || new Date().getFullYear();
  // البصمة التي يُثبَّت بها الاختيار يولّدها الخادم نفسه — فلا يختار المخطِّط بصمة تُسقط جهة بعينها (المادة 26/2)؛
  // وتُقبل البصمة من الطلب للتحقق من خطة سابقة فقط
  if (commit && seed) return res.status(422).json({ error: 'تثبيت الخطة يكون ببصمة يولّدها النظام — البصمة المُدخلة للتحقق فقط' });
  if (commit && db.prepare("SELECT 1 FROM audits WHERE fiscal_year=? AND trigger IN ('sample','mandatory','pilot_year') AND sample_seed IS NOT NULL AND status='planned' AND created_at > datetime('now','-300 day')").get(year)
      && !req.body.replace)
    return res.status(409).json({ error: 'ثُبّتت خطة لهذه السنة مسبقاً — لا تُكرَّر الجدولة' });
  const usedSeed = commit ? crypto.randomBytes(8).toString('hex') : (seed ? String(seed).slice(0, 64) : crypto.randomBytes(8).toString('hex'));
  const pilot = db.prepare("SELECT v FROM settings WHERE k='pilot_year'").get()?.v === '1';
  const licensees = db.prepare("SELECT * FROM licensees WHERE status IN ('active','suspended')").all();
  const plan = [];
  for (const l of licensees) {
    const hasComplaint = !!db.prepare("SELECT 1 FROM complaints WHERE subject_kind='licensee' AND subject_id=? AND status NOT IN ('closed','unsubstantiated')").get(l.id);
    const rate = R.fieldAuditRate({ level: l.level, tierCode: l.tier_code, hasComplaint, pilotYear: pilot });
    // اختيار عشوائي حتمي مبني على البصمة — يمكن إعادة التحقق منه ولا يعلمه المقيّم مسبقاً
    const h = crypto.createHash('sha256').update(`${usedSeed}:${year}:${l.id}`).digest();
    const draw = h.readUInt32BE(0) / 0xffffffff;
    const selected = draw < rate.rate;
    if (selected) plan.push({ licensee_id: l.id, legal_name: l.legal_name, license_no: l.license_no,
      level: l.level, tier_code: l.tier_code, rate: rate.rate, reason: rate.reason, draw: R.round4(draw) });
  }
  // 10% على الأقل من الزيارات غير معلنة (المادة 26/1)
  const unannouncedCount = Math.max(1, Math.ceil(plan.length * 0.10));
  const sorted = [...plan].sort((a, b) => a.draw - b.draw);
  const unannouncedIds = new Set(sorted.slice(0, unannouncedCount).map((x) => x.licensee_id));
  plan.forEach((p) => { p.unannounced = unannouncedIds.has(p.licensee_id) ? 1 : 0; });

  if (req.body.commit) {
    const st = db.prepare(`INSERT INTO audits (reference, subject_kind, subject_id, fiscal_year, audit_type,
        trigger, sample_seed, scheduled_date, status) VALUES (?,?,?,?,?,?,?,?, 'planned')`);
    const tx = db.transaction(() => {
      let i = 0;
      for (const p of plan) {
        st.run(nextRef('AUD', 'audits'), 'licensee', p.licensee_id, year,
          p.unannounced ? 'unannounced' : 'field',
          pilot ? 'pilot_year' : (p.rate === 1 ? 'mandatory' : 'sample'), usedSeed,
          R.addDays(`${year}-03-01`, (i++ * 3) % 240), );
      }
    });
    tx();
    log(req, 'audit.plan', 'audit', null, `خطة تدقيق ${year}: ${plan.length} ملفاً — بصمة ${usedSeed}`);
  }
  res.json({ fiscal_year: year, seed: usedSeed, committed: !!req.body.commit,
    total_active: licensees.length, selected: plan.length,
    unannounced_min_pct: 0.10, unannounced_selected: unannouncedCount,
    coverage: licensees.length ? R.round4(plan.length / licensees.length) : 0,
    plan,
    integrity_note: 'تُختار العيّنة عشوائياً بآلية موثّقة لا يعلمها المقيّم قبل يوم الزيارة، ويُحظر إخطار المرخَّص له بأي وسيلة (المادة 26).' });
});

r.post('/audits', requireAuth, can('audit.execute', 'audit.unannounced'), (req, res) => {
  const { subject_kind, subject_id, fiscal_year, audit_type, trigger, scheduled_date } = req.body;
  if (audit_type === 'unannounced' && !hasPerm(req.user, 'audit.unannounced'))
    return res.status(403).json({ error: 'الزيارات غير المعلنة مقصورة على المدققين المفوَّضين' });
  // المادة 20/4: حظر تقييم جهة سبقت للمقيّم معها علاقة مهنية
  const conflict = db.prepare(`SELECT 1 FROM integrity_pledges WHERE user_id=? AND kind='annual_interests'
      AND has_conflict=1 AND details LIKE ?`).get(req.user.id, `%(الملف ${Number(subject_id)})%`);
  if (!['licensee', 'association'].includes(subject_kind)) return res.status(400).json({ error: 'نوع الجهة غير صالح' });
  if (!Object.keys({ desk: 1, field: 1, unannounced: 1, compliance_review: 1 }).includes(audit_type))
    return res.status(400).json({ error: 'نوع التدقيق غير صالح' });
  if (conflict) return res.status(422).json({ error: 'تعارض مصالح معلن — يُحظر على المقيّم تقييم هذه الجهة (المادة 20/4)' });
  if (!db.prepare(`SELECT 1 FROM ${subject_kind === 'licensee' ? 'licensees' : 'associations'} WHERE id=?`).get(subject_id))
    return res.status(404).json({ error: 'الجهة غير موجودة' });
  if (scheduled_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(scheduled_date))) return res.status(400).json({ error: 'تاريخ غير صالح' });
  if (trigger && !['sample','mandatory','complaint','pilot_year','renewal','random'].includes(trigger)) return res.status(400).json({ error: 'سبب غير صالح' });
  const info = db.prepare(`INSERT INTO audits (reference, subject_kind, subject_id, fiscal_year, audit_type,
      trigger, scheduled_date, assessor_id, status) VALUES (?,?,?,?,?,?,?,?, 'planned')`).run(
    nextRef('AUD', 'audits'), subject_kind, subject_id, fiscal_year || new Date().getFullYear(),
    audit_type, trigger || 'random', scheduled_date || null, req.user.id);
  log(req, 'audit.create', 'audit', info.lastInsertRowid, `${audit_type} على ${subject_kind}#${subject_id}`);
  res.status(201).json(db.prepare('SELECT * FROM audits WHERE id=?').get(info.lastInsertRowid));
});

r.post('/audits/:id/report', requireAuth, can('audit.execute'), (req, res) => {
  const { facts_summary, findings = [], hours_spent, recommendation } = req.body;
  if (recommendation) return res.status(422).json({ error: 'التقرير وقائع وأدلة بلا توصية (المادة 20/3)' });
  if (!facts_summary) return res.status(400).json({ error: 'facts_summary مطلوب' });
  const a = db.prepare('SELECT * FROM audits WHERE id=?').get(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'غير موجود' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE audits SET facts_summary=?, hours_spent=?, executed_date=COALESCE(executed_date,date('now')),
                status='facts_reported' WHERE id=?`).run(facts_summary, hours_spent || null, a.id);
    const st = db.prepare('INSERT INTO audit_findings (audit_id, area, fact, severity, violation_code, evidence_doc_id) VALUES (?,?,?,?,?,?)');
    for (const f of findings) st.run(a.id, f.area || 'عام', f.fact, f.severity || 'info', f.violation_code || null, f.evidence_doc_id || null);
  });
  tx();
  const major = findings.filter((f) => ['major', 'critical'].includes(f.severity));
  if (major.length) notify({ role_code: 'LICENSING_COMMITTEE', title: 'وقائع جسيمة تستوجب نظر لجنة الترخيص',
    body: `${a.reference}: ${major.length} واقعة`, severity: 'danger', link: `#/audits/${a.id}` });
  log(req, 'audit.report', 'audit', a.id, `تقرير وقائع: ${findings.length} واقعة`);
  res.json({ audit: db.prepare('SELECT * FROM audits WHERE id=?').get(a.id),
    findings: db.prepare('SELECT * FROM audit_findings WHERE audit_id=?').all(a.id) });
});

// اختبار السوق (المادة 28)
r.get('/market-tests', requireAuth, can('market_test.manage', 'report.view'), (_req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM market_tests ORDER BY conducted_on DESC').all() });
});
r.post('/market-tests', requireAuth, can('market_test.manage'), (req, res) => {
  const b = req.body;
  const n = (k) => Number(b[k] || 0);
  if (!b.round_name || !b.city || !b.conducted_on) return res.status(400).json({ error: 'اسم الجولة والمدينة والتاريخ مطلوبة' });
  const parts = ['correct_usage', 'missing_license_no', 'level_mismatch', 'out_of_scope', 'unlicensed_usage'];
  if ([...parts, 'outlets_visited', 'items_checked'].some((k) => n(k) < 0 || !Number.isInteger(n(k))))
    return res.status(400).json({ error: 'الأعداد يجب أن تكون صحيحة غير سالبة' });
  if (parts.reduce((t, k) => t + n(k), 0) > n('items_checked'))
    return res.status(422).json({ error: 'مجموع النتائج يتجاوز عدد الأصناف المفحوصة' });
  const info = db.prepare(`INSERT INTO market_tests (round_name, city, conducted_on, outlets_visited, items_checked,
      correct_usage, missing_license_no, level_mismatch, out_of_scope, unlicensed_usage, published)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(b.round_name, b.city, b.conducted_on, b.outlets_visited,
    b.items_checked, b.correct_usage, b.missing_license_no, b.level_mismatch, b.out_of_scope,
    b.unlicensed_usage, b.published ? 1 : 0);
  log(req, 'market_test.create', 'market_test', info.lastInsertRowid, b.round_name);
  res.status(201).json({ id: info.lastInsertRowid });
});

// ================= الجزاءات (الفصل التاسع) =================
r.get('/sanctions', requireAuth, can('sanction.view.all', 'registry.view'), (req, res) => {
  const all = hasPerm(req.user, 'sanction.view.all');
  const extra = [], params = [];
  if (!all) {
    const parts = [];
    if (req.user.scopes.licensee.length) { parts.push(`(s.subject_kind='licensee' AND s.subject_id IN (${req.user.scopes.licensee.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.licensee); }
    if (req.user.scopes.association.length) { parts.push(`(s.subject_kind='association' AND s.subject_id IN (${req.user.scopes.association.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.association); }
    parts.push('s.published=1');
    extra.push('(' + parts.join(' OR ') + ')');
  }
  const out = buildList(db, {
    table: `sanctions s LEFT JOIN violation_codes v ON v.code=s.violation_code
            LEFT JOIN licensees l ON s.subject_kind='licensee' AND l.id=s.subject_id
            LEFT JOIN associations o ON s.subject_kind='association' AND o.id=s.subject_id
            LEFT JOIN users u ON u.id=s.decided_by`,
    columns: `s.*, COALESCE(l.legal_name, o.name, s.subject_name) resolved_name, l.license_no,
              o.accreditation_no, v.case_ar violation_text, v.measure_ar, u.full_name decided_by_name,
              (SELECT COUNT(*) FROM appeals ap WHERE ap.sanction_id=s.id) appeals_count`,
    filters: {
      measure: { op: 'in', col: 's.measure' },
      status: { op: 'in', col: 's.status' },
      violation_code: { op: 'in', col: 's.violation_code' },
      subject_kind: { op: 'in', col: 's.subject_kind' },
      published: { op: 'bool', col: 's.published' },
      date_from: { op: 'gte', col: 's.decided_at' },
      date_to: { op: 'lte', col: 's.decided_at' },
    },
    search: ['s.case_no', 'l.legal_name', 'o.name', 's.subject_name', 's.reason'],
    allowSort: ['decided_at', 'case_no', 'measure', 'status'],
    defaultSort: 's.decided_at DESC', req, extraWhere: extra, params,
  });
  res.json(out);
});

r.post('/sanctions', requireAuth, can('sanction.decide'), (req, res) => {
  const { subject_kind, subject_id, subject_name, violation_code, measure, reason,
          source_audit_id, fine_amount, grace_days } = req.body;
  if (!reason || String(reason).trim().length < 10) return res.status(422).json({ error: 'التسبيب الكتابي مطلوب' });
  if (!['licensee', 'association', 'unlicensed'].includes(subject_kind)) return res.status(400).json({ error: 'نوع الجهة غير صالح' });
  if (!db.prepare('SELECT 1 FROM violation_codes WHERE code=?').get(violation_code))
    return res.status(400).json({ error: 'بند المخالفة غير معروف (المادة 29)' });
  if (subject_kind !== 'unlicensed') {
    const t = subject_kind === 'licensee' ? 'licensees' : 'associations';
    if (!db.prepare(`SELECT 1 FROM ${t} WHERE id=?`).get(subject_id)) return res.status(404).json({ error: 'الجهة غير موجودة' });
  } else if (!subject_name) return res.status(400).json({ error: 'اسم الجهة غير المرخَّصة مطلوب' });
  if (fine_amount != null && fine_amount !== '' && !(Number(fine_amount) >= 0)) return res.status(400).json({ error: 'قيمة الغرامة غير صالحة' });
  if (measure && !['written_warning','formal_notice','late_fine','grace_period','level_downgrade','suspension','withdrawal','cease_and_desist','fine','legal_action'].includes(measure))
    return res.status(400).json({ error: 'الجزاء غير صالح' });
  const row = db.transaction(() => S.createSanction(req.user.id, { subject_kind, subject_id, subject_name,
    violation_code, measure, reason, source_audit_id, fine_amount, grace_days }))();
  log(req, 'sanction.decide', subject_kind, subject_id, `${row.measure}: ${reason.slice(0, 120)}`);
  res.status(201).json(row);
});

// ================= التظلمات (المادة 22) =================
r.get('/appeals', requireAuth, can('appeal.view.all', 'appeal.file'), (req, res) => {
  const all = hasPerm(req.user, 'appeal.view.all');
  const extra = [], params = [];
  if (!all) {
    const parts = [];
    if (req.user.scopes.licensee.length) { parts.push(`(ap.appellant_kind='licensee' AND ap.appellant_id IN (${req.user.scopes.licensee.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.licensee); }
    if (req.user.scopes.association.length) { parts.push(`(ap.appellant_kind='association' AND ap.appellant_id IN (${req.user.scopes.association.map(()=>'?').join(',')}))`); params.push(...req.user.scopes.association); }
    extra.push(parts.length ? '(' + parts.join(' OR ') + ')' : '1=0');
  }
  const out = buildList(db, {
    table: `appeals ap LEFT JOIN sanctions s ON s.id=ap.sanction_id
            LEFT JOIN licensees l ON ap.appellant_kind='licensee' AND l.id=ap.appellant_id
            LEFT JOIN associations o ON ap.appellant_kind='association' AND o.id=ap.appellant_id
            LEFT JOIN users u ON u.id=ap.decided_by`,
    columns: `ap.*, COALESCE(l.legal_name,o.name,ap.appellant_name) resolved_name, s.case_no, s.measure,
              s.reason sanction_reason, u.full_name decided_by_name`,
    filters: { status: { op: 'in', col: 'ap.status' }, decision: { op: 'in', col: 'ap.decision' },
      appellant_kind: { op: 'in', col: 'ap.appellant_kind' }, due_before: { op: 'lte', col: 'ap.decision_due_at' } },
    search: ['ap.reference', 'l.legal_name', 'o.name', 'ap.grounds'],
    allowSort: ['filed_at', 'decision_due_at', 'status'], defaultSort: 'ap.filed_at DESC',
    req, extraWhere: extra, params,
  });
  const today = new Date().toISOString().slice(0, 10);
  out.rows.forEach((x) => { x.overdue = x.status !== 'decided' && x.decision_due_at < today ? 1 : 0; });
  res.json(out);
});

r.post('/appeals', requireAuth, can('appeal.file'), (req, res) => {
  const { sanction_id, application_id, appellant_kind, grounds } = req.body;
  const appellant_id = Number(req.body.appellant_id);
  if (!grounds || String(grounds).trim().length < 20) return res.status(400).json({ error: 'أسباب التظلم مطلوبة ومفصّلة (20 حرفاً على الأقل)' });
  if (!['licensee', 'association'].includes(appellant_kind)) return res.status(400).json({ error: 'نوع المتظلم غير صالح' });
  const own = (appellant_kind === 'licensee' && ownsLicensee(req.user, appellant_id)) ||
              (appellant_kind === 'association' && ownsAssociation(req.user, appellant_id));
  if (!own) return res.status(403).json({ error: 'التظلم من حق صاحب الملف' });
  if (!!sanction_id === !!application_id) return res.status(400).json({ error: 'حدّد القرار المتظلَّم منه: جزاءً أو قراراً على طلب' });
  // المتظلَّم منه يجب أن يخصّ المتظلم نفسه، وأن يكون قراراً صادراً فعلاً
  let notifiedAt;
  if (sanction_id) {
    const sn = db.prepare('SELECT * FROM sanctions WHERE id=?').get(Number(sanction_id));
    if (!sn) return res.status(404).json({ error: 'الجزاء غير موجود' });
    if (sn.subject_kind !== appellant_kind || Number(sn.subject_id) !== appellant_id) return res.status(403).json({ error: 'لا يُتظلَّم إلا من جزاء صادر على ملفك' });
    if (['overturned', 'closed', 'lifted'].includes(sn.status)) return res.status(409).json({ error: 'الجزاء لم يعد قائماً' });
    notifiedAt = sn.decided_at;
  } else {
    const ap = db.prepare('SELECT * FROM applications WHERE id=?').get(Number(application_id));
    if (!ap) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (ap.subject_kind !== appellant_kind || Number(ap.subject_id) !== appellant_id) return res.status(403).json({ error: 'لا يُتظلَّم إلا من قرار على طلبك' });
    if (!ap.decided_at) return res.status(422).json({ error: 'لا تظلم قبل صدور القرار' });
    notifiedAt = ap.decided_at;
  }
  const dup = db.prepare(`SELECT reference FROM appeals WHERE ${sanction_id ? 'sanction_id' : 'application_id'}=? AND status!='withdrawn'`)
    .get(Number(sanction_id || application_id));
  if (dup) return res.status(409).json({ error: `قُدِّم تظلم من هذا القرار مسبقاً (${dup.reference})` });
  // المادة 22/2: خلال ثلاثين يوماً من الإخطار
  const today = new Date().toISOString().slice(0, 10);
  const deadline = R.addDays(String(notifiedAt).slice(0, 10), 30);
  if (today > deadline)
    return res.status(422).json({ error: `انقضت مهلة التظلم — كانت تنتهي في ${deadline} (ثلاثون يوماً من الإخطار، المادة 22/2)` });
  const info = db.prepare(`INSERT INTO appeals (reference, sanction_id, application_id, appellant_kind,
      appellant_id, grounds, filing_deadline, decision_due_at) VALUES (?,?,?,?,?,?,?,?)`).run(
    nextRef('APL', 'appeals'), sanction_id ? Number(sanction_id) : null, application_id ? Number(application_id) : null,
    appellant_kind, appellant_id, String(grounds), deadline, R.addDays(today, 60));
  // لا يُغيَّر وضع الجزاء: التظلم لا يوقف تنفيذ التعليق أو السحب ولا تصعيده (المادة 22/4)
  notify({ role_code: 'APPEALS_COMMITTEE', title: 'تظلم جديد', body: 'تفصل اللجنة خلال ستين يوماً (المادة 22/3)',
    severity: 'warning', link: '#/appeals' });
  log(req, 'appeal.file', 'appeal', info.lastInsertRowid, 'تقديم تظلم');
  res.status(201).json({ ...db.prepare('SELECT * FROM appeals WHERE id=?').get(info.lastInsertRowid),
    note: 'لا يوقف التظلم تنفيذ قرار التعليق أو السحب إلا بقرار مسبَّب من اللجنة نفسها (المادة 22/4)' });
});

// وقف التنفيذ بقرار مسبَّب من لجنة التظلمات نفسها (المادة 22/4) — ويوقف التصعيد الآلي ما دام التظلم قائماً
r.post('/appeals/:id/stay', requireAuth, can('appeal.decide'), (req, res) => {
  const ap = db.prepare('SELECT * FROM appeals WHERE id=?').get(Number(req.params.id));
  if (!ap) return res.status(404).json({ error: 'غير موجود' });
  if (ap.status === 'decided') return res.status(409).json({ error: 'فُصل في التظلم' });
  if (!ap.sanction_id) return res.status(422).json({ error: 'وقف التنفيذ يرد على الجزاءات' });
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 10) return res.status(422).json({ error: 'وقف التنفيذ يكون بقرار مسبَّب (المادة 22/4)' });
  db.prepare("UPDATE appeals SET stay_of_execution=1, stay_reason=?, status='under_review' WHERE id=?").run(reason, ap.id);
  log(req, 'appeal.stay', 'appeal', ap.id, reason.slice(0, 120));
  res.json(db.prepare('SELECT * FROM appeals WHERE id=?').get(ap.id));
});

r.post('/appeals/:id/decide', requireAuth, can('appeal.decide'), (req, res) => {
  const { decision } = req.body;
  const reason = String(req.body.reason || '').trim();
  if (!['upheld', 'overturned', 'partially_upheld', 'inadmissible'].includes(decision))
    return res.status(400).json({ error: 'decision غير صالح' });
  if (reason.length < 10) return res.status(422).json({ error: 'التسبيب مطلوب' });
  const ap = db.prepare('SELECT * FROM appeals WHERE id=?').get(Number(req.params.id));
  if (!ap) return res.status(404).json({ error: 'غير موجود' });
  if (ap.status === 'decided') return res.status(409).json({ error: 'فُصل في هذا التظلم — وقرار اللجنة نهائي داخلياً (المادة 22/3)' });
  db.transaction(() => {
    db.prepare(`UPDATE appeals SET decision=?, decision_reason=?, decided_at=datetime('now'), decided_by=?,
        status='decided', stay_of_execution=0 WHERE id=?`).run(decision, reason, req.user.id, ap.id);
    if (ap.sanction_id && decision === 'overturned') {
      const sn = db.prepare('SELECT * FROM sanctions WHERE id=?').get(ap.sanction_id);
      db.prepare("UPDATE sanctions SET status='overturned', published=0 WHERE id=?").run(ap.sanction_id);
      if (sn.subject_kind === 'licensee' && sn.subject_id) {
        if (['suspension', 'withdrawal'].includes(sn.measure))
          db.prepare("UPDATE licensees SET status='active', status_reason=NULL WHERE id=? AND status IN ('suspended','withdrawn')").run(sn.subject_id);
        if (sn.measure === 'level_downgrade') db.prepare('UPDATE licensees SET level=MIN(5, level+1) WHERE id=?').run(sn.subject_id);
      }
      if (sn.subject_kind === 'association' && sn.subject_id && ['suspension', 'withdrawal'].includes(sn.measure))
        db.prepare("UPDATE associations SET status='accredited', status_reason=NULL WHERE id=? AND status IN ('suspended','revoked')").run(sn.subject_id);
    }
    if (ap.application_id && decision === 'overturned') {
      // إلغاء قرار الرفض يعيد الطلب إلى لجنة منح الترخيص لتُصدر قراراً جديداً مسبَّباً
      db.prepare("UPDATE applications SET status='decision_pending', stage=7, decision=NULL, decided_at=NULL WHERE id=?").run(ap.application_id);
      notify({ role_code: 'LICENSING_COMMITTEE', title: 'أُلغي قرار رفض بتظلم — يلزم قرار جديد', body: ap.reference, link: `#/applications/${ap.application_id}` });
    }
  })();
  const owner = S.ownerOf(ap.appellant_kind, ap.appellant_id);
  if (owner) notify({ user_id: owner, title: 'صدر قرار لجنة التظلمات', body: `${ap.reference}: ${reason.slice(0, 160)}`, link: '#/appeals' });
  log(req, 'appeal.decide', 'appeal', ap.id, `${decision}: ${reason.slice(0, 120)}`);
  res.json({ ...db.prepare('SELECT * FROM appeals WHERE id=?').get(ap.id),
    note: 'قرار اللجنة نهائي في النطاق الداخلي للعلامة، دون إخلال بحق اللجوء إلى القضاء (المادة 22/3)' });
});

// ================= المراقبون (المادة 34) =================
r.get('/observers', requireAuth, can('gov.meetings.view', 'observer.nominate', 'registry.view'), (req, res) => {
  const out = buildList(db, {
    table: 'observers o LEFT JOIN users u ON u.id=o.user_id',
    columns: 'o.*, u.email, u.region',
    filters: { status: { op: 'in', col: 'o.status' }, entity_kind: { op: 'in', col: 'o.entity_kind' },
      cycle: { op: 'in', col: 'o.cycle' } },
    search: ['o.person_name', 'o.nominating_entity', 'o.reference', 'o.sector'],
    allowSort: ['created_at', 'person_name', 'status'], defaultSort: 'o.created_at DESC', req,
  });
  // الضوابط: 5 مراقبين كحد أقصى في الدورة، ولا قطاع واحد أكثر من مراقبَين
  const admitted = db.prepare("SELECT entity_kind, COUNT(*) n FROM observers WHERE status='admitted' GROUP BY entity_kind").all();
  out.limits = { max_per_cycle: 5, max_per_sector: 2,
    admitted_total: admitted.reduce((s, x) => s + x.n, 0), by_sector: admitted,
    rights: 'للمراقب حق الحضور والمداخلة، ولا صوت له ولا حق في الاطلاع على ملف فردي قيد التقييم (المادة 34).' };
  res.json(out);
});

r.post('/observers', requireAuth, can('observer.nominate', 'app.create'), (req, res) => {
  const { person_name, nominating_entity, entity_kind, sector, cycle } = req.body;
  if (!person_name || !nominating_entity) return res.status(400).json({ error: 'الاسم والجهة المرشِّحة مطلوبان' });
  const info = db.prepare(`INSERT INTO observers (reference, person_name, nominating_entity, entity_kind, sector, cycle, status)
      VALUES (?,?,?,?,?,?, 'nominated')`).run(nextRef('OBS', 'observers'), person_name, nominating_entity,
    entity_kind || 'civil', sector || null, cycle || `${new Date().getFullYear()}`);
  notify({ role_code: 'BOARD_CHAIR', title: 'ترشيح مراقب جديد', body: `${person_name} — ${nominating_entity}`, link: '#/observers' });
  log(req, 'observer.nominate', 'observer', info.lastInsertRowid, person_name);
  res.status(201).json(db.prepare('SELECT * FROM observers WHERE id=?').get(info.lastInsertRowid));
});

r.post('/observers/:id/decide', requireAuth, can('observer.admit'), (req, res) => {
  const { decision, reason } = req.body || {};
  if (!['admitted', 'rejected', 'ended'].includes(decision)) return res.status(400).json({ error: 'القرار: قبول أو رفض أو إنهاء' });
  const o = db.prepare('SELECT * FROM observers WHERE id=?').get(Number(req.params.id));
  if (!o) return res.status(404).json({ error: 'غير موجود' });
  if (decision === 'ended' && o.status !== 'admitted') return res.status(409).json({ error: 'الإنهاء لمراقب مقبول فقط' });
  if (['admitted', 'rejected'].includes(decision) && o.status !== 'nominated') return res.status(409).json({ error: 'البتّ في الترشيحات القائمة فقط' });
  if (['rejected', 'ended'].includes(decision) && (!reason || reason.trim().length < 5))
    return res.status(422).json({ error: 'القرار المسبَّب مطلوب (المادة 34/6)' });
  if (decision === 'admitted') {
    const total = db.prepare("SELECT COUNT(*) n FROM observers WHERE status='admitted' AND cycle=?").get(o.cycle).n;
    if (total >= 5) return res.status(422).json({ error: 'بلغ عدد المراقبين المقبولين في الدورة خمسة — وهو السقف المقرر (المادة 34/3)' });
    const sameSector = db.prepare("SELECT COUNT(*) n FROM observers WHERE status='admitted' AND cycle=? AND entity_kind=?").get(o.cycle, o.entity_kind).n;
    if (sameSector >= 2) return res.status(422).json({ error: 'لا يجوز أن يمثّل قطاعٌ واحدٌ أكثر من مراقبَين (المادة 34/3)' });
  }
  db.prepare(`UPDATE observers SET status=?, end_reason=?, term_start=CASE WHEN ?='admitted' THEN date('now') ELSE term_start END,
      term_end=CASE WHEN ?='ended' THEN date('now') ELSE term_end END WHERE id=?`)
    .run(decision, reason || null, decision, decision, o.id);
  log(req, 'observer.decide', 'observer', o.id, `${decision}: ${reason || ''}`);
  res.json(db.prepare('SELECT * FROM observers WHERE id=?').get(o.id));
});

// ================= النزاهة (المادة 23) =================
r.get('/integrity-notes', requireAuth, can('integrity.note', 'report.view'), (req, res) => {
  const pub = !hasPerm(req.user, 'integrity.note') && !hasPerm(req.user, 'admin.log');
  const out = buildList(db, {
    table: 'integrity_notes n LEFT JOIN users u ON u.id=n.raised_by',
    columns: 'n.*, u.full_name raised_by_name',
    filters: { status: { op: 'in', col: 'n.status' }, category: { op: 'in', col: 'n.category' },
      public_disclosure: { op: 'bool', col: 'n.public_disclosure' } },
    search: ['n.title', 'n.body', 'n.reference'],
    allowSort: ['raised_at', 'response_due_at', 'status'], defaultSort: 'n.raised_at DESC',
    req, extraWhere: pub ? ['n.public_disclosure=1'] : [],
  });
  const today = new Date().toISOString().slice(0, 10);
  out.rows.forEach((x) => { x.publishable = !x.responded_at && !x.public_disclosure && x.response_due_at && x.response_due_at < today ? 1 : 0; });
  out.power = 'إذا لم يُستجب لتحذيرات اللجنة خلال تسعين يوماً، كان لها نشر ملاحظاتها علناً في السجل — وهذه الصلاحية جوهرية ولا يجوز تعطيلها (المادة 23/3).';
  res.json(out);
});

r.post('/integrity-notes', requireAuth, can('integrity.note'), (req, res) => {
  const { title, body, category } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'العنوان والنص مطلوبان' });
  const today = new Date().toISOString().slice(0, 10);
  const info = db.prepare(`INSERT INTO integrity_notes (reference, title, body, category, raised_by,
      board_notified_at, response_due_at) VALUES (?,?,?,?,?,date('now'),?)`).run(
    nextRef('INT', 'integrity_notes'), title, body, category || 'other', req.user.id, R.addDays(today, 90));
  notify({ role_code: 'BOARD_CHAIR', title: 'ملاحظة من لجنة حماية النزاهة',
    body: `${title} — أمام المجلس تسعون يوماً للاستجابة`, severity: 'warning', link: '#/integrity' });
  log(req, 'integrity.note', 'integrity_note', info.lastInsertRowid, title);
  res.status(201).json(db.prepare('SELECT * FROM integrity_notes WHERE id=?').get(info.lastInsertRowid));
});

r.post('/integrity-notes/:id/publish', requireAuth, can('integrity.publish'), (req, res) => {
  const n = db.prepare('SELECT * FROM integrity_notes WHERE id=?').get(Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'غير موجود' });
  const today = new Date().toISOString().slice(0, 10);
  if (n.public_disclosure) return res.status(409).json({ error: 'نُشرت الملاحظة مسبقاً' });
  if (n.responded_at)
    return res.status(422).json({ error: 'استجاب المجلس للملاحظة — النشر العلني مقرَّر لحالة عدم الاستجابة (المادة 23/3)' });
  if (n.response_due_at > today)
    return res.status(422).json({ error: `لم تنقضِ مهلة التسعين يوماً بعد — تنتهي في ${n.response_due_at} (المادة 23/3)` });
  db.prepare("UPDATE integrity_notes SET public_disclosure=1, published_at=datetime('now'), status='published' WHERE id=?").run(n.id);
  log(req, 'integrity.publish', 'integrity_note', n.id, 'نشر علني');
  res.json(db.prepare('SELECT * FROM integrity_notes WHERE id=?').get(n.id));
});

r.post('/integrity-notes/:id/respond', requireAuth, (req, res) => {
  // الرد من مجلس الأمناء نفسه — لا من الأمانة التي قد تكون موضوع الملاحظة (المادة 23/3)
  if (!req.user.role_codes.some((c) => ['BOARD_CHAIR', 'BOARD_MEMBER'].includes(c)))
    return res.status(403).json({ error: 'الرد على ملاحظات لجنة النزاهة من اختصاص مجلس الأمناء' });
  const n = db.prepare('SELECT * FROM integrity_notes WHERE id=?').get(Number(req.params.id));
  if (!n) return res.status(404).json({ error: 'غير موجود' });
  if (n.responded_at || n.public_disclosure) return res.status(409).json({ error: 'رُدّ على الملاحظة أو نُشرت مسبقاً' });
  if (String(req.body.response || '').trim().length < 20) return res.status(422).json({ error: 'نص الرد والإجراء المتخذ مطلوب' });
  db.prepare("UPDATE integrity_notes SET board_response=?, responded_at=datetime('now'), status='answered' WHERE id=?")
    .run(req.body.response || '', n.id);
  log(req, 'integrity.respond', 'integrity_note', n.id, 'رد المجلس');
  res.json(db.prepare('SELECT * FROM integrity_notes WHERE id=?').get(n.id));
});

// ================= الشكاوى والبلاغات (نموذج 9) =================
r.get('/complaints', requireAuth, can('complaint.triage', 'complaint.file'), (req, res) => {
  const all = hasPerm(req.user, 'complaint.triage');
  const out = buildList(db, {
    table: `complaints c LEFT JOIN users u ON u.id=c.assigned_to
            LEFT JOIN licensees l ON c.subject_kind='licensee' AND l.id=c.subject_id
            LEFT JOIN associations o ON c.subject_kind='association' AND o.id=c.subject_id`,
    columns: `c.id, c.reference, c.channel, c.is_anonymous, c.subject_kind, c.subject_id,
              COALESCE(l.legal_name,o.name,c.subject_name) resolved_name, c.body, c.filed_at,
              c.status, c.resolution, c.closed_at, c.triggered_audit_id, c.whistleblower_protected,
              u.full_name assigned_to_name,
              CASE WHEN c.is_anonymous=1 THEN NULL ELSE c.reporter_name END reporter_name`,
    filters: { status: { op: 'in', col: 'c.status' }, subject_kind: { op: 'in', col: 'c.subject_kind' },
      channel: { op: 'in', col: 'c.channel' }, date_from: { op: 'gte', col: 'c.filed_at' } },
    search: ['c.reference', 'c.body', 'l.legal_name', 'o.name'],
    allowSort: ['filed_at', 'status'], defaultSort: 'c.filed_at DESC',
    req, extraWhere: all ? [] : ['1=0'],
  });
  res.json(out);
});

r.post('/complaints', (req, res) => {
  const { channel, is_anonymous, reporter_name, reporter_contact, subject_kind, subject_id, subject_name, body } = req.body;
  if (typeof body !== 'string' || body.trim().length < 10) return res.status(400).json({ error: 'نص البلاغ مطلوب' });
  if (subject_kind && !['licensee', 'association', 'secretariat', 'unlicensed'].includes(subject_kind)) return res.status(400).json({ error: 'نوع الجهة غير صالح' });
  if (channel && !['portal', 'email', 'phone', 'letter', 'field'].includes(channel)) return res.status(400).json({ error: 'القناة غير صالحة' });
  if (body.length > 5000) return res.status(400).json({ error: 'نص البلاغ طويل جداً' });
  const tracking = crypto.randomBytes(4).toString('hex').toUpperCase();
  const info = db.prepare(`INSERT INTO complaints (reference, channel, is_anonymous, reporter_name, reporter_contact,
      subject_kind, subject_id, subject_name, body, whistleblower_protected, tracking_code)
      VALUES (?,?,?,?,?,?,?,?,?,1,?)`).run(nextRef('CMP', 'complaints'), channel || 'portal',
    is_anonymous ? 1 : 0, is_anonymous ? null : (reporter_name || null), is_anonymous ? null : (reporter_contact || null),
    subject_kind || null, subject_id || null, subject_name || null, body, tracking);
  notify({ role_code: 'INTEGRITY_COMMITTEE', title: 'بلاغ جديد', body: body.slice(0, 120), severity: 'warning', link: '#/complaints' });
  notify({ role_code: 'EVAL_DIRECTOR', title: 'بلاغ جديد — يستوجب تدقيقاً فورياً 100%',
    body: 'أي ملف ورد بشأنه بلاغ أو شكوى: تدقيق ميداني 100% وفوري (المادة 25)', severity: 'danger', link: '#/complaints' });
  res.status(201).json({ reference: db.prepare('SELECT reference FROM complaints WHERE id=?').get(info.lastInsertRowid).reference,
    tracking_code: tracking,
    note: 'قناة سرّية وحماية للمبلّغين — لا يُفصح عن هوية المبلّغ (المادة 29). احفظ الرقم المرجعي ورمز المتابعة لمتابعة البلاغ.' });
});

r.post('/complaints/:id/triage', requireAuth, can('complaint.triage'), (req, res) => {
  const { status, resolution, assigned_to, open_audit } = req.body;
  const c = db.prepare('SELECT * FROM complaints WHERE id=?').get(Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'غير موجود' });
  let auditId = c.triggered_audit_id;
  if (open_audit && c.subject_kind && c.subject_id && !auditId) {
    const info = db.prepare(`INSERT INTO audits (reference, subject_kind, subject_id, fiscal_year, audit_type,
        trigger, scheduled_date, status) VALUES (?,?,?,?, 'field','complaint',date('now'),'planned')`).run(
      nextRef('AUD', 'audits'), c.subject_kind, c.subject_id, new Date().getFullYear());
    auditId = info.lastInsertRowid;
  }
  db.prepare(`UPDATE complaints SET status=?, resolution=?, assigned_to=?, triggered_audit_id=?,
      closed_at=CASE WHEN ? IN ('closed','unsubstantiated') THEN datetime('now') ELSE closed_at END WHERE id=?`)
    .run(status || c.status, resolution || c.resolution, assigned_to || req.user.id, auditId, status, c.id);
  log(req, 'complaint.triage', 'complaint', c.id, status || '');
  res.json({ ...db.prepare('SELECT * FROM complaints WHERE id=?').get(c.id), triggered_audit_id: auditId });
});

// ================= الحوكمة: الاجتماعات =================
r.get('/meetings', requireAuth, can('gov.meetings.view', 'gov.attend'), (req, res) => {
  const onlyPublic = hasPerm(req.user, 'gov.attend') && !hasPerm(req.user, 'gov.meetings.view');
  const out = buildList(db, {
    table: 'meetings m', columns: 'm.*',
    filters: { body: { op: 'in', col: 'm.body' }, is_public: { op: 'bool', col: 'm.is_public' },
      date_from: { op: 'gte', col: 'm.held_on' }, date_to: { op: 'lte', col: 'm.held_on' } },
    search: ['m.title', 'm.decisions', 'm.meeting_no'],
    allowSort: ['held_on', 'body'], defaultSort: 'm.held_on DESC',
    req, extraWhere: onlyPublic ? ["m.body='board'"] : [],
  });
  for (const m of out.rows)
    m.attendance = db.prepare(`SELECT ma.*, u.full_name, o.person_name observer_name, o.nominating_entity
        FROM meeting_attendance ma LEFT JOIN users u ON u.id=ma.user_id
        LEFT JOIN observers o ON o.id=ma.observer_id WHERE ma.meeting_id=?`).all(m.id);
  res.json(out);
});

// إنشاء اجتماع بمحضره وحضوره — والمراقب يحضر اجتماعات المجلس بلا صوت (المادة 34)
r.post('/meetings', requireAuth, can('gov.meetings.manage'), (req, res) => {
  const { body, title, meeting_no, held_on, decisions, attendee_ids = [], observer_ids = [], is_public } = req.body;
  if (!L_BODIES.includes(body)) return res.status(400).json({ error: 'جهة الاجتماع غير صالحة' });
  if (!title || !held_on || !decisions) return res.status(400).json({ error: 'العنوان والتاريخ والقرارات مطلوبة' });
  if (observer_ids.length && body !== 'board') return res.status(422).json({ error: 'حضور المراقبين مقصور على اجتماعات مجلس الأمناء (المادة 34)' });
  const admitted = new Set(db.prepare("SELECT id FROM observers WHERE status='admitted'").all().map((o) => o.id));
  for (const o of observer_ids) if (!admitted.has(Number(o))) return res.status(422).json({ error: `المراقب ${o} غير مقبول في الدورة` });
  const ROLE_OF = { board: ['BOARD_MEMBER', 'BOARD_CHAIR'], general_assembly: ['GENERAL_ASSEMBLY', 'BOARD_MEMBER', 'BOARD_CHAIR', 'PARTNER_BUSINESS', 'PARTNER_ASSOCIATION'],
    standards: ['STANDARDS_COMMITTEE'], licensing: ['LICENSING_COMMITTEE'], appeals: ['APPEALS_COMMITTEE'], integrity: ['INTEGRITY_COMMITTEE'] }[body];
  const ids = [...new Set((Array.isArray(attendee_ids) ? attendee_ids : []).map(Number))];
  for (const u of ids) {
    const ok = db.prepare(`SELECT 1 FROM users u JOIN user_roles ur ON ur.user_id=u.id WHERE u.id=? AND u.status='active'
        AND ur.role_code IN (${ROLE_OF.map(() => '?').join(',')})`).get(u, ...ROLE_OF);
    if (!ok) return res.status(422).json({ error: `المستخدم ${u} ليس عضواً في «${body}» — لا يُحتسب في النصاب` });
  }
  attendee_ids.length = 0; attendee_ids.push(...ids);
  const quorum = { board: 6, general_assembly: null, standards: 3, licensing: 2, appeals: 2, integrity: 3 }[body];
  if (quorum && attendee_ids.length < quorum)
    return res.status(422).json({ error: `النصاب غير مكتمل: ${attendee_ids.length} من ${quorum} على الأقل (المادة 16)` });
  const id = db.transaction(() => {
    const mid = db.prepare(`INSERT INTO meetings (body, title, meeting_no, held_on, quorum_required, attendees_count,
        observers_count, decisions, is_public) VALUES (?,?,?,?,?,?,?,?,?)`).run(body, title, meeting_no || null, held_on,
      quorum, attendee_ids.length, observer_ids.length, decisions, is_public ? 1 : 0).lastInsertRowid;
    const st = db.prepare('INSERT INTO meeting_attendance (meeting_id, user_id, observer_id, role_at_meeting, attended, voting) VALUES (?,?,?,?,1,?)');
    for (const u of attendee_ids) st.run(mid, Number(u), null, 'عضو', 1);
    for (const o of observer_ids) st.run(mid, null, Number(o), 'مراقب — حضور ومداخلة بلا صوت', 0);
    return mid;
  })();
  log(req, 'meeting.create', 'meeting', id, title);
  res.status(201).json(db.prepare('SELECT * FROM meetings WHERE id=?').get(id));
});
const L_BODIES = ['board', 'general_assembly', 'standards', 'licensing', 'appeals', 'integrity'];

module.exports = r;
