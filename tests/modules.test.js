'use strict';
/**
 * اختبارات قبول للوحدات الجديدة عبر الـ API: التسجيل الذاتي، مسار الطلب بالنواقص، التجديد والترقية،
 * إقرارات الامتثال، المساهمات والإثباتات، مقترحات المعايير والمشاورة، البلاغات، رموز QR،
 * المهام الآلية، الأمان، الاجتماعات، اختبار السوق.
 *
 * تكتب في قاعدة البيانات — شغّلها عبر: node tests/run.js --only=modules
 * لا تُفترض معرِّفات كيانات غير ربط الحسابات التصويرية (partnerN ↔ مرخَّص له N، orgN ↔ منظمة N).
 */
const B = (process.env.SEMA_BASE || 'http://localhost:3000') + '/api';
const PW = 'Sema@2026';
const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = new Date().getFullYear();
const UNIQ = Date.now().toString(36);

let pass = 0, fail = 0, skip = 0;
const T = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra).slice(0, 260) : '')); }
  return !!cond;
};
const SKIP = (name, why) => { skip++; console.log(`  - (متخطّى) ${name} — ${why}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

/** طلب عام: يعيد الحالة والبيانات والترويسات. form = FormData للتحميل متعدد الأجزاء */
async function api(method, path, { tok, body, form, headers = {}, ip } = {}) {
  const h = { ...headers };
  if (tok) h.authorization = 'Bearer ' + tok;
  if (ip) h['x-forwarded-for'] = ip;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const r = await fetch(B + path, { method, headers: h, body: payload });
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  let data = {};
  if (ct.includes('json')) { try { data = JSON.parse(text); } catch { /* تجاهل */ } }
  return { status: r.status, data, headers: r.headers, text };
}
const get = (path, tok, o = {}) => api('GET', path, { tok, ...o });
const post = (path, tok, body = {}, o = {}) => api('POST', path, { tok, body, ...o });

const tokens = {};
async function login(email, password = PW, ip) {
  const r = await post('/auth/login', null, { email, password }, { ip });
  return r;
}
async function tok(email) {
  if (!tokens[email]) {
    const r = await login(email);
    if (!r.data.token) throw new Error(`تعذّر دخول ${email}: ${r.status} ${JSON.stringify(r.data)}`);
    tokens[email] = r.data.token;
  }
  return tokens[email];
}

// عناوين مختلفة للتسجيل الذاتي — حدّ التسجيل عشرة في الساعة لكل عنوان
let ipSeq = 1;
const nextIp = () => `10.77.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;

function bizBody(email, over = {}) {
  return {
    contact_name: 'مسؤول اختبار', email, password: 'Test2026pass', region: 'الغربية', city: 'طرابلس',
    legal_name: `شركة اختبار ${UNIQ} ${email.split('@')[0]}`, commercial_reg: 'CR-' + UNIQ, tax_file_no: 'TX-' + UNIQ,
    sector: 'التجارة', annual_revenue: 400000, net_profit: 60000, requested_level: 1,
    pledge_exclusion: true, pledge_conduct: true, pledge_audit: true, pledge_statement: true, ...over,
  };
}
function orgBody(email, over = {}) {
  return {
    contact_name: 'منسّق اختبار', email, password: 'Test2026pass', region: 'الشرقية', city: 'بنغازي',
    name: `جمعية اختبار ${UNIQ} ${email.split('@')[0]}`, registration_no: 'REG-' + UNIQ, focus_areas: 'التعليم',
    established_year: 2015, board_size: 7, board_meetings_last_year: 4, annual_revenue: 200000,
    total_expenses: 180000, admin_expenses: 27000, largest_budget_3y: 150000,
    pledge_accuracy: true, pledge_audit: true, ...over,
  };
}
const pdfBlob = (label = 'x') => new Blob([`%PDF-1.4\n% SEMA test ${label} ${UNIQ}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`], { type: 'application/pdf' });

// حالة مشتركة بين الأبواب
const ctx = {};

async function section(title, fn) {
  console.log(`\n=== ${title} ===`);
  try { await fn(); }
  catch (e) { fail++; console.log(`  ✗ استثناء غير متوقع في الباب: ${e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
}

(async () => {
  // ================================================================
  await section('أ. التسجيل الذاتي من الواجهة العامة (نماذج 1 و2 و8)', async () => {
    const email = `biz-${UNIQ}@test.ly`;
    let r = await post('/public/register/business', null, bizBody(email), { ip: nextIp() });
    T('تسجيل منشأة ينجح (201) ويُرجع رمزاً وطلباً', r.status === 201 && !!r.data.token && !!r.data.application?.id, { s: r.status, d: r.data });
    T('الطلب الناشئ في حالة «submitted» بالمرحلة 2', r.data.application?.status === 'submitted' && r.data.application?.stage === 2, r.data.application);
    T('المعاينة تحسب الالتزام (مقهى ب/م1 = 1,500)', r.data.preview?.commitment?.commitment_due === 1500, r.data.preview?.commitment);
    T('المعاينة تُظهر الشريحة ب', r.data.preview?.tier === 'ب', r.data.preview?.tier);
    ctx.biz = { email, password: 'Test2026pass', token: r.data.token, lid: r.data.licensee_id, app: r.data.application,
      appFee: r.data.preview?.fees?.application_fee };

    r = await post('/public/register/business', null, bizBody(email), { ip: nextIp() });
    T('البريد المكرر ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(email.toUpperCase()), { ip: nextIp() });
    T('البريد المكرر بحالة أحرف مختلفة ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`weak-${UNIQ}@test.ly`, { password: 'abc1' }), { ip: nextIp() });
    T('كلمة مرور قصيرة ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`weak2-${UNIQ}@test.ly`, { password: 'abcdefghij' }), { ip: nextIp() });
    T('كلمة مرور بلا أرقام ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`nopl-${UNIQ}@test.ly`, { pledge_conduct: undefined }), { ip: nextIp() });
    T('غياب إقرار الحد الأدنى للسلوك ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`nopl2-${UNIQ}@test.ly`, { pledge_exclusion: 'yes' }), { ip: nextIp() });
    T('إقرار الاستبعاد بقيمة غير true ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`l5-${UNIQ}@test.ly`, { requested_level: 5 }), { ip: nextIp() });
    T('المستوى 5 بلا خط إنتاج مخصص ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`l5b-${UNIQ}@test.ly`, { requested_level: 5, scope_type: 'product_line' }), { ip: nextIp() });
    T('خط إنتاج بلا تحديد النطاق ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`l5ok-${UNIQ}@test.ly`,
      { requested_level: 5, scope_type: 'product_line', scope_desc: 'خط المياه المعبأة', scope_net_profit: 5000 }), { ip: nextIp() });
    T('المستوى 5 لخط إنتاج محدد ← 201', r.status === 201, r.data);
    T('المستوى 5 دون أرضية م3 يحمل تنبيه المادة 7/3', !!r.data.preview?.commitment?.level5_floor_check, r.data.preview?.commitment);
    r = await post('/public/register/business', null, bizBody(`rev-${UNIQ}@test.ly`, { annual_revenue: 0 }), { ip: nextIp() });
    T('إيراد صفري ← 422', r.status === 422, r.data);
    r = await post('/public/register/business', null, bizBody(`reg-${UNIQ}@test.ly`, { region: 'خارج ليبيا' }), { ip: nextIp() });
    T('منطقة غير صالحة ← 422', r.status === 422, r.data);

    // الدخول بالحساب الجديد ونطاقه
    const lr = await login(email, 'Test2026pass');
    T('الحساب الجديد يدخل بكلمة مروره', lr.status === 200 && !!lr.data.token, lr.data);
    const bt = ctx.biz.token;
    r = await get('/licensees', bt);
    T('يرى ملفاً واحداً فقط هو ملفه', r.status === 200 && r.data.rows?.length === 1 && r.data.rows[0].id === ctx.biz.lid,
      { n: r.data.rows?.length, ids: r.data.rows?.map((x) => x.id) });
    const other = (await get('/licensees?status=active&per_page=5', await tok('director@sema.ly'))).data.rows.find((x) => x.id !== ctx.biz.lid);
    r = await get('/licensees/' + other.id, bt);
    T('لا يطّلع على ملف مرخَّص له آخر (403)', r.status === 403, r.status);
    r = await get('/applications/' + ctx.biz.app.id, bt);
    T('يطّلع على طلبه بمراحله التسع', r.status === 200 && r.data.stages?.length === 9, { s: r.status, n: r.data.stages?.length });
    r = await get('/applications/' + ctx.biz.app.id, await tok('partner1@sema.ly'));
    T('شريك آخر لا يطّلع على الطلب (403)', r.status === 403, r.status);
    r = await get('/invoices', bt);
    const appInv = (r.data.rows || []).filter((i) => i.fee_type === 'application' && i.subject_id === ctx.biz.lid);
    T('صدرت فاتورة رسم الطلب للمنشأة', appInv.length === 1, r.data.rows);
    T('قيمة الفاتورة = رسم الطلب في المعاينة (ب = 250)', appInv[0]?.amount === ctx.biz.appFee && ctx.biz.appFee === 250, { inv: appInv[0]?.amount, fee: ctx.biz.appFee });
    T('ملخص الفواتير للشريك يقتصر على فواتيره (لا إجماليات النظام)',
      (r.data.summary || []).reduce((s, x) => s + x.n, 0) === r.data.total, { summary: r.data.summary, total: r.data.total });
    r = await get('/documents', bt);
    T('وُلِّدت إقرارات التسجيل الأربعة مستنداتٍ موقّعة', (r.data.rows || []).filter((d) => d.owner_id === ctx.biz.lid).length >= 4, r.data.total);

    // منظمة — مجانية ونسبة إدارية مرتفعة
    const oemail = `org-${UNIQ}@test.ly`;
    r = await post('/public/register/association', null, orgBody(oemail, { admin_expenses: 54000 }), { ip: nextIp() });
    T('تسجيل منظمة بنسبة إدارية 30% يُقبل (201)', r.status === 201 && !!r.data.token, { s: r.status, d: r.data });
    T('المعاينة تنبّه إلى تجاوز سقف 25% (المعيار 8)', (r.data.preview?.warnings || []).some((w) => /25%/.test(w) && /المعيار 8/.test(w)), r.data.preview?.warnings);
    T('التصنيف الإداري «غير مقبولة»', r.data.preview?.admin_class?.code === 'rejected', r.data.preview?.admin_class);
    T('طلب الاعتماد نشأ', r.data.application?.app_type === 'accreditation' && r.data.application?.status === 'submitted', r.data.application);
    ctx.org = { email: oemail, password: 'Test2026pass', token: r.data.token, aid: r.data.association_id, name: orgBody(oemail).name, app: r.data.application };
    const fin = await get('/invoices?per_page=200&q=' + encodeURIComponent(ctx.org.name), await tok('finance@sema.ly'));
    T('لا فاتورة لطلب اعتماد المنظمة (المادة 12: مجاناً)', fin.status === 200 && fin.data.total === 0, fin.data.rows);
    r = await get('/associations', ctx.org.token);
    T('المنظمة ترى ملفها فقط', r.data.rows?.length === 1 && r.data.rows[0].id === ctx.org.aid, r.data.rows?.map((x) => x.id));
    r = await post('/public/register/association', null, orgBody(`org2-${UNIQ}@test.ly`, { admin_expenses: 999999 }), { ip: nextIp() });
    T('مصروفات إدارية تتجاوز الإجمالي ← 422', r.status === 422, r.data);
    r = await post('/public/register/association', null, orgBody(`org3-${UNIQ}@test.ly`, { pledge_audit: false }), { ip: nextIp() });
    T('منظمة بلا إقرار قبول التدقيق ← 422', r.status === 422, r.data);

    // مراقب
    const obs = { person_name: 'مراقب اختبار ' + UNIQ, nominating_entity: 'جامعة اختبار', contact_email: `obs-${UNIQ}@test.ly`,
      entity_kind: 'academic', pledge_confidentiality: true, pledge_costs: true };
    r = await post('/public/register/observer', null, obs, { ip: nextIp() });
    T('ترشيح مراقب عبر البوابة (201) بحالة «nominated»', r.status === 201 && r.data.status === 'nominated' && !!r.data.reference, r.data);
    ctx.obsRef = r.data.reference;
    r = await post('/public/register/observer', null, { ...obs, pledge_confidentiality: false }, { ip: nextIp() });
    T('مراقب بلا إقرار السرّية ← 422', r.status === 422, r.data);
    r = await post('/public/register/observer', null, { ...obs, entity_kind: 'foreign' }, { ip: nextIp() });
    T('قطاع جهة غير صالح ← 422', r.status === 422, r.data);
  });

  // ================================================================
  await section('ب. مسار الطلب كاملاً مع النواقص (المادة 17)', async () => {
    if (!ctx.biz?.app) return SKIP('المسار', 'لم ينجح التسجيل');
    const id = ctx.biz.app.id, as = await tok('assessor1@sema.ly'), lc = await tok('licensing1@sema.ly');
    let r = await post(`/applications/${id}/screen`, as, { complete: false });
    T('إخطار بالنواقص بلا بيانها ← 422', r.status === 422, r.data);
    r = await post(`/applications/${id}/screen`, as, { complete: false, deficiencies: 'شهادة السداد الضريبي غير مرفقة' });
    T('إخطار بالنواقص ← الحالة deficiencies والمرحلة 3', r.data.status === 'deficiencies' && r.data.stage === 3, r.data);
    r = await post(`/applications/${id}/resubmit`, await tok('partner1@sema.ly'), { note: 'ليس طلبي' });
    T('غير صاحب الطلب لا يستكمل النواقص (403)', r.status === 403, r.data);
    r = await post(`/applications/${id}/resubmit`, ctx.biz.token, { note: 'أُرفقت الشهادة' });
    T('صاحب الطلب يستكمل ← completing', r.data.status === 'completing', r.data);
    r = await post(`/applications/${id}/resubmit`, ctx.biz.token, {});
    T('استكمال ثانٍ بلا نواقص ← 409', r.status === 409, r.data);
    r = await post(`/applications/${id}/decide`, lc, { decision: 'grant', reason: 'محاولة قرار قبل الفحص والوقائع — تُرفض' });
    T('القرار قبل تقرير الوقائع ← 422', r.status === 422, r.data);
    r = await post(`/applications/${id}/facts-report`, as, { facts_summary: 'وقائع قبل اكتمال الفحص الشكلي' });
    T('تقرير الوقائع قبل اكتمال الفحص ← 409', r.status === 409, r.data);
    r = await post(`/applications/${id}/screen`, as, { complete: true });
    T('فحص الاستيفاء بعد الاستكمال ← assessment بالمرحلة 4', r.data.status === 'assessment' && r.data.stage === 4, r.data);
    r = await post(`/applications/${id}/facts-report`, as, { facts_summary: 'طوبقت المستندات مع السجل التجاري', recommendation: 'أوصي بالمنح' });
    T('تقرير وقائع يحمل توصية ← 422', r.status === 422, r.data);
    r = await post(`/applications/${id}/facts-report`, as, { facts_summary: 'قصير' });
    T('ملخص وقائع أقصر من اللازم ← 400', r.status === 400, r.data);
    r = await post(`/applications/${id}/facts-report`, as, { facts_summary: 'طوبقت المستندات مع السجل التجاري والملف الضريبي؛ لا مخالفة لقائمة الاستبعاد.',
      findings: [{ area: 'المستندات', fact: 'الإثباتات الإلزامية مقدَّمة', severity: 'info' }] });
    T('تقرير الوقائع ← decision_pending بالمرحلة 7', r.data.application?.status === 'decision_pending' && r.data.application?.stage === 7, r.data);
    r = await post(`/applications/${id}/decide`, await tok('director@sema.ly'), { decision: 'grant', reason: 'المدير التنفيذي يحاول المنح وهذا محظور' });
    T('المدير التنفيذي لا يقرر (403)', r.status === 403, r.status);
    r = await post(`/applications/${id}/decide`, lc, { decision: 'grant_lower_level', granted_level: 1, reason: 'منح بمستوى أدنى من المطلوب المساوي له — يُرفض' });
    T('المنح بمستوى أدنى يقتضي مستوى دون المطلوب ← 422', r.status === 422, r.data);
    r = await post(`/applications/${id}/decide`, lc, { decision: 'grant', granted_level: 1,
      reason: 'مستوفٍ لشروط الدخول في المادة (9) ولمعايير المستوى المطلوب، ولا مخالفة لقائمة الاستبعاد.' });
    T('القرار المسبَّب يعتمد الطلب', r.status === 200 && r.data.status === 'approved', r.data);
    r = await post(`/applications/${id}/decide`, lc, { decision: 'reject', reason: 'قرار ثانٍ على طلب مفصول فيه — يُرفض' });
    T('قرار مكرر ← 409', r.status === 409, r.data);
    r = await post(`/applications/${id}/screen`, as, { complete: true });
    T('فحص طلب مفصول فيه ← 409', r.status === 409, r.data);
    r = await post(`/applications/${id}/facts-report`, as, { facts_summary: 'تقرير وقائع على طلب مفصول فيه' });
    T('تقرير وقائع على طلب مفصول فيه ← 409', r.status === 409, r.data);
    const lic = (await get('/licensees/' + ctx.biz.lid, ctx.biz.token)).data;
    T('صار الملف «ساري» برقم ترخيص صحيح الصيغة', lic.status === 'active' && /^LY-KH-\d{4}-\d{2}$/.test(lic.license_no || ''), { st: lic.status, no: lic.license_no });
    T('أُنشئ إقرار امتثال مستقبلي للسنة', (lic.declarations || []).some((d) => d.fiscal_year === YEAR && d.status === 'pending'), lic.declarations);
    const st = (await get('/applications/' + id, ctx.biz.token)).data.stages || [];
    T('المراحل التسع مغلقة كلها', st.length === 9 && st.every((s) => s.completed_at), st.map((s) => [s.stage, !!s.completed_at]));
    ctx.biz.license_no = lic.license_no;
  });

  // ================================================================
  await section('ج. التجديد ورفع المستوى', async () => {
    if (!ctx.biz?.license_no) return SKIP('التجديد والترقية', 'لم يُمنح ترخيص الاختبار');
    const bt = ctx.biz.token, lid = ctx.biz.lid;
    let r = await post('/applications', bt, { app_type: 'license_renewal', subject_kind: 'licensee', subject_id: lid });
    T('طلب تجديد بلا إقرار امتثال مقدَّم ← 422', r.status === 422, r.data);
    r = await post('/applications', bt, { app_type: 'level_upgrade', subject_kind: 'licensee', subject_id: lid, requested_level: 1 });
    T('رفع مستوى إلى المستوى نفسه ← 422', r.status === 422, r.data);
    r = await post('/applications', bt, { app_type: 'level_upgrade', subject_kind: 'licensee', subject_id: lid });
    T('رفع مستوى بلا مستوى مطلوب ← 422', r.status === 422, r.data);
    r = await post('/applications', bt, { app_type: 'accreditation', subject_kind: 'licensee', subject_id: lid });
    T('نوع طلب لا يطابق نوع الجهة ← 400', r.status === 400, r.data);
    r = await post('/applications', bt, { app_type: 'level_upgrade', subject_kind: 'licensee', subject_id: 1, requested_level: 4 });
    T('طلب على ملف لا يملكه ← 403', r.status === 403, r.data);
    r = await post('/applications', bt, { app_type: 'level_upgrade', subject_kind: 'licensee', subject_id: lid, requested_level: 2 });
    T('رفع المستوى إلى 2 ← 201', r.status === 201 && r.data.app_type === 'level_upgrade', r.data);
    const upId = r.data.id;
    r = await post('/applications', bt, { app_type: 'level_upgrade', subject_kind: 'licensee', subject_id: lid, requested_level: 3 });
    T('طلب ثانٍ مفتوح للملف نفسه ← 409', r.status === 409, r.data);
    r = await get('/invoices', bt);
    T('طلب الترقية لا يُصدر فاتورة رسم طلب جديدة', (r.data.rows || []).filter((i) => i.fee_type === 'application').length === 1, r.data.rows?.map((i) => i.fee_type));
    // المسار الإيجابي للتجديد على ملف تصويري له إقرار مقدَّم
    const dt = await tok('director@sema.ly');
    const decls = (await get('/declarations?per_page=200&sort=-fiscal_year', dt)).data.rows || [];
    let cand = null;
    for (const d of decls.filter((x) => x.submitted_at && x.fiscal_year >= YEAR - 1 && x.licensee_id <= 43)) {
      const l = (await get('/licensees/' + d.licensee_id, dt)).data;
      if (l.status === 'active' && !(l.applications || []).some((a) => !['approved', 'rejected', 'shelved', 'withdrawn'].includes(a.status))) { cand = l; break; }
    }
    if (!cand) SKIP('تجديد بإقرار مقدَّم', 'لا ملف ساري بإقرار مقدَّم ولا طلب مفتوح');
    else {
      const pt = await tok(`partner${cand.id}@sema.ly`);
      r = await post('/applications', pt, { app_type: 'license_renewal', subject_kind: 'licensee', subject_id: cand.id });
      T(`تجديد ملف له إقرار مقدَّم (partner${cand.id}) ← 201`, r.status === 201 && r.data.app_type === 'license_renewal', r.data);
      ctx.renewalLicensee = cand.id;
    }
    ctx.upgradeAppId = upId;
  });

  // ================================================================
  await section('د. إقرارات الامتثال: المعالجة والقرار (المادتان 23 و24)', async () => {
    const dt = await tok('director@sema.ly'), as = await tok('assessor1@sema.ly'), lc = await tok('licensing1@sema.ly');
    const all = (await get('/declarations?per_page=200', dt)).data.rows || [];
    const pending = all.find((d) => !d.submitted_at);
    if (pending) {
      const r = await post(`/declarations/${pending.id}/process`, as, { status: 'accepted', facts_note: 'معالجة إقرار لم يُقدَّم بعد' });
      T('معالجة إقرار لم يُقدَّم ← مرفوضة (409/422)', [409, 422].includes(r.status), { s: r.status, d: r.data });
    } else SKIP('معالجة إقرار غير مقدَّم', 'لا إقرار معلّق');
    // مرشح للخفض: مقدَّم، غير معالج، غير مقرر، مستوى > 1
    let d = all.find((x) => x.submitted_at && !x.processed_at && !x.decided_at && x.level > 1 && x.licensee_id !== ctx.renewalLicensee);
    if (!d) {
      const p = all.find((x) => !x.submitted_at && x.level > 1 && x.licensee_id <= 43 && x.licensee_id !== ctx.renewalLicensee);
      if (p) {
        const pt = await tok(`partner${p.licensee_id}@sema.ly`);
        const r = await post(`/declarations/${p.id}/submit`, pt, { basis_type: 'tax_return', declared_revenue: 1000000, declared_net_profit: 50000, declared_total: 10000 });
        T('صاحب الملف يقدّم إقراره (tax_return)', r.status === 200 && !!r.data.submitted_at, r.data);
        d = { ...p, ...r.data };
      }
    }
    if (!d) return SKIP('باب الإقرارات', 'لا إقرار مناسب');
    const before = (await get('/licensees/' + d.licensee_id, dt)).data;
    let r = await post(`/declarations/${d.id}/decide`, lc, { outcome: 'renew', reason: 'قرار قبل وقائع وحدة التقييم — يُرفض' });
    T('قرار لجنة الترخيص قبل المعالجة ← 422', r.status === 422, r.data);
    r = await post(`/declarations/${d.id}/process`, as, { status: 'deficient', facts_note: 'عجز في الالتزام أقل من 20%', recommendation: 'أوصي بالخفض' });
    T('معالجة تحمل توصية ← 422', r.status === 422, r.data);
    r = await post(`/declarations/${d.id}/process`, as, { status: 'approved', facts_note: 'حالة غير صالحة للمعالجة' });
    T('حالة معالجة غير صالحة ← 400', r.status === 400, r.data);
    r = await post(`/declarations/${d.id}/process`, as, { status: 'deficient', facts_note: 'قصير' });
    T('معالجة بلا بيان وقائع كافٍ ← 422', r.status === 422, r.data);
    r = await post(`/declarations/${d.id}/process`, await tok('standards1@sema.ly'), { status: 'deficient', facts_note: 'لجنة المعايير لا تعالج الإقرارات' });
    T('لجنة المعايير لا تعالج الإقرار (403)', r.status === 403, r.status);
    r = await post(`/declarations/${d.id}/process`, as, { status: 'deficient', facts_note: 'المسدَّد الموثّق دون المستحق بنسبة تقل عن 20% وفق الكشوف المصرفية.' });
    T('المقيّم يعالج الإقرار ← deficient', r.status === 200 && r.data.declaration?.status === 'deficient' && !!r.data.declaration?.processed_at, r.data);
    r = await post(`/declarations/${d.id}/decide`, dt, { outcome: 'downgrade', reason: 'المدير التنفيذي يحاول الخفض وهذا محظور' });
    T('المدير التنفيذي لا يقرر في الإقرار (403)', r.status === 403, r.status);
    r = await post(`/declarations/${d.id}/decide`, lc, { outcome: 'demote', reason: 'قرار بقيمة غير معروفة' });
    T('قرار بقيمة غير صالحة ← 400', r.status === 400, r.data);
    r = await post(`/declarations/${d.id}/decide`, lc, { outcome: 'downgrade', reason: 'قصير' });
    T('قرار بلا تسبيب كافٍ ← 422', r.status === 422, r.data);
    r = await post(`/declarations/${d.id}/decide`, lc, { outcome: 'downgrade',
      reason: 'عجز في الالتزام أقل من 20% عن السنة المالية — خفض المستوى المعلن درجة واحدة (المادة 29/3).' });
    T('لجنة الترخيص تقرر الخفض', r.status === 200 && r.data.outcome === 'downgrade' && !!r.data.decided_at, r.data);
    const after = (await get('/licensees/' + d.licensee_id, dt)).data;
    T(`انخفض المستوى درجة (${before.level} ← ${after.level})`, after.level === before.level - 1, { before: before.level, after: after.level });
    T('قُيّد جزاء «level_downgrade»', (after.sanctions || []).length === (before.sanctions || []).length + 1 &&
      (after.sanctions || []).some((s) => s.measure === 'level_downgrade' && s.violation_code === 3), after.sanctions?.map((s) => s.measure));
    r = await post(`/declarations/${d.id}/decide`, lc, { outcome: 'renew', reason: 'قرار ثانٍ على الإقرار نفسه — يُرفض' });
    T('قرار ثانٍ على الإقرار ← 409', r.status === 409, r.data);
    r = await post(`/declarations/${d.id}/process`, as, { status: 'accepted', facts_note: 'معالجة بعد صدور القرار — تُرفض' });
    T('معالجة بعد القرار ← 409', r.status === 409, r.data);
    ctx.downgraded = d.licensee_id;
  });

  // ================================================================
  await section('هـ. المساهمات والإثباتات (المواد 20–22)', async () => {
    const dt = await tok('director@sema.ly');
    const lics = (await get('/licensees?status=active&per_page=200&sort=legal_name', dt)).data.rows || [];
    const L = lics.find((l) => l.id <= 43 && ![ctx.downgraded, ctx.renewalLicensee].includes(l.id));
    const orgs = (await get('/associations?status=accredited&per_page=200', dt)).data.rows || [];
    const cands = orgs.filter((o) => o.id <= 24 && (o.absorption_cap || 0) - (o.absorption_used || 0) > 50000);
    const O = cands[0], O2 = orgs.find((o) => o.id <= 24 && o.id !== O?.id);
    if (!L || !O || !O2) return SKIP('المساهمات', 'لا مرخَّص له ساري أو منظمة معتمدة بسعة كافية');
    const pt = await tok(`partner${L.id}@sema.ly`), ot = await tok(`org${O.id}@sema.ly`), ot2 = await tok(`org${O2.id}@sema.ly`);
    const au = await tok('auditor1@sema.ly');
    const base = { licensee_id: L.id, fiscal_year: YEAR, purpose: 'اختبار وحدة المساهمات ' + UNIQ, transfer_date: TODAY };
    let r = await post('/contributions', pt, { ...base, channel: 'cash', amount: 0, association_id: O.id });
    T('مبلغ صفري ← 400', r.status === 400, r.data);
    r = await post('/contributions', pt, { ...base, channel: 'cash', amount: -100, association_id: O.id });
    T('مبلغ سالب ← 400', r.status === 400, r.data);
    r = await post('/contributions', pt, { ...base, channel: 'cash', amount: 100, fiscal_year: YEAR + 1, association_id: O.id });
    T('سنة مالية مستقبلية ← 400', r.status === 400, r.data);
    r = await post('/contributions', pt, { ...base, channel: 'inkind', amount: 500, association_id: O.id });
    T('تبرع عيني بلا تقييم طرف ثالث ← 422', r.status === 422, r.data);
    r = await post('/contributions', pt, { ...base, channel: 'volunteer', amount: 500 });
    T('تطوع بلا سجل ساعات ← 422', r.status === 422, r.data);
    r = await post('/contributions', pt, { ...base, channel: 'bogus', amount: 500 });
    T('مسار غير معروف ← 400', r.status === 400, r.data);
    r = await post('/contributions', pt, { ...base, channel: 'direct_program', amount: 800, purpose: 'برنامج تدريب مهني ذاتي ' + UNIQ });
    T('برنامج تنموي ذاتي يُسجَّل (201)', r.status === 201, r.data);
    const dp = r.data.id;
    r = await post(`/contributions/${dp}/verify`, au, { status: 'verified' });
    T('لا تحقّق من برنامج ذاتي قبل الموافقة المسبقة ← 422', r.status === 422, r.data);
    r = await post(`/contributions/${dp}/preapprove`, au, {});
    T('المدقق الميداني لا يملك الموافقة المسبقة (403)', r.status === 403, r.status);
    r = await post(`/contributions/${dp}/preapprove`, await tok('standards1@sema.ly'), {});
    T('لجنة المعايير توافق مسبقاً', r.status === 200 && r.data.program_preapproved === 1 && r.data.status === 'documented', r.data);
    r = await post(`/contributions/${dp}/verify`, au, { status: 'verified' });
    T('التحقق بعد الموافقة المسبقة ← verified', r.status === 200 && r.data.status === 'verified', r.data);

    r = await post('/contributions', pt, { ...base, channel: 'cash', amount: 1200, association_id: O.id, bank_ref: 'TRF-' + UNIQ });
    T('مساهمة نقدية لمنظمة معتمدة (201)', r.status === 201, r.data);
    const c1 = r.data.id;
    r = await post('/contributions', pt, { ...base, channel: 'cash', amount: 700, association_id: O.id, bank_ref: 'TRF2-' + UNIQ });
    const c2 = r.data.id;
    const form0 = new FormData(); form0.append('file', pdfBlob('early'), 'impact-early.pdf');
    r = await api('POST', `/contributions/${c2}/impact`, { tok: ot, form: form0 });
    T('تقرير أثر قبل إقرار الاستلام ← 422', r.status === 422, r.data);
    r = await post(`/contributions/${c1}/confirm-receipt`, ot2, {});
    T('منظمة غير متلقية لا تقرّ الاستلام (403)', r.status === 403, r.data);
    r = await post(`/contributions/${c1}/confirm-receipt`, ot, {});
    T('المنظمة المتلقية تقرّ الاستلام', r.status === 200 && r.data.receipt_confirmed === 1 && r.data.status === 'documented', r.data);
    r = await post(`/contributions/${c1}/confirm-receipt`, ot, {});
    T('إقرار استلام مكرر ← 409', r.status === 409, r.data);
    r = await api('POST', `/contributions/${c1}/impact`, { tok: ot, body: {} });
    T('تقرير أثر بلا ملف ← 400', r.status === 400, r.data);
    let form = new FormData(); form.append('file', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'impact.html');
    r = await api('POST', `/contributions/${c1}/impact`, { tok: ot, form });
    T('تقرير أثر بملف HTML ← 415', r.status === 415, r.data);
    form = new FormData(); form.append('file', pdfBlob('impact'), 'impact.pdf'); form.append('beneficiaries', '120'); form.append('spent_pct', '80');
    r = await api('POST', `/contributions/${c1}/impact`, { tok: ot2, form });
    T('منظمة أخرى لا تقدّم تقرير الأثر (403)', r.status === 403, r.data);
    form = new FormData(); form.append('file', pdfBlob('impact'), 'impact.pdf'); form.append('beneficiaries', '120'); form.append('spent_pct', '80');
    r = await api('POST', `/contributions/${c1}/impact`, { tok: ot, form });
    T('تقرير الأثر (PDF) بعد الاستلام يُقبل', r.status === 200 && !!r.data.impact_doc_id, r.data);
    ctx.impactDoc = r.data.impact_doc_id;

    // تحميل الإثباتات
    const up = async (name, type, content, owner = L.id, t = pt) => {
      const f = new FormData();
      f.append('file', new Blob([content], { type }), name);
      f.append('owner_kind', 'licensee'); f.append('owner_id', String(owner)); f.append('title', 'اختبار ' + name);
      return api('POST', '/documents', { tok: t, form: f });
    };
    r = await up('evil.html', 'text/html', '<html><script>alert(1)</script></html>');
    T('تحميل ملف .html ← 415', r.status === 415, r.data);
    r = await up('evil.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    T('تحميل ملف .svg ← 415', r.status === 415, r.data);
    r = await up('evil.PDF.html', 'text/html', '<html></html>');
    T('امتداد مزدوج ينتهي بـ .html ← 415', r.status === 415, r.data);
    const otherLic = lics.find((l) => l.id !== L.id);
    r = await up('doc.pdf', 'application/pdf', `%PDF-1.4 other ${UNIQ}`, otherLic.id);
    T('تحميل إثبات على ملف لا يملكه ← 403', r.status === 403, r.data);
    r = await up('proof.pdf', 'application/pdf', `%PDF-1.4 proof ${UNIQ}`);
    T('تحميل PDF على ملفه ← 201 ببصمة', r.status === 201 && /^[0-9a-f]{64}$/.test(r.data.sha256 || ''), r.data);
    ctx.privDoc = { id: r.data.id, owner: L.id, ownerTok: pt };
    r = await up('proof-copy.pdf', 'application/pdf', `%PDF-1.4 proof ${UNIQ}`);
    T('ملف مكرر بالبصمة يُرصد (duplicate_of)', r.status === 201 && r.data.duplicate_of === ctx.privDoc.id, r.data);
    r = await api('POST', '/documents', { tok: pt, form: new FormData() });
    T('تحميل بلا ملف ← 400', r.status === 400, r.data);
  });

  // ================================================================
  await section('و. تنزيل المستندات: العام والمحمي والعزل', async () => {
    const dt = await tok('director@sema.ly');
    let pubId = ctx.impactDoc;
    if (!pubId) pubId = (await get('/documents?is_public=1&per_page=1', dt)).data.rows?.[0]?.id;
    if (!pubId) SKIP('مستند عام', 'لا مستند منشور');
    else {
      const r = await api('GET', `/documents/${pubId}/file`);
      T('مستند منشور يُنزَّل بلا دخول (200)', r.status === 200, { s: r.status, d: r.data });
      const csp = r.headers.get('content-security-policy') || '';
      T('ترويسة CSP للمستند تحوي sandbox', /sandbox/.test(csp), csp);
      T('ترويسة nosniff للمستند', r.headers.get('x-content-type-options') === 'nosniff');
    }
    const seededPub = (await get('/documents?is_public=1&per_page=1&sort=uploaded_at', dt)).data.rows?.[0];
    if (seededPub) {
      const r = await api('GET', `/documents/${seededPub.id}/file`);
      T('مستند تصويري منشور يُنزَّل بلا دخول', r.status === 200, r.status);
    }
    const priv = ctx.privDoc?.id || (await get('/documents?is_public=0&per_page=1', dt)).data.rows?.[0]?.id;
    if (!priv) return SKIP('مستند غير عام', 'لا مستند');
    let r = await api('GET', `/documents/${priv}/file`);
    T('مستند غير منشور بلا دخول ← 401', r.status === 401, r.status);
    r = await api('GET', `/documents/${priv}/file`, { tok: 'not-a-valid-token' });
    T('رمز غير صالح ← 401', r.status === 401, r.status);
    if (ctx.privDoc) {
      r = await api('GET', `/documents/${priv}/file`, { tok: ctx.privDoc.ownerTok });
      T('صاحب المستند ينزّله (200) مع CSP sandbox', r.status === 200 && /sandbox/.test(r.headers.get('content-security-policy') || ''), r.status);
      const stranger = (await get('/licensees?status=active&per_page=200', dt)).data.rows.find((l) => l.id <= 43 && l.id !== ctx.privDoc.owner);
      r = await api('GET', `/documents/${priv}/file`, { tok: await tok(`partner${stranger.id}@sema.ly`) });
      T('شريك آخر لا ينزّل المستند (403)', r.status === 403, r.status);
      r = await api('GET', `/documents/${priv}/file`, { tok: dt });
      T('المدير (doc.view.all) ينزّله', r.status === 200, r.status);
    }
    r = await api('GET', '/documents/99999999/file', { tok: dt });
    T('مستند غير موجود ← 404', r.status === 404, r.status);
  });

  // ================================================================
  await section('ز. مقترحات المعايير والمشاورة العامة (المادة 19/3)', async () => {
    const st = await tok('standards1@sema.ly'), ch = await tok('chair@sema.ly');
    let r = await post('/proposals', st, { title: 'مقترح اختبار ' + UNIQ, summary: 'ملخص المقترح', body: 'نص المقترح الكامل للتعديل', kind: 'standard', is_material: true, article_ref: 'م20' });
    T('لجنة المعايير تنشئ مقترحاً (201) بحالة draft', r.status === 201 && r.data.status === 'draft', r.data);
    const P = r.data;
    r = await post('/proposals', await tok('assessor1@sema.ly'), { title: 't', summary: 's', body: 'b' });
    T('المقيّم لا ينشئ مقترحاً (403)', r.status === 403, r.status);
    r = await post('/proposals', st, { title: 'x', summary: 'y' });
    T('مقترح بلا نص ← 400', r.status === 400, r.data);
    const comment = { author_name: 'مواطن مهتم', author_kind: 'public', body: 'أقترح توضيح طريقة احتساب الأرضية للمنشآت الموسمية.' };
    r = await post(`/public/consultations/${P.id}/comments`, null, comment);
    T('مداخلة على مسوّدة ← 422', r.status === 422, r.data);
    r = await post(`/proposals/${P.id}/open-consultation`, st, { days: 20 });
    T('مشاورة جوهرية أقل من 30 يوماً ← 422', r.status === 422, r.data);
    r = await post(`/proposals/${P.id}/submit`, st, {});
    T('رفع مقترح جوهري قبل المشاورة ← 422', r.status === 422, r.data);
    r = await post(`/proposals/${P.id}/open-consultation`, st, { days: 30 });
    T('فتح مشاورة 30 يوماً ← consultation', r.status === 200 && r.data.status === 'consultation' && r.data.consultation_end === addDays(TODAY, 30), r.data);
    r = await post(`/proposals/${P.id}/open-consultation`, st, { days: 30 });
    T('فتح المشاورة مرتين ← 409', r.status === 409, r.data);
    r = await get('/public/consultations');
    const row = (r.data.rows || []).find((x) => x.id === P.id);
    T('المشاورة ظاهرة للعموم بعلامة open=true', r.status === 200 && row?.open === true && row?.days_left === 30, row);
    r = await post(`/public/consultations/${P.id}/comments`, null, comment);
    T('مداخلة عامة بلا دخول (201)', r.status === 201 && !!r.data.id, r.data);
    const cid = r.data.id;
    r = await post(`/public/consultations/${P.id}/comments`, null, { author_name: 'x', body: 'قصير' });
    T('مداخلة أقصر من 15 حرفاً ← 400', r.status === 400, r.data);
    r = await post('/public/consultations/99999999/comments', null, comment);
    T('مداخلة على مقترح غير موجود ← 404', r.status === 404, r.status);
    r = await post(`/proposals/${P.id}/close-consultation`, st, { response_summary: 'ملخص المداخلات وردود اللجنة عليها' });
    T('إغلاق المشاورة قبل موعد انتهائها ← 422', r.status === 422, r.data);
    r = await post(`/proposals/${P.id}/submit`, st, {});
    T('رفع مقترح جوهري قبل إغلاق المشاورة ← 422', r.status === 422, r.data);
    r = await post(`/proposals/${P.id}/decide`, st, { decision: 'approved', reason: 'لجنة المعايير تعتمد مقترحها بنفسها', effective_from: addDays(TODAY, 90) });
    T('لجنة المعايير لا تعتمد (403)', r.status === 403, r.status);
    r = await post(`/proposals/${P.id}/decide`, ch, { decision: 'approved', reason: 'اعتماد قبل الرفع للمجلس', effective_from: addDays(TODAY, 90) });
    T('المجلس لا يعتمد مقترحاً لم يُرفع ← 409', r.status === 409, r.data);
    r = await post(`/proposals/${P.id}/comments/${cid}/respond`, st, { response: 'شكراً — سنوضح ذلك في النص النهائي.' });
    T('اللجنة ترد على المداخلة', r.status === 200 && !!r.data.responded_at, r.data);
    r = await get(`/proposals/${P.id}`, st);
    T('تفاصيل المقترح تُظهر المداخلة والأيام المتبقية', r.data.comments?.length === 1 && r.data.days_left === 30, { c: r.data.comments?.length, d: r.data.days_left });

    // مسار ما بعد انتهاء المشاورة — لا يمكن تقديم الزمن عبر الـ API
    const ended = ((await get('/proposals?status=consultation&per_page=200', st)).data.rows || []).find((x) => x.consultation_end < TODAY);
    if (!ended) SKIP('إغلاق المشاورة بعد انتهائها ثم الرفع', 'لا مقترح تصويري انتهت مشاورته، ولا يمكن تقديم الزمن عبر الـ API');
    else {
      r = await post(`/proposals/${ended.id}/close-consultation`, st, { response_summary: 'قصير' });
      T('إغلاق بلا ملخص ردود ← 422', r.status === 422, r.data);
      r = await post(`/proposals/${ended.id}/close-consultation`, st, { response_summary: 'ملخص المداخلات وردود اللجنة المنشورة عليها.' });
      T(`إغلاق مشاورة منتهية (${ended.reference}) ← consultation_closed`, r.data.status === 'consultation_closed', r.data);
      r = await get('/public/consultations');
      const pr = (r.data.rows || []).find((x) => x.id === ended.id);
      T('المشاورة المغلقة تُنشر بملخص الردود وopen=false', pr?.open === false && !!pr?.response_summary, pr);
      r = await post(`/public/consultations/${ended.id}/comments`, null, comment);
      T('مداخلة على مشاورة مغلقة ← 422', r.status === 422, r.data);
      const unanswered = ((await get(`/proposals/${ended.id}`, st)).data.comments || []).filter((c) => !c.response);
      r = await post(`/proposals/${ended.id}/submit`, st, {});
      if (unanswered.length) {
        T('الرفع مع مداخلات بلا رد ← 422', r.status === 422, r.data);
        for (const c of unanswered) await post(`/proposals/${ended.id}/comments/${c.id}/respond`, st, { response: 'نشكركم — أُخذت المداخلة بالاعتبار.' });
        r = await post(`/proposals/${ended.id}/submit`, st, {});
      }
      T('بعد الإغلاق والرد على المداخلات يُرفع للمجلس', r.status === 200 && r.data.status === 'submitted_to_board', r.data);
    }
    const floors = ((await get('/proposals?status=submitted_to_board&kind=floors&per_page=50', st)).data.rows || [])[0];
    if (!floors) SKIP('قرار المجلس في تعديل الأرضيات', 'لا مقترح أرضيات مرفوع');
    else {
      r = await post(`/proposals/${floors.id}/decide`, ch, { decision: 'approved', reason: 'اعتماد الأرضيات المعدّلة وفق المراجعة الدورية.', effective_from: addDays(TODAY, 59) });
      T(`أرضيات (${floors.reference}) بنفاذ بعد 59 يوماً ← 422`, r.status === 422, r.data);
      r = await post(`/proposals/${floors.id}/decide`, ch, { decision: 'approved', reason: 'اعتماد الأرضيات المعدّلة وفق المراجعة الدورية.', effective_from: addDays(TODAY, 60) });
      T('أرضيات بنفاذ بعد 60 يوماً تُعتمد', r.status === 200 && r.data.status === 'approved', r.data);
    }

    // مقترحات غير جوهرية: الرفع المباشر وقرارات المجلس والجمعية العمومية
    r = await post('/proposals', st, { title: 'تفسير اختبار ' + UNIQ, summary: 'تفسير', body: 'نص التفسير', kind: 'interpretation', is_material: false });
    const I = r.data;
    r = await post(`/proposals/${I.id}/submit`, st, {});
    T('مقترح غير جوهري يُرفع من المسوّدة مباشرةً', r.data.status === 'submitted_to_board', r.data);
    r = await post(`/proposals/${I.id}/decide`, ch, { decision: 'approved', reason: 'قصير' });
    T('قرار المجلس بلا تسبيب ← 422', r.status === 422, r.data);
    r = await post(`/proposals/${I.id}/decide`, ch, { decision: 'approved', reason: 'تفسير متسق مع نص المادة ومقاصدها.' });
    T('اعتماد بلا تاريخ نفاذ ← 422', r.status === 422, r.data);
    r = await post(`/proposals/${I.id}/decide`, ch, { decision: 'approved', reason: 'تفسير متسق مع نص المادة ومقاصدها.', effective_from: addDays(TODAY, 7) });
    T('رئيس المجلس يعتمد التفسير', r.status === 200 && r.data.status === 'approved', r.data);
    // الرسوم والأرضيات والنظام الداخلي تعديلات جوهرية دائماً: لا تُرفع دون مشاورة ولو وُسمت «غير جوهرية»
    r = await post('/proposals', st, { title: 'رسوم اختبار ' + UNIQ, summary: 'رسوم', body: 'تعديل جدول الرسوم', kind: 'fees', is_material: false });
    T('تعديل الرسوم يُعامَل جوهرياً مهما وُسم', r.data.is_material === 1, r.data);
    r = await post(`/proposals/${r.data.id}/submit`, st, {});
    T('تعديل الرسوم لا يُرفع دون مشاورة عامة ← 422 (المادة 19/3)', r.status === 422, r.data);
    // مقترح الأرضيات المرفوع في البذرة بعد مشاورة مكتملة
    const FL = ((await get('/proposals?q=STD-00002', st)).data.rows || [])[0];
    if (FL && FL.status === 'submitted_to_board') {
      r = await post(`/proposals/${FL.id}/decide`, ch, { decision: 'approved', reason: 'تعديل الأرضيات وفق دراسة الكلفة.', effective_from: addDays(TODAY, 30) });
      T('تعديل الأرضيات بنفاذ أقل من 60 يوماً ← 422 (المادة 5)', r.status === 422, r.data);
      r = await post(`/proposals/${FL.id}/decide`, ch, { decision: 'approved', reason: 'تعديل الأرضيات وفق دراسة الكلفة.', effective_from: '2026-13-45' });
      T('تاريخ نفاذ غير صالح ← 422', r.status === 422, r.data);
      r = await post(`/proposals/${FL.id}/decide`, ch, { decision: 'approved', reason: 'تعديل الأرضيات وفق دراسة الكلفة.', effective_from: addDays(TODAY, 90) });
      T('تعديل الأرضيات بنفاذ بعد 90 يوماً يُعتمد', r.status === 200 && r.data.status === 'approved', r.data);
    } else SKIP('قرار الأرضيات', 'STD-00002 غير مرفوع في البذرة');
    // تعديل النظام الداخلي المرفوع في البذرة — قراره للجمعية العمومية
    const BY = ((await get('/proposals?q=STD-00005', st)).data.rows || [])[0];
    if (BY && BY.status === 'submitted_to_board') {
      r = await post(`/proposals/${BY.id}/decide`, ch, { decision: 'approved', reason: 'تعديل النظام الداخلي.', effective_from: addDays(TODAY, 30) });
      T('تعديل النظام الداخلي ليس للمجلس (403)', r.status === 403, r.status);
      r = await post(`/proposals/${BY.id}/decide`, await tok('ga1@sema.ly'), { decision: 'rejected', reason: 'لم يحز أغلبية الثلثين في الجمعية العمومية.' });
      T('الجمعية العمومية تبتّ في تعديل النظام', r.status === 200 && r.data.status === 'rejected', r.data);
    } else SKIP('قرار تعديل النظام', 'STD-00005 غير مرفوع في البذرة');
    r = await get('/public/consultations');
    T('المسوّدات لا تظهر للعموم', !(r.data.rows || []).some((x) => x.status === 'draft'), (r.data.rows || []).map((x) => x.status));
  });

  // ================================================================
  await section('ح. البلاغات ومتابعتها (نموذج 9)', async () => {
    const text = 'بلاغ اختبار ' + UNIQ + ': استعمال الشعار على منتج خارج النطاق المرخَّص.';
    let r = await post('/complaints', null, { body: text, is_anonymous: true, subject_name: 'متجر مجهول' });
    T('بلاغ بلا دخول (201) برقم مرجعي ورمز متابعة', r.status === 201 && /^CMP-\d+/.test(r.data.reference || '') && /^[0-9A-F]{8}$/.test(r.data.tracking_code || ''), r.data);
    const { reference, tracking_code } = r.data;
    r = await post('/complaints', null, { body: 'قصير' });
    T('بلاغ بلا نص كافٍ ← 400', r.status === 400, r.data);
    r = await get(`/public/complaints/track?reference=${encodeURIComponent(reference)}&code=${tracking_code}`);
    T('المتابعة بالرمز الصحيح ← 200 بالحالة', r.status === 200 && r.data.status === 'received' && r.data.reference === reference, r.data);
    T('المتابعة لا تسرّب نص البلاغ ولا رمزه ولا هوية المبلّغ',
      !r.text.includes(UNIQ) && !('body' in r.data) && !('tracking_code' in r.data) && !('reporter_name' in r.data), r.data);
    r = await get(`/public/complaints/track?reference=${encodeURIComponent(reference.toLowerCase())}&code=${tracking_code.toLowerCase()}`);
    T('المتابعة لا تتأثر بحالة الأحرف', r.status === 200, r.status);
    r = await get(`/public/complaints/track?reference=${encodeURIComponent(reference)}&code=00000000`);
    T('رمز خاطئ ← 404', r.status === 404, r.status);
    r = await get(`/public/complaints/track?reference=${encodeURIComponent(reference)}`);
    T('بلا رمز ← 404', r.status === 404, r.status);
    const nf = await get(`/public/complaints/track?reference=CMP-99999&code=${tracking_code}`);
    T('مرجع غير موجود ← 404 بالرسالة نفسها', nf.status === 404 && nf.data.error === r.data.error, { s: nf.status, a: nf.data.error, b: r.data.error });
    r = await get('/public/complaints/track?reference=CMP-00001&code=SEMA2026');
    if (r.status === 404) SKIP('متابعة البلاغ التصويري CMP-00001', 'رمز المتابعة التصويري غير موجود في هذه البيانات');
    else T('البلاغ التصويري CMP-00001 يُتابَع برمزه', r.status === 200 && r.data.reference === 'CMP-00001' && !('body' in r.data), r.data);
  });

  // ================================================================
  await section('ط. رمز QR للتحقق (المادة 36)', async () => {
    const lic = (await get('/public/registry/licensees?status=active&per_page=1')).data.rows?.[0];
    if (!lic) return SKIP('QR', 'لا مرخَّص له منشور');
    let r = await api('GET', `/public/qr/${encodeURIComponent(lic.license_no)}.svg`);
    T('QR برقم الترخيص ← image/svg+xml', r.status === 200 && /image\/svg\+xml/.test(r.headers.get('content-type') || ''), { s: r.status, ct: r.headers.get('content-type') });
    T('المحتوى رسم SVG', r.text.includes('<svg'), r.text.slice(0, 80));
    if (lic.qr_token) {
      r = await api('GET', `/public/qr/${lic.qr_token}.svg`);
      T('QR برمز التحقق ← 200', r.status === 200, r.status);
    }
    r = await api('GET', '/public/qr/LY-KH-9999-99.svg');
    T('رقم غير مقيَّد ← 404', r.status === 404, r.status);
  });

  // ================================================================
  await section('ي. المهام الآلية', async () => {
    const dt = await tok('director@sema.ly');
    let r = await post('/jobs/run', await tok('assessor1@sema.ly'), {});
    T('المقيّم لا يشغّل المهام (403)', r.status === 403, r.status);
    r = await post('/jobs/run', null, {});
    T('بلا دخول ← 401', r.status === 401, r.status);
    r = await post('/jobs/run', dt, { job: 'no_such_job' });
    T('مهمة غير معروفة ← 400', r.status === 400, r.data);
    r = await post('/jobs/run', dt, {});
    T('المدير يشغّل المهام العشر', r.status === 200 && r.data.results?.length === 10, r.data.results?.map((x) => x.job));
    T('لا خطأ في أي مهمة', (r.data.results || []).every((x) => !x.error), (r.data.results || []).filter((x) => x.error));
    r = await post('/jobs/run', dt, { job: 'invoices_overdue' });
    T('تشغيل مهمة واحدة', r.status === 200 && r.data.results?.length === 1, r.data);
    r = await get('/jobs', dt);
    T('سجل التشغيل يحوي المهام العشر ودوراتها', r.status === 200 && r.data.jobs?.length === 10 && r.data.runs?.length >= 11 && r.data.jobs.every((j) => j.last), { j: r.data.jobs?.length, r: r.data.runs?.length });
    r = await get('/jobs', await tok('partner1@sema.ly'));
    T('الشريك لا يطّلع على سجل المهام (403)', r.status === 403, r.status);
  });

  // ================================================================
  await section('ك. الأمان: حد المحاولات، تغيير كلمة المرور، الإيقاف، الترويسات', async () => {
    // ترويسات
    let r = await api('GET', '/health');
    T('X-Frame-Options: DENY', r.headers.get('x-frame-options') === 'DENY', r.headers.get('x-frame-options'));
    T('Content-Security-Policy موجودة وتمنع التأطير', /frame-ancestors 'none'/.test(r.headers.get('content-security-policy') || ''), r.headers.get('content-security-policy'));
    T('X-Content-Type-Options: nosniff', r.headers.get('x-content-type-options') === 'nosniff');
    T('لا X-Powered-By', !r.headers.get('x-powered-by'));
    const idx = await fetch(B.replace(/\/api$/, '/'));
    T('الصفحة الرئيسة تحمل CSP و X-Frame-Options', !!idx.headers.get('content-security-policy') && idx.headers.get('x-frame-options') === 'DENY');
    r = await api('GET', '/licensees');
    T('مسار داخلي بلا دخول ← 401', r.status === 401, r.status);
    r = await api('GET', '/auth/me', { tok: 'eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjF9.bad' });
    T('رمز مزوّر ← 401', r.status === 401, r.status);
    r = await api('POST', '/auth/login', { body: undefined, headers: { 'content-type': 'application/json' } });
    T('طلب دخول بجسم فارغ لا يُسقط الخادم (4xx)', r.status >= 400 && r.status < 500, r.status);
    r = await fetch(B + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad json' });
    T('JSON تالف ← 400', r.status === 400, r.status);

    // حد محاولات الدخول — على حساب مسجَّل خصيصاً
    const lockEmail = `lock-${UNIQ}@test.ly`;
    r = await post('/public/register/business', null, bizBody(lockEmail), { ip: nextIp() });
    const lockIp = '10.66.6.6';
    const codes = [];
    for (let i = 0; i < 6; i++) codes.push((await login(lockEmail, 'Wrong-pass-' + i, lockIp)).status);
    T('خمس محاولات خاطئة ← 401 ثم السادسة ← 429', codes.slice(0, 5).every((c) => c === 401) && codes[5] === 429, codes);
    r = await login(lockEmail, 'Test2026pass', lockIp);
    T('حتى كلمة المرور الصحيحة ← 429 أثناء الحظر', r.status === 429, r.status);
    r = await login(lockEmail, 'Test2026pass', '10.66.6.7');
    T('الحظر لا يُتجاوز بتغيير X-Forwarded-For', r.status === 429,
      { status: r.status, note: 'trust proxy=true يجعل req.ip من ترويسة يتحكم بها العميل' });

    // تغيير كلمة المرور
    if (!ctx.biz) SKIP('تغيير كلمة المرور', 'لا حساب اختبار');
    else {
      const l1 = await login(ctx.biz.email, ctx.biz.password);
      const old = l1.data.token;
      await sleep(2100); // الطابع الزمني للرمز بدقة الثانية
      r = await post('/auth/password', old, { current_password: 'wrong-123', new_password: 'NewPass2026' });
      T('كلمة المرور الحالية خاطئة ← 422', r.status === 422, r.data);
      r = await post('/auth/password', old, { current_password: ctx.biz.password, new_password: ctx.biz.password });
      T('كلمة المرور الجديدة مطابقة للقديمة ← 422', r.status === 422, r.data);
      r = await post('/auth/password', old, { current_password: ctx.biz.password, new_password: 'short1' });
      T('كلمة مرور جديدة ضعيفة ← 422', r.status === 422, r.data);
      r = await post('/auth/password', old, { current_password: ctx.biz.password, new_password: 'NewPass2026' });
      T('تغيير كلمة المرور ← 200 برمز جديد', r.status === 200 && !!r.data.token, r.data);
      const fresh = r.data.token;
      r = await get('/auth/me', old);
      T('الرمز القديم يسقط (401)', r.status === 401, r.status);
      r = await get('/auth/me', ctx.biz.token);
      T('رمز التسجيل الأصلي يسقط (401)', r.status === 401, r.status);
      r = await get('/auth/me', fresh);
      T('الرمز الجديد يعمل', r.status === 200 && r.data.email === ctx.biz.email, r.status);
      T('الدخول بكلمة المرور القديمة ← 401', (await login(ctx.biz.email, ctx.biz.password, nextIp())).status === 401);
      T('الدخول بكلمة المرور الجديدة ← 200', (await login(ctx.biz.email, 'NewPass2026', nextIp())).status === 200);
      ctx.biz.password = 'NewPass2026'; ctx.biz.token = fresh;
    }
    // الرمز الصادر قبل التغيير بلحظات يجب أن يسقط أيضاً
    const qEmail = `quick-${UNIQ}@test.ly`;
    r = await post('/public/register/business', null, bizBody(qEmail), { ip: nextIp() });
    if (r.status !== 201) SKIP('تغيير فوري لكلمة المرور', 'تعذّر التسجيل');
    else {
      const t0 = r.data.token;
      const ch = await post('/auth/password', t0, { current_password: 'Test2026pass', new_password: 'Quick2026pass' });
      r = await get('/auth/me', t0);
      T('رمز صادر قبل تغيير كلمة المرور بأقل من ثانيتين يسقط أيضاً', ch.status === 200 && r.status === 401,
        { change: ch.status, old_token_me: r.status });
    }

    // إيقاف مستخدم
    const sEmail = `susp-${UNIQ}@test.ly`;
    r = await post('/public/register/business', null, bizBody(sEmail), { ip: nextIp() });
    if (r.status !== 201) SKIP('إيقاف مستخدم', 'تعذّر التسجيل');
    else {
      const st = r.data.token, uid = r.data.user.id;
      T('رمز المستخدم يعمل قبل الإيقاف', (await get('/auth/me', st)).status === 200);
      r = await post(`/users/${uid}/status`, await tok('assessor1@sema.ly'), { status: 'suspended' });
      T('المقيّم لا يوقف المستخدمين (403)', r.status === 403, r.status);
      r = await post(`/users/${uid}/status`, await tok('director@sema.ly'), { status: 'frozen' });
      T('حالة مستخدم غير صالحة ← 400', r.status === 400, r.data);
      r = await post(`/users/${uid}/status`, await tok('director@sema.ly'), { status: 'suspended' });
      T('المدير يوقف المستخدم', r.status === 200, r.data);
      r = await get('/auth/me', st);
      T('رمز المستخدم الموقوف يُرفض (401)', r.status === 401, r.status);
      r = await login(sEmail, 'Test2026pass', nextIp());
      T('المستخدم الموقوف لا يدخل', r.status !== 200 && !r.data.token, { s: r.status, d: r.data });
    }
  });

  // ================================================================
  await section('ل. الاجتماعات والمراقبون (المادتان 16 و34)', async () => {
    const dt = await tok('director@sema.ly');
    const users = (await get('/users?role=BOARD_MEMBER&per_page=200', dt)).data.rows || [];
    const board = users.filter((u) => u.roles.some((x) => x.role_code === 'BOARD_MEMBER')).map((u) => u.id);
    const obs = ((await get('/observers?status=admitted&per_page=50', dt)).data.rows || []).map((o) => o.id);
    const nominated = ((await get('/observers?status=nominated&per_page=50', dt)).data.rows || []).map((o) => o.id);
    if (board.length < 6 || obs.length < 1) return SKIP('الاجتماعات', `أعضاء المجلس ${board.length}، المراقبون المقبولون ${obs.length}`);
    const base = { title: 'اجتماع اختبار ' + UNIQ, held_on: TODAY, decisions: 'اعتماد محضر الجلسة السابقة.' };
    let r = await post('/meetings', dt, { ...base, body: 'licensing', attendee_ids: board.slice(0, 3), observer_ids: [obs[0]] });
    T('مراقب في اجتماع لجنة الترخيص ← 422', r.status === 422, r.data);
    r = await post('/meetings', dt, { ...base, body: 'board', attendee_ids: board.slice(0, 5), observer_ids: [] });
    T('اجتماع مجلس دون النصاب (5 من 6) ← 422', r.status === 422, r.data);
    if (nominated.length) {
      r = await post('/meetings', dt, { ...base, body: 'board', attendee_ids: board.slice(0, 6), observer_ids: [nominated[0]] });
      T('مراقب غير مقبول ← 422', r.status === 422, r.data);
    }
    r = await post('/meetings', dt, { ...base, body: 'senate', attendee_ids: board });
    T('جهة اجتماع غير صالحة ← 400', r.status === 400, r.data);
    r = await post('/meetings', await tok('assessor1@sema.ly'), { ...base, body: 'board', attendee_ids: board.slice(0, 6) });
    T('المقيّم لا ينشئ اجتماعات (403)', r.status === 403, r.status);
    const oIds = obs.slice(0, 2);
    r = await post('/meetings', dt, { ...base, body: 'board', attendee_ids: board.slice(0, 6), observer_ids: oIds });
    T('اجتماع مجلس مكتمل النصاب بمراقبين مقبولين ← 201', r.status === 201 && r.data.observers_count === oIds.length && r.data.attendees_count === 6, r.data);
    const mid = r.data.id;
    const list = (await get('/meetings?body=board&per_page=200', dt)).data.rows || [];
    const m = list.find((x) => x.id === mid);
    const obsRows = (m?.attendance || []).filter((a) => a.observer_id);
    const memRows = (m?.attendance || []).filter((a) => a.user_id);
    T('المراقبون مسجَّلون بلا صوت (voting=0)', obsRows.length === oIds.length && obsRows.every((a) => a.voting === 0), obsRows);
    T('الأعضاء مسجَّلون بصوت (voting=1)', memRows.length === 6 && memRows.every((a) => a.voting === 1), memRows.length);
    r = await get('/meetings?per_page=200', await tok('observer1@sema.ly'));
    T('المراقب يرى اجتماعات المجلس فقط', r.status === 200 && (r.data.rows || []).length > 0 && r.data.rows.every((x) => x.body === 'board'), (r.data.rows || []).map((x) => x.body));
    // النصاب يُحسب بأعضاء الجهة لا بأي معرِّف
    const partners = ((await get('/users?role=PARTNER_BUSINESS&per_page=200', dt)).data.rows || []).slice(0, 6).map((u) => u.id);
    r = await post('/meetings', dt, { ...base, title: 'نصاب بغير الأعضاء ' + UNIQ, body: 'board', attendee_ids: partners });
    T('النصاب لا يكتمل بحضور غير أعضاء المجلس ← 422', r.status === 422, { s: r.status, d: r.data });
    r = await post('/meetings', dt, { ...base, title: 'معرّفات وهمية ' + UNIQ, body: 'board', attendee_ids: [9e6, 9e6 + 1, 9e6 + 2, 9e6 + 3, 9e6 + 4, 9e6 + 5] });
    T('معرّفات حضور غير موجودة ← 4xx لا 500', r.status >= 400 && r.status < 500, { s: r.status, d: r.data });
    // فلترة المستخدمين بالدور
    r = await get('/users?role=BOARD_MEMBER&per_page=5', dt);
    T('فلترة المستخدمين بالدور تُطبَّق قبل الترقيم (total = عدد أعضاء المجلس)', r.data.total === board.length && r.data.rows.length === Math.min(5, board.length),
      { total: r.data.total, rows: r.data.rows?.length, expected: board.length });
    // قرار المراقب بقيمة غير صالحة
    const nom = ((await get('/observers?status=nominated&per_page=50', dt)).data.rows || []).find((o) => o.reference === ctx.obsRef) ||
      ((await get('/observers?status=nominated&per_page=50', dt)).data.rows || [])[0];
    if (nom) {
      r = await post(`/observers/${nom.id}/decide`, await tok('chair@sema.ly'), { decision: 'bogus' });
      T('قرار مراقب بقيمة غير صالحة ← 400', r.status === 400, { s: r.status, status_after: r.data.status });
    }
  });

  // ================================================================
  await section('م. اختبار السوق (المادة 28)', async () => {
    const au = await tok('auditor1@sema.ly');
    const base = { round_name: 'جولة اختبار ' + UNIQ, city: 'مصراتة', conducted_on: TODAY, outlets_visited: 10, items_checked: 20 };
    let r = await post('/market-tests', au, { ...base, correct_usage: 15, missing_license_no: 6 });
    T('مجموع النتائج يتجاوز الأصناف المفحوصة ← 422', r.status === 422, r.data);
    r = await post('/market-tests', au, { ...base, correct_usage: -1 });
    T('عدد سالب ← 400', r.status === 400, r.data);
    r = await post('/market-tests', au, { ...base, correct_usage: 2.5 });
    T('عدد كسري ← 400', r.status === 400, r.data);
    r = await post('/market-tests', au, { round_name: 'ناقص', items_checked: 1 });
    T('بلا مدينة وتاريخ ← 400', r.status === 400, r.data);
    r = await post('/market-tests', await tok('assessor1@sema.ly'), { ...base, correct_usage: 10 });
    T('المقيّم لا يدير اختبار السوق (403)', r.status === 403, r.status);
    r = await post('/market-tests', au, { ...base, correct_usage: 14, missing_license_no: 3, level_mismatch: 1, out_of_scope: 1, unlicensed_usage: 1, published: true });
    T('جولة صحيحة (المجموع = الأصناف) ← 201', r.status === 201 && !!r.data.id, r.data);
    r = await get('/public/transparency');
    T('الجولة المنشورة تظهر في لوحة الشفافية', (r.data.market_tests || []).some((m) => m.round_name === base.round_name), (r.data.market_tests || []).length);
  });

  console.log(`\n======== النتيجة: ${pass} ناجح · ${fail} فاشل · ${skip} متخطّى ========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('خطأ غير متوقع:', e); console.log(`\n======== النتيجة: ${pass} ناجح · ${fail + 1} فاشل ========`); process.exit(1); });
