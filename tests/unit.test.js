'use strict';
/**
 * اختبارات وحدة لمحرّك القواعد server/rules.js — بلا خادم ولا قاعدة بيانات.
 * التشغيل: node tests/unit.test.js   (أو node tests/run.js --only=unit)
 */
const assert = require('node:assert/strict');
const R = require('../server/rules');

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  →  ' + String(e.message).split('\n')[0].slice(0, 220)); }
}
const section = (t) => console.log('\n=== ' + t + ' ===');

// ---------------------------------------------------------------
section('tierFor — حدود الشرائح (المادة 5)');
for (const [rev, code] of [
  [0, 'أ'], [249999, 'أ'], [250000, 'ب'], [999999, 'ب'], [1000000, 'ج'], [4999999, 'ج'],
  [5000000, 'د'], [24999999, 'د'], [25000000, 'هـ'], [99999999, 'هـ'], [100000000, 'و'], [5e9, 'و'],
]) T(`${rev.toLocaleString('en')} ← الشريحة ${code}`, () => assert.equal(R.tierFor(rev).code, code));
T('قيمة غير رقمية تُعامل صفراً ← أ', () => assert.equal(R.tierFor('abc').code, 'أ'));
T('إيراد سالب يرجع إلى الشريحة الأولى', () => assert.equal(R.tierFor(-5).code, 'أ'));
T('الإيراد نصاً رقمياً يُقبل', () => assert.equal(R.tierFor('250000').code, 'ب'));

// ---------------------------------------------------------------
section('computeCommitment — أمثلة ملحق (1) الستة');
for (const [rev, np, lv, due, basis, label] of [
  [400000, 60000, 1, 1500, 'floor', 'مقهى صغير'],
  [180000, 35000, 2, 1000, 'floor', 'ورشة حرفية'],
  [4000000, 320000, 1, 6000, 'floor', 'شركة توزيع'],
  [3500000, 900000, 2, 18000, 'percent', 'شركة خدمات'],
  [18000000, 2400000, 3, 125000, 'floor', 'مصنع أغذية'],
  [220000000, 30000000, 1, 300000, 'percent', 'شركة اتصالات'],
]) {
  T(`${label}: ${rev.toLocaleString('en')}/${np.toLocaleString('en')}/م${lv} = ${due.toLocaleString('en')} (${basis})`, () => {
    const c = R.computeCommitment({ revenue: rev, netProfit: np, level: lv });
    assert.equal(c.commitment_due, due);
    assert.equal(c.basis, basis);
    assert.equal(c.commitment_due, Math.max(c.pct_amount, c.floor_amount));
  });
}
T('الشريحة و: الأرضية نسبة من الإيراد (0.10% للمستوى 1)', () => {
  const c = R.computeCommitment({ revenue: 220000000, netProfit: 30000000, level: 1 });
  assert.equal(c.floor_amount, 220000);
  assert.equal(c.pct_amount, 300000);
});
T('منشأة خاسرة (ربح سالب): النسبة صفر والأرضية تسري', () => {
  const c = R.computeCommitment({ revenue: 400000, netProfit: -50000, level: 2 });
  assert.equal(c.pct_amount, 0);
  assert.equal(c.floor_amount, 3000);
  assert.equal(c.commitment_due, 3000);
  assert.equal(c.basis, 'floor');
});
T('ربح صفري: الأرضية تسري', () => {
  assert.equal(R.computeCommitment({ revenue: 100000, netProfit: 0, level: 1 }).commitment_due, 500);
});
T('المستوى 5 دون أرضية المستوى 3: يُرفع إلى الأرضية مع تنبيه المادة 7/3', () => {
  const c = R.computeCommitment({ revenue: 18000000, netProfit: 2400000, level: 5, scopeNetProfit: 100000 });
  assert.equal(c.level, 5);
  assert.equal(c.floor_amount, 125000);
  assert.equal(c.commitment_due, 125000);
  assert.ok(c.level5_floor_check && /المادة 7\/3/.test(c.level5_floor_check), 'رسالة التنبيه غائبة');
});
T('المستوى 5 فوق أرضية المستوى 3: 100% من ربح النطاق بلا تنبيه', () => {
  const c = R.computeCommitment({ revenue: 18000000, netProfit: 2400000, level: 5, scopeNetProfit: 200000 });
  assert.equal(c.commitment_due, 200000);
  assert.equal(c.basis, 'percent');
  assert.equal(c.level5_floor_check, null);
});
T('المستوى 5 بلا ربح نطاق مستقل يستعمل صافي الربح', () => {
  const c = R.computeCommitment({ revenue: 4000000, netProfit: 50000, level: 5 });
  assert.equal(c.pct_amount, 50000);
  assert.equal(c.commitment_due, 50000); // أرضية م3 في ج = 30,000
});
T('المستويات 1–4 لا تحمل تنبيه المستوى الخامس', () => {
  for (const lv of [1, 2, 3, 4]) assert.equal(R.computeCommitment({ revenue: 1e6, netProfit: 0, level: lv }).level5_floor_check, null);
});

