'use strict';
/**
 * اختبارات المرحلة الثالثة: استعادة كلمة المرور · كلمة المرور المؤقتة · التحقق بخطوتين وإلزامه ·
 * المراسلات ومرفقاتها · البحث الشامل · تقويم المواعيد · النسخ الاحتياطي · البريد الصادر · المهام الآلية.
 * يعمل ضمن tests/run.js (SEMA_MAIL_TRANSPORT=json و SEMA_TEST_EXPOSE_TOKENS=1).
 * لا يغيّر حسابات تستعملها المجموعات الأخرى: يُنشئ حساباته، ويستعمل partner25 للاستعادة.
 */
const TOTP = require('../server/totp');
const B = (process.env.SEMA_BASE || 'http://localhost:3000') + '/api';
let pass = 0, fail = 0;
const T = (name, cond, extra) => { if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  →  ' + JSON.stringify(extra).slice(0, 260) : '')); } };
const section = (t) => console.log('\n=== ' + t + ' ===');
async function call(method, path, tok, body) {
  const isForm = body instanceof FormData;
  const r = await fetch(B + path, { method, headers: { ...(isForm ? {} : { 'content-type': 'application/json' }), ...(tok ? { authorization: 'Bearer ' + tok } : {}) },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) });
  const text = await r.text(); let data = {}; try { data = JSON.parse(text); } catch { /* */ }
  return { status: r.status, data, text, headers: r.headers };
}
const get = (p, t) => call('GET', p, t), post = (p, t, b) => call('POST', p, t, b ?? {}), put = (p, t, b) => call('PUT', p, t, b);
const login = async (email, password = 'Sema@2026') => (await post('/auth/login', null, { email, password })).data;
const tok = async (email, password) => (await login(email, password)).token;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const file = (name, content, type) => new Blob([content], { type });

