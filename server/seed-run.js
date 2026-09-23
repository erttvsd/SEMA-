'use strict';
const crypto = require('crypto');
const { db } = require('./db');
const REF = require('./reference');
const R = require('./rules');
const S = require('./seed');
const O = require('./seed-ops');
const { YEAR, rnd, pick, between, dateStr } = S;
const { doc, fmt } = O;

const nref = (p, t) => `${p}-${String(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n + 1).padStart(5, '0')}`;

function run() {
  console.log('تصفير قاعدة البيانات…');
  S.reset();
  const tx = db.transaction(() => {
    console.log('البيانات المرجعية…');
    S.seedReference();
    console.log('المستخدمون والأدوار…');
    const staff = S.seedUsers();
    console.log('المرخَّص لهم والمنظمات…');
    const { licensees, associations } = S.seedEntities(staff);

    console.log('الإثباتات…');
    for (const l of licensees) O.seedLicenseeDocs(l, staff);
    for (const a of associations) O.seedAssociationDocs(a, staff);

    console.log('معايير الاعتماد…');
    seedCriteria(associations, staff);
    console.log('الطلبات ومساراتها…');
    seedApplications(licensees, associations, staff);
    console.log('الالتزام والمساهمات…');
    seedCommitments(licensees, associations, staff);
    console.log('التدقيق…');
    seedAudits(licensees, associations, staff);
    console.log('الجزاءات والتظلمات…');
    seedSanctions(licensees, associations, staff);
    console.log('الرسوم والموازنة…');
    seedFinance(licensees, staff);
    console.log('الحوكمة والمراقبون والنزاهة…');
    seedGovernance(staff, licensees, associations);
    console.log('التصاميم والشكاوى واختبار السوق…');
    seedMisc(licensees, associations, staff);
    console.log('المؤشرات الفعلية…');
    console.log('المقترحات والمشاورة والحالات المفتوحة للمسارات…');
    seedExtensions(staff, licensees, associations);
    seedActuals();
  });
  tx();
  console.log('تشغيل المهام الآلية على البيانات…');
  const jr = require('./jobs').runJobs('seed');
  for (const j of jr) if (j.affected) console.log(`  ${j.title}: ${j.affected}`);
  report();
}

// ---------- معايير الاعتماد الخمسة عشر ----------
function seedCriteria(associations, staff) {
  const st = db.prepare(`INSERT INTO criteria_assessments (association_id,criterion_no,cycle_year,result,
      measured_value,note,assessed_by,assessed_at) VALUES (?,?,?,?,?,?,?,?)`);
  for (const a of associations) {
    if (!['accredited', 'suspended', 'revoked', 'under_review'].includes(a.status)) continue;
    const assessor = pick([staff['assessor1@sema.ly'], staff['assessor3@sema.ly']]);
    for (const [no, name, , isq, thr] of REF.CRITERIA) {
      let result = 'met', val = null, note = null;
      if (no === 3) { val = a.rev; if (a.rev < 30000) result = 'not_met'; }
      if (no === 8) { val = a.ratio;
        if (a.ratio > 0.25) { result = 'not_met'; note = `نسبة المصروفات الإدارية ${(a.ratio * 100).toFixed(1)}% تتجاوز السقف 25%`; }
        else if (a.ratio < 0.05) { result = 'partial'; note = 'نسبة أقل من 5% — تستوجب فحصاً إضافياً (المادة 15)'; } }
      if (no === 9) { val = db.prepare('SELECT fundraising_cost_ratio r FROM associations WHERE id=?').get(a.id).r;
        if (val > 0.30) { result = 'not_met'; note = `كلفة الجمع ${(val * 100).toFixed(0)}% تتجاوز 30%`; } }
      if (no === 10) { val = a.big3 * 2; note = `سقف الاستيعاب ${fmt(a.big3 * 2)} د.ل`; }
      if (no === 7 && a.rev <= 1000000) { result = 'na'; note = 'لا يسري — الإيرادات لا تتجاوز مليون دينار'; }
      if (no === 11) note = R.auditTierFor(a.rev);
      st.run(a.id, no, YEAR, result, val, note, assessor, dateStr(YEAR, between(2, 7), between(1, 28)));
    }
  }
}