// ---------------------------------------------------------------
section('computeFees — الرسوم (المادتان 33 و34)');
T('خصم 20% للمستوى 3 فأعلى (ج: 2000 ← 1600)', () => {
  assert.equal(R.computeFees({ revenue: 2e6, level: 2 }).annual_fee, 2000);
  const f = R.computeFees({ revenue: 2e6, level: 3 });
  assert.equal(f.annual_fee, 1600);
  assert.ok(f.discounts.some((d) => /20%/.test(d)));
  assert.equal(R.computeFees({ revenue: 2e6, level: 5 }).annual_fee, 1600);
});
T('لا خصم 20% للمستويين 1 و2', () => {
  assert.ok(!R.computeFees({ revenue: 2e6, level: 2 }).discounts.some((d) => /20%/.test(d)));
});
T('الشريحة و المستوى 1: الرسم السنوي لا يتجاوز سقف 30,000', () => {
  const f = R.computeFees({ revenue: 5e8, level: 1 });
  assert.equal(f.annual_fee, 30000);
  assert.equal(f.cap, 30000);
  assert.ok(f.annual_fee <= f.cap);
});
T('رسم الطلب غير مسترد', () => assert.equal(R.computeFees({ revenue: 1e5, level: 1 }).application_fee_refundable, false));
T('خصم التجربة 50% للشريحة أ (رسم الطلب والسنوي)', () => {
  const f = R.computeFees({ revenue: 100000, level: 1, pilotDiscount: true });
  assert.equal(f.application_fee, 50);
  assert.equal(f.annual_fee, 150);
  assert.ok(f.discounts.some((d) => /50%/.test(d)));
});
T('خصم التجربة 50% للشريحة ب', () => {
  const f = R.computeFees({ revenue: 500000, level: 2, pilotDiscount: true });
  assert.equal(f.application_fee, 125);
  assert.equal(f.annual_fee, 375);
});
T('لا خصم تجربة للشريحة ج فما فوق', () => {
  const f = R.computeFees({ revenue: 2e6, level: 1, pilotDiscount: true });
  assert.equal(f.application_fee, 500);
  assert.equal(f.annual_fee, 2000);
});
T('التناسب في السنة الأولى: 6 أشهر من 750 = 375', () => {
  assert.equal(R.computeFees({ revenue: 500000, level: 1, firstYearRemainingMonths: 6 }).annual_fee_prorated, 375);
});
T('التناسب محصور بين 0 و12 شهراً', () => {
  assert.equal(R.computeFees({ revenue: 500000, level: 1, firstYearRemainingMonths: 15 }).annual_fee_prorated, 750);
  assert.equal(R.computeFees({ revenue: 500000, level: 1, firstYearRemainingMonths: -2 }).annual_fee_prorated, 0);
});
T('بلا أشهر متبقية: annual_fee_prorated = null', () => {
  assert.equal(R.computeFees({ revenue: 500000, level: 1 }).annual_fee_prorated, null);
});

