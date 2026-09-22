'use strict';
/** محرّك القواعد — يجسّد مواد لائحة الاعتماد والترخيص والرقابة */
const REF = require('./reference');

/** الشريحة من الإيراد السنوي (المادة 5) */
function tierFor(revenue) {
  const r = Number(revenue) || 0;
  return REF.TIERS.find((t) => r >= t.min && (t.max === null || r < t.max)) || REF.TIERS[0];
}

/** الأرضية المطلقة للمستوى في الشريحة. المستوى 5 يستعمل أرضية المستوى 3 (المادة 7/3) */
function floorFor(tier, level, revenue) {
  const lv = level === 5 ? 3 : level;
  if (tier.code === 'و') {
    const pct = tier['p' + lv];
    return pct ? pct * (Number(revenue) || 0) : 0;
  }
  return tier['f' + lv] || 0;
}

/**
 * المادة (4): الالتزام السنوي = الأعلى من النسبة أو الأرضية.
 * وتسري القاعدة سواء حقّقت المنشأة ربحاً أم لم تحقق.
 * المستوى الخامس: 100% من صافي أرباح النطاق المخصص، بحد أدنى أرضية المستوى الثالث.
 */
function computeCommitment({ revenue, netProfit, level, scopeNetProfit }) {
  const tier = tierFor(revenue);
  const lv = REF.LEVELS.find((l) => l.level === Number(level)) || REF.LEVELS[0];
  const profit = Math.max(0, Number(netProfit) || 0);

  let pctAmount;
  if (lv.level === 5) {
    pctAmount = Math.max(0, Number(scopeNetProfit ?? netProfit) || 0); // 100%
  } else {
    pctAmount = profit * lv.pct;
  }
  const floorAmount = floorFor(tier, lv.level, revenue);
  const due = Math.max(pctAmount, floorAmount);

  return {
    tier_code: tier.code,
    tier_name: tier.name,
    level: lv.level,
    level_name: lv.name,
    level_pct: lv.pct,
    pct_amount: round2(pctAmount),
    floor_amount: round2(floorAmount),
    commitment_due: round2(due),
    basis: pctAmount >= floorAmount ? 'percent' : 'floor',
    basis_note: pctAmount >= floorAmount ? 'النسبة هي الأعلى' : 'الأرضية هي الأعلى',
    level5_floor_check:
      lv.level === 5 && pctAmount < floorFor(tier, 3, revenue)
        ? 'الالتزام أقل من أرضية المستوى الثالث — يُمنح المستوى المناسب لقيمته الفعلية (المادة 7/3)'
        : null,
  };
}

/** المادة (33) و(34): الرسوم مع خصم 20% للمستويات 3–5 وسقف مطلق 30,000 */
function computeFees({ revenue, level, firstYearRemainingMonths, pilotDiscount }) {
  const tier = tierFor(revenue);
  const lv = Number(level);
  const ANNUAL_CAP = 30000;
  let appFee = tier.app;
  let annual = lv >= 3 ? tier.a35 : tier.a12;
  const discounts = [];
  if (lv >= 3) discounts.push('خصم 20% للمستويات الثالث والرابع والخامس');
  if (pilotDiscount && ['أ', 'ب'].includes(tier.code)) {
    appFee = appFee * 0.5; annual = annual * 0.5;
    discounts.push('خصم 50% للشريحتين أ وب للمرخَّص لهم الأوائل في السنة الأولى (المادة 38/3)');
  }
  let prorated = null;
  if (firstYearRemainingMonths != null) {
    prorated = round2((annual * Math.max(0, Math.min(12, firstYearRemainingMonths))) / 12);
    discounts.push('الرسم السنوي في السنة الأولى محتسب بالتناسب (المادة 34/3)');
  }
  const capped = annual > ANNUAL_CAP;
  return {
    tier_code: tier.code,
    application_fee: round2(appFee),
    application_fee_refundable: false,
    annual_fee: round2(Math.min(annual, ANNUAL_CAP)),
    annual_fee_prorated: prorated == null ? null : round2(Math.min(prorated, ANNUAL_CAP)),
    capped,
    cap: ANNUAL_CAP,
    discounts,
    note: 'الرسوم لا تُحتسب ضمن الالتزام الخيري بأي حال (المادة 34/6)',
  };
}

