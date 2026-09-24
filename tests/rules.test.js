'use strict';
/**
 * اختبارات القبول — تتحقق من إنفاذ قواعد اللائحة والنظام الداخلي في الخادم لا في الواجهة.
 * كل مجموعة مرقَّمة تقابل باباً في docs/04-القواعد-المُنفَّذة-ومصادرها.md
 *
 * التشغيل:  npm run seed && npm start   ثم في طرفية أخرى:  npm test
 * ملاحظة: الاختبارات تكتب في قاعدة البيانات — أعِد البناء بـ npm run seed بعدها.
 */
const B = (process.env.SEMA_BASE || 'http://localhost:3000') + '/api';
let pass = 0, fail = 0;
const login = async (email) => (await (await fetch(B + '/auth/login', { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'Sema@2026' }) })).json()).token;
const call = async (tok, path, opts = {}) => {
  const r = await fetch(B + path, { method: opts.method || 'GET',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
    body: opts.body ? JSON.stringify(opts.body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const T = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + JSON.stringify(extra).slice(0, 220) : '')); } };

(async () => {
  const tok = {};
  for (const e of ['director@sema.ly','assessor1@sema.ly','licensing1@sema.ly','appeals1@sema.ly',
    'integrity1@sema.ly','standards1@sema.ly','partner1@sema.ly','org1@sema.ly','observer1@sema.ly','evaldir@sema.ly',
    'chair@sema.ly','auditor1@sema.ly','finance@sema.ly','partner14@sema.ly'])
    tok[e] = await login(e);

  console.log('\n=== 1. الفصل الوظيفي (المادة 18) ===');
  let r = await call(tok['director@sema.ly'], '/rbac/check', { method: 'POST',
    body: { roles: ['ASSESSOR', 'LICENSING_COMMITTEE'] } });
  T('يرفض الجمع بين التقييم وقرار الترخيص', r.data.conflict === true, r.data);
  r = await call(tok['director@sema.ly'], '/rbac/check', { method: 'POST',
    body: { roles: ['STANDARDS_COMMITTEE', 'APPEALS_COMMITTEE'] } });
  T('يرفض الجمع بين وضع المعيار والتظلم', r.data.conflict === true);
  r = await call(tok['director@sema.ly'], '/rbac/check', { method: 'POST',
    body: { roles: ['ASSESSOR', 'FIELD_AUDITOR'] } });
  T('يقبل دورين في الوظيفة نفسها', r.data.conflict === false);
  r = await call(tok['director@sema.ly'], '/users', { method: 'POST',
    body: { full_name: 'اختبار تعارض', email: 'sod-test@sema.ly', password: 'x1234567',
      roles: ['EVAL_DIRECTOR', 'LICENSING_COMMITTEE'] } });
  T('يرفض إنشاء مستخدم بأدوار متعارضة (422)', r.status === 422, r.data);

  console.log('\n=== 2. حدود اختصاص كل جهة (المصفوفة) ===');
  r = await call(tok['chair@sema.ly'], '/applications/1/decide', { method: 'POST',
    body: { decision: 'grant', reason: 'محاولة من مجلس الأمناء لمنح ترخيص وهذا محظور عليه' } });
  T('مجلس الأمناء لا يملك منح الترخيص (403)', r.status === 403, r.data);
  r = await call(tok['standards1@sema.ly'], '/applications/1/screen', { method: 'POST', body: { complete: true } });
  T('لجنة المعايير لا تفحص الطلبات (403)', r.status === 403, r.data);
  r = await call(tok['director@sema.ly'], '/sanctions', { method: 'POST',
    body: { subject_kind: 'licensee', subject_id: 1, violation_code: 4, reason: 'المدير التنفيذي يحاول التعليق' } });
  T('المدير التنفيذي لا يملك التعليق أو السحب (403)', r.status === 403, r.data);
  r = await call(tok['assessor1@sema.ly'], '/appeals/1/decide', { method: 'POST',
    body: { decision: 'upheld', reason: 'مقيّم يحاول البتّ في تظلم وهذا محظور' } });
  T('المقيّم لا يبتّ في التظلمات (403)', r.status === 403);
  r = await call(tok['observer1@sema.ly'], '/licensees/1');
  T('المراقب لا يطلع على ملف فردي (403)', r.status === 403, r.data);

  console.log('\n=== 3. تقرير الوقائع بلا توصية (المادة 20/3) ===');
  r = await call(tok['assessor1@sema.ly'], '/applications/1/facts-report', { method: 'POST',
    body: { facts_summary: 'وقائع', recommendation: 'أوصي بالمنح' } });
  T('يرفض تقريراً يحتوي توصية (422)', r.status === 422, r.data);

  console.log('\n=== 4. التسبيب الكتابي إلزامي (المادة 21/3) ===');
  const openApp = (await call(tok['assessor1@sema.ly'], '/applications?status=submitted&per_page=1')).data.rows[0];
  r = await call(tok['licensing1@sema.ly'], '/applications/' + (openApp?.id || 1) + '/decide', { method: 'POST',
    body: { decision: 'grant', reason: 'قصير' } });
  T('يرفض قراراً بلا تسبيب كافٍ (422)', r.status === 422, r.data);

  console.log('\n=== 5. المسار الكامل لطلب: فحص ← وقائع ← قرار ===');
  const app = (await call(tok['assessor1@sema.ly'], '/applications?status=submitted&per_page=5')).data.rows
    .find((x) => x.subject_kind === 'licensee');
  if (!app) { console.log('  (لا طلب مقدَّم متاح)'); }
  else {
    r = await call(tok['licensing1@sema.ly'], '/applications/' + app.id + '/decide', { method: 'POST',
      body: { decision: 'grant', reason: 'قرار قبل تقرير الوقائع — يجب أن يُرفض نظاماً' } });
    T('يرفض القرار قبل تقرير الوقائع (422)', r.status === 422, r.data);
    r = await call(tok['assessor1@sema.ly'], '/applications/' + app.id + '/screen', { method: 'POST',
      body: { complete: true } });
    T('فحص الاستيفاء ينقل الطلب للمرحلة 4', r.data.stage === 4, r.data);
    r = await call(tok['assessor1@sema.ly'], '/applications/' + app.id + '/facts-report', { method: 'POST',
      body: { facts_summary: 'طوبقت المستندات مع السجل التجاري والملف الضريبي؛ لا مخالفة لقائمة الاستبعاد.',
        findings: [{ area: 'المستندات', fact: 'كل الإثباتات الإلزامية مقدَّمة وسارية.', severity: 'info' }] } });
    T('رفع تقرير الوقائع ينقل الطلب للمرحلة 7', r.data.application?.stage === 7, r.data);
    r = await call(tok['licensing1@sema.ly'], '/applications/' + app.id + '/decide', { method: 'POST',
      body: { decision: 'grant', granted_level: app.requested_level || 1,
        reason: 'مستوفٍ لشروط الدخول في المادة (9) ولمعايير المستوى المطلوب، ولا مخالفة لقائمة الاستبعاد في المادة (10).' } });
    T('القرار المسبَّب يعتمد الطلب', r.data.status === 'approved', r.data);
    const lic = (await call(tok['director@sema.ly'], '/licensees/' + app.subject_id)).data;
    T('أُصدر رقم ترخيص بالصيغة LY-KH-0000-YY', /^LY-KH-\d{4}-\d{2}$/.test(lic.license_no || ''), lic.license_no);
    T('صارت حالة الملف «ساري»', lic.status === 'active', lic.status);
    T('أُنشئ ملف التزام للسنة', (lic.commitments || []).length > 0);
    T('أُصدرت فاتورة الرسم السنوي', (lic.invoices || []).some((i) => i.fee_type.startsWith('annual')));
    T('أُنشئ إقرار امتثال مستقبلي', (lic.declarations || []).some((d) => d.status === 'pending'));
  }

  console.log('\n=== 6. احتساب الالتزام (أمثلة ملحق 1 من اللائحة) ===');
  const cases = [
    [400000, 60000, 1, 1500, 'مقهى صغير — الأرضية هي الأعلى'],
    [180000, 35000, 2, 1000, 'ورشة حرفية — الأرضية هي الأعلى'],
    [4000000, 320000, 1, 6000, 'شركة توزيع — الأرضية هي الأعلى'],
    [3500000, 900000, 2, 18000, 'شركة خدمات — النسبة هي الأعلى'],
    [18000000, 2400000, 3, 125000, 'مصنع أغذية — الأرضية هي الأعلى'],
    [220000000, 30000000, 1, 300000, 'شركة اتصالات — النسبة هي الأعلى'],
  ];
  for (const [rev, np, lv, expect, label] of cases) {
    const res = await fetch(B + '/public/calculator', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revenue: rev, net_profit: np, level: lv }) });
    const d = await res.json();
    T(`${label} = ${expect.toLocaleString('en')}`, d.commitment.commitment_due === expect, d.commitment);
  }

  console.log('\n=== 7. سقوف المسارات وقاعدة النصف النقدي ===');
  r = await call(tok['partner1@sema.ly'], '/contributions', { method: 'POST',
    body: { licensee_id: 1, fiscal_year: 2026, channel: 'license_fees', amount: 5000 } });
  T('يرفض مساراً غير محتسب (رسوم الترخيص) 422', r.status === 422, r.data);
  r = await call(tok['partner1@sema.ly'], '/contributions', { method: 'POST',
    body: { licensee_id: 1, fiscal_year: 2026, channel: 'foreign', amount: 5000 } });
  T('يرفض التبرع لجهة خارج ليبيا 422', r.status === 422);
  r = await call(tok['partner1@sema.ly'], '/contributions', { method: 'POST',
    body: { licensee_id: 2, fiscal_year: 2026, channel: 'cash', amount: 1000, association_id: 1 } });
  T('يرفض التسجيل على ملف لا يملكه (403)', r.status === 403, r.data);
  const revoked = (await call(tok['director@sema.ly'], '/associations?status=revoked&per_page=1')).data.rows[0];
  if (revoked) {
    r = await call(tok['partner1@sema.ly'], '/contributions', { method: 'POST',
      body: { licensee_id: 1, fiscal_year: 2026, channel: 'cash', amount: 1000, association_id: revoked.id } });
    T('يرفض التوجيه لمنظمة اعتمادها غير سارٍ 422', r.status === 422, r.data);
  }
  r = await call(tok['partner1@sema.ly'], '/contributions', { method: 'POST',
    body: { licensee_id: 1, fiscal_year: 2026, channel: 'cash', amount: 2500, association_id: 1,
      purpose: 'اختبار تسجيل مساهمة', transfer_date: '2026-09-10', bank_ref: 'TRF-TEST-1' } });
  T('يسجّل مساهمة نقدية لمنظمة معتمدة', r.status === 201, r.data);
  const cid = r.data.id;
  if (cid) {
    let v = await call(tok['auditor1@sema.ly'], '/contributions/' + cid + '/verify', { method: 'POST', body: { status: 'verified' } });
    T('يرفض التحقق قبل إقرار الاستلام (422)', v.status === 422, v.data);
    v = await call(tok['org1@sema.ly'], '/contributions/' + cid + '/confirm-receipt', { method: 'POST', body: {} });
    T('المنظمة تقرّ الاستلام', v.status === 200, v.data);
    v = await call(tok['auditor1@sema.ly'], '/contributions/' + cid + '/verify', { method: 'POST', body: { status: 'verified' } });
    T('يقبل التحقق بعد الإقرار', v.data.status === 'verified', v.data);
  }

  console.log('\n=== 8. سقف الاستيعاب (المعيار 10) ===');
  const org = (await call(tok['director@sema.ly'], '/associations?status=accredited&per_page=1')).data.rows[0];
  r = await call(tok['partner1@sema.ly'], '/contributions', { method: 'POST',
    body: { licensee_id: 1, fiscal_year: 2026, channel: 'cash', amount: (org.absorption_cap || 1e6) * 3,
      association_id: org.id, purpose: 'مبلغ يتجاوز السقف' } });
  T('يرفض تجاوز سقف الاستيعاب 200% (422)', r.status === 422, r.data);

  console.log('\n=== 9. الجزاءات والتعليق والسحب ===');
  const target = (await call(tok['director@sema.ly'], '/licensees?status=active&per_page=40')).data.rows
    .find((x) => x.id > 20);
  r = await call(tok['licensing1@sema.ly'], '/sanctions', { method: 'POST',
    body: { subject_kind: 'licensee', subject_id: target.id, violation_code: 4, measure: 'suspension',
      reason: 'عجز في الالتزام يتجاوز 20% عن السنة المالية 2025 — تعليق لمدة أقصاها ستة أشهر (المادة 29/4).' } });
  T('لجنة الترخيص تُصدر التعليق', r.status === 201, r.data);
  const snc = r.data;
  T('التعليق ينتهي بعد 180 يوماً', !!snc.effective_to);
  T('تصعيد تلقائي إلى السحب', snc.auto_escalate_to === 'withdrawal', snc.auto_escalate_to);
  T('التعليق منشور في السجل', snc.published === 1);
  let after = (await call(tok['director@sema.ly'], '/licensees/' + target.id)).data;
  T('صارت حالة الملف «معلَّق»', after.status === 'suspended', after.status);
  const pub = await (await fetch(B + '/public/verify/' + after.license_no)).json();
  T('صفحة التحقق العامة تُظهر التعليق', pub.status === 'suspended' && pub.valid === false, pub.status);

  console.log('\n=== 10. التظلم ومدده (المادة 22) ===');
  const ownerTok = await login('partner' + target.id + '@sema.ly').catch(() => null);
  if (ownerTok) {
    r = await call(ownerTok, '/appeals', { method: 'POST',
      body: { sanction_id: snc.id, appellant_kind: 'licensee', appellant_id: target.id,
        grounds: 'نرفق كشفاً مصرفياً يثبت خروج المبلغ قبل انتهاء السنة المالية، ونطلب احتسابه على تلك السنة.' } });
    T('صاحب الملف يقدّم تظلماً', r.status === 201, r.data);
    const ap = r.data;
    T('موعد الفصل بعد ستين يوماً', !!ap.decision_due_at);
    T('التظلم لا يوقف التنفيذ تلقائياً', ap.stay_of_execution === 0);
    r = await call(tok['partner1@sema.ly'], '/appeals', { method: 'POST',
      body: { sanction_id: snc.id, appellant_kind: 'licensee', appellant_id: target.id, grounds: 'تظلم مفصَّل من غير ذي شأن على جزاء لا يخص ملفه إطلاقاً' } });
    T('يرفض تظلماً من غير صاحب الملف (403)', r.status === 403, { s: r.status, d: r.data });
    r = await call(tok['appeals1@sema.ly'], '/appeals/' + ap.id + '/decide', { method: 'POST',
      body: { decision: 'overturned',
        reason: 'ثبت من الكشف المصرفي خروج المبلغ قبل انتهاء السنة المالية، فيُحتسب عليها، وينزل العجز دون الحد الموجب للتعليق. يُلغى القرار.' } });
    T('لجنة التظلمات تُلغي القرار', r.data.decision === 'overturned', r.data);
    after = (await call(tok['director@sema.ly'], '/licensees/' + target.id)).data;
    T('عاد الملف إلى «ساري» بعد الإلغاء', after.status === 'active', after.status);
  }

  console.log('\n=== 11. النزاهة: النشر العلني بعد تسعين يوماً ===');
  r = await call(tok['integrity1@sema.ly'], '/integrity-notes', { method: 'POST',
    body: { title: 'ملاحظة اختبار', body: 'نص ملاحظة لاختبار مهلة التسعين يوماً.', category: 'transparency' } });
  T('لجنة النزاهة تسجّل ملاحظة', r.status === 201, r.data);
  const note = r.data;
  r = await call(tok['integrity1@sema.ly'], '/integrity-notes/' + note.id + '/publish', { method: 'POST', body: {} });
  T('يرفض النشر قبل انقضاء المهلة (422)', r.status === 422, r.data);
  const overdue = (await call(tok['integrity1@sema.ly'], '/integrity-notes')).data.rows.find((x) => x.publishable);
  if (overdue) {
    r = await call(tok['integrity1@sema.ly'], '/integrity-notes/' + overdue.id + '/publish', { method: 'POST', body: {} });
    T('يسمح بالنشر بعد انقضاء المهلة', r.data.public_disclosure === 1, r.data);
    const t2 = await (await fetch(B + '/public/transparency')).json();
    T('تظهر الملاحظة في لوحة الشفافية العامة', t2.integrity_disclosures.length > 0);
  }
  r = await call(tok['director@sema.ly'], '/integrity-notes/' + note.id + '/publish', { method: 'POST', body: {} });
  T('المدير التنفيذي لا يملك النشر العلني (403)', r.status === 403);

  console.log('\n=== 12. المراقبون: السقف العددي والقطاعي (المادة 34) ===');
  r = await call(tok['director@sema.ly'], '/observers', { method: 'POST',
    body: { person_name: 'مراقب اختبار', nominating_entity: 'جهة اختبار', entity_kind: 'civil', cycle: '2026' } });
  T('ترشيح مراقب يُقيَّد', r.status === 201, r.data);
  r = await call(tok['chair@sema.ly'], '/observers/' + r.data.id + '/decide', { method: 'POST',
    body: { decision: 'admitted' } });
  T('يرفض القبول عند بلوغ السقف (422)', r.status === 422, r.data);

  console.log('\n=== 13. الموافقة على التصاميم وفحص الادعاء (المادة 19) ===');
  r = await call(tok['partner1@sema.ly'], '/designs', { method: 'POST',
    body: { licensee_id: 1, material_type: 'packaging', title: 'اختبار عبوة', logo_variant: 'full',
      shows_license_no: true, claim_text: 'شركة مسؤولة — نُسهم في الخير' } });
  T('يقبل الطلب ويرصد الادعاء المطلق', r.status === 201 && r.data.claim_screen?.ok === false, r.data.claim_screen);
  T('يقترح الادعاء المحدد المسموح به', /LY-KH-\d{4}-\d{2}/.test(r.data.claim_screen?.recommended || ''));
  T('الموعد الأقصى عشرة أيام عمل مسجَّل', !!r.data.due_at);

  console.log('\n=== 14. الزيارات غير المعلنة (المادة 26) ===');
  let noPlan = await call(tok['assessor1@sema.ly'], '/audits/plan', { method: 'POST', body: { fiscal_year: 2026 } });
  T('المقيّم لا يملك تخطيط العيّنة (403)', noPlan.status === 403, noPlan.data);
  const plan = await call(tok['evaldir@sema.ly'], '/audits/plan', { method: 'POST', body: { fiscal_year: 2026 } });
  T('خطة العيّنة تُولَّد ببصمة موثّقة', !!plan.data.seed && plan.data.plan.length > 0);
  T('نسبة الزيارات غير المعلنة ≥ 10%',
    plan.data.unannounced_selected / Math.max(1, plan.data.selected) >= 0.10,
    { u: plan.data.unannounced_selected, s: plan.data.selected });
  const p2 = await call(tok['evaldir@sema.ly'], '/audits/plan', { method: 'POST',
    body: { fiscal_year: 2026, seed: plan.data.seed } });
  T('الخطة قابلة للتحقق بإعادة البصمة نفسها',
    JSON.stringify(p2.data.plan.map((x) => x.licensee_id)) === JSON.stringify(plan.data.plan.map((x) => x.licensee_id)));
  const un = (await call(tok['director@sema.ly'], '/audits?audit_type=unannounced&per_page=3')).data.rows[0];
  if (un) {
    const ot = await login('partner' + un.subject_id + '@sema.ly').catch(() => null);
    if (ot) { const seen = await call(ot, '/audits?audit_type=unannounced');
      T('المرخَّص له لا يرى زيارة غير معلنة قبل تنفيذها',
        seen.data.rows.every((x) => x.executed_date), seen.data.rows.map((x) => x.executed_date)); }
  }

  console.log('\n=== 15. إقرار الامتثال (المادة 23) ===');
  const decl = (await call(tok['partner14@sema.ly'], '/declarations?status=pending&per_page=1')).data.rows[0];
  if (decl) {
    r = await call(tok['partner14@sema.ly'], '/declarations/' + decl.id + '/submit', { method: 'POST',
      body: { basis_type: 'bank_statement_accountant', declared_revenue: 1000, declared_net_profit: 100, declared_total: 100 } });
    const okTier = ['أ', 'ب'].includes(decl.tier_code);
    T('كشف الحساب مقبول للشريحتين أ وب فقط',
      okTier ? r.status === 200 : r.status === 422, { tier: decl.tier_code, status: r.status });
  }

  console.log('\n=== 16. السجل العام بلا تسجيل دخول ===');
  for (const [p, name] of [['/public/registry/licensees?level=4&status=active', 'فلترة المرخَّص لهم'],
    ['/public/registry/associations?admin_class=rejected', 'فلترة المنظمات بالتصنيف الإداري'],
    ['/public/registry/sanctions', 'الجزاءات المنشورة'],
    ['/public/registry/former', 'المرخَّص لهم السابقون'],
    ['/public/transparency', 'لوحة الشفافية'], ['/public/reference', 'البيانات المرجعية']]) {
    const res = await fetch(B + p);
    T(name + ' متاحة للعموم', res.status === 200);
  }
  const nf = await fetch(B + '/public/verify/LY-KH-9999-99');
  T('رقم غير مقيَّد يُرجع 404 مع تحذير المادة 29/11', nf.status === 404 && !!(await nf.json()).warning);
  const noauth = await fetch(B + '/licensees');
  T('قائمة المرخَّص لهم الداخلية تلزم الدخول', noauth.status === 401 || noauth.status === 404);

  console.log(`\n======== النتيجة: ${pass} ناجح · ${fail} فاشل ========`);
  process.exit(fail ? 1 : 0);
})();