// ---------------------------------------------------------------
section('fieldAuditRate — نسب التدقيق الميداني (المادة 25)');
for (const [args, rate, label] of [
  [{ level: 1, tierCode: 'أ', pilotYear: true }, 1.0, 'السنة التجريبية 100%'],
  [{ level: 1, tierCode: 'أ', hasComplaint: true }, 1.0, 'ملف عليه بلاغ 100%'],
  [{ level: 1, tierCode: 'هـ' }, 1.0, 'الشريحة هـ 100%'],
  [{ level: 1, tierCode: 'و' }, 1.0, 'الشريحة و 100%'],
  [{ level: 4, tierCode: 'أ' }, 1.0, 'المستوى 4 100%'],
  [{ level: 5, tierCode: 'ب' }, 1.0, 'المستوى 5 100%'],
  [{ level: 3, tierCode: 'أ' }, 0.35, 'المستوى 3 35%'],
  [{ level: 1, tierCode: 'د' }, 0.35, 'المستويان 1–2 في الشريحة د 35%'],
  [{ level: 2, tierCode: 'د' }, 0.35, 'المستوى 2 في الشريحة د 35%'],
  [{ level: 1, tierCode: 'أ' }, 0.20, 'المستوى 1 في أ 20%'],
  [{ level: 2, tierCode: 'ج' }, 0.20, 'المستوى 2 في ج 20%'],
]) T(label, () => { const r = R.fieldAuditRate(args); assert.equal(r.rate, rate); assert.ok(r.reason); });

// ---------------------------------------------------------------
section('validateMix — قاعدة النصف النقدي وسقوف المسارات (المادتان 20 و21)');
T('لا مساهمات ← غير صالح', () => { const m = R.validateMix({}); assert.equal(m.valid, false); assert.equal(m.total, 0); });
T('النقدي أقل من 50% ← خطأ النصف النقدي وحده', () => {
  const m = R.validateMix({ cash: 40, inkind: 20, volunteer: 10, direct_program: 30 });
  assert.equal(m.valid, false);
  assert.equal(m.errors.length, 1);
  assert.match(m.errors[0], /النصف النقدي/);
});
T('العيني أكثر من 25% ← خطأ', () => {
  const m = R.validateMix({ cash: 60, inkind: 30, volunteer: 10 });
  assert.equal(m.valid, false); assert.equal(m.errors.length, 1); assert.match(m.errors[0], /العيني/);
});
T('التطوع أكثر من 10% ← خطأ', () => {
  const m = R.validateMix({ cash: 80, volunteer: 20 });
  assert.equal(m.valid, false); assert.equal(m.errors.length, 1); assert.match(m.errors[0], /التطوع/);
});
T('البرامج الذاتية أكثر من 40% ← خطأ', () => {
  const m = R.validateMix({ cash: 55, direct_program: 45 });
  assert.equal(m.valid, false); assert.equal(m.errors.length, 1); assert.match(m.errors[0], /40%/);
});
T('مزيج صالح (60/20/10/10)', () => {
  const m = R.validateMix({ cash: 60, inkind: 20, volunteer: 10, direct_program: 10 });
  assert.equal(m.valid, true); assert.deepEqual(m.errors, []); assert.equal(m.total, 100); assert.equal(m.cash_share, 0.6);
});
T('الحدود بالضبط صالحة (نقدي 50%، عيني 25%، تطوع 10%)', () => {
  assert.equal(R.validateMix({ cash: 50, inkind: 25, volunteer: 10, direct_program: 15 }).valid, true);
});
T('نقدي 100% صالح', () => assert.equal(R.validateMix({ cash: 1000 }).valid, true));

