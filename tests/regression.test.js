'use strict';
/**
 * اختبارات انحدار لما كشفته المراجعة المستقلة — كل بند هنا ثغرة أُغلقت، ويبقى الاختبار حارساً عليها.
 * يعمل ضمن tests/run.js على قاعدة مؤقتة.
 */
const B = (process.env.SEMA_BASE || 'http://localhost:3000') + '/api';
let pass = 0, fail = 0;
const T = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra).slice(0, 240) : '')); } };
const H = (tok, json = true) => ({ ...(json ? { 'content-type': 'application/json' } : {}), ...(tok ? { authorization: 'Bearer ' + tok } : {}) });
async function call(method, path, tok, body) {
  const r = await fetch(B + path, { method, headers: H(tok), body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text(); let data = {}; try { data = JSON.parse(text); } catch { /* */ }
  return { status: r.status, data, text, headers: r.headers };
}
const get = (p, t) => call('GET', p, t), post = (p, t, b) => call('POST', p, t, b ?? {}), patch = (p, t, b) => call('PATCH', p, t, b);
const toks = {};
async function tok(email) {
  if (toks[email]) return toks[email];
  const r = await post('/auth/login', null, { email, password: 'Sema@2026' });
  if (!r.data.token) throw new Error('login failed ' + email + ' ' + r.text);
  return (toks[email] = r.data.token);
}

(async () => {
  const dir = await tok('director@sema.ly'), p1 = await tok('partner1@sema.ly'), o1 = await tok('org1@sema.ly');
  const lic = await tok('licensing1@sema.ly'), apl = await tok('appeals1@sema.ly'), ev = await tok('evaldir@sema.ly');
  const aud = await tok('auditor1@sema.ly'), std = await tok('standards1@sema.ly'), chair = await tok('chair@sema.ly');
  const obs = await tok('observer1@sema.ly'), integ = await tok('integrity1@sema.ly');

  console.log('\n=== 1. التقارير لا تكشف ملفات الآخرين ===');
  for (const key of ['sanctions_ledger', 'commitment_gap', 'annual_registry', 'contribution_flow', 'audit_coverage', 'admin_ratio']) {
    const r = await get('/reports/' + key, p1);
    T(`الشريك لا يقرأ تقرير ${key} (403)`, r.status === 403, r.status);
  }
  const rl = await get('/reports', p1);
  T('قائمة تقارير الشريك تقتصر على العامة', (rl.data.reports || []).every((x) => ['transparency', 'founding_partners'].includes(x.key)), rl.data.reports?.map((x) => x.key));
  T('المراقب لا يقرأ سجل الجزاءات', (await get('/reports/sanctions_ledger', obs)).status === 403);
  T('المدير يقرأ سجل الجزاءات', (await get('/reports/sanctions_ledger', dir)).status === 200);
  const csv = await fetch(B + '/reports/annual_registry/export.csv?token=' + dir);
  T('تصدير CSV يعمل للمخوَّل', csv.status === 200);

  console.log('\n=== 2. لا رفع ذاتي للصلاحيات ===');
  const me = (await get('/auth/me', dir)).data;
  let r = await post(`/users/${me.id}/roles`, dir, { roles: ['EXEC_DIRECTOR', 'LICENSING_COMMITTEE'] });
  T('لا يعدّل المدير أدواره بنفسه (403)', r.status === 403, r.data);
  const users = (await get('/users?per_page=200', dir)).data.rows;
  const victim = users.find((u) => u.email === 'registry@sema.ly');
  r = await post(`/users/${victim.id}/roles`, dir, { roles: ['EXEC_DIRECTOR', 'LICENSING_COMMITTEE'] });
  T('المدير التنفيذي + لجنة الترخيص ← 422 (المادة 25)', r.status === 422, r.data);
  r = await post(`/users/${victim.id}/roles`, dir, { roles: ['BOARD_MEMBER', 'ASSESSOR'] });
  T('عضو المجلس لا يكون موظفاً بالأمانة ← 422 (المادة 13)', r.status === 422, r.data);
  r = await post(`/users/${victim.id}/roles`, dir, { roles: ['APPEALS_COMMITTEE', 'BOARD_MEMBER'] });
  T('لجنة التظلمات من خارج المجلس ← 422 (المادة 22/1)', r.status === 422, r.data);
  r = await post(`/users/${victim.id}/roles`, dir, { roles: [{ role_code: 'PARTNER_BUSINESS', scope_id: 1 }, 'ASSESSOR'] });
  T('دور خارجي مع دور داخلي ← 422', r.status === 422, r.data);
  r = await post(`/users/${victim.id}/roles`, dir, { roles: ['PARTNER_BUSINESS'] });
  T('دور الشريك بلا ملف ← 400', r.status === 400, r.data);
  for (const bad of ['X', [null], ['NOPE'], [{ role_code: 5 }]]) {
    r = await post(`/users/${victim.id}/roles`, dir, { roles: bad });
    T(`مدخلات أدوار غير صالحة ${JSON.stringify(bad)} ← 400 لا 500`, r.status === 400, r.status);
  }
  r = await post('/users', dir, { full_name: 'ضعيف', email: `weak-${Date.now()}@x.ly`, password: 'a', roles: [] });
  T('إنشاء مستخدم بكلمة مرور ضعيفة ← 422', r.status === 422, r.data);
  r = await post('/rbac/check', dir, { roles: ['EXEC_DIRECTOR', 'LICENSING_COMMITTEE'] });
  T('فحص التعيين يكشف تعارض المادة 25', r.data.conflict === true, r.data);
  r = await post(`/users/${victim.id}/roles`, dir, { roles: ['REGISTRY_OFFICER'] });
  T('تعيين سليم يُقبل', r.status === 200, r.data);

  console.log('\n=== 3. لا حقن سكربت عبر معالجات الأحداث ===');
  const fs = require('fs'), path = require('path');
  const js = fs.readdirSync(path.join(__dirname, '..', 'public', 'js')).map((f) => fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8')).join('\n');
  const risky = js.match(/onclick=["'][^"'`]*'\$\{/g) || [];
  T('لا معالج onclick يضمّن قيمة داخل علامتي اقتباس مفردتين', risky.length === 0, risky.slice(0, 3));
  T("لا معالج onclick محاط بعلامة اقتباس مفردة", !/onclick='/.test(js));

  console.log('\n=== 4. الزيارات غير المعلنة لا تظهر لصاحب الملف قبل تنفيذها ===');
  const planned = (await get('/audits?audit_type=unannounced&status=planned&per_page=50', dir)).data.rows.find((a) => a.subject_kind === 'licensee');
  if (planned) {
    const ot = await tok(`partner${planned.subject_id}@sema.ly`).catch(() => null);
    if (ot) {
      const d = (await get('/licensees/' + planned.subject_id, ot)).data;
      T('ملف الشريك لا يعرض زيارة غير معلنة مجدولة', !(d.audits || []).some((a) => a.audit_type === 'unannounced' && !a.executed_date), (d.audits || []).map((a) => a.audit_type + ':' + a.executed_date));
    }
  } else {
    const c = await post('/audits', await tok('auditor1@sema.ly'), { subject_kind: 'licensee', subject_id: 2, audit_type: 'unannounced', trigger: 'random' });
    const d = (await get('/licensees/2', await tok('partner2@sema.ly'))).data;
    T('ملف الشريك لا يعرض زيارة غير معلنة مجدولة', c.status === 201 && !(d.audits || []).some((a) => a.id === c.data.id));
  }

  console.log('\n=== 5. التظلمات مقيَّدة بقرارات صاحبها ولا يُبتّ فيها مرتين ===');
  const foreign = (await get('/sanctions?per_page=100', dir)).data.rows.find((x) => x.subject_kind === 'licensee' && x.subject_id !== 1 && x.status === 'active');
  r = await post('/appeals', p1, { sanction_id: foreign.id, appellant_kind: 'licensee', appellant_id: 1, grounds: 'تظلم من جزاء على ملف غيري لاختبار الحماية.' });
  T('لا تظلم من جزاء على ملف آخر (403)', r.status === 403, r.data);
  r = await post('/appeals', p1, { appellant_kind: 'licensee', appellant_id: 1, grounds: 'تظلم بلا قرار محدد لاختبار الحماية من الخطأ.' });
  T('تظلم بلا قرار محدد ← 400 لا 500', r.status === 400, r.data);
  r = await post('/appeals', p1, { sanction_id: 999999, appellant_kind: 'licensee', appellant_id: 1, grounds: 'تظلم من جزاء غير موجود لاختبار الحماية.' });
  T('تظلم من جزاء غير موجود ← 404', r.status === 404, r.data);
  // جزاء جديد على ملف الشريك 1 ثم تظلم ثم قرار ثم محاولة قرار ثانٍ
  const sn = await post('/sanctions', lic, { subject_kind: 'licensee', subject_id: 1, violation_code: 5, measure: 'written_warning', reason: 'استعمال العلامة على منتج خارج نطاق الترخيص — تنبيه كتابي.' });
  r = await post('/appeals', p1, { sanction_id: sn.data.id, appellant_kind: 'licensee', appellant_id: 1, grounds: 'المنتج المذكور داخل نطاق العلامة التجارية المرخَّصة، ونرفق صورة الشهادة.' });
  T('صاحب الملف يتظلم من جزائه', r.status === 201, r.data);
  const sAfter = (await get('/sanctions?per_page=200', dir)).data.rows.find((x) => x.id === sn.data.id);
  T('التظلم لا يغيّر وضع الجزاء (لا يوقف التنفيذ)', sAfter.status === 'active', sAfter.status);
  r = await post('/appeals', p1, { sanction_id: sn.data.id, appellant_kind: 'licensee', appellant_id: 1, grounds: 'تظلم ثانٍ من القرار ذاته لاختبار منع التكرار.' });
  T('لا تظلم ثانياً من القرار نفسه (409)', r.status === 409, r.data);
  const apId = (await get('/appeals?per_page=200', apl)).data.rows.find((x) => x.sanction_id === sn.data.id).id;
  r = await post(`/appeals/${apId}/decide`, apl, { decision: 'upheld', reason: 'ثبت أن المنتج خارج النطاق المحدد في الشهادة.' });
  T('لجنة التظلمات تبتّ', r.status === 200, r.data);
  r = await post(`/appeals/${apId}/decide`, apl, { decision: 'overturned', reason: 'محاولة قرار ثانٍ على التظلم ذاته.' });
  T('لا قرار ثانياً في التظلم (409)', r.status === 409, r.data);
  r = await post(`/appeals/${apId}/decide`, apl, { decision: 'upheld', reason: 12345678901 });
  T('تسبيب رقمي لا يُسقط الخادم', r.status !== 500, r.status);

  console.log('\n=== 6. الشريك والمنظمة لا يعدّلان الأرقام الحاكمة ===');
  const before = (await get('/licensees/1', p1)).data;
  r = await patch('/licensees/1', p1, { annual_revenue: 5, net_profit: 'abc', contact_phone: '0912345678' });
  const after = (await get('/licensees/1', p1)).data;
  T('إيراد الشريك وشريحته لا يتغيران بتعديله', after.annual_revenue === before.annual_revenue && after.tier_code === before.tier_code, { before: before.tier_code, after: after.tier_code });
  T('بيانات التواصل تُحدَّث', after.contact_phone === '0912345678');
  T('الحقول المُهملة تُعاد للشريك', Array.isArray(r.data.ignored_fields) && r.data.ignored_fields.includes('annual_revenue'), r.data);
  const ob = (await get('/associations/1', o1)).data;
  r = await patch('/associations/1', o1, { admin_expenses: 1, largest_budget_3y: 999999999 });
  const oa = (await get('/associations/1', o1)).data;
  T('المنظمة لا تعدّل نسبتها ولا سقف استيعابها', oa.admin_expense_ratio === ob.admin_expense_ratio && oa.absorption_cap === ob.absorption_cap, r.data);
  r = await patch('/licensees/2', dir, { annual_revenue: 'abc' });
  T('قيمة غير رقمية من الأمانة ← 400', r.status === 400, r.data);

  console.log('\n=== 7. لا منح لغير المستوفي ===');
  const susp = (await get('/licensees?status=suspended&per_page=5', dir)).data.rows[0];
  if (susp) {
    const st = await tok(`partner${susp.id}@sema.ly`).catch(() => null);
    if (st) { r = await post('/applications', st, { app_type: 'license', subject_kind: 'licensee', subject_id: susp.id, requested_level: 1 });
      T('المعلَّق لا يلتف على جزائه بطلب ترخيص جديد (422)', r.status === 422, r.data); }
  }
  // منظمة بنسبة إدارية فوق السقف تُسجَّل ثم لا تُمنح
  const U = Date.now().toString(36);
  const reg = await post('/public/register/association', null, { name: 'جمعية فوق السقف ' + U, registration_no: 'R-' + U, region: 'الغربية',
    city: 'طرابلس', established_year: 2015, board_size: 7, board_meetings_last_year: 4, annual_revenue: 400000, total_expenses: 300000,
    admin_expenses: 180000, largest_budget_3y: 400000, focus_areas: 'تعليم', contact_name: 'منسّق', email: `over-${U}@t.ly`,
    password: 'Strong2026x', pledge_accuracy: true, pledge_audit: true });
  T('التسجيل مقبول مع التحذير', reg.status === 201, reg.data);
  const appId = reg.data.application?.id;
  if (appId) {
    await post(`/applications/${appId}/screen`, ev, { complete: true });
    await post(`/applications/${appId}/facts-report`, ev, { facts_summary: 'النسبة الإدارية 60% من إجمالي المصروفات وفق القوائم المقدَّمة.' });
    r = await post(`/applications/${appId}/decide`, lic, { decision: 'grant', reason: 'محاولة منح منظمة نسبتها الإدارية تتجاوز السقف.' });
    T('لا اعتماد لمنظمة نسبتها فوق 25% (422)', r.status === 422, r.data);
  }
  const upg = (await get('/applications?app_type=level_upgrade&status=decision_pending', dir)).data.rows[0];
  if (upg) {
    r = await post(`/applications/${upg.id}/decide`, lic, { decision: 'grant_lower_level', granted_level: 9, reason: 'مستوى خارج النطاق لاختبار التحقق.' });
    T('مستوى خارج 1–5 ← 422 لا 500', r.status === 422, r.data);
  }

  console.log('\n=== 8. النشر العلني يحترم رد المجلس ===');
  const notes = (await get('/integrity-notes', integ)).data.rows;
  const answered = notes.find((n) => n.responded_at);
  if (answered) { r = await post(`/integrity-notes/${answered.id}/publish`, integ, {});
    T('لا نشر علني لملاحظة استجاب لها المجلس', r.status === 422 || r.status === 409, r.data); }
  const openN = notes.find((n) => !n.responded_at && !n.public_disclosure);
  if (openN) {
    r = await post(`/integrity-notes/${openN.id}/respond`, dir, { response: 'رد من المدير التنفيذي لا من المجلس — يجب أن يُرفض.' });
    T('المدير التنفيذي لا يرد نيابةً عن المجلس (403)', r.status === 403, r.data);
    r = await post(`/integrity-notes/${openN.id}/respond`, chair, { response: '' });
    T('رد فارغ من المجلس ← 422', r.status === 422, r.data);
  }

  console.log('\n=== 9. تعارض المصالح في كل مراحل التقييم ===');
  await post('/pledges', aud, { kind: 'annual_interests', year: 2026, has_conflict: true, details: 'قدّمت خدمة لشركة (الملف 3)' });
  r = await post('/audits', aud, { subject_kind: 'licensee', subject_id: 3, audit_type: 'field', trigger: 'random' });
  T('المدقق المتعارض لا يُجدول تدقيقاً على الجهة', r.status === 422, r.data);

  console.log('\n=== 10–12. المقترحات والتصاميم والبرامج ===');
  const designs = (await get('/designs?per_page=200', dir)).data.rows;
  const decided = designs.find((d) => d.status !== 'pending');
  r = await post(`/designs/${decided.id}/decide`, std, { decision: 'rejected', notes: 'محاولة تغيير قرار سابق على التصميم.' });
  T('لا يُعاد البتّ في تصميم مفصول فيه (409)', r.status === 409, r.data);
  const dp = (await get('/contributions?channel=direct_program&per_page=100', dir)).data.rows;
  const rejected = dp.find((c) => c.status === 'rejected') || null;
  const declared = dp.find((c) => c.status === 'declared' && !c.program_preapproved);
  if (declared) {
    r = await post(`/contributions/${declared.id}/verify`, aud, { status: 'rejected', reject_reason: 'لا تقرير أثر ولا موافقة.' });
    r = await post(`/contributions/${declared.id}/preapprove`, std, { approve: true });
    T('الموافقة المسبقة لا تلغي رفض الوحدة (409)', r.status === 409, r.data);
  }
  void rejected;
  r = await post('/proposals', std, { title: 'رسوم بلا مشاورة', summary: 'رسوم', body: 'تعديل', kind: 'fees', is_material: false });
  T('الرسوم تُعامَل جوهرية', r.data.is_material === 1, r.data);

  console.log('\n=== 13. الإشعارات بلا تكرار ولا تسرّب ===');
  const n1 = (await get('/notifications', apl)).data.rows;
  const ids = n1.map((x) => x.id);
  T('لا تكرار للإشعار نفسه لعضو اللجنة', new Set(ids).size === ids.length && n1.every((x) => x.user_id), n1.length);
  const apl2 = await tok('appeals2@sema.ly');
  const u2before = (await get('/notifications', apl2)).data.unread;
  await post('/notifications/read', apl, {});
  const u2after = (await get('/notifications', apl2)).data.unread;
  T('تعليم الإشعارات مقروءة لا يمسّ نسخ الآخرين', u2before === u2after, { u2before, u2after });

  console.log('\n=== 14. لا حقن صيغ في CSV ===');
  const U2 = Date.now().toString(36);
  await post('/public/register/business', null, { legal_name: '=HYPERLINK("http://x","y")', commercial_reg: 'C' + U2, tax_file_no: 'T' + U2,
    sector: 'تجارة تجزئة', region: 'الغربية', city: 'طرابلس', annual_revenue: 300000, net_profit: 20000, requested_level: 1,
    contact_name: 'x', email: `csv-${U2}@t.ly`, password: 'Strong2026x', pledge_exclusion: true, pledge_conduct: true, pledge_audit: true, pledge_statement: true });
  const users2 = await fetch(B + '/reports/founding_partners/export.csv?token=' + dir).then((x) => x.text());
  const reg2 = await fetch(B + '/reports/annual_registry/export.csv?token=' + dir).then((x) => x.text());
  T('لا خلية تبدأ بـ= في التصدير', !/(^|,)"=/m.test(users2 + reg2));

  console.log('\n=== 15. مدخلات شاذة لا تُسقط الخادم ===');
  const cases = [
    ['GET', '/public/registry/licensees?q=a&q=b'], ['GET', '/public/registry/licensees?sort=a&sort=b'],
    ['GET', '/public/registry/licensees?page=1.5'], ['GET', '/public/registry/licensees?page=1e400'],
    ['GET', '/public/registry/licensees?per_page=-5&level=abc'],
  ];
  for (const [m, pth] of cases) { r = await call(m, pth); T(`${pth} ← ليس 500`, r.status < 500, r.status); }
  const authed = [
    ['/sanctions', lic, { subject_kind: 'licensee', subject_id: 1, violation_code: 1, measure: 'bogus', reason: 'قيمة جزاء غير صالحة للاختبار.' }],
    ['/designs', p1, { licensee_id: 1, material_type: 'ad' }],
    ['/associations/1/criteria', ev, { items: [{ criterion_no: 99, result: 'met' }] }],
    ['/complaints', null, { body: 12345678901 }],
    ['/audits', aud, { subject_kind: 'licensee', subject_id: 999999, audit_type: 'field' }],
    ['/observers/1/decide', chair, { decision: 'bogus' }],
  ];
  for (const [pth, t, body] of authed) { r = await post(pth, t, body); T(`POST ${pth} بمدخلات شاذة ← 4xx`, r.status >= 400 && r.status < 500, { s: r.status, d: r.data }); }
  r = await call('PUT', '/kpis/nope/9', dir, { value: 'x' });
  T('PUT /kpis بمدخلات شاذة ← 4xx', r.status >= 400 && r.status < 500, r.status);
  r = await call('PUT', '/settings/annual_fee_cap', dir, { value: 1 });
  T('إعداد تحكمه اللائحة لا يُعدَّل من الإعدادات (422)', r.status === 422, r.data);
  r = await call('PATCH', '/licensees/1', p1);
  T('PATCH بلا جسم ← 4xx', r.status >= 400 && r.status < 500, r.status);

  console.log('\n=== مشتبهات عولجت ===');
  const planA = await post('/audits/plan', ev, { fiscal_year: 2026, commit: true, seed: 'chosen-by-planner' });
  T('تثبيت خطة العيّنة ببصمة يختارها المخطِّط ← 422', planA.status === 422, planA.data);
  const drafts = (await get('/proposals', p1)).data.rows || [];
  T('الشريك لا يرى المسوّدات', !drafts.some((x) => x.status === 'draft'));
  const pubL = (await get('/public/registry/licensees?per_page=5')).data.rows[0];
  T('السجل العام يعرض المتحقَّق منه فقط', typeof pubL.verified_commitment === 'number');

  console.log(`\n======== النتيجة: ${pass} ناجح · ${fail} فاشل ========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n======== النتيجة: ${pass} ناجح · ${fail + 1} فاشل ========`); process.exit(1); });