/** المادة (25): نسبة التدقيق الميداني السنوي */
function fieldAuditRate({ level, tierCode, hasComplaint, pilotYear }) {
  if (pilotYear) return { rate: 1.0, reason: 'السنة الأولى للعلامة — المرحلة التجريبية: 100% من كل الملفات' };
  if (hasComplaint) return { rate: 1.0, reason: 'ملف ورد بشأنه بلاغ أو شكوى: 100% وفوري' };
  if (['هـ', 'و'].includes(tierCode)) return { rate: 1.0, reason: 'الشريحتان هـ و و — أياً كان المستوى: 100% سنوياً' };
  if (level >= 4) return { rate: 1.0, reason: 'المستويان الرابع والخامس: 100% سنوياً' };
  if (level === 3) return { rate: 0.35, reason: 'المستوى الثالث — كل الشرائح: 35%' };
  if (tierCode === 'د') return { rate: 0.35, reason: 'المستويان الأول والثاني — الشريحة د: 35%' };
  return { rate: 0.20, reason: 'المستويان الأول والثاني — الشرائح أ، ب، ج: عيّنة عشوائية 20%' };
}

/** المادة (21): قاعدة النصف النقدي + سقوف المسارات (المادة 20) */
function validateMix({ cash = 0, inkind = 0, volunteer = 0, direct_program = 0 }) {
  const total = cash + inkind + volunteer + direct_program;
  const errors = [];
  if (total <= 0) return { total: 0, valid: false, errors: ['لا توجد مساهمات مسجَّلة'] };
  const share = (x) => x / total;
  if (share(cash) < 0.5)
    errors.push(`قاعدة النصف النقدي (المادة 21): الجزء النقدي ${pct(share(cash))} والحد الأدنى 50%`);
  if (share(direct_program) > 0.40)
    errors.push(`البرامج التنموية الذاتية ${pct(share(direct_program))} والسقف 40% (المادة 20)`);
  if (share(inkind) > 0.25)
    errors.push(`التبرع العيني ${pct(share(inkind))} والسقف 25% (المادة 20)`);
  if (share(volunteer) > 0.10)
    errors.push(`وقت التطوع ${pct(share(volunteer))} والسقف 10% (المادة 20)`);
  return {
    total: round2(total),
    cash_share: round4(share(cash)),
    valid: errors.length === 0,
    errors,
  };
}

/** المادة (22): سقف 60% للمنظمة الواحدة إذا تجاوز الالتزام مئة ألف دينار */
function concentrationCheck(commitmentDue, byAssociation) {
  if (!(commitmentDue > 100000)) return { applies: false, breaches: [] };
  const breaches = [];
  for (const [name, amount] of Object.entries(byAssociation || {})) {
    const share = amount / commitmentDue;
    if (share > 0.60)
      breaches.push({ association: name, share: round4(share),
        message: `توجيه ${pct(share)} من الالتزام إلى «${name}» يتجاوز سقف 60% — يلزم موافقة مسبقة من لجنة المعايير (المادة 22/2)` });
  }
  return { applies: true, breaches };
}

/** المادة (29) بنود 1 و3 و4: تكييف العجز في الالتزام */
function deficitAssessment(due, paid) {
  const deficit = Math.max(0, due - paid);
  const p = due > 0 ? deficit / due : 0;
  // تسامح تدوير العملة فقط — دينار واحد — ولا تسامح في أي نسبة
  if (deficit <= 1) return { deficit: 0, deficit_pct: 0, status: 'fulfilled', violation: null, measure: null,
    message: 'الالتزام مستوفى' };
  if (p < 0.20) return { deficit: round2(deficit), deficit_pct: round4(p), status: 'deficient', violation: 3,
    measure: 'grace_period', message: 'عجز أقل من 20%: إمهال 60 يوماً لاستكمال الفارق + خفض المستوى المعلن (المادة 29/3)' };
  return { deficit: round2(deficit), deficit_pct: round4(p), status: 'breach', violation: 4,
    measure: 'suspension', message: 'عجز يتجاوز 20%: تعليق لمدة أقصاها ستة أشهر + نشر الحالة في السجل (المادة 29/4)' };
}

/** المادة (15): تصنيف المستوى الإداري المنشور + تنبيه ما دون 5% */
function classifyAdminRatio(ratio) {
  const r = Number(ratio);
  const cls = REF.ADMIN_CLASSES.find((c) => r >= c.min && (c.max === null || r < c.max)) || REF.ADMIN_CLASSES[3];
  return {
    code: cls.code, name: cls.name, accredit: !!cls.accredit,
    flag: r < 0.05
      ? 'تنبيه إرشادي: نسبة أقل من 5% تستوجب فحصاً إضافياً من وحدة التقييم — كثيراً ما تدل على تحميل تكاليف إدارية على بنود البرامج'
      : null,
  };
}