// ---------------------------------------------------------------
section('concentrationCheck — سقف 60% للمنظمة الواحدة (المادة 22)');
T('لا يسري إذا لم يتجاوز الالتزام 100,000', () => {
  const c = R.concentrationCheck(100000, { 'أ': 100000 });
  assert.equal(c.applies, false); assert.deepEqual(c.breaches, []);
});
T('يسري فوق 100,000 ويرصد تجاوز 60%', () => {
  const c = R.concentrationCheck(100001, { 'منظمة أ': 70000, 'منظمة ب': 30001 });
  assert.equal(c.applies, true); assert.equal(c.breaches.length, 1);
  assert.equal(c.breaches[0].association, 'منظمة أ');
  assert.match(c.breaches[0].message, /60%/);
});
T('60% بالضبط لا يُعدّ تجاوزاً', () => {
  assert.equal(R.concentrationCheck(200000, { 'أ': 120000, 'ب': 80000 }).breaches.length, 0);
});
T('أكثر من 60% بقليل يُرصد', () => {
  assert.equal(R.concentrationCheck(200000, { 'أ': 120001 }).breaches.length, 1);
});

// ---------------------------------------------------------------
section('deficitAssessment — تكييف العجز (المادة 29)');
T('مستوفى تماماً', () => { const d = R.deficitAssessment(1000, 1000); assert.equal(d.status, 'fulfilled'); assert.equal(d.deficit, 0); });
T('زيادة على المستحق ← مستوفى', () => assert.equal(R.deficitAssessment(1000, 1500).status, 'fulfilled'));
T('تسامح التدوير دينار واحد ← مستوفى', () => {
  const d = R.deficitAssessment(1000, 999); assert.equal(d.status, 'fulfilled'); assert.equal(d.deficit, 0);
});
T('عجز 1.5 دينار يتجاوز التسامح ← عجز أقل من 20%', () => {
  const d = R.deficitAssessment(1000, 998.5);
  assert.equal(d.status, 'deficient'); assert.equal(d.deficit, 1.5); assert.equal(d.violation, 3); assert.equal(d.measure, 'grace_period');
});
T('عجز 19.99% ← إمهال (المخالفة 3)', () => {
  const d = R.deficitAssessment(10000, 8001);
  assert.equal(d.status, 'deficient'); assert.equal(d.violation, 3); assert.equal(d.deficit_pct, 0.1999);
});
// المادة 29/4 تعاقب العجز الذي «يتجاوز» 20% — والمساوي لها لا يتجاوزها فيُعامَل بالبند الأخف (29/3)
T('عجز 20% بالضبط ← إمهال وخفض المستوى (المخالفة 3)', () => {
  const d = R.deficitAssessment(1000, 800);
  assert.equal(d.status, 'deficient'); assert.equal(d.violation, 3); assert.equal(d.measure, 'grace_period'); assert.equal(d.deficit_pct, 0.2);
});
T('عجز يتجاوز 20% ولو قليلاً ← تعليق (المخالفة 4)', () => {
  const d = R.deficitAssessment(1000, 799);
  assert.equal(d.status, 'breach'); assert.equal(d.violation, 4); assert.equal(d.measure, 'suspension');
});
T('لا سداد إطلاقاً ← تعليق', () => assert.equal(R.deficitAssessment(5000, 0).status, 'breach'));
T('مستحق صفري ← مستوفى', () => assert.equal(R.deficitAssessment(0, 0).status, 'fulfilled'));

// ---------------------------------------------------------------
section('classifyAdminRatio — التصنيف الإداري (المادة 15)');
for (const [r, code, accredit] of [
  [0, 'low', true], [0.0999, 'low', true], [0.10, 'suitable', true], [0.1799, 'suitable', true],
  [0.18, 'acceptable', true], [0.2499, 'acceptable', true], [0.25, 'rejected', false], [0.6, 'rejected', false],
]) T(`${r} ← ${code}`, () => { const c = R.classifyAdminRatio(r); assert.equal(c.code, code); assert.equal(c.accredit, accredit); });
T('ما دون 5% يحمل تنبيه الفحص الإضافي', () => assert.ok(R.classifyAdminRatio(0.049).flag));
T('5% بالضبط بلا تنبيه', () => assert.equal(R.classifyAdminRatio(0.05).flag, null));
T('12% بلا تنبيه', () => assert.equal(R.classifyAdminRatio(0.12).flag, null));