// ---------- الطلبات ----------
function seedApplications(licensees, associations, staff) {
  const ia = db.prepare(`INSERT INTO applications (reference,app_type,subject_kind,subject_id,applicant_user_id,
      requested_level,requested_tier,stage,status,submitted_at,completeness_due_at,completeness_done_at,
      deficiencies,assessment_due_at,assessment_done_at,facts_report_id,decision,granted_level,decision_reason,
      decided_by,decided_at,sla_due_at,processing_days) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ist = db.prepare(`INSERT INTO application_stages (application_id,stage,stage_name_ar,responsible_body,
      max_days,started_at,completed_at,actor_id,note,breached_sla) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const licCommittee = [staff['licensing1@sema.ly'], staff['licensing2@sema.ly'], staff['licensing3@sema.ly']];

  const mk = (kind, e, type, level) => {
    const active = kind === 'licensee'
      ? ['active', 'suspended', 'withdrawn', 'expired'].includes(e.status)
      : ['accredited', 'suspended', 'revoked', 'expired'].includes(e.status);
    const open = ['under_review', 'submitted', 'draft'].includes(e.status);
    // الملفات المفتوحة قُدِّمت حديثاً فتكون داخل المدة المعيارية، وواحدة متأخرة عرضاً للحالة
    const submitted = open
      ? (e.id % 7 === 0 ? dateStr(YEAR, 2, between(1, 20)) : dateStr(YEAR, between(7, 9), between(1, 20)))
      : dateStr(YEAR, between(1, 5), between(1, 27));
    const rejected = e.status === 'rejected';
    const stage = active ? 9 : e.status === 'under_review' ? 5 : e.status === 'submitted' ? 2 : rejected ? 7 : 1;
    const status = active ? 'approved' : rejected ? 'rejected'
      : e.status === 'under_review' ? 'field_visit' : e.status === 'submitted' ? 'submitted' : 'submitted';
    const days = active || rejected ? between(48, 96) : null;
    const decidedAt = days ? R.addDays(submitted, days) : null;
    const reason = active
      ? `مستوفٍ لشروط الدخول في المادة (9)، ولمعايير المستوى المطلوب. تقرير الوقائع لم يسجّل أي مخالفة لقائمة الاستبعاد. يُمنح ${kind === 'licensee' ? 'الترخيص' : 'الاعتماد'} بالمستوى المطلوب.`
      : rejected ? 'مدرجة على قائمة الاستبعاد في المادة (10/1) — منشآت التبغ ومنتجات النيكوتين ووكلاؤها الحصريون. الطلب مرفوض، ورسم الطلب غير مستردّ (المادة 34/1).'
      : null;
    const id = ia.run(nref('APP', 'applications'), type, kind, e.id,
      e.uid, level || null, kind === 'licensee' ? e.tier : null, stage, status, submitted,
      R.addWorkDays(submitted, 10), R.addWorkDays(submitted, between(4, 9)),
      e.status === 'submitted' ? null : null, R.addWorkDays(submitted, 30),
      active || rejected ? R.addWorkDays(submitted, between(28, 44)) : null, null,
      active ? 'grant' : rejected ? 'reject' : null, active ? level : null, reason,
      active || rejected ? pick(licCommittee) : null, decidedAt,
      R.addWorkDays(submitted, 90), days).lastInsertRowid;

    REF.APP_STAGES.forEach(([sn, name, body, maxd]) => {
      const done = sn <= stage;
      const start = done || sn === stage + 1 ? R.addDays(submitted, (sn - 1) * between(3, 8)) : null;
      const end = done ? R.addDays(submitted, sn * between(4, 9)) : null;
      const actor = !done ? null : sn <= 6 ? pick([staff['assessor1@sema.ly'], staff['assessor3@sema.ly'], staff['evaldir@sema.ly']])
        : sn === 7 ? pick(licCommittee) : staff['registry@sema.ly'];
      ist.run(id, sn, name, body, maxd, start, end, actor,
        done ? (sn === 7 ? (reason || '').slice(0, 160) : 'منفَّذ داخل المدة') : null,
        done && maxd && start && end && R.daysBetween(start, end) > maxd ? 1 : 0);
    });
    return id;
  };
  for (const l of licensees) mk('licensee', l, 'license', l.level);
  for (const a of associations) mk('association', a, 'accreditation', null);
  // طلبات ترقية مستوى
  const upgradable = licensees.filter((l) => l.status === 'active' && l.level < 4).slice(0, 4);
  for (const l of upgradable) mk('licensee', l, 'level_upgrade', l.level + 1);
}

// ---------- الالتزام والمساهمات ----------
function seedCommitments(licensees, associations, staff) {
  const ic = db.prepare(`INSERT INTO commitments (licensee_id,fiscal_year,level,tier_code,annual_revenue,net_profit,
      pct_amount,floor_amount,commitment_due,basis,cash_paid,inkind_paid,volunteer_paid,direct_program_paid,
      total_paid,cash_share,deficit_amount,deficit_pct,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ict = db.prepare(`INSERT INTO contributions (reference,licensee_id,association_id,fiscal_year,channel,amount,
      purpose,transfer_date,bank_ref,volunteer_hours,hour_rate,valuation_by,notified_secretariat,
      transfer_doc_id,receipt_doc_id,impact_doc_id,receipt_confirmed,status,verified_by,verified_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)`);
  const idl = db.prepare(`INSERT INTO compliance_declarations (licensee_id,fiscal_year,fiscal_year_end,due_at,
      submitted_at,late_days,basis_type,basis_doc_id,declared_revenue,declared_net_profit,declared_total,status,
      desk_review_due,field_audit_due,facts_report_due,decision_due,processed_by,processed_at,outcome,note)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const accredited = associations.filter((a) => a.status === 'accredited');
  const PURPOSES = ['كفالة 40 أسرة متعففة لستة أشهر','تجهيز مختبر علوم لمدرستين','شراء أجهزة تنفس لقسم الحضانة',
    'حفر بئر مياه وتركيب مضخة شمسية','منح دراسية لعشرين طالباً','ترميم مركز تأهيل ذوي الإعاقة',
    'سلال غذائية لشهر رمضان','تدريب مهني لخمسين شاباً','دعم وحدة غسيل كلوي','تجهيز مكتبة عامة',
    'برنامج صحة الأم والطفل','إعادة تأهيل ثلاثة منازل متضررة'];

  let idx = 0;
  for (const l of licensees) {
    if (!['active', 'suspended', 'withdrawn', 'expired'].includes(l.status)) continue;
    const c = R.computeCommitment({ revenue: l.rev, netProfit: l.np, level: l.level,
      scopeNetProfit: l.level === 5 ? l.np * 0.22 : null });
    /* نسبة الإنجاز المستهدفة — موزَّعة على نحو يوافق حالة الملف:
       الساري: الأغلبية مستوفية، وأقلية بعجز دون 20% (إمهال)، وحالتان بعجز يتجاوز 20% قيد نظر اللجنة.
       المعلَّق والمسحوب: عجز يتجاوز 20% وهو سند الجزاء الصادر بحقهما. */
    let ratio;
    if (l.status === 'active') {
      const bucket = (idx++) % 10;                       // توزيع حتمي قابل للتحقق
      ratio = bucket < 7 ? 1.00 + rnd() * 0.06           // 70% مستوفية (تبلغ الالتزام أو تزيد)
            : bucket < 9 ? 0.86 + rnd() * 0.10           // 20% عجز دون 20%
            : 0.73 + rnd() * 0.05;                       // 10% عجز يتجاوز 20%
    } else if (l.status === 'suspended') ratio = 0.70 + rnd() * 0.07;
    else if (l.status === 'withdrawn') ratio = 0.52 + rnd() * 0.12;
    else ratio = 0.44 + rnd() * 0.14;
    const target = R.round2(c.commitment_due * ratio);   // هذا هو المبلغ الذي سيُوثَّق فعلاً
    // تركيب المسارات ضمن سقوف المادة (20) وقاعدة النصف النقدي في المادة (21)
    const cashShare = 0.60 + rnd() * 0.30;
    let cash = target * cashShare;
    let inkind = Math.min(target * 0.24, target * (1 - cashShare) * 0.55);
    let vol = Math.min(target * 0.09, target * (1 - cashShare) * 0.22);
    let dp = Math.max(0, target - cash - inkind - vol);
    if (dp > target * 0.38) { cash += dp - target * 0.38; dp = target * 0.38; }
    if (dp < 800) { cash += dp; dp = 0; }
    if (vol < 400) { cash += vol; vol = 0; }
    if (inkind < 600) { cash += inkind; inkind = 0; }
    cash = R.round2(cash);

    // توزيع الجزء النقدي على منظمات معتمدة، مع مراعاة سقف 60% للمنظمة الواحدة فوق 100 ألف
    const nOrgs = Math.min(accredited.length, cash > 400000 ? between(3, 5) : cash > 60000 ? between(2, 3) : 1);
    const weights = [];
    for (let i = 0; i < nOrgs; i++) weights.push(0.6 + rnd() * 0.8);
    const wsum = weights.reduce((s, x) => s + x, 0);
    const chosen = [];
    const parts = [];
    for (let i = 0; i < nOrgs; i++) {
      let a; let g = 0;
      do { a = pick(accredited); g++; } while (chosen.includes(a.id) && g < 40);
      chosen.push(a.id);
      let share = weights[i] / wsum;
      if (c.commitment_due > 100000) share = Math.min(share, 0.58);  // سقف المادة (22/2)
      parts.push({ a, amount: share });
    }
    const psum = parts.reduce((s, p) => s + p.amount, 0) || 1;
    parts.forEach((p) => { p.amount = R.round2(cash * (p.amount / psum)); });
    // فروق التدوير تُضاف إلى الحصة الأولى حتى يطابق المجموع الهدف تماماً
    if (parts.length) parts[0].amount = R.round2(parts[0].amount + (cash - parts.reduce((s, p) => s + p.amount, 0)));

    for (const p of parts) {
      if (p.amount <= 0) continue;
      const tdate = dateStr(YEAR, between(2, 9), between(1, 28));
      // كل المساهمات المحتسبة موثَّقة أو متحقَّق منها — ويُضاف لاحقاً بعضٌ معلَن لاختبار مسار التحقق
      const verified = rnd() < 0.86;
      const purpose = pick(PURPOSES);
      const tdoc = doc({ owner_kind: 'licensee', owner_id: l.id, doc_type: 'transfer_receipt',
        title: `إيصال تحويل — ${l.trade} إلى ${p.a.name}`, issuer: 'مصرف ' + pick(['الجمهورية','الوحدة','الصحاري']),
        refNo: `TRF-${between(100000, 999999)}`, date: tdate, uploaded_by: l.uid,
        verified_by: staff['auditor1@sema.ly'], verification: verified ? 'verified' : 'pending',
        rows: [['المُحوِّل', l.legal], ['المستفيد', p.a.name], ['المبلغ', fmt(p.amount) + ' د.ل'],
          ['تاريخ التحويل', tdate], ['الغرض', purpose], ['مرجع الحوالة', `TRF-${between(100000, 999999)}`]] });
      const rdoc = doc({ owner_kind: 'association', owner_id: p.a.id, doc_type: 'receipt_ack',
        title: `نموذج (5) إقرار استلام مساهمة — ${l.trade}`, issuer: p.a.name, refNo: `F5-${l.id}-${p.a.id}`,
        date: R.addDays(tdate, between(2, 9)), uploaded_by: p.a.uid, verified_by: staff['orgrel@sema.ly'],
        verification: verified ? 'verified' : 'pending',
        rows: [['المنظمة المتلقية', p.a.name], ['رقم الاعتماد', p.a.no], ['المساهم', l.legal],
          ['رقم الترخيص', l.no], ['المبلغ المستلَم', fmt(p.amount) + ' د.ل'], ['الغرض المعلن', purpose]],
        body: '<p>نتعهد بأن يُصرف هذا المبلغ في الغرض المذكور أعلاه حصراً، وبتقديم تقرير أثر عنه وفق نموذج (6)، وبإتاحة مستنداته لوحدة التقييم والتحقق عند الطلب.</p>' });
      const idoc = verified ? doc({ owner_kind: 'association', owner_id: p.a.id, doc_type: 'impact_report',
        title: `نموذج (6) تقرير الأثر — مساهمة ${l.trade}`, issuer: p.a.name, refNo: `F6-${l.id}-${p.a.id}`,
        date: R.addDays(tdate, between(40, 120)), uploaded_by: p.a.uid, is_public: 1,
        verified_by: staff['orgrel@sema.ly'],
        rows: [['المبلغ الوارد عبر العلامة', fmt(p.amount) + ' د.ل'], ['الغرض', purpose],
          ['المستفيدون المباشرون', fmt(between(30, 2400)) + ' شخص'],
          ['نسبة الصرف', between(72, 100) + '%'], ['موقع التنفيذ', p.a.city],
          ['فترة التنفيذ', `${R.addDays(tdate, 10)} — ${R.addDays(tdate, between(90, 200))}`]],
        body: '<p>هذا التقرير يخص <b>الأموال الواردة عبر العلامة تحديداً</b>، لا نشاط المنظمة كله (المادة 23/3).</p>' }) : null;
      ict.run(nref('CON', 'contributions'), l.id, p.a.id, YEAR, 'cash', p.amount, purpose, tdate,
        `TRF-${between(100000, 999999)}`, null, null, null, tdoc, rdoc, idoc,
        1, verified ? 'verified' : 'documented',
        verified ? staff['auditor1@sema.ly'] : null, verified ? R.addDays(tdate, between(10, 40)) : null);
    }
    // مساهمات معلَنة بعد إقرار الامتثال — لا تُحتسب حتى يتم التحقق، وتخدم عرض مسار التحقق
    if (l.status === 'active' && idx % 4 === 0) {
      const tdate = dateStr(YEAR, 9, between(1, 20));
      const extra = R.round2(c.commitment_due * (0.03 + rnd() * 0.05));
      const a = pick(accredited);
      ict.run(nref('CON', 'contributions'), l.id, a.id, YEAR, 'cash', extra,
        pick(PURPOSES), tdate, `TRF-${between(100000, 999999)}`, null, null, null,
        null, null, null, 0, 'declared', null, null);
    }
    if (inkind > 0) {
      const a = pick(accredited);
      const tdate = dateStr(YEAR, between(3, 9), between(1, 28));
      const vdoc = doc({ owner_kind: 'licensee', owner_id: l.id, doc_type: 'inkind_valuation',
        title: `تقييم تبرع عيني — ${l.trade}`, issuer: 'مكتب ' + pick(['التقييم المستقل','الخبرة الفنية']) + ' — طرف ثالث مستقل',
        refNo: `VAL-${between(1000, 9999)}`, date: tdate, uploaded_by: l.uid, verified_by: staff['auditor2@sema.ly'],
        rows: [['نوع التبرع', pick(['أغذية معلبة','أدوية','مستلزمات مدرسية','مواد بناء','أجهزة حاسوب'])],
          ['القيمة السوقية المقدَّرة', fmt(inkind) + ' د.ل'], ['أساس التقييم', 'متوسط ثلاثة عروض سوقية'],
          ['الجهة المقيِّمة', 'طرف ثالث مستقل (المادة 20)'], ['السقف المقرر', '25% من إجمالي الالتزام']] });
      ict.run(nref('CON', 'contributions'), l.id, a.id, YEAR, 'inkind', R.round2(inkind),
        'تبرع عيني مقيَّم بالقيمة السوقية', tdate, null, null, null, 'مكتب تقييم مستقل', vdoc, null, null,
        1, 'verified', staff['auditor2@sema.ly'], R.addDays(tdate, 20));
    }
    if (vol > 0) {
      const a = pick(accredited);
      const hours = Math.round(vol / 18);
      const tdate = dateStr(YEAR, between(4, 9), between(1, 28));
      const ldoc = doc({ owner_kind: 'licensee', owner_id: l.id, doc_type: 'volunteer_log',
        title: `سجل ساعات التطوع — ${l.trade}`, issuer: l.legal, refNo: `VOL-${l.id}`, date: tdate,
        uploaded_by: l.uid, verified_by: staff['auditor1@sema.ly'],
        rows: [['عدد المتطوعين', between(4, 60)], ['إجمالي الساعات', fmt(hours) + ' ساعة'],
          ['سعر الساعة الموحَّد', '18 د.ل'], ['القيمة المحتسبة', fmt(vol) + ' د.ل'],
          ['السقف المقرر', '10% من إجمالي الالتزام'], ['الجهة المستضيفة', a.name]] });
      ict.run(nref('CON', 'contributions'), l.id, a.id, YEAR, 'volunteer', R.round2(vol),
        'وقت تطوّع الموظفين', tdate, null, hours, 18, null, ldoc, null, null, 1, 'verified',
        staff['auditor1@sema.ly'], R.addDays(tdate, 15));
    }
    if (dp > 0) {
      const tdate = dateStr(YEAR, between(3, 8), between(1, 28));
      ict.run(nref('CON', 'contributions'), l.id, null, YEAR, 'direct_program', R.round2(dp),
        pick(['برنامج تنموي ذاتي: تدريب 80 شاباً على الحِرف','برنامج تنموي ذاتي: تأهيل مركز صحي','برنامج تنموي ذاتي: مشروع طاقة شمسية لمدرسة']),
        tdate, null, null, null, null, null, null, null, 1, 'verified', staff['evaldir@sema.ly'], R.addDays(tdate, 25));
    }

    const rows = db.prepare(`SELECT channel, COALESCE(SUM(amount),0) s FROM contributions
        WHERE licensee_id=? AND fiscal_year=? AND status IN ('documented','verified') GROUP BY channel`).all(l.id, YEAR);
    const g = (x) => rows.find((r) => r.channel === x)?.s || 0;
    const tot = g('cash') + g('inkind') + g('volunteer') + g('direct_program');
    const d = R.deficitAssessment(c.commitment_due, tot);
    ic.run(l.id, YEAR, l.level, c.tier_code, l.rev, l.np, c.pct_amount, c.floor_amount, c.commitment_due,
      c.basis, g('cash'), g('inkind'), g('volunteer'), g('direct_program'), R.round2(tot),
      tot > 0 ? R.round4(g('cash') / tot) : null, d.deficit, d.deficit_pct,
      d.status === 'fulfilled' ? 'fulfilled' : d.status);

    // إقرار الامتثال
    const fye = `${YEAR - 1}-12-31`;
    const due = R.addDays(fye, 120);
    const submittedDecl = ['active', 'suspended', 'withdrawn'].includes(l.status);
    const late = l.status === 'expired' ? null : (rnd() < 0.15 ? between(3, 26) : 0);
    const basis = l.tier === 'أ' || l.tier === 'ب' ? pick(['tax_return', 'bank_statement_accountant']) : pick(['tax_return', 'audited_statements']);
    const bdoc = submittedDecl ? doc({ owner_kind: 'licensee', owner_id: l.id, doc_type: 'compliance_decl',
      title: `نموذج (4) إقرار الامتثال السنوي ${YEAR - 1} — ${l.trade}`, issuer: l.legal,
      refNo: `F4-${YEAR - 1}-${l.id}`, date: late ? R.addDays(due, late) : R.addDays(due, -between(3, 40)),
      uploaded_by: l.uid, verified_by: staff['assessor1@sema.ly'], confidential: 1,
      rows: [['السنة المالية', YEAR - 1], ['نهاية السنة المالية', fye], ['موعد التقديم الأقصى', due],
        ['أساس الإثبات المالي', { tax_return: 'الإقرار الضريبي المقدَّم لمصلحة الضرائب',
          audited_statements: 'قوائم مالية مدققة من محاسب قانوني مقيّد',
          bank_statement_accountant: 'كشف حساب مصرفي مع إقرار محاسب (للشريحتين أ وب)' }[basis]],
        ['الإيراد المعلن', fmt(l.rev) + ' د.ل'], ['صافي الربح قبل الضريبة', fmt(l.np) + ' د.ل'],
        ['الالتزام الواجب', fmt(c.commitment_due) + ' د.ل'], ['المصروف والموثَّق', fmt(tot) + ' د.ل'],
        ['الفارق', fmt(d.deficit) + ' د.ل'], ['تكييف الفارق', d.message]] }) : null;
    idl.run(l.id, YEAR - 1, fye, due, submittedDecl ? (late ? R.addDays(due, late) : R.addDays(due, -between(3, 40))) : null,
      late || 0, submittedDecl ? basis : null, bdoc, submittedDecl ? l.rev : null,
      submittedDecl ? l.np : null, submittedDecl ? tot : null,
      !submittedDecl ? 'pending' : late ? 'late' : d.status === 'breach' ? 'deficient' : 'accepted',
      submittedDecl ? R.addDays(due, 30) : null, submittedDecl ? R.addDays(due, 60) : null,
      submittedDecl ? R.addDays(due, 75) : null, submittedDecl ? R.addDays(due, 90) : null,
      submittedDecl ? staff['assessor1@sema.ly'] : null, submittedDecl ? R.addDays(due, 35) : null,
      !submittedDecl ? null : d.status === 'breach' ? 'suspend' : d.status === 'deficient' ? 'downgrade' : 'renew',
      d.message);
    // إقرار السنة الجارية معلّق
    if (l.status === 'active')
      idl.run(l.id, YEAR, `${YEAR}-12-31`, R.addDays(`${YEAR}-12-31`, 120), null, 0, null, null, null, null, null,
        'pending', null, null, null, null, null, null, null, 'إقرار السنة الجارية — يُقدَّم خلال 120 يوماً من انتهاء السنة المالية');
  }
  // تحديث سقف الاستيعاب المستخدم
  for (const a of associations) {
    const s = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM contributions WHERE association_id=?
        AND fiscal_year=? AND status IN ('documented','verified')`).get(a.id, YEAR).s;
    db.prepare('UPDATE associations SET absorption_used=? WHERE id=?').run(R.round2(s), a.id);
  }
}

// ---------- التدقيق ----------
function seedAudits(licensees, associations, staff) {
  const iaud = db.prepare(`INSERT INTO audits (reference,subject_kind,subject_id,fiscal_year,audit_type,trigger,
      sample_seed,scheduled_date,executed_date,assessor_id,second_assessor_id,status,facts_summary,
      facts_report_doc_id,hours_spent) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const ifn = db.prepare('INSERT INTO audit_findings (audit_id,area,fact,evidence_doc_id,severity,violation_code) VALUES (?,?,?,?,?,?)');
  const seed = 'a91f37c8d2e45b06';
  const assessors = [staff['assessor1@sema.ly'], staff['assessor2@sema.ly'], staff['assessor3@sema.ly']];
  const auditors = [staff['auditor1@sema.ly'], staff['auditor2@sema.ly']];

  const FACTS_OK = [
    'طوبقت الدفاتر مع إيصالات التحويل وكشوف الحساب المصرفي؛ وتوافقت أرقام الالتزام مع الإقرار الضريبي المقدَّم.',
    'عُوينت العبوات في المصنع وفي ثلاث نقاط بيع؛ ظهر رقم الترخيص بجوار الشعار في كل التطبيقات الملحوظة.',
    'قوبل المسؤول المالي وراجع المقيّم قيود مركز التكلفة المخصص؛ لا توجد قيود معلَّقة غير مسوَّاة.',
    'راسلت الوحدة ثلاث منظمات متلقية وطابقت إقرارات الاستلام مع مبالغ التحويل؛ لا فوارق.',
  ];
  const FACTS_ISSUE = [
    ['العبوات ونقاط البيع', 'لوحظ في عبوتين من خط الإنتاج الفرعي شعار العلامة دون رقم الترخيص المطلوب.', 'major', 5],
    ['المستندات', 'لم يُقدَّم مستند تقييم مستقل للتبرع العيني بقيمة تتجاوز عشرين ألف دينار.', 'minor', 2],
    ['المطابقة المالية', 'فارق بين المبلغ المعلن في إقرار الامتثال وما تسنده كشوف الحساب المصرفية.', 'critical', 4],
    ['الادعاء الإعلاني', 'مادة إعلانية تحمل عبارة «شركة مسؤولة» وهي ادعاء مطلق محظور.', 'major', 5],
    ['نطاق الترخيص', 'العلامة موضوعة على منتج خارج النطاق المحدد في شهادة الترخيص.', 'major', 5],
  ];

  let i = 0;
  for (const l of licensees) {
    if (!['active', 'suspended', 'withdrawn'].includes(l.status)) continue;
    const rate = R.fieldAuditRate({ level: l.level, tierCode: l.tier, pilotYear: true });
    // المرحلة التجريبية: تدقيق ميداني كامل
    const kinds = ['desk', 'field'];
    if (i % 7 === 0) kinds.push('unannounced');
    for (const kind of kinds) {
      const sched = dateStr(YEAR, between(3, 10), between(1, 28));
      const executed = rnd() < 0.85 ? R.addDays(sched, between(0, 6)) : null;
      const hasIssue = ['suspended', 'withdrawn'].includes(l.status) ? true : rnd() < 0.22;
      const assessor = kind === 'desk' ? pick(assessors) : pick(auditors);
      const facts = executed
        ? (hasIssue ? `${pick(FACTS_OK)} ${FACTS_ISSUE.filter(() => rnd() < 0.5).map((f) => f[1]).join(' ') || FACTS_ISSUE[0][1]}` : pick(FACTS_OK))
        : null;
      const fdoc = executed ? doc({ owner_kind: 'audit', owner_id: 0, doc_type: 'facts_report',
        title: `تقرير وقائع ${kind === 'unannounced' ? 'زيارة غير معلنة' : kind === 'field' ? 'تدقيق ميداني' : 'تدقيق مكتبي'} — ${l.trade}`,
        issuer: 'وحدة التقييم والتحقق', refNo: `FR-${l.id}-${kind}`, date: executed, uploaded_by: assessor,
        verified_by: staff['evaldir@sema.ly'], confidential: 1,
        rows: [['الجهة', l.legal], ['رقم الترخيص', l.no], ['نوع التدقيق',
          { desk: 'تدقيق مكتبي', field: 'تدقيق ميداني معلن', unannounced: 'زيارة غير معلنة' }[kind]],
          ['المقيّم', db.prepare('SELECT full_name f FROM users WHERE id=?').get(assessor).f],
          ['تاريخ التنفيذ', executed], ['نسبة التدقيق المقررة', (rate.rate * 100).toFixed(0) + '%'],
          ['سند النسبة', rate.reason]],
        body: `<p><b>الوقائع:</b> ${facts}</p><p style="color:#A32020"><b>تنويه نظامي:</b> يقتصر هذا التقرير على الوقائع والأدلة
          <b>دون توصية بالمنح أو الرفض</b>، إعمالاً للمادة (20/3) من النظام الداخلي والمواصفة ISO/IEC 17065.</p>` }) : null;
      const aid = iaud.run(nref('AUD', 'audits'), 'licensee', l.id, YEAR, kind,
        kind === 'unannounced' ? 'random' : 'pilot_year', seed, sched, executed, assessor,
        kind === 'field' ? pick(assessors) : null,
        executed ? 'facts_reported' : 'planned', facts, fdoc, executed ? between(3, 22) : null).lastInsertRowid;
      if (fdoc) db.prepare("UPDATE documents SET owner_id=? WHERE id=?").run(aid, fdoc);
      if (executed && hasIssue) {
        const picks = FACTS_ISSUE.filter(() => rnd() < 0.45);
        for (const [area, fact, sev, vc] of (picks.length ? picks : [FACTS_ISSUE[0]]))
          ifn.run(aid, area, fact, null, sev, vc);
      } else if (executed) {
        ifn.run(aid, 'المطابقة العامة', 'لا توجد وقائع مخالفة؛ الملف مطابق لاشتراطات الاستعمال.', null, 'info', null);
      }
      i++;
    }
  }
  // تدقيق المنظمات
  for (const a of associations.filter((x) => ['accredited', 'suspended', 'revoked'].includes(x.status))) {
    const sched = dateStr(YEAR, between(4, 10), between(1, 28));
    const executed = R.addDays(sched, between(0, 5));
    const issue = a.ratio > 0.25;
    const assessor = pick(assessors);
    const facts = issue
      ? `نسبة المصروفات الإدارية والتسييرية والدعائية بلغت ${(a.ratio * 100).toFixed(1)}% من إجمالي المصروفات، وهي تتجاوز السقف المقرر 25%. طوبقت الأرقام مع القوائم المالية المدققة وتقرير المراجع.`
      : `طوبقت القوائم المالية مع تقرير المراجع؛ نسبة المصروفات الإدارية ${(a.ratio * 100).toFixed(1)}%. تحقّقت الوحدة من إقرارات استلام المساهمات الواردة عبر العلامة ومن تقارير الأثر المقدَّمة عنها.`;
    const fdoc = doc({ owner_kind: 'audit', owner_id: 0, doc_type: 'facts_report',
      title: `تقرير وقائع تدقيق منظمة — ${a.name}`, issuer: 'وحدة التقييم والتحقق',
      refNo: `FR-ORG-${a.id}`, date: executed, uploaded_by: assessor, verified_by: staff['evaldir@sema.ly'],
      rows: [['المنظمة', a.name], ['رقم الاعتماد', a.no], ['نسبة المصروفات الإدارية', (a.ratio * 100).toFixed(1) + '%'],
        ['التصنيف المنشور', R.classifyAdminRatio(a.ratio).name], ['مستوى المراجعة المطلوب', R.auditTierFor(a.rev)],
        ['سقف الاستيعاب', fmt(a.big3 * 2) + ' د.ل'],
        ['المستخدَم من السقف', fmt(db.prepare('SELECT absorption_used u FROM associations WHERE id=?').get(a.id).u) + ' د.ل']],
      body: `<p><b>الوقائع:</b> ${facts}</p><p style="color:#A32020"><b>تنويه:</b> وقائع وأدلة بلا توصية (المادة 20/3).</p>` });
    const aid = iaud.run(nref('AUD', 'audits'), 'association', a.id, YEAR, 'field', 'renewal', seed,
      sched, executed, assessor, null, 'facts_reported', facts, fdoc, between(4, 16)).lastInsertRowid;
    db.prepare('UPDATE documents SET owner_id=? WHERE id=?').run(aid, fdoc);
    if (issue) ifn.run(aid, 'سقف المصروفات الإدارية',
      `النسبة ${(a.ratio * 100).toFixed(1)}% تتجاوز السقف 25% المقرر في المعيار (8).`, null, 'critical', null);
    else if (a.ratio < 0.05) ifn.run(aid, 'سقف المصروفات الإدارية',
      `النسبة ${(a.ratio * 100).toFixed(1)}% أقل من 5% — فحص إضافي للتأكد من عدم تحميل تكاليف إدارية على بنود البرامج.`, null, 'minor', null);
    else ifn.run(aid, 'المطابقة العامة', 'المنظمة مستوفية للمعايير الخمسة عشر مجتمعةً.', null, 'info', null);
  }
}

// ---------- الجزاءات والتظلمات ----------
function seedSanctions(licensees, associations, staff) {
  const isn = db.prepare(`INSERT INTO sanctions (case_no,subject_kind,subject_id,subject_name,violation_code,measure,
      fine_amount,grace_days,reason,source_audit_id,decided_by,decided_at,effective_from,effective_to,
      auto_escalate_to,published,publish_until,reapply_allowed_from,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const iap = db.prepare(`INSERT INTO appeals (reference,sanction_id,application_id,appellant_kind,appellant_id,
      appellant_name,filed_at,filing_deadline,decision_due_at,grounds,stay_of_execution,stay_reason,
      decision,decision_reason,decided_at,decided_by,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const lc = [staff['licensing1@sema.ly'], staff['licensing2@sema.ly'], staff['licensing3@sema.ly']];
  const ac = [staff['appeals1@sema.ly'], staff['appeals2@sema.ly'], staff['appeals3@sema.ly']];

  const add = (kind, e, vc, measure, reason, date, extra = {}) => {
    const v = REF.VIOLATIONS.find((x) => x[0] === vc);
    let eff_to = null, auto = null, pub = v?.[5] ? 1 : 0, pubUntil = null, reapply = null;
    if (measure === 'suspension') { eff_to = R.addDays(date, 180); auto = 'withdrawal'; pub = 1; }
    if (measure === 'withdrawal') { pub = 1; pubUntil = R.addDays(date, 365); reapply = R.addDays(date, (v?.[4] || 12) * 30); }
    return isn.run(nref('SNC', 'sanctions'), kind, e ? e.id : null, e ? (e.legal || e.name) : extra.name,
      vc, measure, extra.fine || null, extra.grace || null, reason, null, pick(lc), date, date, eff_to,
      auto, pub, pubUntil, reapply, extra.status || 'active').lastInsertRowid;
  };

  // تعليق: عجز يتجاوز 20%
  for (const l of licensees.filter((x) => x.status === 'suspended')) {
    const c = db.prepare('SELECT * FROM commitments WHERE licensee_id=?').get(l.id);
    const d = date2(YEAR, 8);
    const sid = add('licensee', l, 4, 'suspension',
      `عجز في الالتزام بنسبة ${((c?.deficit_pct || 0.28) * 100).toFixed(1)}% يتجاوز حدّ 20% المقرر في المادة (29/4). قُدِّر الالتزام بـ${fmt(c?.commitment_due)} د.ل والموثَّق ${fmt(c?.total_paid)} د.ل. تعليق لمدة أقصاها ستة أشهر مع نشر الحالة في السجل، ويتحول تلقائياً إلى سحب إن لم تُزَل أسبابه (المادة 30/2).`, d);
    // تظلم على أحدها
    if (l.id % 2 === 0) {
      const filed = R.addDays(d, between(6, 25));
      iap.run(nref('APL', 'appeals'), sid, null, 'licensee', l.id, l.legal, filed, R.addDays(d, 30),
        R.addDays(filed, 60),
        'نطلب إعادة النظر في تكييف العجز: جزء من المساهمة حُوِّل في آخر أسبوع من السنة المالية ووصل إلى حساب المنظمة في اليوم الثاني من السنة التالية، ونرفق كشفاً مصرفياً وإقرار استلام مؤرَّخاً. ونطلب اعتبار المبلغ محتسباً على السنة محل الإقرار.',
        0, null, 'partially_upheld',
        'تثبت اللجنة من الكشف المصرفي أن مبلغ التحويل خرج من حساب المتظلم قبل انتهاء السنة المالية، فيُحتسب على تلك السنة. وبعد الاحتساب ينزل العجز إلى ما دون 20%، فتُعدَّل المرتبة الجزائية من التعليق إلى إمهال ستين يوماً لاستكمال الفارق مع خفض المستوى المعلن، إعمالاً للمادة (29/3). ويبقى الجزاء قائماً في حدّه الأدنى لثبوت العجز أصلاً.',
        R.addDays(filed, between(38, 58)), pick(ac), 'decided');
    }
  }
  // سحب: بيانات غير صحيحة عمداً
  for (const l of licensees.filter((x) => x.status === 'withdrawn')) {
    const d = date2(YEAR, 6);
    add('licensee', l, 8, 'withdrawal',
      'ثبت من مطابقة إقرار الامتثال مع الإقرار الضريبي المقدَّم لمصلحة الضرائب تقديم بيانات غير صحيحة عمداً بشأن صافي الربح والمبالغ المحوَّلة. سحب فوري مع حظر إعادة التقديم أربعاً وعشرين شهراً ونشر علني (المادة 29/8)، والتزام بوقف كل استعمال خلال ثلاثين يوماً وسحب المواد المطبوعة من نقاط البيع خلال تسعين يوماً على نفقة المسحوب منه (المادة 31/2).', d);
  }
  // غرامات تأخير
  for (const l of licensees.filter((x) => x.status === 'active').slice(0, 5)) {
    const inv = db.prepare("SELECT amount FROM invoices WHERE subject_kind='licensee' AND subject_id=? LIMIT 1").get(l.id);
    add('licensee', l, 1, 'late_fine',
      `تأخر تقديم إقرار الامتثال السنوي ${between(4, 26)} يوماً (أقل من ثلاثين). تنبيه كتابي مع غرامة تأخير 10% من الرسم السنوي (المادة 29/1).`,
      date2(YEAR, 5), { fine: R.round2((inv?.amount || 1000) * 0.10), status: 'closed' });
  }
  // نقص مستندات
  for (const l of licensees.filter((x) => x.status === 'active').slice(5, 9))
    add('licensee', l, 2, 'grace_period',
      'نقص في المستندات: لم يُقدَّم مستند تقييم مستقل للتبرع العيني. إمهال ثلاثين يوماً مع إيقاف إصدار مواد جديدة تحمل العلامة (المادة 29/2).',
      date2(YEAR, 7), { grace: 30 });
  // إنذار: نطاق
  for (const l of licensees.filter((x) => x.status === 'active').slice(9, 12))
    add('licensee', l, 5, 'written_warning',
      'استعمال العلامة على منتج خارج نطاق الترخيص المحدد في الشهادة. تنبيه كتابي، ويعقبه إنذار رسمي ثم تعليق عند التكرار (المادة 29/5).',
      date2(YEAR, 8));
  // المنظمات
  for (const a of associations.filter((x) => x.status === 'suspended'))
    add('association', a, 4, 'suspension',
      `تجاوز سقف المصروفات الإدارية: النسبة ${(a.ratio * 100).toFixed(1)}% مقابل سقف 25% (المعيار 8). تعليق صفة الاعتماد مع إمهال لمعالجة الوضع، ويوقف توجيه مساهمات جديدة إليها (المادة 32).`,
      date2(YEAR, 7));
  for (const a of associations.filter((x) => x.status === 'revoked'))
    add('association', a, 8, 'withdrawal',
      `تجاوز سقف المصروفات الإدارية ثلاث سنوات مالية متتالية دون ظروف استثنائية مقبولة، مع بلوغ كلفة جمع التبرعات ${((db.prepare('SELECT fundraising_cost_ratio r FROM associations WHERE id=?').get(a.id).r) * 100).toFixed(0)}% وهي تتجاوز سقف 30%. سحب صفة الاعتماد (المادة 32).`,
      date2(YEAR, 4));
  // غير مرخَّص
  add('unlicensed', null, 11, 'cease_and_desist',
    'ثبت من جولة اختبار السوق استعمال شعار العلامة على عبوات منشأة غير مرخَّصة. وُجِّه خطاب كفٍّ وامتناع، وتُقدَّر الغرامة بخمسة أضعاف الرسم السنوي لشريحتها، ويُرفَع الأمر للقضاء عند الاستمرار (المادة 29/11).',
    date2(YEAR, 9), { name: 'مؤسسة الصفوة للمواد الغذائية — غير مرخَّصة' });
  // تظلم على رفض طلب
  const rej = db.prepare("SELECT * FROM applications WHERE decision='reject' LIMIT 1").get();
  if (rej) {
    const filed = R.addDays(String(rej.decided_at).slice(0, 10), 12);
    iap.run(nref('APL', 'appeals'), null, rej.id, 'licensee', rej.subject_id,
      db.prepare('SELECT legal_name n FROM licensees WHERE id=?').get(rej.subject_id).n, filed,
      R.addDays(String(rej.decided_at).slice(0, 10), 30), R.addDays(filed, 60),
      'نتظلم من قرار الرفض ونبيّن أن نشاطنا الرئيسي هو تجارة التجزئة العامة، وأن التبغ بند فرعي ننوي التخلي عن توكيله. ونطلب قبول الطلب بنطاق ترخيص مقصور على خط المنتجات الغذائية.',
      0, null, 'upheld',
      'قائمة الاستبعاد في المادة (10/1) تشمل منشآت التبغ ومنتجات النيكوتين ووكلاءها الحصريين، والاستبعاد قائم على صفة الجهة لا على نطاق الترخيص المطلوب، فلا يرفعه قصر النطاق على خط آخر. وقرار الرفض صحيح ويُؤيَّد. وللمتظلم إعادة التقديم متى انتفت صفة الوكالة الحصرية بمستند رسمي.',
      R.addDays(filed, 44), pick(ac), 'decided');
  }
}
const date2 = (y, m) => dateStr(y, m, between(1, 27));

// ---------- الرسوم والموازنة ----------
function seedFinance(licensees, staff) {
  const iv = db.prepare(`INSERT INTO invoices (invoice_no,subject_kind,subject_id,subject_name,fee_type,fiscal_year,
      tier_code,level,base_amount,discount_pct,discount_reason,amount,capped,issued_at,due_at,paid_at,
      payment_ref,status,refundable) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const l of licensees) {
    const f = R.computeFees({ revenue: l.rev, level: l.level, pilotDiscount: l.founding && ['أ','ب'].includes(l.tier) });
    const issued = l.start || dateStr(YEAR, between(1, 5), between(1, 27));
    iv.run(nref('INV', 'invoices'), 'licensee', l.id, l.legal, 'application', YEAR, l.tier, l.level,
      f.application_fee, 0, null, f.application_fee, 0, issued, R.addDays(issued, 14),
      R.addDays(issued, between(1, 12)), `PAY-${between(100000, 999999)}`, 'paid', 0);
    if (['active', 'suspended', 'withdrawn', 'expired'].includes(l.status)) {
      const base = l.level >= 3 ? R.tierFor(l.rev).a12 : R.tierFor(l.rev).a12;
      const paid = rnd() < 0.86;
      iv.run(nref('INV', 'invoices'), 'licensee', l.id, l.legal, 'annual', YEAR, l.tier, l.level,
        base, l.level >= 3 ? 20 : 0, l.level >= 3 ? 'خصم 20% للمستويات الثالث والرابع والخامس (المادة 34/4)' : null,
        f.annual_fee, f.capped ? 1 : 0, issued, R.addDays(issued, 30),
        paid ? R.addDays(issued, between(2, 28)) : null, paid ? `PAY-${between(100000, 999999)}` : null,
        paid ? 'paid' : (R.addDays(issued, 30) < dateStr(YEAR, 9, 22) ? 'overdue' : 'issued'), 0);
    }
  }
  // غرامات التأخير كفواتير
  for (const s of db.prepare("SELECT * FROM sanctions WHERE measure='late_fine'").all())
    iv.run(nref('INV', 'invoices'), s.subject_kind, s.subject_id, s.subject_name, 'late_fine', YEAR, null, null,
      s.fine_amount, 0, null, s.fine_amount, 0, s.decided_at, R.addDays(String(s.decided_at).slice(0, 10), 30),
      rnd() < 0.6 ? R.addDays(String(s.decided_at).slice(0, 10), 10) : null, null, rnd() < 0.6 ? 'paid' : 'issued', 0);

  // موازنة الأمانة — تصنيف ثلاثي (المادة 31)
  const ib = db.prepare('INSERT INTO secretariat_budget (fiscal_year,category,line_item,budgeted,actual) VALUES (?,?,?,?,?)');
  const B = [
    ['program','التقييم والتدقيق والزيارات الميدانية',420000,398000],
    ['program','السجل العام والنظم الرقمية',180000,171000],
    ['program','الوعي والاتصال الوطني وبلديات الخير',310000,296000],
    ['program','بناء قدرات المنظمات وورش الاعتماد',140000,128000],
    ['program','اختبار السوق وحماية العلامة قانونياً',95000,88000],
    ['fundraising','استقطاب الشركاء المؤسسين والممولين',86000,79000],
    ['fundraising','مواد العرض والملفات التعريفية',34000,31000],
    ['admin','أجور الإدارة العامة',215000,209000],
    ['admin','إيجار المقر والتشغيل',74000,71000],
    ['admin','المراجعة الحسابية الخارجية والقانونية',46000,44000],
  ];
  for (const b of B) ib.run(YEAR, b[0], b[1], b[2], b[3]);
  for (const b of B) ib.run(YEAR - 1, b[0], b[1], Math.round(b[2] * 0.42), Math.round(b[3] * 0.4));

  const fees = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE status='paid'").get().s;
  const isrc = db.prepare(`INSERT INTO funding_sources (fiscal_year,source_name,source_kind,amount,conditional,
      board_approval_required,board_approved) VALUES (?,?,?,?,?,?,?)`);
  isrc.run(YEAR, 'رسوم ترخيص قطاع الأعمال', 'fees', R.round2(fees), 0, 0, 0);
  isrc.run(YEAR, 'منحة تأسيسية غير مشروطة — صندوق تنمية محلي', 'grant', 450000, 0, 1, 1);
  isrc.run(YEAR, 'منحة بناء قدرات — شريك تنموي دولي', 'grant', 180000, 0, 1, 1);
  isrc.run(YEAR, 'تبرعات الشركاء المؤسسين', 'donation', 240000, 0, 0, 0);
  isrc.run(YEAR, 'رعاية جائزة سِيمَا الخَيْر السنوية', 'sponsorship', 95000, 1, 1, 1);
  isrc.run(YEAR, 'عوائد خدمات تدريب وبناء قدرات', 'training', 62000, 0, 0, 0);
}

// ---------- الحوكمة ----------
function seedGovernance(staff, licensees, associations) {
  const im = db.prepare(`INSERT INTO meetings (body,title,meeting_no,held_on,quorum_required,attendees_count,
      observers_count,minutes_doc_id,decisions,is_public) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const iat = db.prepare('INSERT INTO meeting_attendance (meeting_id,user_id,observer_id,role_at_meeting,attended,voting) VALUES (?,?,?,?,?,?)');
  const iob = db.prepare(`INSERT INTO observers (reference,user_id,person_name,nominating_entity,entity_kind,sector,
      term_start,term_end,cycle,pledge_doc_id,status,end_reason) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const iu = db.prepare('INSERT INTO users (full_name,email,phone,password_hash,region,gender,job_title) VALUES (?,?,?,?,?,?,?)');
  const ir = db.prepare('INSERT INTO user_roles (user_id,role_code,scope_kind,scope_id) VALUES (?,?,?,?)');

  const OBS = [
    ['د. عبدالمنعم الساعدي','غرفة التجارة والصناعة — طرابلس','private','قطاع الأعمال','admitted'],
    ['أ. سالمة بن طاهر','شبكة المنظمات الأهلية الليبية','civil','المجتمع المدني','admitted'],
    ['م. رمزي القذافي','وزارة الشؤون الاجتماعية','public','القطاع العام','admitted'],
    ['د. هالة الدرناوي','جامعة بنغازي — كلية الاقتصاد','academic','الأكاديمي','admitted'],
    ['أ. مصطفى الزوي','مؤسسة الإعلام — قناة ليبيا','media','الإعلام','admitted'],
    ['أ. نادية العريبي','جمعية حماية المستهلك','civil','المجتمع المدني','rejected'],
    ['م. فوزي بن حامد','اتحاد الحرفيين','private','قطاع الأعمال','rejected'],
    ['أ. عادل المرغني','بلدية مصراتة','public','القطاع العام','ended'],
  ];
  const observerIds = [];
  OBS.forEach(([name, entity, kind, sector, status], i) => {
    const uid = iu.run(name, `observer${i + 1}@sema.ly`, `091-${between(1000000, 9999999)}`,
      S.PASS, pick(['الغربية','الشرقية','الجنوبية']), null, `مراقب — ${entity}`).lastInsertRowid;
    if (status === 'admitted') ir.run(uid, 'OBSERVER', 'global', null);
    const pledge = doc({ owner_kind: 'observer', owner_id: 0, doc_type: 'observer_pledge',
      title: `نموذج (8) إقرار سرّية وحياد المراقب — ${name}`, issuer: entity, refNo: `F8-${i + 1}`,
      uploaded_by: uid, verified_by: staff['director@sema.ly'],
      rows: [['المراقب', name], ['الجهة المرشِّحة', entity], ['القطاع', sector],
        ['حق التصويت', 'لا يوجد — للمراقب حق الحضور والمداخلة فقط'],
        ['الاطلاع على الملفات الفردية', 'محظور — لا حق له في الاطلاع على ملف فردي قيد التقييم'],
        ['مصاريف المشاركة', 'يتحملها المراقب، ولا يترتب عليها أي حق في التأثير على القرار']] });
    const oid = iob.run(nref('OBS', 'observers'), uid, name, entity, kind, sector,
      status === 'admitted' || status === 'ended' ? dateStr(YEAR, 2, between(1, 27)) : null,
      status === 'ended' ? dateStr(YEAR, 7, 14) : (status === 'admitted' ? dateStr(YEAR + 1, 1, 31) : null),
      String(YEAR), pledge, status,
      status === 'rejected' ? 'بلغ القطاع سقف المراقبَين المقرر في المادة (34/3)'
        : status === 'ended' ? 'إنهاء بقرار مسبَّب من مجلس الأمناء عند الإخلال بضوابط السرّية (المادة 34/6)' : null).lastInsertRowid;
    db.prepare('UPDATE documents SET owner_id=? WHERE id=?').run(oid, pledge);
    if (status === 'admitted') observerIds.push(oid);
  });

  const boardIds = Object.entries(staff).filter(([e]) => e.startsWith('board') || e === 'chair@sema.ly').map(([, v]) => v);
  const MEETINGS = [
    ['general_assembly','الجمعية العمومية التأسيسية — إقرار النظام الداخلي واعتماد الميثاق', 'ج ع/01', dateStr(YEAR, 1, 18), 1,
     'إقرار النظام الداخلي لإدارة العلامة بأغلبية ثلثي الحاضرين · انتخاب أعضاء مجلس الأمناء من الفئات المنتخَبة · تكليف المجلس بإيداع طلب تسجيل العلامة الجماعية لدى مكتب العلامات التجارية استيفاءً للمادة (29) من القرار 26 لسنة 2024.'],
    ['board','الاجتماع الأول لمجلس الأمناء — تشكيل اللجان وتعيين المدير التنفيذي','م أ/01', dateStr(YEAR, 2, 3), 1,
     'تشكيل لجنة المعايير ولجنة منح الترخيص ولجنة التظلمات ولجنة حماية النزاهة مع مراعاة الفصل الوظيفي في المادة (18) · تعيين المدير التنفيذي · اعتماد أن السنة الأولى مرحلة تجريبية بنطاق طرابلس الكبرى وبتدقيق ميداني كامل لكل الملفات.'],
    ['standards','لجنة المعايير — إقرار جدول الأرضيات وشرائح الإيراد','ل م/01', dateStr(YEAR, 2, 20), 0,
     'إقرار جدول شرائح الإيراد والأرضيات المطلقة للمستويات الأربعة · إقرار سعر ساعة التطوع الموحَّد بـ18 ديناراً للسنة · تثبيت قاعدة «الأعلى من النسبة أو الأرضية» وسريانها سواء حقّقت المنشأة ربحاً أم لم تحقق.'],
    ['board','مجلس الأمناء — اعتماد جدول الرسوم والموازنة السنوية','م أ/02', dateStr(YEAR, 3, 12), 1,
     'اعتماد جدول الرسوم مع خصم 20% للمستويات الثالث والرابع والخامس وسقف مطلق 30,000 دينار للرسم السنوي · اعتماد موازنة السنة بتصنيف ثلاثي: برامجي وجمع تمويل وإدارة عامة · اعتماد منحتين تأسيسيتين غير مشروطتين في حدود المادة (28).'],
    ['licensing','لجنة منح الترخيص — الدفعة الأولى من القرارات','ل ت/01', dateStr(YEAR, 4, 9), 0,
     'منح اثني عشر ترخيصاً للشركاء المؤسسين بقرارات مسبَّبة كتابية · رفض طلب واحد لإدراج الطالب على قائمة الاستبعاد · تأكيد حظر التفاوض مع الطالب أو تعديل الوقائع الواردة في تقرير وحدة التقييم.'],
    ['licensing','لجنة منح الترخيص — اعتماد المنظمات والدفعة الثانية','ل ت/02', dateStr(YEAR, 5, 21), 0,
     'اعتماد اثنتي عشرة منظمة مجتمع مدني بلا أي رسوم في أي مرحلة · منح تراخيص الدفعة الثانية · تعليق ترخيصين لعجز في الالتزام يتجاوز 20%.'],
    ['integrity','لجنة حماية النزاهة — التقرير النصف سنوي الأول','ل ن/01', dateStr(YEAR, 6, 15), 0,
     'رصد ملاحظتين على استقلال المنظومة ورفعهما للمجلس · مراجعة التزام الأمانة بأحكام الشفافية في المادة (6) · التأكيد على أن صلاحية النشر العلني بعد تسعين يوماً جوهرية ولا يجوز تعطيلها.'],
    ['appeals','لجنة التظلمات — الجلسة الأولى','ل ظ/01', dateStr(YEAR, 7, 8), 0,
     'الفصل في تظلمين خلال المدة المقررة · تأييد قرار رفض لثبوت الاستبعاد وقبول تظلم جزئياً بتعديل المرتبة الجزائية · التأكيد على أن التظلم لا يوقف تنفيذ التعليق أو السحب إلا بقرار مسبَّب من اللجنة.'],
    ['board','مجلس الأمناء — مراجعة أداء المرحلة التجريبية','م أ/03', dateStr(YEAR, 9, 2), 1,
     'مراجعة نتائج التدقيق الميداني الكامل ونسبة الزيارات غير المعلنة · اعتماد نشر خلاصة جولات اختبار السوق في التقرير السنوي · الالتزام كتابةً بالتوسع إلى بنغازي في السنة الثانية وسبها في السنة الثالثة.'],
  ];
  for (const [body, title, no, held, isPub, decisions] of MEETINGS) {
    const mdoc = doc({ owner_kind: 'secretariat', owner_id: 0, doc_type: 'meeting_minutes',
      title: `محضر — ${title}`, issuer: { board: 'مجلس الأمناء', general_assembly: 'الجمعية العمومية',
        standards: 'لجنة المعايير', licensing: 'لجنة منح الترخيص', appeals: 'لجنة التظلمات',
        integrity: 'لجنة حماية النزاهة' }[body], refNo: no, date: held,
      uploaded_by: staff['director@sema.ly'], is_public: isPub,
      rows: [['الجهة', no], ['تاريخ الانعقاد', held], ['النصاب', 'مكتمل']],
      body: `<p><b>القرارات:</b></p><p>${decisions}</p>` });
    const attendees = body === 'board' || body === 'general_assembly' ? boardIds
      : body === 'standards' ? [staff['standards1@sema.ly'], staff['standards2@sema.ly'], staff['standards3@sema.ly']]
      : body === 'licensing' ? [staff['licensing1@sema.ly'], staff['licensing2@sema.ly'], staff['licensing3@sema.ly']]
      : body === 'appeals' ? [staff['appeals1@sema.ly'], staff['appeals2@sema.ly'], staff['appeals3@sema.ly']]
      : [staff['integrity1@sema.ly'], staff['integrity2@sema.ly'], staff['integrity3@sema.ly'], staff['integrity4@sema.ly']];
    const obs = body === 'board' ? observerIds.slice(0, between(2, 5)) : [];
    const mid = im.run(body, title, no, held, Math.ceil(attendees.length / 2) + 1, attendees.length,
      obs.length, mdoc, decisions, isPub).lastInsertRowid;
    db.prepare('UPDATE documents SET owner_id=? WHERE id=?').run(mid, mdoc);
    for (const uid of attendees) iat.run(mid, uid, null, 'عضو', 1, 1);
    for (const oid of obs) iat.run(mid, null, oid, 'مراقب — حضور ومداخلة بلا صوت', 1, 0);
  }

  // ملاحظات النزاهة
  const iin = db.prepare(`INSERT INTO integrity_notes (reference,title,body,category,raised_by,raised_at,
      board_notified_at,response_due_at,board_response,responded_at,public_disclosure,published_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  iin.run(nref('INT', 'integrity_notes'), 'تركّز حصة ممول واحد في هيكل الإيرادات',
    'بلغت حصة أكبر ممول 26% من إجمالي موارد الأمانة للسنة، وهي وإن كانت داخل حدود المادة (28) فإنها تقترب من الحد الذي يجعل استمرار التمويل ورقة تأثير. توصي اللجنة بتنويع الموارد وبنشر حصص الممولين في التقرير السنوي.',
    'independence', staff['integrity1@sema.ly'], dateStr(YEAR, 6, 15), dateStr(YEAR, 6, 15), dateStr(YEAR, 9, 13),
    'يقر المجلس بالملاحظة، ويكلّف المدير التنفيذي بخطة تنويع موارد ترفع نسبة التغطية الذاتية من الرسوم، وبنشر حصص الممولين ضمن لوحة الشفافية.',
    dateStr(YEAR, 8, 4), 0, null, 'answered');
  iin.run(nref('INT', 'integrity_notes'), 'تأخر نشر ثلاث حالات تعليق في السجل العام',
    'رصدت اللجنة تأخر نشر ثلاث حالات تعليق في السجل العام بين أحد عشر وتسعة عشر يوماً من تاريخ القرار. والأصل هو النشر (المادة 6)، وتغيير الحالة في السجل أثر مباشر للتعليق (المادة 30/1). التأخر يمسّ مصداقية السجل بوصفه مرجعاً للتحقق.',
    'transparency', staff['integrity3@sema.ly'], dateStr(YEAR, 6, 15), dateStr(YEAR, 6, 15), dateStr(YEAR, 9, 13),
    null, null, 1, dateStr(YEAR, 9, 16), 'published');
  iin.run(nref('INT', 'integrity_notes'), 'مقيّم كُلِّف بملف لجهة سبقت له معها علاقة مهنية',
    'ورد للجنة أن أحد المقيّمين أُدرج مبدئياً في توزيع ملف لجهة قدّم لها خدمة استشارية خلال السنتين السابقتين، وهو محظور صراحةً بالمادة (20/4). صُحِّح التوزيع قبل بدء التقييم بناءً على إقرار المصالح السنوي الذي أفصح فيه المقيّم عن العلاقة.',
    'conflict_of_interest', staff['integrity1@sema.ly'], dateStr(YEAR, 8, 20), dateStr(YEAR, 8, 20),
    dateStr(YEAR, 11, 18), null, null, 0, null, 'open');
}

// ---------- التصاميم والشكاوى واختبار السوق ----------
function seedMisc(licensees, associations, staff) {
  const idg = db.prepare(`INSERT INTO design_approvals (reference,licensee_id,material_type,title,logo_variant,
      shows_license_no,claim_text,file_doc_id,submitted_at,due_at,decision,decision_notes,decided_by,decided_at,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const MAT = [['packaging','عبوة 1 لتر — الوجه الأمامي'],['packaging','عبوة 0.5 لتر — خط «قارورة الخير»'],
    ['ad','إعلان صحفي نصف صفحة'],['website','صفحة «التزامنا المجتمعي»'],['social','منشور إنستغرام مربّع'],
    ['signage','لوحة واجهة الفرع الرئيسي'],['vehicle','تغليف شاحنة توزيع']];
  const active = licensees.filter((l) => l.status === 'active');
  let k = 0;
  for (const l of active.slice(0, 24)) {
    const n = between(1, 3);
    for (let j = 0; j < n; j++) {
      const [mt, title] = MAT[(k++) % MAT.length];
      const sub = dateStr(YEAR, between(3, 9), between(1, 27));
      const due = R.designDecisionDue(sub);
      const bad = rnd() < 0.22;
      const claim = bad
        ? pick([`شركة مسؤولة — نُسهم في الخير`, `الأفضل خيرياً في ليبيا`, `تُسهم هذه الشركة بـ${(l.level + 1)}% من صافي دخلها`])
        : R.allowedClaim(l.level, l.no);
      const decided = due < dateStr(YEAR, 9, 18) ? rnd() < 0.82 : rnd() < 0.4;
      const fdoc = doc({ owner_kind: 'design', owner_id: 0, doc_type: 'design_file',
        title: `نموذج (7) ملف تصميم — ${title} — ${l.trade}`, issuer: l.legal, refNo: `F7-${l.id}-${j}`,
        date: sub, uploaded_by: l.uid, verified_by: staff['comms@sema.ly'],
        rows: [['نوع المادة', { packaging:'عبوة', ad:'إعلان', website:'صفحة إلكترونية', social:'منشور تواصل',
          signage:'لوحة', vehicle:'تغليف مركبة' }[mt]], ['نسخة الشعار', mt === 'packaging' && rnd() < 0.5 ? 'مختصرة (دون الشعار اللفظي) — للعبوات والشارات تحت 40 مم' : 'كاملة بالشعار اللفظي — للمقاسات فوق 40 مم'],
          ['شريط المستوى', `${REF.LEVELS.find((x) => x.level === l.level).name} — ${REF.LEVELS.find((x) => x.level === l.level).color}`],
          ['رقم الترخيص على المادة', l.no], ['الادعاء المكتوب', claim]],
        body: bad ? '<p style="color:#A32020"><b>ملاحظة الفحص الآلي:</b> الادعاء المكتوب لا يطابق الادعاء المحدد المسموح به، ويُحظر إيراد ادعاء مطلق (المادة 19/3).</p>' : '' });
      const did = idg.run(nref('DSG', 'design_approvals'), l.id, mt, title,
        mt === 'packaging' && rnd() < 0.5 ? 'compact' : 'full', bad && rnd() < 0.4 ? 0 : 1, claim, fdoc,
        sub, due, decided ? (bad ? 'changes_required' : 'approved') : null,
        decided ? (bad ? `الادعاء المكتوب غير مطابق: الادعاء المسموح به هو المحدد فقط — «${R.allowedClaim(l.level, l.no)}». ويُحظر الادعاء المطلق وحذف رقم الترخيص (المادة 19/3 و4).`
          : 'مطابق لدليل الهوية البصرية: نسخة الشعار مناسبة للمقاس، وشريط المستوى بلونه المقرر، ورقم الترخيص ظاهر بالحد الأدنى للحجم، والادعاء محدد.') : null,
        decided ? staff['comms@sema.ly'] : null, decided ? R.addDays(sub, between(2, 9)) : null,
        decided ? 'decided' : (due < dateStr(YEAR, 9, 22) ? 'expired_implicit' : 'pending')).lastInsertRowid;
      db.prepare('UPDATE documents SET owner_id=? WHERE id=?').run(did, fdoc);
    }
  }

  const ic = db.prepare(`INSERT INTO complaints (reference,channel,is_anonymous,reporter_name,reporter_contact,
      subject_kind,subject_id,subject_name,body,filed_at,assigned_to,triggered_audit_id,status,resolution,
      closed_at,whistleblower_protected) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
  const CMP = [
    ['portal',1,'licensee',0,'رأيت شعار العلامة على عبوة مياه في متجر بطرابلس دون رقم ترخيص بجواره. الشعار مطبوع بلون أخضر مختلف عن المعتاد.','substantiated','ثبتت الواقعة من جولة اختبار السوق؛ أُنذر المرخَّص له وأُلزم بسحب الدفعة المطبوعة على نفقته.'],
    ['email',0,'licensee',0,'شركة ترفع أسعار منتجاتها الأساسية وتبرر ذلك بمساهمتها في العلامة، وهذا تمرير لكلفة الالتزام إلى المستهلك.','investigating',null],
    ['phone',1,'association',0,'منظمة معتمدة لم تقدّم تقرير أثر عن مساهمة استلمتها قبل أكثر من ستة أشهر.','substantiated','أُخطرت المنظمة وقدّمت التقرير خلال المهلة؛ أُغلق البلاغ.'],
    ['portal',0,'unlicensed',0,'منشأة غير مرخَّصة تستعمل شعاراً شديد الشبه بعلامة سِيمَا الخَيْر على أكياس التعبئة.','substantiated','وُجِّه خطاب كفٍّ وامتناع وفُتح ملف جزائي تحت المادة (29/11).'],
    ['field',1,'licensee',0,'مادة إعلانية تحمل عبارة «الأفضل خيرياً» بجوار شعار العلامة.','substantiated','رُفض التصميم وأُلزمت المنشأة بالادعاء المحدد المسموح به.'],
    ['portal',1,'secretariat',0,'أحد منتسبي وحدة التقييم استفسر عن موعد زيارة ميدانية لجهة يعرفها. أُبلغ عن الواقعة عبر القناة السرّية.','investigating',null],
    ['email',0,'licensee',0,'شكوى من مورّد بأن إحدى الشركات المرخَّصة تعلن مستوى أعلى من مستواها في السجل.','substantiated','ثبتت الواقعة؛ تعليق فوري مع إلزام بسحب المواد المطبوعة (المادة 29/6).'],
    ['portal',1,'association',0,'منظمة تتلقى مساهمات تتجاوز قدرتها التنفيذية بمراحل.','unsubstantiated','فحصت الوحدة سقف الاستيعاب فوجدته غير متجاوز؛ أُغلق البلاغ.'],
  ];
  const activeL = licensees.filter((l) => l.status === 'active');
  const accA = associations.filter((a) => a.status === 'accredited');
  CMP.forEach(([ch, anon, kind, , body, status, res], i) => {
    const subj = kind === 'licensee' ? pick(activeL) : kind === 'association' ? pick(accA) : null;
    const filed = dateStr(YEAR, between(4, 9), between(1, 27));
    ic.run(nref('CMP', 'complaints'), ch, anon, anon ? null : pick(['أ. سالم البرعصي','م. هدى العبيدي','أ. منير الشلوي']),
      anon ? null : `09${between(1, 6)}-${between(1000000, 9999999)}`,
      kind, subj ? subj.id : null, subj ? (subj.legal || subj.name) : 'منشأة غير مرخَّصة',
      body, filed, pick([staff['evaldir@sema.ly'], staff['integrity1@sema.ly']]), null, status, res,
      ['substantiated', 'unsubstantiated'].includes(status) ? R.addDays(filed, between(14, 60)) : null);
  });

  const imt = db.prepare(`INSERT INTO market_tests (round_name,city,conducted_on,outlets_visited,items_checked,
      correct_usage,missing_license_no,level_mismatch,out_of_scope,unlicensed_usage,report_doc_id,published)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const MT = [
    ['الجولة الأولى — الربع الثاني','طرابلس', dateStr(YEAR, 5, 14), 42, 186, 161, 12, 4, 6, 3],
    ['الجولة الثانية — الربع الثالث','طرابلس', dateStr(YEAR, 8, 9), 55, 241, 219, 9, 2, 8, 3],
    ['جولة استطلاعية — التوسع','مصراتة', dateStr(YEAR, 8, 26), 18, 64, 55, 5, 1, 2, 1],
  ];
  for (const m of MT) {
    const rdoc = doc({ owner_kind: 'secretariat', owner_id: 0, doc_type: 'market_test_report',
      title: `تقرير جولة اختبار سوق — ${m[0]} (${m[1]})`, issuer: 'وحدة التقييم والتحقق', refNo: `MT-${m[2]}`,
      date: m[2], uploaded_by: staff['auditor1@sema.ly'], is_public: 1, verified_by: staff['evaldir@sema.ly'],
      rows: [['المدينة', m[1]], ['نقاط البيع المزارة', m[3]], ['الأصناف المفحوصة', m[4]],
        ['استعمال صحيح', m[5]], ['بلا رقم ترخيص', m[6]], ['مستوى معلن مخالف', m[7]],
        ['خارج نطاق الترخيص', m[8]], ['استعمال من غير مرخَّص', m[9]],
        ['نسبة المطابقة', ((m[5] / m[4]) * 100).toFixed(1) + '%']],
      body: '<p>تُنشر خلاصة نتائج هذه الجولات في التقرير السنوي (المادة 28).</p>' });
    imt.run(...m, rdoc, 1);
  }
}

// ---------- الوحدات المضافة: المشاورة، الحالات المفتوحة، رموز المتابعة ----------
function seedExtensions(staff, licensees, associations) {
  const S = require('./services');
  const t = new Date().toISOString().slice(0, 10);
  const ago = (d) => R.addDays(t, -d);

  // 1) البرامج الذاتية: الموثَّقة موافَق عليها مسبقاً، وواحد بانتظار موافقة لجنة المعايير
  db.prepare("UPDATE contributions SET program_preapproved=1 WHERE channel='direct_program' AND status IN ('documented','verified')").run();
  const lDp = licensees.find((l) => l.status === 'active' && l.level >= 3);
  db.prepare(`INSERT INTO contributions (reference, licensee_id, association_id, fiscal_year, channel, amount, purpose,
      transfer_date, notified_secretariat, status) VALUES (?,?,NULL,?, 'direct_program', ?, ?, ?, 1, 'declared')`)
    .run(nref('CON', 'contributions'), lDp.id, YEAR, 14500, 'برنامج تنموي ذاتي مقترح: تأهيل ورشة تدريب مهني لثلاثين شاباً في حي الأندلس', ago(6));

  // 2) رموز متابعة البلاغات — ورمز ثابت للبلاغ الأول لأغراض العرض
  for (const c of db.prepare('SELECT id FROM complaints').all())
    db.prepare('UPDATE complaints SET tracking_code=? WHERE id=?').run(c.id === 1 ? 'SEMA2026' : crypto.randomBytes(4).toString('hex').toUpperCase(), c.id);

  // 3) طلبات في مراحل المسار كلها: نواقص، واستكمال، وتجديد، ورفع مستوى
  const open = db.prepare("SELECT * FROM applications WHERE status='submitted' AND subject_kind='licensee' ORDER BY id").all();
  if (open[0]) {
    db.prepare(`UPDATE applications SET status='deficiencies', stage=3, completeness_done_at=?, deficiencies=? WHERE id=?`)
      .run(ago(6), 'شهادة عدم المديونية الضريبية منتهية الصلاحية · لم يُرفق بيان الالتزام المجتمعي معتمداً من الإدارة العليا', open[0].id);
    db.prepare("UPDATE application_stages SET completed_at=?, note='إخطار بالنواقص' WHERE application_id=? AND stage=2").run(ago(6), open[0].id);
    db.prepare("UPDATE application_stages SET started_at=? WHERE application_id=? AND stage=3").run(ago(6), open[0].id);
  }
  if (open[1]) {
    db.prepare(`UPDATE applications SET status='completing', stage=2, completeness_done_at=?, resubmitted_at=?, deficiencies=? WHERE id=?`)
      .run(ago(12), ago(2), 'إفادة الضمان الاجتماعي غير محدَّثة', open[1].id);
  }
  const orgOpen = db.prepare("SELECT * FROM applications WHERE status='submitted' AND subject_kind='association' ORDER BY id").get();
  if (orgOpen) db.prepare("UPDATE applications SET status='assessment', stage=4, completeness_done_at=?, assessment_due_at=? WHERE id=?")
    .run(ago(9), R.addWorkDays(ago(9), 20), orgOpen.id);
  // ترخيص يقترب انتهاؤه وقد قُدِّم تجديده، وآخر يقترب انتهاؤه بلا تجديد (يولّد تذكيراً)
  const act = licensees.filter((l) => l.status === 'active');
  const renew = act[3], expiring = act[4], upgrade = act[5];
  db.prepare('UPDATE licensees SET start_date=?, end_date=? WHERE id=?').run(ago(340), R.addDays(t, 25), renew.id);
  db.prepare('UPDATE licensees SET start_date=?, end_date=? WHERE id=?').run(ago(320), R.addDays(t, 45), expiring.id);
  const ren = S.createApplication({ app_type: 'license_renewal', subject_kind: 'licensee', subject_id: renew.id, applicant_user_id: renew.uid });
  db.prepare('UPDATE applications SET submitted_at=?, completeness_due_at=?, sla_due_at=? WHERE id=?')
    .run(ago(8) + ' 10:00:00', R.addWorkDays(ago(8), 10), R.addWorkDays(ago(8), 90), ren.id);
  if (upgrade.level < 4) {
    const up = S.createApplication({ app_type: 'level_upgrade', subject_kind: 'licensee', subject_id: upgrade.id,
      applicant_user_id: upgrade.uid, requested_level: upgrade.level + 1 });
    const audit = db.prepare(`INSERT INTO audits (reference, subject_kind, subject_id, fiscal_year, audit_type, trigger, executed_date,
        assessor_id, status, facts_summary) VALUES (?,?,?,?, 'desk','renewal',?,?, 'facts_reported', ?)`).run(nref('AUD', 'audits'),
      'licensee', upgrade.id, YEAR, ago(3), staff['assessor1@sema.ly'],
      'راجعت الوحدة القوائم المالية وخطة المساهمات للسنة الجارية؛ الالتزام المقدَّر بالمستوى المطلوب موثَّق بخطة تحويلات لثلاث منظمات معتمدة، ولا مخالفة سابقة على الملف.').lastInsertRowid;
    db.prepare(`UPDATE applications SET status='decision_pending', stage=7, facts_report_id=?, submitted_at=?, completeness_done_at=?, assessment_done_at=? WHERE id=?`)
      .run(audit, ago(20) + ' 09:00:00', ago(17), ago(3), up.id);
    db.prepare("UPDATE application_stages SET started_at=?, completed_at=?, note='منفَّذ' WHERE application_id=? AND stage BETWEEN 2 AND 6").run(ago(18), ago(3), up.id);
    db.prepare("UPDATE application_stages SET started_at=? WHERE application_id=? AND stage=7").run(ago(3), up.id);
  }

  // 4) إقرارات في كل مرحلة: بانتظار الوقائع، وبانتظار القرار، ومقضيّ فيها
  const decl = db.prepare(`SELECT cd.* FROM compliance_declarations cd JOIN licensees l ON l.id=cd.licensee_id
      WHERE cd.fiscal_year=? AND cd.submitted_at IS NOT NULL AND l.status='active' ORDER BY cd.id`).all(YEAR - 1);
  decl.forEach((d, i) => {
    if (i < 3) db.prepare(`UPDATE compliance_declarations SET status='submitted', processed_by=NULL, processed_at=NULL, outcome=NULL,
        facts_note=NULL, decided_by=NULL, decided_at=NULL WHERE id=?`).run(d.id);
    else if (i < 5) db.prepare(`UPDATE compliance_declarations SET status='accepted', facts_note=?, outcome=NULL, decided_by=NULL, decided_at=NULL WHERE id=?`)
      .run('طوبق الإقرار الضريبي مع القوائم المالية المدققة؛ وطوبقت إيصالات التحويل مع إقرارات الاستلام من المنظمات المتلقية. الالتزام موثَّق.', d.id);
    else db.prepare(`UPDATE compliance_declarations SET facts_note=COALESCE(facts_note,?), decided_by=?, decided_at=COALESCE(decided_at, processed_at) WHERE id=?`)
      .run('وقائع التدقيق المكتبي مطابقة لما في الإقرار.', staff['licensing1@sema.ly'], d.id);
  });

  // 5) مقترحات التعديل والمشاورة العامة (المادة 19/3)
  const P = db.prepare(`INSERT INTO standards_proposals (reference, title, summary, body, article_ref, kind, is_material, proposed_by,
      status, consultation_start, consultation_end, response_summary, board_decision, board_decision_reason, board_decided_by,
      board_decided_at, effective_from, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const C = db.prepare(`INSERT INTO consultation_comments (proposal_id, author_name, author_kind, organization, body, submitted_at,
      response, responded_by, responded_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  const st1 = staff['standards1@sema.ly'], st2 = staff['standards2@sema.ly'], chair = staff['chair@sema.ly'];
  const p1 = P.run('STD-00001', 'تحديد سعر ساعة التطوع الموحَّد للسنة المالية 2026', 'تفسير ملزم لطريقة احتساب وقت تطوع الموظفين ضمن الالتزام.',
    'تُحتسب ساعة التطوع بثمانية عشر ديناراً ليبياً للسنة المالية 2026، على أن يُعتمد سجل الساعات من المسؤول المباشر ويُطابَق مع كشوف الحضور، ولا يتجاوز مجموع ما يُحتسب من التطوع 10% من إجمالي الالتزام (المادة 20).',
    'لائحة الاعتماد — المادة 20', 'interpretation', 0, st1, 'approved', null, null, null, 'approved',
    'تفسير لا يغيّر المعيار ويحقق التوحيد بين المرخَّص لهم؛ يُعتمد ويُنشر في السجل.', chair, R.addDays(`${YEAR}-02-20`, 0), `${YEAR}-03-01`, `${YEAR}-02-10`).lastInsertRowid;
  void p1;
  const p2 = P.run('STD-00002', 'تخفيض أرضية المستوى الأول للحرفيين والفنانين في الشريحة (أ)',
    'خفض أرضية المستوى الأول من 500 إلى 300 دينار للحرفيين والفنانين والمبدعين دون غيرهم.',
    'أظهرت السنة التجريبية أن أرضية 500 دينار تعادل عند بعض الحرفيين أكثر من 3% من صافي دخلهم، أي ثلاثة أضعاف نسبة المستوى الأول. يُقترح خفض أرضية المستوى الأول في الشريحة (أ) إلى 300 دينار لفئة الحرفيين والفنانين والمبدعين، مع بقاء النسبة 1% والقاعدة «الأعلى من الاثنين» كما هي.',
    'لائحة الاعتماد — المادة 5', 'floors', 1, st2, 'submitted_to_board', ago(110), ago(80),
    'وردت أربع مداخلات: ثلاث مؤيدة من اتحاد الحرفيين ومنظمتين معتمدتين، وواحدة تحفّظت على أثر الخفض في إيراد الرسوم. ردّت اللجنة بأن الرسوم لا تتأثر لأنها لا تُحتسب من الالتزام، وأن فئة الحرفيين لا تتجاوز 12% من المرخَّص لهم.',
    null, null, null, null, null, ago(120)).lastInsertRowid;
  C.run(p2, 'م. فوزي بن حامد', 'expert', 'اتحاد الحرفيين', 'نؤيد الخفض؛ فأغلب الحرفيين في طرابلس لا يتجاوز صافي دخلهم أربعين ألف دينار، والأرضية الحالية تعادل عندهم 1.25% فأكثر.', ago(105), 'شكراً — المقترح يستهدف هذه الفئة تحديداً دون المنشآت التجارية في الشريحة ذاتها.', st2, ago(90));
  C.run(p2, 'جمعية نور المعرفة لمحو الأمية', 'association', 'منظمة معتمدة', 'نؤيد، ونقترح ربط الخفض بعدد سنوات الترخيص حتى لا يصبح دائماً.', ago(100), 'اللجنة تراجع كل الأرضيات سنوياً وجوباً (المادة 5)، فلا حاجة لربطه بمدة.', st2, ago(88));
  C.run(p2, 'أ. منير الشلوي', 'public', null, 'أخشى أن يقلّ إيراد الرسوم فتضعف قدرة الأمانة على التدقيق.', ago(95), 'الرسوم منفصلة عن الالتزام ولا تتأثر بالأرضية (المادة 34/6).', st2, ago(86));
  C.run(p2, 'مشغل يد الخير للتطريز', 'licensee', 'مرخَّص له', 'نؤيد بقوة — هذا سيشجع حرفيين آخرين على الانضمام.', ago(85), 'شكراً على المداخلة.', st2, ago(84));
  const p3 = P.run('STD-00003', 'إضافة معيار سادس عشر للاعتماد: حماية بيانات المستفيدين',
    'اشتراط سياسة مكتوبة لحماية بيانات المستفيدين الشخصية لدى المنظمات المعتمدة.',
    'يُضاف إلى معايير الاعتماد في المادة (13) معيار سادس عشر: «سياسة مكتوبة لحماية البيانات الشخصية للمستفيدين، تحدد ما يُجمع ولماذا ومن يطلع عليه ومدة الحفظ، مع تعيين مسؤول عنها». ويُمهل المعتمدون حالياً ستة أشهر لاستيفائه.',
    'لائحة الاعتماد — المادة 13', 'standard', 1, st1, 'consultation', ago(18), R.addDays(t, 12), null, null, null, null, null, null, ago(25)).lastInsertRowid;
  C.run(p3, 'جمعية الهلال الأحمر الليبي — فرع طرابلس', 'association', 'منظمة معتمدة', 'نؤيد المعيار، ونطلب نموذج سياسة استرشادي تصدره الأمانة حتى لا تتفاوت المنظمات الصغيرة في فهمه.', ago(15), 'ستصدر اللجنة نموذجاً استرشادياً مع اعتماد المعيار.', st1, ago(10));
  C.run(p3, 'د. هالة الدرناوي', 'expert', 'جامعة بنغازي', 'مهلة ستة أشهر كافية للمنظمات الكبيرة لكنها قصيرة للصغيرة؛ أقترح تسعة أشهر للمنظمات دون 250 ألف دينار.', ago(9), null, null, null);
  C.run(p3, 'أ. سالمة بن طاهر', 'association', 'شبكة المنظمات الأهلية الليبية', 'ينبغي أن يشمل المعيار حذف البيانات بعد انتهاء البرنامج بمدة محددة.', ago(4), null, null, null);
  const p4 = P.run('STD-00004', 'إلزام المستوى الثالث فأعلى بإرفاق تقرير أثر ربع سنوي',
    'رفع وتيرة تقارير الأثر للمساهمات الكبيرة من سنوية إلى ربع سنوية.',
    'يُقترح أن تقدّم المنظمات المتلقية تقرير أثر ربع سنوي عن كل مساهمة تتجاوز خمسين ألف دينار من مرخَّص له في المستوى الثالث فأعلى، بدلاً من التقرير الواحد في المادة (23/3).',
    'لائحة الاعتماد — المادة 23', 'standard', 1, st1, 'consultation', ago(44), ago(14), null, null, null, null, null, null, ago(50)).lastInsertRowid;
  C.run(p4, 'مؤسسة نماء للتنمية المجتمعية', 'association', 'منظمة معتمدة', 'العبء الإداري كبير؛ نقترح نصف سنوي بدل ربع سنوي حتى لا ترتفع النسبة الإدارية.', ago(30), 'وجيه — ستعدّل اللجنة الوتيرة إلى نصف سنوية في الصيغة المرفوعة.', st1, ago(20));
  C.run(p4, 'شركة الواحة للصناعات الغذائية', 'licensee', 'مرخَّص له', 'نؤيد؛ التقارير الأكثر تواتراً تفيدنا في الاتصال مع المستهلكين.', ago(26), 'شكراً على المداخلة.', st1, ago(20));
  P.run('STD-00005', 'تعديل النظام الداخلي: رفع سقف المراقبين إلى سبعة في الدورة',
    'رفع سقف المراقبين المقبولين من خمسة إلى سبعة مع بقاء سقف القطاع مراقبَين.',
    'يُعدَّل البند (3) من المادة (34) ليصبح: «لا يجوز أن يزيد عدد المراقبين المقبولين في الدورة الواحدة على سبعة، ولا أن يمثّل قطاعٌ واحدٌ أكثر من مراقبَين». ويُعرض على الجمعية العمومية بأغلبية الثلثين (المادة 35).',
    'النظام الداخلي — المادة 34', 'bylaws', 1, st1, 'submitted_to_board', ago(75), ago(40),
    'وردت مداخلتان: غرفة التجارة أيّدت لاتساع قاعدة أصحاب المصلحة، وشبكة المنظمات تحفّظت على كلفة إدارة سبعة مراقبين. ردّت اللجنة بأن المراقب يتحمل مصاريفه (المادة 34/5)، وأُبقي سقف القطاع مراقبَين.',
    null, null, null, null, null, ago(80)).lastInsertRowid;
  const p5 = db.prepare("SELECT id FROM standards_proposals WHERE reference='STD-00005'").get().id;
  C.run(p5, 'غرفة التجارة والصناعة — طرابلس', 'expert', null, 'نؤيد رفع السقف لاتساع قاعدة أصحاب المصلحة في المرحلة الوطنية.', ago(70), 'شكراً — أُبقي سقف القطاع مراقبَين لمنع هيمنة قطاع واحد.', st1, ago(45));
  C.run(p5, 'شبكة المنظمات الأهلية الليبية', 'association', null, 'نتحفّظ على كلفة إدارة سبعة مراقبين على الأمانة.', ago(60), 'المراقب يتحمل مصاريف مشاركته (المادة 34/5)، فلا كلفة إضافية على الأمانة.', st1, ago(45));
  P.run('STD-00006', 'تفسير ملزم: احتساب التبرع العيني المقدَّم خدماتٍ مهنية',
    'كيف تُقيَّم الخدمات المهنية المتبرَّع بها ضمن سقف التبرع العيني.',
    'تُقيَّم الخدمة المهنية المتبرَّع بها بأجر السوق المماثل موثَّقاً من طرف ثالث مستقل، وتدخل ضمن سقف 25% للتبرع العيني (المادة 20)، ولا تُحتسب ساعات موظفي المنشأة المتبرِّعة هنا بل في وقت التطوع.',
    'لائحة الاعتماد — المادة 20', 'interpretation', 0, st2, 'draft', null, null, null, null, null, null, null, null, ago(2));

  // 6) مستندات منشورة للعموم: شهادة السجل والنظام الأساسي والتقارير متاحة بلا دخول (المعيار 14)
  db.prepare("UPDATE documents SET is_public=1 WHERE doc_type IN ('bylaws','annual_report','financials_3y','salary_disclosure','impact_report') AND confidential=0").run();
}

// ---------- المؤشرات الفعلية للسنة الأولى ----------
function seedActuals() {
  const set = (code, y, v) => db.prepare(`INSERT INTO kpi_values (kpi_code,year_no,kind,value) VALUES (?,?,'actual',?)
    ON CONFLICT(kpi_code,year_no,kind) DO UPDATE SET value=excluded.value`).run(code, y, v);
  const lic = db.prepare("SELECT COUNT(*) n FROM licensees WHERE status='active'").get().n;
  const org = db.prepare("SELECT COUNT(*) n FROM associations WHERE status='accredited'").get().n;
  const paid = db.prepare('SELECT COALESCE(SUM(total_paid),0) s FROM commitments').get().s;
  const fees = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE status='paid'").get().s;
  const spend = db.prepare('SELECT COALESCE(SUM(COALESCE(actual,budgeted)),0) s FROM secretariat_budget WHERE fiscal_year=?').get(YEAR).s;
  const audited = db.prepare("SELECT COUNT(DISTINCT subject_id) n FROM audits WHERE subject_kind='licensee' AND audit_type IN ('field','unannounced') AND executed_date IS NOT NULL").get().n;
  set('licensees', 1, lic);
  set('associations', 1, org);
  set('directed', 1, Math.round((paid / 1000000) * 100) / 100);
  set('fee_revenue', 1, Math.round(fees / 1000));
  set('self_coverage', 1, spend ? Math.round((fees / spend) * 1000) / 10 : 0);
  set('withdrawals', 1, db.prepare("SELECT COUNT(*) n FROM sanctions WHERE measure='withdrawal' AND published=1").get().n);
  set('field_audited', 1, lic ? Math.round((audited / lic) * 1000) / 10 : 0);
  set('per_dinar', 1, fees ? Math.round((paid / fees) * 10) / 10 : 0);
  set('aided_aware', 1, 23);       // من الاستطلاع السنوي بعيّنة 1,240 مستجيباً
  set('unaided_recall', 1, 4);
  set('trust', 1, 58);
  set('purchase', 1, 9);
  set('followers', 1, 31);
  set('registry_hits', 1, 640);
  set('towns', 1, 1);
  set('schools', 1, 0);
}

function report() {
  const t = (q) => db.prepare(q).get().n;
  console.log('\n======== ملخص البيانات التصويرية ========');
  const rows = [
    ['المستخدمون', 'SELECT COUNT(*) n FROM users'],
    ['تعيينات الأدوار', 'SELECT COUNT(*) n FROM user_roles'],
    ['المرخَّص لهم', 'SELECT COUNT(*) n FROM licensees'],
    ['  منهم ساري', "SELECT COUNT(*) n FROM licensees WHERE status='active'"],
    ['المنظمات', 'SELECT COUNT(*) n FROM associations'],
    ['  منها معتمد', "SELECT COUNT(*) n FROM associations WHERE status='accredited'"],
    ['الطلبات', 'SELECT COUNT(*) n FROM applications'],
    ['مراحل الطلبات', 'SELECT COUNT(*) n FROM application_stages'],
    ['الإثباتات المحمَّلة', 'SELECT COUNT(*) n FROM documents'],
    ['تقييمات المعايير', 'SELECT COUNT(*) n FROM criteria_assessments'],
    ['ملفات الالتزام', 'SELECT COUNT(*) n FROM commitments'],
    ['المساهمات', 'SELECT COUNT(*) n FROM contributions'],
    ['إقرارات الامتثال', 'SELECT COUNT(*) n FROM compliance_declarations'],
    ['عمليات التدقيق', 'SELECT COUNT(*) n FROM audits'],
    ['  زيارات غير معلنة', "SELECT COUNT(*) n FROM audits WHERE audit_type='unannounced'"],
    ['وقائع التدقيق', 'SELECT COUNT(*) n FROM audit_findings'],
    ['الجزاءات', 'SELECT COUNT(*) n FROM sanctions'],
    ['التظلمات', 'SELECT COUNT(*) n FROM appeals'],
    ['المراقبون', 'SELECT COUNT(*) n FROM observers'],
    ['الاجتماعات', 'SELECT COUNT(*) n FROM meetings'],
    ['ملاحظات النزاهة', 'SELECT COUNT(*) n FROM integrity_notes'],
    ['الشكاوى', 'SELECT COUNT(*) n FROM complaints'],
    ['طلبات الموافقة على التصاميم', 'SELECT COUNT(*) n FROM design_approvals'],
    ['الفواتير', 'SELECT COUNT(*) n FROM invoices'],
    ['جولات اختبار السوق', 'SELECT COUNT(*) n FROM market_tests'],
    ['قيم المؤشرات', 'SELECT COUNT(*) n FROM kpi_values'],
    ['مقترحات التعديل', 'SELECT COUNT(*) n FROM standards_proposals'],
    ['مداخلات المشاورة', 'SELECT COUNT(*) n FROM consultation_comments'],
    ['تشغيلات المهام الآلية', 'SELECT COUNT(*) n FROM job_runs'],
  ];
  for (const [label, q] of rows) console.log(String(label).padEnd(30, '.') + ' ' + t(q));
  const money = db.prepare('SELECT COALESCE(SUM(commitment_due),0) d, COALESCE(SUM(total_paid),0) p FROM commitments').get();
  const fees = db.prepare("SELECT COALESCE(SUM(amount),0) s FROM invoices WHERE status='paid'").get().s;
  console.log('\nإجمالي الالتزام الواجب  : ' + fmt(money.d) + ' د.ل');
  console.log('الموثَّق والمتحقَّق منه   : ' + fmt(money.p) + ' د.ل');
  console.log('رسوم محصَّلة             : ' + fmt(fees) + ' د.ل');
  console.log('الموجَّه لكل دينار رسوم  : ' + (fees ? (money.p / fees).toFixed(1) : '—'));
  console.log('\nكلمة المرور لكل الحسابات التصويرية: Sema@2026');
}

if (require.main === module) run();
module.exports = { run };