/** المادة (14): تدرّج المراجعة الحسابية */
function auditTierFor(revenue) {
  const r = Number(revenue) || 0;
  return (REF.AUDIT_TIERS.find((t) => t.max === null || r < t.max) || REF.AUDIT_TIERS[3]).label;
}

/** المعيار (10): سقف الاستيعاب 200% من أكبر ميزانية سنوية في الثلاث سنوات السابقة */
function absorptionCheck(largestBudget3y, receivedThisYear) {
  const cap = (Number(largestBudget3y) || 0) * 2;
  const used = Number(receivedThisYear) || 0;
  return {
    cap: round2(cap), used: round2(used),
    remaining: round2(Math.max(0, cap - used)),
    utilization: cap > 0 ? round4(used / cap) : null,
    breached: used > cap,
    message: used > cap
      ? `تجاوز سقف الاستيعاب: تلقّت ${fmt(used)} د.ل والسقف ${fmt(cap)} د.ل — يوقف توجيه مساهمات جديدة إليها`
      : null,
  };
}

/** رقم الترخيص LY-KH-0000-YY (المادة 35) */
function licenseNo(serial, year) {
  return `LY-KH-${String(serial).padStart(4, '0')}-${String(year).slice(-2)}`;
}
function accreditationNo(serial, year) {
  return `LY-KH-ORG-${String(serial).padStart(3, '0')}-${String(year).slice(-2)}`;
}

/** الادعاء المسموح به (المادة 19/4) */
function allowedClaim(level, licenseNoStr) {
  const lv = REF.LEVELS.find((l) => l.level === Number(level));
  if (!lv) return null;
  if (lv.level === 5)
    return `كامل عائد هذا المنتج يُوجَّه إلى أعمال خيرية وإنسانية وتنموية داخل ليبيا — رقم الترخيص ${licenseNoStr}`;
  return `تُسهم هذه الشركة بـ${lv.pct * 100}% من صافي دخلها في أعمال خيرية وإنسانية وتنموية داخل ليبيا — رقم الترخيص ${licenseNoStr}`;
}

const FORBIDDEN_CLAIM_PATTERNS = [
  { re: /شركة\s*مسؤولة/, why: 'ادعاء مطلق محظور (المادة 19/3)' },
  { re: /الأفضل\s*خيريا?ً?/, why: 'ادعاء مطلق محظور (المادة 19/3)' },
  { re: /الأول\s*(وطنيا?ً?|في\s*ليبيا)/, why: 'ادعاء تفضيلي غير مرخَّص (المادة 19/3)' },
  { re: /100%\s*خيري/, why: 'ادعاء مطلق غير مطابق للمستوى الممنوح' },
];

function screenClaim(text, level, licenseNoStr) {
  const issues = [];
  const t = String(text || '');
  for (const p of FORBIDDEN_CLAIM_PATTERNS) if (p.re.test(t)) issues.push(p.why);
  if (licenseNoStr && !t.includes(licenseNoStr))
    issues.push('رقم الترخيص غير مذكور في الادعاء (المادة 35/2 و36)');
  return { ok: issues.length === 0, issues, recommended: allowedClaim(level, licenseNoStr) };
}

// ---------- مواعيد ----------
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** أيام العمل: الجمعة والسبت عطلة في ليبيا */
function addWorkDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dw = d.getUTCDay(); // 5=Fri 6=Sat
    if (dw !== 5 && dw !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}

/** المادة (23): إقرار الامتثال خلال 120 يوماً من انتهاء السنة المالية */
function complianceDeadlines(fiscalYearEnd) {
  return {
    declaration_due: addDays(fiscalYearEnd, 120),
    desk_review_due: 30, field_audit_due: 60, facts_report_due: 75, decision_due: 90,
    appeal_window_days: 30,
  };
}

/** المادة (19/2): الموافقة المسبقة — عدم الرد خلال 10 أيام عمل موافقة ضمنية */
function designDecisionDue(submittedOn) { return addWorkDays(submittedOn, 10); }

// ---------- أدوات ----------
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const round4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const pct = (n) => (Math.round(n * 1000) / 10).toFixed(1) + '%';
const fmt = (n) => new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

module.exports = {
  tierFor, floorFor, computeCommitment, computeFees, fieldAuditRate, validateMix,
  concentrationCheck, deficitAssessment, classifyAdminRatio, auditTierFor, absorptionCheck,
  licenseNo, accreditationNo, allowedClaim, screenClaim, complianceDeadlines, designDecisionDue,
  addDays, addWorkDays, daysBetween, round2, round4,
};