// ---------------------------------------------------------------
section('absorptionCheck — سقف الاستيعاب 200% (المعيار 10)');
T('ضمن السقف', () => {
  const a = R.absorptionCheck(100000, 150000);
  assert.equal(a.cap, 200000); assert.equal(a.remaining, 50000); assert.equal(a.utilization, 0.75);
  assert.equal(a.breached, false); assert.equal(a.message, null);
});
T('عند السقف بالضبط غير متجاوز', () => assert.equal(R.absorptionCheck(100000, 200000).breached, false));
T('فوق السقف متجاوز مع رسالة', () => {
  const a = R.absorptionCheck(100000, 200001);
  assert.equal(a.breached, true); assert.equal(a.remaining, 0); assert.ok(a.message);
});
T('بلا ميزانية: السقف صفر والاستعمال null', () => {
  const a = R.absorptionCheck(0, 0); assert.equal(a.cap, 0); assert.equal(a.utilization, null); assert.equal(a.breached, false);
});

// ---------------------------------------------------------------
section('auditTierFor — تدرّج المراجعة الحسابية (المادة 14)');
T('الحدود الأربعة', () => {
  assert.match(R.auditTierFor(249999), /مراجعَين مستقلَّين/);
  assert.match(R.auditTierFor(250000), /محاسب قانوني/);
  assert.match(R.auditTierFor(1000000), /تدقيق كامل بقوائم/);
  assert.match(R.auditTierFor(5000000), /امتثال إضافية/);
});

// ---------------------------------------------------------------
section('أرقام الترخيص والاعتماد (المادة 35)');
T('licenseNo(1, 2026) = LY-KH-0001-26', () => assert.equal(R.licenseNo(1, 2026), 'LY-KH-0001-26'));
T('licenseNo(1234, 2030) = LY-KH-1234-30', () => assert.equal(R.licenseNo(1234, 2030), 'LY-KH-1234-30'));
T('licenseNo يطابق الصيغة', () => assert.match(R.licenseNo(42, 2027), /^LY-KH-\d{4}-\d{2}$/));
T('accreditationNo(7, 2026) = LY-KH-ORG-007-26', () => assert.equal(R.accreditationNo(7, 2026), 'LY-KH-ORG-007-26'));
T('accreditationNo يطابق الصيغة', () => assert.match(R.accreditationNo(123, 2026), /^LY-KH-ORG-\d{3}-\d{2}$/));

// ---------------------------------------------------------------
section('screenClaim / allowedClaim — فحص الادعاء (المادة 19)');
const LN = 'LY-KH-0007-26';
for (const [txt, label] of [
  ['نحن شركة مسؤولة', 'شركة مسؤولة'], ['الأفضل خيرياً في المدينة', 'الأفضل خيرياً'],
  ['الأول في ليبيا في العطاء', 'الأول في ليبيا'], ['الأول وطنياً', 'الأول وطنياً'], ['منتج 100% خيري', '100% خيري'],
]) T(`يرصد الادعاء المحظور «${label}»`, () => {
  const s = R.screenClaim(`${txt} — ${LN}`, 2, LN);
  assert.equal(s.ok, false); assert.equal(s.issues.length, 1);
});
T('يرصد غياب رقم الترخيص', () => {
  const s = R.screenClaim('تُسهم هذه الشركة بـ2% من صافي دخلها', 2, LN);
  assert.equal(s.ok, false); assert.ok(s.issues.some((i) => /رقم الترخيص/.test(i)));
});
T('الادعاء الموصى به يجتاز الفحص', () => {
  const rec = R.allowedClaim(2, LN);
  assert.match(rec, /2%/); assert.ok(rec.includes(LN));
  assert.equal(R.screenClaim(rec, 2, LN).ok, true);
});
T('ادعاء المستوى الخامس خاص بالمنتج', () => assert.match(R.allowedClaim(5, LN), /كامل عائد هذا المنتج/));
T('مستوى غير معروف ← null', () => assert.equal(R.allowedClaim(9, LN), null));
T('نص فارغ بلا رقم ترخيص مطلوب ← سليم', () => assert.equal(R.screenClaim('', 1, null).ok, true));
T('ادعاءان محظوران + رقم مفقود ← ثلاث ملاحظات', () => {
  assert.equal(R.screenClaim('شركة مسؤولة و100% خيري', 1, LN).issues.length, 3);
});