(async () => {
  const stamp = Date.now();
  const dir = await tok('director@sema.ly'), p1 = await tok('partner1@sema.ly'), o1 = await tok('org1@sema.ly');
  const obs = await tok('observer1@sema.ly'), lic = await tok('licensing1@sema.ly'), fin = await tok('finance@sema.ly');
  const reg = await tok('registry@sema.ly'), p2 = await tok('partner2@sema.ly');
  const me = async (t) => (await get('/auth/me', t)).data;

  // =====================================================================
  section('1. استعادة كلمة المرور');
  let r = await post('/auth/forgot', null, { email: 'bad' });
  T('بريد غير صالح ← 400', r.status === 400, r.status);
  r = await post('/auth/forgot', null, { email: `nobody-${stamp}@nowhere.ly` });
  T('بريد غير مسجَّل ← الرد نفسه (لا يُكشف وجود الحساب)', r.status === 200 && !r.data.debug_token && /إن كان البريد/.test(r.data.note), r.data);
  r = await post('/auth/forgot', null, { email: 'PARTNER25@sema.ly' });
  const t1 = r.data.debug_token;
  T('بريد مسجَّل ← رابط (والبريد غير حساس لحالة الأحرف)', r.status === 200 && !!t1, r.data);
  r = await post('/auth/forgot', null, { email: 'partner25@sema.ly' });
  const t2 = r.data.debug_token;
  r = await get('/auth/reset/check?token=' + encodeURIComponent(t1));
  T('إصدار رابط جديد يُبطل السابق', r.data.valid === false, r.data);
  r = await get('/auth/reset/check?token=' + encodeURIComponent(t2));
  T('الرابط الساري صالح والبريد مقنَّع', r.data.valid === true && /\*/.test(r.data.email) && !r.data.email.startsWith('partner25'), r.data);
  const oldSession = await tok('partner25@sema.ly');
  r = await post('/auth/reset', null, { token: t2, new_password: 'short' });
  T('كلمة مرور ضعيفة ← 422 (والرابط باقٍ)', r.status === 422 && (await get('/auth/reset/check?token=' + encodeURIComponent(t2))).data.valid, r.data);
  r = await post('/auth/reset', null, { token: t2, new_password: 'Reset2026x' });
  T('تعيين كلمة المرور بالرابط', r.status === 200, r.data);
  T('الجلسات السابقة تسقط', (await get('/auth/me', oldSession)).status === 401);
  r = await post('/auth/reset', null, { token: t2, new_password: 'Another2026' });
  T('الرابط لمرة واحدة ← 400', r.status === 400, r.data);
  T('الدخول بكلمة المرور الجديدة', !!(await tok('partner25@sema.ly', 'Reset2026x')));
  r = await post('/auth/reset', null, { token: 'x'.repeat(43), new_password: 'Reset2026y' });
  T('رمز مزوَّر ← 400', r.status === 400);
  await sleep(400);
  r = await get('/outbox?kind=password_reset&q=partner25', dir);
  T('رسالة الاستعادة في الصندوق مُرسلة ومتنها لا يُعرض', r.data.rows?.length >= 2 && r.data.rows.every((x) => x.status === 'sent' && !/token=/.test(x.body_text)), r.data.rows);
  r = await get('/outbox?kind=security&q=partner25', dir);
  T('إشعار أمني بتعيين كلمة المرور', r.data.rows?.some((x) => /عُيِّنت كلمة مرور/.test(x.subject)), r.data.rows?.map((x) => x.subject));

  const users = (await get('/users?per_page=200', dir)).data.rows;
  const uid = (e) => users.find((u) => u.email === e)?.id;
  r = await post(`/users/${uid('partner25@sema.ly')}/reset-link`, dir);
  T('الإدارة تُرسل رابط تعيين دون أن تراه', r.status === 200 && /أُرسل الرابط/.test(r.data.note) && /\*/.test(r.data.note), r.data);
  r = await post(`/users/${uid('director@sema.ly')}/reset-link`, dir);
  T('لا ترسل الإدارة رابطاً لنفسها ← 403', r.status === 403);
  r = await post(`/users/${uid('partner25@sema.ly')}/reset-link`, p1);
  T('غير الإدارة ← 403', r.status === 403);
  r = await post('/users/999999/reset-link', dir);
  T('مستخدم غير موجود ← 404', r.status === 404);

  // =====================================================================
  section('2. كلمة المرور المؤقتة التي تضعها الإدارة');
  const regEmail = `p3-reg-${stamp}@sema.ly`;
  r = await post('/users', dir, { full_name: 'موظف سجل للاختبار', email: regEmail, password: 'Temp2026x', roles: ['REGISTRY_OFFICER'] });
  T('إنشاء حساب بكلمة مرور مؤقتة', r.status === 201 || r.status === 200, r.data);
  let L1 = await login(regEmail, 'Temp2026x');
  T('الحساب يُعلَّم بوجوب تغيير كلمة المرور', L1.user?.must_reset === true, L1.user);
  r = await get('/licensees', L1.token);
  T('لا عمل قبل التغيير ← 403 PASSWORD_CHANGE_REQUIRED', r.status === 403 && r.data.code === 'PASSWORD_CHANGE_REQUIRED', r.data);
  T('«حسابي» متاح', (await get('/auth/me', L1.token)).status === 200);
  r = await post('/auth/password', L1.token, { current_password: 'Temp2026x', new_password: 'Mine2026x' });
  const regTok = r.data.token;
  T('تغيير كلمة المرور يرفع القيد', r.status === 200 && (await get('/licensees', regTok)).status === 200, r.data);

  // =====================================================================
  section('3. التحقق بخطوتين');
  r = await post('/auth/2fa/setup', regTok, { password: 'wrong' });
  T('الإعداد يلزمه تأكيد كلمة المرور ← 422', r.status === 422);
  r = await post('/auth/2fa/enable', regTok, { code: '123456' });
  T('التفعيل قبل الإعداد ← 422', r.status === 422);
  r = await post('/auth/2fa/setup', regTok, { password: 'Mine2026x' });
  const secret = r.data.secret;
  T('الإعداد يُرجع مفتاحاً ورمز QR ورابط otpauth', r.status === 200 && /^[A-Z2-7]{32}$/.test(secret) && /<svg/.test(r.data.qr_svg) && /^otpauth:\/\/totp\//.test(r.data.otpauth), r.data.otpauth);
  r = await post('/auth/2fa/enable', regTok, { code: '000000' });
  T('رمز خاطئ ← 422', r.status === 422);
  r = await post('/auth/2fa/enable', regTok, { code: TOTP.generate(secret) });
  const recovery = r.data.recovery_codes || [];
  T('التفعيل بالرمز الصحيح + ثمانية رموز استرداد', r.status === 200 && recovery.length === 8 && r.data.user?.totp_enabled === true, r.data);
  T('تفعيل ثانٍ ← 409', (await post('/auth/2fa/enable', regTok, { code: TOTP.generate(secret) })).status === 409);
  T('الجلسة القائمة باقية بعد التفعيل', (await get('/auth/me', regTok)).status === 200);

  L1 = await login(regEmail, 'Mine2026x');
  T('الدخول يطلب الخطوة الثانية ولا يُصدر جلسة', L1.mfa_required === true && !L1.token && !!L1.mfa_token, L1);
  T('رمز الخطوة الثانية لا يصلح جلسةً', (await get('/auth/me', L1.mfa_token)).status === 401);
  r = await post('/auth/login/2fa', null, { mfa_token: L1.mfa_token, code: '000000' });
  T('رمز خاطئ ← 401', r.status === 401);
  r = await post('/auth/login/2fa', null, { mfa_token: L1.mfa_token, code: TOTP.generate(secret) });
  T('الرمز المستعمَل في التفعيل لا يُعاد استعماله', r.status === 401);
  r = await post('/auth/login/2fa', null, { mfa_token: L1.mfa_token, code: TOTP.generate(secret, Date.now() + 30e3) });
  let t2fa = r.data.token;
  T('الرمز التالي يُكمل الدخول', r.status === 200 && !!t2fa, r.data);
  r = await post('/auth/login/2fa', null, { mfa_token: 'garbage', code: '123456' });
  T('رمز خطوة ثانية مزوَّر ← 401', r.status === 401);
  const forged = await call('POST', '/auth/login/2fa', null, { mfa_token: dir, code: '123456' });
  T('رمز جلسة عادي لا يصلح خطوةً ثانية', forged.status === 401);
  L1 = await login(regEmail, 'Mine2026x');
  r = await post('/auth/login/2fa', null, { mfa_token: L1.mfa_token, code: recovery[0].toLowerCase() });
  T('رمز الاسترداد يُكمل الدخول (بلا حساسية للحالة)', r.status === 200 && !!r.data.token, r.data);
  L1 = await login(regEmail, 'Mine2026x');
  r = await post('/auth/login/2fa', null, { mfa_token: L1.mfa_token, code: recovery[0] });
  T('رمز الاسترداد لمرة واحدة', r.status === 401);
  r = await get('/auth/2fa', t2fa);
  T('بقي سبعة رموز استرداد', r.data.enabled === true && r.data.recovery_left === 7, r.data);
  r = await post('/auth/2fa/disable', t2fa, { password: 'Mine2026x', code: '000000' });
  T('التعطيل برمز خاطئ ← 422', r.status === 422);
  const regId = (await me(t2fa)).id;
  r = await post(`/users/${regId}/2fa/reset`, dir, { reason: 'قصير' });
  T('إسقاط الإدارة للتحقق يلزمه تسبيب ← 422', r.status === 422);
  r = await post(`/users/${uid('director@sema.ly')}/2fa/reset`, dir, { reason: 'محاولة إسقاط التحقق عن حسابي بنفسي' });
  T('لا تُسقطه الإدارة عن نفسها ← 403', r.status === 403);
  r = await post(`/users/${regId}/2fa/reset`, dir, { reason: 'فقد الهاتف ورموز الاسترداد، وثبتت هويته حضورياً' });
  T('الإدارة تُسقط التحقق عن حساب فقد هاتفه', r.status === 200, r.data);
  T('وتسقط جلساته', (await get('/auth/me', t2fa)).status === 401);
  L1 = await login(regEmail, 'Mine2026x');
  T('يدخل بعدها بكلمة المرور وحدها', !!L1.token && !L1.mfa_required);

  // ---- الإلزام ----
  const exEmail = `p3-exec-${stamp}@sema.ly`;
  await post('/users', dir, { full_name: 'مدير تنفيذي ثانٍ للاختبار', email: exEmail, password: 'Temp2026x', roles: ['EXEC_DIRECTOR'] });
  let ex = (await login(exEmail, 'Temp2026x')).token;
  ex = (await post('/auth/password', ex, { current_password: 'Temp2026x', new_password: 'Exec2026x' })).data.token;
  const exSec = (await post('/auth/2fa/setup', ex, { password: 'Exec2026x' })).data.secret;
  r = await post('/auth/2fa/enable', ex, { code: TOTP.generate(exSec) });
  T('المدير الثاني يفعّل التحقق', r.status === 200);
  r = await put('/settings/require_2fa_internal', dir, { value: '1' });
  T('من لم يفعّل التحقق لا يُلزم به غيره ← 422', r.status === 422, r.data);
  r = await put('/settings/require_2fa_internal', ex, { value: 'yes' });
  T('قيمة غير صالحة ← 400', r.status === 400);
  r = await put('/settings/require_2fa_internal', ex, { value: '1' });
  T('من فعّله يُلزم به حسابات الحوكمة والأمانة', r.status === 200, r.data);
  const F = await login('finance@sema.ly');
  T('الحساب الداخلي يُعلَّم بوجوب التفعيل', F.user?.mfa_enroll_required === true, F.user?.mfa_enroll_required);
  r = await get('/licensees', F.token);
  T('ويُحجب عن النظام ← 403 MFA_ENROLL_REQUIRED', r.status === 403 && r.data.code === 'MFA_ENROLL_REQUIRED', r.data);
  r = await get('/auth/2fa', F.token);
  T('صفحة التفعيل متاحة له', r.status === 200 && r.data.required === true, r.data);
  T('الشريك غير معني بالإلزام', (await get('/licensees/2', p2)).status === 200);
  T('والمراجع الخارجي مشمول بالإلزام (يطّلع على السرّي)', (await login('auditor.ext@sema.ly')).user?.mfa_enroll_required === true);
  T('المُفعِّل يعمل كالمعتاد', (await get('/licensees', ex)).status === 200);
  r = await post('/auth/2fa/disable', ex, { password: 'Exec2026x', code: TOTP.generate(exSec, Date.now() + 30e3) });
  T('لا يُعطَّل التحقق وهو إلزامي ← 422', r.status === 422, r.data);
  r = await put('/settings/require_2fa_internal', ex, { value: '0' });
  T('رفع الإلزام', r.status === 200 && (await get('/licensees', F.token)).status === 200, r.data);

  // =====================================================================
  section('4. المراسلات');
  T('لجنة الترخيص لا تراسل (يُحظر عليها التفاوض) ← 403', (await get('/threads', lic)).status === 403 && (await post('/threads', lic, { title: 'محاولة', body: 'محاولة مراسلة' })).status === 403);
  r = await post('/threads', p1, { title: 'س', body: 'نص' });
  T('عنوان قصير ← 422', r.status === 422);
  r = await post('/threads', p1, { subject_kind: 'licensee', subject_id: 2, title: 'مراسلة على ملف غيري', body: 'اختبار الحماية' });
  T('لا تراسل الجهة بشأن ملف غيرها ← 403', r.status === 403);
  r = await post('/threads', p1, { title: 'فاتورة ليست لي', body: 'اختبار الموضوع', topic_kind: 'invoice', topic_id: 999999 });
  T('موضوع لا يخص الملف ← 422', r.status === 422);
  r = await post('/threads', p1, { title: 'موضوع مجهول', body: 'اختبار', topic_kind: 'audit', topic_id: 1 });
  T('نوع موضوع غير مسموح ← 400', r.status === 400);
  const myApp = (await get('/applications?per_page=5', p1)).data.rows[0];
  r = await post('/threads', p1, { title: `بشأن الطلب ${myApp.reference}`, body: 'متى يُنتظر القرار في الطلب؟', topic_kind: 'application', topic_id: myApp.id });
  const th = r.data;
  T('الجهة تفتح مراسلة مربوطة بطلبها', r.status === 201 && th.subject_kind === 'licensee' && th.status === 'awaiting_staff' && /^MSG-/.test(th.reference), r.data);
  await sleep(150);
  const evNotif = (await get('/notifications', await tok('evaldir@sema.ly'))).data.rows || [];
  T('تُوجَّه مراسلة الطلب إلى وحدة التقييم', evNotif.some((n) => (n.body || '').includes(th.reference)), evNotif.slice(0, 2));
  T('منظمة أخرى لا تطّلع عليها ← 403', (await get('/threads/' + th.id, o1)).status === 403);

  // مرفقات
  let fd = new FormData(); fd.append('body', 'مرفق خطير'); fd.append('file', file('x.html', '<script>alert(1)</script>', 'text/html'), 'x.html');
  r = await call('POST', `/threads/${th.id}/messages`, p1, fd);
  T('مرفق HTML مرفوض ← 415', r.status === 415, r.data);
  fd = new FormData(); fd.append('body', 'أرفقنا صورة الإشعار'); fd.append('file', file('notice.pdf', '%PDF-1.4 test', 'application/pdf'), 'notice.pdf');
  r = await call('POST', `/threads/${th.id}/messages`, p1, fd);
  T('مرفق PDF مقبول', r.status === 201, r.data);
  let tv = (await get('/threads/' + th.id, p1)).data;
  const att = tv.messages.find((m) => m.document_id);
  T('المرفق يُقيَّد في ملف الجهة', !!att && /مرفق مراسلة/.test(att.doc_title), tv.messages);
  T('صاحب الملف ينزّل مرفقه', (await fetch(`${B}/documents/${att.document_id}/file?token=${p1}`)).status === 200);
  T('جهة أخرى لا تنزّله ← 403', (await fetch(`${B}/documents/${att.document_id}/file?token=${o1}`)).status === 403);

  // ردود الأمانة
  r = await post(`/threads/${th.id}/messages`, reg, { body: 'ملاحظة داخلية: الطلب بانتظار تقرير الوقائع.', internal: true });
  T('ملاحظة داخلية من الأمانة', r.status === 201);
  fd = new FormData(); fd.append('body', 'مرفق داخلي'); fd.append('internal', '1'); fd.append('file', file('memo.txt', 'internal memo', 'text/plain'), 'memo.txt');
  r = await call('POST', `/threads/${th.id}/messages`, reg, fd);
  const staffView = (await get('/threads/' + th.id, reg)).data;
  const internalDoc = staffView.messages.find((m) => m.internal && m.document_id)?.document_id;
  T('المرفق الداخلي سرّي باسم الأمانة', r.status === 201 && !!internalDoc);
  T('الجهة لا تنزّل المرفق الداخلي ← 403', (await fetch(`${B}/documents/${internalDoc}/file?token=${p1}`)).status === 403);
  r = await post(`/threads/${th.id}/messages`, reg, { body: 'يصدر القرار خلال خمسة عشر يوم عمل من رفع تقرير الوقائع.' });
  T('رد الأمانة', r.status === 201);
  const unread = (await get('/threads/unread', p1)).data;
  T('للجهة رسالة غير مقروءة', unread.unread >= 1, unread);
  tv = (await get('/threads/' + th.id, p1)).data;
  T('الجهة لا ترى الملاحظات الداخلية', tv.messages.every((m) => !m.internal) && !tv.messages.some((m) => /ملاحظة داخلية/.test(m.body)), tv.messages.map((m) => m.body));
  T('ولا ترى اسم الموظف بل «الأمانة التنفيذية»', tv.messages.filter((m) => m.author_side === 'staff').every((m) => m.author_name === 'الأمانة التنفيذية'));
  const regMe = await me(reg);
  T('الملاحظة الداخلية لا تُسند المراسلة، والرد العلني يُسندها إلى من ردّ', !staffView.assigned_to &&
    tv.status === 'awaiting_entity' && (await get('/threads/' + th.id, reg)).data.assigned_to === regMe.id, tv.status);
  T('العرض يعلّم المقروء', (await get('/threads/unread', p1)).data.unread < unread.unread);
  T('قائمة الجهة لا تُظهر عدد الملاحظات الداخلية', (await get('/threads?q=' + th.reference, p1)).data.rows[0].messages === tv.messages.length);

  // الإسناد والإغلاق
  const licId = uid('licensing1@sema.ly'), finId = uid('finance@sema.ly');
  r = await post(`/threads/${th.id}/assign`, reg, { user_id: licId });
  T('لا تُسند إلى من لا يملك المراسلات ← 422', r.status === 422);
  r = await post(`/threads/${th.id}/assign`, reg, { user_id: finId });
  T('الإسناد إلى موظف مختص', r.status === 200);
  T('الجهة لا تُسند ← 403', (await post(`/threads/${th.id}/assign`, p1, { user_id: finId })).status === 403);
  T('الجهة تُغلق مراسلتها', (await post(`/threads/${th.id}/close`, p1)).status === 200);
  T('إغلاق ثانٍ ← 409', (await post(`/threads/${th.id}/close`, p1)).status === 409);
  T('لا ترد الجهة على مراسلة مغلقة ← 409', (await post(`/threads/${th.id}/messages`, p1, { body: 'إضافة بعد الإغلاق' })).status === 409);
  T('الجهة لا تعيد الفتح ← 403', (await post(`/threads/${th.id}/reopen`, p1)).status === 403);
  T('الأمانة تعيد الفتح', (await post(`/threads/${th.id}/reopen`, reg)).status === 200);

  // الأمانة تبادر، والمراقب
  r = await post('/threads', reg, { subject_kind: 'association', subject_id: 1, title: 'تحديث القوائم المالية', body: 'نرجو تحميل القوائم المالية المدققة للسنة الأخيرة.', category: 'other' });
  T('الأمانة تبادر بمراسلة منظمة', r.status === 201 && r.data.status === 'awaiting_entity', r.data);
  await sleep(150);
  T('والمنظمة تراها ويصلها إشعار', (await get('/threads/' + r.data.id, o1)).status === 200 &&
    ((await get('/notifications', o1)).data.rows || []).some((n) => (n.body || '').includes(r.data.reference)));
  r = await post('/threads', reg, { subject_kind: 'licensee', subject_id: 999999, title: 'جهة غير موجودة', body: 'اختبار' });
  T('جهة غير موجودة ← 404', r.status === 404);
  r = await post('/threads', obs, { title: 'استفسار مراقب', body: 'هل تصلني محاضر الاجتماعات؟' });
  T('المراقب يراسل من حسابه', r.status === 201 && r.data.subject_kind === 'user', r.data);
  T('ولا يرى مراسلات الجهات', (await get('/threads', obs)).data.rows.every((x) => x.subject_kind === 'user'));
  r = await get('/threads?status=awaiting_staff&per_page=200', reg);
  T('فلترة الحالة', r.data.rows.length > 0 && r.data.rows.every((x) => x.status === 'awaiting_staff'), r.data.by_status);
  r = await get('/threads?unread=1&per_page=200', reg);
  T('فلترة غير المقروء', r.data.rows.every((x) => x.unread > 0));
  r = await get('/threads?per_page=200', p1);
  T('الشريك يرى مراسلات ملفه فقط', r.data.rows.every((x) => x.subject_kind === 'licensee' && x.subject_id === 1), r.data.rows.map((x) => x.subject_id));

  // =====================================================================
  section('5. البحث الشامل');
  T('حرف واحد ← 400', (await get('/search?q=ش', dir)).status === 400);
  r = await get('/search?q=' + encodeURIComponent('شركة'), p1);
  const gk = (d) => (d.groups || []).map((g) => g.key);
  T('الشريك: ملفه فقط من المرخَّص لهم، والسجل العام متاح', r.data.groups.find((g) => g.key === 'licensees')?.rows.length === 1 && gk(r.data).includes('registry'), gk(r.data));
  T('الشريك لا يرى المستخدمين ولا البلاغات ولا التدقيق', !gk(r.data).some((k) => ['users', 'complaints', 'audits', 'documents'].includes(k)), gk(r.data));
  r = await get('/search?q=INV', p1);
  const myName = (await get('/licensees/1', p1)).data.legal_name;
  T('فواتير الشريك وحده', (r.data.groups.find((g) => g.key === 'invoices')?.rows || []).every((x) => x.sub.startsWith(myName)), r.data.groups.find((g) => g.key === 'invoices'));
  r = await get('/search?q=AUD', p1);
  T('لا تظهر له عمليات التدقيق بالبحث', !gk(r.data).includes('audits'));
  r = await get('/search?q=sema.ly', dir);
  T('الإدارة تبحث في المستخدمين', gk(r.data).includes('users'), gk(r.data));
  r = await get('/search?q=MSG', o1);
  T('المنظمة تجد مراسلاتها فقط', (r.data.groups.find((g) => g.key === 'threads')?.rows || []).length >= 1);
  r = await get('/search?q=' + encodeURIComponent("' OR 1=1 --"), dir);
  T('مدخلات حقن ← نتائج عادية لا خطأ', r.status === 200);

  // =====================================================================
  section('6. تقويم المواعيد');
  r = await get('/calendar', dir);
  const kinds = (d) => [...new Set((d.events || []).map((e) => e.kind))];
  T('تقويم الإدارة فيه مواعيد متنوعة', r.status === 200 && r.data.events.length > 5 && kinds(r.data).includes('meeting') && kinds(r.data).includes('application'), kinds(r.data));
  T('المتجاوز معلَّم', r.data.events.some((e) => e.overdue) && r.data.counts.overdue === r.data.events.filter((e) => e.overdue).length);
  T('مرتَّب زمنياً', r.data.events.every((e, i, a) => !i || a[i - 1].date <= e.date));
  r = await get('/calendar', p1);
  T('تقويم الشريك بلا اجتماعات ولا نزاهة ولا تظلمات الغير', !kinds(r.data).some((k) => ['meeting', 'integrity'].includes(k)), kinds(r.data));
  T('ولا زيارات غير معلنة', !(r.data.events || []).some((e) => /غير معلنة/.test(e.title)));
  r = await get('/calendar', obs);
  T('المراقب: اجتماعات المجلس والمشاورات فقط', kinds(r.data).every((k) => ['meeting', 'consultation'].includes(k)), kinds(r.data));
  T('مدى معكوس ← 400', (await get('/calendar?from=2026-12-01&to=2026-01-01', dir)).status === 400);
  r = await get('/calendar?from=2030-01-01&to=2030-01-31', dir);
  T('مدى مستقبلي يُعيد المتجاوز فقط', r.data.events.every((e) => e.overdue || (e.date >= '2030-01-01' && e.date <= '2030-01-31')));

  // =====================================================================
  section('7. النسخ الاحتياطي');
  T('الشريك لا يصل ← 403', (await get('/backups', p1)).status === 403 && (await post('/backups', p1)).status === 403);
  T('المالية لا تصل ← 403', (await get('/backups', fin)).status === 403);
  T('ولا مسؤول السجل: النسخة تحوي كل البيانات فهي للمدير التنفيذي وحده ← 403', (await get('/backups', reg)).status === 403 && (await post('/backups', reg)).status === 403);
  r = await post('/backups', dir);
  const bk = r.data;
  T('المدير التنفيذي يُنشئ نسخة سليمة', r.status === 201 && bk.integrity === 'ok' && /^[0-9a-f]{64}$/.test(bk.sha256) && bk.size_bytes > 100000, bk);
  T('نسختان متتاليتان فوراً ← 429', (await post('/backups', dir)).status === 429);
  T('القائمة لا تكشف مسار الخادم', !('dir' in (await get('/backups', dir)).data));
  const dl = await fetch(`${B}/backups/${bk.id}/download?token=${dir}`);
  const buf = Buffer.from(await dl.arrayBuffer());
  T('تنزيل النسخة: ملف SQLite كامل ببصمته', dl.status === 200 && buf.slice(0, 15).toString() === 'SQLite format 3' &&
    require('crypto').createHash('sha256').update(buf).digest('hex') === bk.sha256);
  T('التنزيل لغير المخوَّل ← 403', (await fetch(`${B}/backups/${bk.id}/download?token=${p1}`)).status === 403 &&
    (await fetch(`${B}/backups/${bk.id}/download?token=${reg}`)).status === 403);
  T('نسخة غير موجودة ← 404', (await fetch(`${B}/backups/999999/download?token=${dir}`)).status === 404);
  // النسخة المسرَّبة لا تكفي للاستيلاء على حساب: لا روابط استعادة فيها، ومفاتيح التحقق بخطوتين مشفَّرة
  {
    const fs = require('fs'), os = require('os'), path = require('path');
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sema-bk-')), 'b.db'); fs.writeFileSync(f, buf);
    const Database = require('better-sqlite3'); const bdb = new Database(f, { readonly: true });
    const leaks = bdb.prepare("SELECT COUNT(*) n FROM email_outbox WHERE body_text LIKE '%token=%' OR body_text LIKE '%#/reset%'").get().n;
    const plain = bdb.prepare("SELECT COUNT(*) n FROM users WHERE (totp_secret IS NOT NULL AND totp_secret NOT LIKE 'v1:%') OR (totp_pending IS NOT NULL AND totp_pending NOT LIKE 'v1:%')").get().n;
    const sealed = bdb.prepare("SELECT COUNT(*) n FROM users WHERE totp_secret LIKE 'v1:%'").get().n;
    bdb.close(); fs.rmSync(path.dirname(f), { recursive: true, force: true });
    T('النسخة بلا أي رابط استعادة', leaks === 0, leaks);
    T('ومفاتيح التحقق بخطوتين فيها مشفَّرة لا نصاً', plain === 0 && sealed >= 1, { plain, sealed });
  }
  T('عدد نسخ غير صالح ← 400', (await put('/settings/backup_keep', dir, { value: '0' })).status === 400);
  await put('/settings/backup_keep', dir, { value: '1' });
  await sleep(2200);
  const bk2 = (await post('/backups', dir)).data;
  r = await get('/backups', dir);
  T('الاحتفاظ بآخر N نسخة: الأقدم تُحذف', r.data.rows.find((x) => x.id === bk2.id)?.available === true && r.data.rows.find((x) => x.id === bk.id)?.available === false, r.data.rows.map((x) => [x.id, x.available]));
  await put('/settings/backup_keep', dir, { value: '14' });
  const audit = (await get('/audit-log?action=backup&per_page=20', dir)).data.rows || [];
  T('الإنشاء والتنزيل مقيَّدان في سجل التتبع', audit.some((a) => a.action === 'backup.create') && audit.some((a) => a.action === 'backup.download'), audit.map((a) => a.action));

  // =====================================================================
  section('8. البريد الصادر');
  T('الشريك لا يصل ← 403', (await get('/outbox', p1)).status === 403);
  T('ولا حاملو سجل التتبع وحده (السجل · المجلس · المراجع الخارجي) ← 403', (await get('/outbox', reg)).status === 403 &&
    (await get('/outbox', await tok('chair@sema.ly'))).status === 403 && (await get('/outbox', await tok('auditor.ext@sema.ly'))).status === 403);
  r = await get('/outbox?per_page=200', dir);
  T('الصندوق يعرض الناقل المضبوط', r.status === 200 && r.data.transport === 'json', r.data.transport);
  T('الرسائل الحساسة لا يُعرض متنها أبداً', r.data.rows.filter((x) => x.kind === 'password_reset').every((x) => !/token=|#\/reset/.test(x.body_text)));
  T('إشعارات المراسلات تصل بالبريد', r.data.rows.some((x) => /مراسلة|رد الأمانة/.test(x.subject)));
  const held = r.data.rows.find((x) => x.status === 'held');
  if (held) {
    r = await post(`/outbox/${held.id}/retry`, dir);
    T('إعادة إرسال رسالة محتجَزة بعد ضبط الناقل', r.status === 200 && r.data.status === 'sent', r.data);
  }
  const sent = (await get('/outbox?status=sent', dir)).data.rows[0];
  T('إعادة إرسال المُرسَل ← 409', (await post(`/outbox/${sent.id}/retry`, dir)).status === 409);
  T('إعادة الإرسال لغير المخوَّل ← 403', (await post(`/outbox/${sent.id}/retry`, reg)).status === 403);
  // تفضيل البريد
  const before = (await get('/outbox?q=org1@sema.ly&per_page=200', dir)).data.total;
  await call('PATCH', '/auth/profile', o1, { email_notifications: false });
  await post('/threads', reg, { subject_kind: 'association', subject_id: 1, title: 'اختبار تفضيل البريد', body: 'رسالة لا تصل بالبريد' });
  await sleep(200);
  T('إيقاف البريد في التفضيلات يوقف نسخ الإشعارات', (await get('/outbox?q=org1@sema.ly&per_page=200', dir)).data.total === before);
  await call('PATCH', '/auth/profile', o1, { email_notifications: true });

  // =====================================================================
  section('9. ثغرات المراجعة المستقلة — حراسة');
  // (2) تغيير حالة الأحرف في المسار لا يتجاوز القيود
  const mrEmail = `p3-mr-${stamp}@sema.ly`;
  await post('/users', dir, { full_name: 'حساب مؤقت للاختبار', email: mrEmail, password: 'Temp2026x', roles: ['REGISTRY_OFFICER'] });
  const mr = (await login(mrEmail, 'Temp2026x')).token;
  const variants = ['/API/licensees', '/Api/invoices', '/aPi/threads'];
  const vr = await Promise.all(variants.map((v) => fetch(B.replace(/\/api$/, '') + v, { headers: { authorization: 'Bearer ' + mr } }).then((x) => x.status)));
  T('كلمة المرور المؤقتة لا تُتجاوز بتغيير حالة أحرف المسار', vr.every((x) => x === 403), vr);
  // (3) مرفقات المراسلات: لجنتا الترخيص والتظلمات لا تفتحانها ولا تجدانها
  const apl = await tok('appeals1@sema.ly');
  const pubDoc = att.document_id;
  for (const [nm, t] of [['لجنة الترخيص', lic], ['لجنة التظلمات', apl]]) {
    const st = await Promise.all([pubDoc, internalDoc].map((id) => fetch(`${B}/documents/${id}/file?token=${t}`).then((x) => x.status)));
    T(`${nm} لا تفتح مرفقات المراسلات ولا الداخلية منها ← 403`, st.every((x) => x === 403), st);
    const dl2 = (await get('/documents?q=' + encodeURIComponent('مرفق') + '&per_page=200', t)).data.rows || [];
    T(`${nm} لا تجدها في قائمة الإثباتات`, !dl2.some((d) => d.doc_type === 'correspondence'), dl2.filter((d) => d.doc_type === 'correspondence').map((d) => d.title));
    const sr = (await get('/search?q=' + encodeURIComponent(th.reference), t)).data;
    T(`${nm} لا تجدها بالبحث`, !(sr.groups || []).some((g) => g.key === 'documents'), (sr.groups || []).map((g) => g.key));
    const ld = (await get('/licensees/1', t)).data.documents || [];
    T(`${nm} لا تراها في ملف المرخَّص له`, !ld.some((d) => d.doc_type === 'correspondence'));
  }
  // (9) كل موظفي المراسلات يفتحون المرفق الداخلي ولو لم يملكوا صلاحية السرّي
  const st9 = await Promise.all([dir, fin, await tok('orgrel@sema.ly')].map((t) => fetch(`${B}/documents/${internalDoc}/file?token=${t}`).then((x) => x.status)));
  T('المدير والمالية والعلاقة بالمنظمات يفتحون المرفق الداخلي', st9.every((x) => x === 200), st9);
  T('وصاحب الملف يرى مرفقاته في ملفه ولا يرى الداخلي', ((await get('/licensees/1', p1)).data.documents || []).some((d) => d.id === pubDoc) &&
    !((await get('/documents?per_page=200', p1)).data.rows || []).some((d) => d.id === internalDoc));
  // (4) نص البلاغ لا يخرج بالبريد ولا يُحفظ في الصندوق
  const secret4 = 'سرّ-المبلّغ-' + stamp;
  r = await post('/complaints', null, { body: `${secret4} — واقعة استعمال للعلامة على منتج خارج نطاق الترخيص`, channel: 'portal', is_anonymous: true });
  await sleep(300);
  const ob4 = (await get('/outbox?per_page=200&q=' + encodeURIComponent('بلاغ'), dir)).data.rows || [];
  T('البلاغ يُبلَّغ بالبريد بلا نصه', r.status === 201 && ob4.length > 0 && ob4.every((x) => !x.body_text.includes(secret4)), { s: r.status, n: ob4.length });
  // (6) طلب multipart مشوَّه ← 400
  let fd6 = new FormData(); fd6.append('title', 'مرفق في حقل آخر'); fd6.append('body', 'اختبار'); fd6.append('other', file('x.pdf', '%PDF', 'application/pdf'), 'x.pdf');
  T('ملف في حقل غير متوقع ← 400', (await call('POST', '/threads', p1, fd6)).status === 400);
  fd6 = new FormData(); fd6.append('title', 'ملفان'); fd6.append('body', 'اختبار');
  fd6.append('file', file('a.pdf', '%PDF', 'application/pdf'), 'a.pdf'); fd6.append('file', file('b.pdf', '%PDF', 'application/pdf'), 'b.pdf');
  T('ملفان في حقل واحد ← 400', (await call('POST', '/threads', p1, fd6)).status === 400);
  const trunc = await fetch(B + '/threads', { method: 'POST', headers: { authorization: 'Bearer ' + p1, 'content-type': 'multipart/form-data; boundary=XX' },
    body: '--XX\r\nContent-Disposition: form-data; name="title"\r\n\r\nabc' });
  T('multipart مبتور ← 400', trunc.status === 400, trunc.status);
  // (7) الجهة لا تعرف الموظف: لا اسم ولا رقم حساب ولا فلترة بالإسناد
  const l7 = (await get('/threads?per_page=200', p1)).data.rows;
  T('قائمة الجهة بلا اسم الموظف المُسنَد', l7.every((x) => !x.assigned_name && !x.assigned_to));
  const d7 = (await get('/threads/' + th.id, p1)).data;
  T('وتفاصيلها بلا رقم حسابه', !d7.assigned_to && !d7.assigned_name && d7.messages.filter((m) => m.author_side === 'staff').every((m) => m.author_id === null));
  T('والفلترة بالموظف لا تعمل للجهة', (await get(`/threads?assigned_to=${regMe.id}&per_page=200`, p1)).data.total === l7.length);
  // (8) الملاحظة الداخلية لا تغيّر ما تراه الجهة
  const before8 = (await get('/threads/' + th.id, p1)).data.updated_at;
  await sleep(1100);
  await post(`/threads/${th.id}/messages`, reg, { body: 'ملاحظة داخلية لا تغيّر وقت التحديث', internal: true });
  T('الملاحظة الداخلية لا تغيّر «آخر تحديث» عند الجهة', (await get('/threads/' + th.id, p1)).data.updated_at === before8);
  // (مشتبه) تغيير كلمة المرور يُسقط روابط الاستعادة المعلَّقة
  const t9 = (await post('/auth/forgot', null, { email: mrEmail })).data.debug_token;
  await post('/auth/password', mr, { current_password: 'Temp2026x', new_password: 'Mine2026y' });
  T('تغيير كلمة المرور يُسقط رابط الاستعادة المعلَّق', (await get('/auth/reset/check?token=' + encodeURIComponent(t9))).data.valid === false);
  T('نوع موضوع من خصائص الكائن (constructor) ← 400', (await post('/threads', p1, { title: 'موضوع مريب', body: 'اختبار', topic_kind: 'constructor', topic_id: 1 })).status === 400);
  const sens = ((await get('/outbox?kind=password_reset&per_page=50', dir)).data.rows || [])[0];
  T('الرسائل الأمنية لا يُعاد إرسالها ← 422', sens && (await post(`/outbox/${sens.id}/retry`, dir)).status === (sens.status === 'sent' ? 409 : 422));

  // =====================================================================
  section('10. المهام الآلية والصلاحيات');
  r = await get('/jobs', dir);
  const jk = (r.data.jobs || []).map((j) => j.key);
  T('مهمتا البريد والنسخ الاحتياطي مسجّلتان', jk.includes('mail_delivery') && jk.includes('database_backup') && jk.length === 12, jk);
  r = await post('/jobs/run', dir, { job: 'database_backup' });
  T('مهمة النسخ لا تكرر نسخة اليوم', r.status === 200 && r.data.results[0].affected === 0 && !r.data.results[0].error, r.data);
  r = await post('/jobs/run', dir, { job: 'mail_delivery' });
  T('مهمة البريد تعمل', r.status === 200 && !r.data.results[0].error, r.data);
  const rb = (await get('/rbac', dir)).data;
  const pc = (rb.permissions || []).map((p) => p.code);
  T('الصلاحيات الجديدة في المصفوفة', ['thread.own', 'thread.staff', 'admin.backup'].every((c) => pc.includes(c)), pc.length);
  T('المراقب والشريك والمنظمة يراسلون، ولجنة الترخيص لا', (await me(obs)).permissions.includes('thread.own') &&
    (await me(o1)).permissions.includes('thread.own') && !(await me(lic)).permissions.some((p) => p.startsWith('thread.')));

  console.log(`\n======== النتيجة: ${pass} ناجح · ${fail} فاشل ========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); console.log(`\n======== النتيجة: ${pass} ناجح · ${fail + 1} فاشل ========`); process.exit(1); });