// ---------------------------------------------------------------
section('المواعيد وأيام العمل (الجمعة والسبت عطلة)');
T('2026-09-23 يوم أربعاء (مرجع)', () => assert.equal(new Date('2026-09-23T00:00:00Z').getUTCDay(), 3));
T('الأربعاء + 1 يوم عمل = الخميس 2026-09-24', () => assert.equal(R.addWorkDays('2026-09-23', 1), '2026-09-24'));
T('الأربعاء + 2 يوم عمل = الأحد 2026-09-27 (تخطي الجمعة والسبت)', () => assert.equal(R.addWorkDays('2026-09-23', 2), '2026-09-27'));
T('الخميس + 1 = الأحد', () => assert.equal(R.addWorkDays('2026-09-24', 1), '2026-09-27'));
T('الجمعة + 1 = الأحد', () => assert.equal(R.addWorkDays('2026-09-25', 1), '2026-09-27'));
T('الأربعاء + 10 أيام عمل = 2026-10-07', () => assert.equal(R.addWorkDays('2026-09-23', 10), '2026-10-07'));
T('صفر أيام عمل = التاريخ نفسه', () => assert.equal(R.addWorkDays('2026-09-23', 0), '2026-09-23'));
T('النتيجة لا تقع أبداً في جمعة أو سبت', () => {
  for (let n = 1; n <= 30; n++) {
    const d = new Date(R.addWorkDays('2026-01-01', n) + 'T00:00:00Z').getUTCDay();
    assert.ok(d !== 5 && d !== 6, `n=${n} وقع في اليوم ${d}`);
  }
});
T('designDecisionDue = 10 أيام عمل', () => assert.equal(R.designDecisionDue('2026-09-23'), '2026-10-07'));
T('addDays عبر نهاية السنة', () => assert.equal(R.addDays('2026-12-31', 1), '2027-01-01'));
T('daysBetween', () => { assert.equal(R.daysBetween('2026-01-01', '2026-03-01'), 59); assert.equal(R.daysBetween('2026-03-01', '2026-01-01'), -59); });
T('complianceDeadlines: الإقرار بعد 120 يوماً من نهاية السنة المالية', () => {
  const c = R.complianceDeadlines('2025-12-31');
  assert.equal(c.declaration_due, '2026-04-30');
  assert.equal(c.desk_review_due, 30); assert.equal(c.field_audit_due, 60);
  assert.equal(c.facts_report_due, 75); assert.equal(c.decision_due, 90); assert.equal(c.appeal_window_days, 30);
});
T('complianceDeadlines لسنة كبيسة (2027-12-31 ← 2028-04-29)', () => {
  assert.equal(R.complianceDeadlines('2027-12-31').declaration_due, '2028-04-29');
});

// ---------------------------------------------------------------
section('أدوات التدوير');
T('round2 / round4', () => { assert.equal(R.round2(1.006), 1.01); assert.equal(R.round4(0.123456), 0.1235); assert.equal(R.round2('x'), 0); });

console.log(`\n======== النتيجة: ${pass} ناجح · ${fail} فاشل ========`);
process.exit(fail ? 1 : 0);
