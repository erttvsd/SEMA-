'use strict';
/** مسارات الواجهة من أولها إلى آخرها في متصفح حقيقي: التسجيل الذاتي، المشاورة، متابعة البلاغ، الشهادة، استكمال النواقص، المهام */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const BASE = process.env.SEMA_BASE || 'http://localhost:3000';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'sema-flows-'));
let pass = 0, fail = 0;
const T = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x ? ' → ' + String(x).slice(0, 200) : '')); } };
(async () => {
  let b;
  try { b = await chromium.launch(fs.existsSync(EXE) ? { executablePath: EXE } : {}); }
  catch (e) { console.log('UI flows skipped: no chromium — ' + e.message.split('\n')[0]); console.log('النتيجة: 0 ناجح · 0 فاشل'); return; }
  const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const go = async (h) => { await p.goto(BASE + '/' + h, { waitUntil: 'networkidle' }); await p.waitForTimeout(500); };
  const body = () => p.evaluate(() => document.body.innerText);
  const stamp = Date.now().toString(36);

  console.log('— تسجيل منشأة عبر الواجهة');
  await go('#/register');
  await p.fill('#bf [name=legal_name]', 'شركة اختبار الواجهة ' + stamp);
  await p.fill('#bf [name=commercial_reg]', 'CR-' + stamp);
  await p.fill('#bf [name=tax_file_no]', 'TX-' + stamp);
  await p.selectOption('#bf [name=sector]', { index: 1 });
  await p.fill('#bf [name=city]', 'طرابلس');
  await p.fill('#bf [name=annual_revenue]', '3500000');
  await p.fill('#bf [name=net_profit]', '900000');
  await p.selectOption('#bf [name=requested_level]', '2');
  await p.dispatchEvent('#bf [name=requested_level]', 'change'); await p.waitForTimeout(700);
  T('المعاينة تحسب الالتزام 18,000', /18[.,]000/.test(await p.innerText('#bprev')), await p.innerText('#bprev'));
  await p.fill('#bf [name=contact_name]', 'مختبر الواجهة');
  await p.fill('#bf [name=email]', `ui-${stamp}@example.ly`);
  await p.fill('#bf [name=password]', 'Weak');
  for (const n of ['pledge_exclusion', 'pledge_conduct', 'pledge_audit', 'pledge_statement']) await p.check(`#bf [name=${n}]`);
  await p.click('#bf button.primary'); await p.waitForTimeout(800);
  T('كلمة مرور ضعيفة تُرفض برسالة واضحة', /ثمانية أحرف/.test(await p.innerText('#berr')), await p.innerText('#berr'));
  await p.fill('#bf [name=password]', 'Strong2026x');
  await p.click('#bf button.primary'); await p.waitForTimeout(1800);
  let t = await body();
  T('التسجيل ينجح ويفتح نافذة الترحيب', /قُدِّم الطلب APP-/.test(t), t.slice(0, 300));
  T('النافذة تعرض الإثباتات الناقصة', /إثباتات إلزامية ما زالت ناقصة/.test(t));
  await p.screenshot({ path: `${OUT}/R1-registered.png` });
  await p.keyboard.press('Escape'); await go('#/applications');
  t = await body();
  T('الطالب الجديد يرى طلبه في «طلباتي»', /APP-\d+/.test(t) && /مقدَّم|submitted/.test(t));
  await go('#/documents');
  t = await body();
  T('إقرارات التسجيل محفوظة مستندات في ملفه', /نموذج \(3\) إقرار الحد الأدنى للسلوك/.test(t), t.slice(0, 200));
  await go('#/profile');
  T('صفحة حسابي تعمل', /تغيير كلمة المرور/.test(await body()));
  await p.evaluate(() => localStorage.clear()); await p.goto(BASE + '/'); await p.reload({ waitUntil: 'networkidle' });

  console.log('— تسجيل منظمة بنسبة إدارية فوق السقف');
  await go('#/register/org');
  const f = async (n, v) => p.fill(`#of [name=${n}]`, v);
  await f('name', 'جمعية اختبار ' + stamp); await f('registration_no', 'REG-' + stamp); await f('established_year', '2015');
  await f('city', 'بنغازي'); await p.selectOption('#of [name=region]', 'الشرقية'); await f('focus_areas', 'تعليم');
  await f('board_size', '7'); await f('board_meetings_last_year', '4'); await f('annual_revenue', '400000');
  await f('total_expenses', '380000'); await f('admin_expenses', '114000'); await f('largest_budget_3y', '420000');
  await p.waitForTimeout(300);
  T('المعاينة تنبّه لتجاوز سقف 25%', /تتجاوز سقف 25%/.test(await p.innerText('#oprev')));
  await f('contact_name', 'منسّق'); await f('email', `org-${stamp}@example.ly`); await f('password', 'Strong2026x');
  await p.check('#of [name=pledge_accuracy]'); await p.check('#of [name=pledge_audit]');
  await p.click('#of button.primary'); await p.waitForTimeout(1800);
  t = await body();
  T('تسجيل المنظمة ينجح بلا رسوم', /قُدِّم طلب الاعتماد/.test(t) && /صفر/.test(t), t.slice(0, 300));
  T('تحذير المعيار 8 ظاهر', /المعيار 8/.test(t));
  await p.evaluate(() => localStorage.clear()); await p.goto(BASE + '/'); await p.reload({ waitUntil: 'networkidle' });

  console.log('— ترشيح مراقب');
  await go('#/register/obs');
  await p.fill('#obf [name=person_name]', 'مراقب ' + stamp); await p.fill('#obf [name=nominating_entity]', 'جهة اختبار');
  await p.fill('#obf [name=contact_email]', `obs-${stamp}@example.ly`);
  await p.check('#obf [name=pledge_confidentiality]'); await p.check('#obf [name=pledge_costs]');
  await p.click('#obf button.primary'); await p.waitForTimeout(900);
  T('الترشيح يُقيَّد برقم', /قُيّد الترشيح برقم OBS-/.test(await p.innerText('#obres')));

  console.log('— المشاورة العامة');
  await go('#/consultations');
  t = await body();
  T('المشاورات منشورة', /حماية بيانات المستفيدين/.test(t) && /مفتوحة للمداخلات/.test(t));
  const form = p.locator('form.cmt').first();
  await form.locator('[name=author_name]').fill('مواطن مختبر');
  await form.locator('[name=body]').fill('أؤيد المعيار مع اقتراح نشر نموذج استرشادي باللغة العربية الواضحة.');
  await form.locator('button').click(); await p.waitForTimeout(1200);
  T('المداخلة تُسجَّل وتظهر', /مواطن مختبر/.test(await body()));

  console.log('— متابعة البلاغ');
  await go('#/track');
  await p.fill('#tf [name=reference]', 'CMP-00001'); await p.fill('#tf [name=code]', 'WRONG');
  await p.click('#tf button'); await p.waitForTimeout(600);
  T('رمز خاطئ يُرفض', /لم يُعثر على البلاغ/.test(await p.innerText('#tout')));
  await p.fill('#tf [name=code]', 'SEMA2026'); await p.click('#tf button'); await p.waitForTimeout(600);
  T('الرمز الصحيح يعرض الحالة', /الحالة/.test(await p.innerText('#tout')));

  console.log('— الشهادة ورمز QR');
  await go('#/certificate/LY-KH-0001-26');
  const qr = await p.evaluate(() => { const i = document.querySelector('.cert-ft img'); return i && i.complete && i.naturalWidth > 0; });
  T('الشهادة تعرض رمز QR محمَّلاً', qr);
  await p.screenshot({ path: `${OUT}/R2-certificate.png`, fullPage: true });

  console.log('— استكمال النواقص من الطالب');
  const login = async (e) => { await p.evaluate(() => localStorage.clear()); await p.goto(BASE + '/'); await p.reload({ waitUntil: 'networkidle' }); await go('#/login');
    await p.fill('[name=email]', e); await p.fill('[name=password]', 'Sema@2026'); await p.click('#lf button'); await p.waitForTimeout(1200); };
  const api = (path, tok) => p.evaluate(async ([u]) => (await fetch('/api' + u, { headers: { authorization: 'Bearer ' + localStorage.getItem('sema_token') } })).json(), [path]);
  await login('director@sema.ly');
  const def = (await api('/applications?status=deficiencies')).rows[0];
  const lic = await api('/licensees/' + def.subject_id);
  const owner = (await api('/users?per_page=200')).rows.find((u) => u.roles.some((r) => r.scope_kind === 'licensee' && r.scope_id === def.subject_id));
  await login(owner.email);
  await go('#/applications/' + def.id);
  T('زر «استكمال النواقص» يظهر للطالب', await p.locator('button:has-text("استكمال النواقص")').count() > 0);
  await p.click('button:has-text("استكمال النواقص")'); await p.waitForTimeout(300);
  await p.fill('#rf [name=note]', 'حُمِّلت الشهادة الضريبية المحدَّثة');
  await p.click('.modal-ft button.primary'); await p.waitForTimeout(1200);
  T('يعود الطلب إلى الوحدة (قيد الاستكمال)', /قيد الاستكمال/.test(await body()), lic.legal_name);

  console.log('— لوحة المهام الآلية');
  await login('director@sema.ly'); await go('#/jobs');
  await p.click('button:has-text("تشغيل الكل الآن")'); await p.waitForTimeout(1500);
  T('تشغيل المهام يدوياً', /manual:/.test(await body()));

  console.log('— المقترحات لرئيس المجلس');
  await login('chair@sema.ly'); await go('#/proposals/2');
  T('زر القرار ظاهر للمقترح المرفوع', await p.locator('button:has-text("القرار")').count() > 0);

  // ====================== المرحلة الثالثة ======================
  console.log('— البحث الشامل من الشريط العلوي');
  await login('director@sema.ly');
  await p.fill('.tb-search input', 'الواحة'); await p.press('.tb-search input', 'Enter'); await p.waitForTimeout(1200);
  t = await body();
  T('نتائج البحث مجمَّعة بحسب النوع', /البحث الشامل/.test(t) && /المرخَّص لهم/.test(t) && /الطلبات/.test(t), t.slice(0, 200));
  await p.click('.card tr.clk >> nth=0'); await p.waitForTimeout(1000);
  T('النقر على نتيجة يفتح ملفها', /#\/licensees\/\d+/.test(await p.evaluate(() => location.hash)));

  console.log('— تقويم المواعيد');
  await go('#/calendar');
  T('شبكة الشهر كاملة', await p.locator('.cal-d').count() >= 35);
  const month1 = await p.innerText('.card-hd h3, .card h3 >> nth=0').catch(() => '');
  await p.click('a:has-text("التالي")'); await p.waitForTimeout(900);
  T('التنقل إلى الشهر التالي', (await p.evaluate(() => location.hash)).includes('m=') && (await p.innerText('.card h3 >> nth=0').catch(() => '')) !== month1);

  console.log('— مراسلة من الشريك ورد الأمانة');
  await login('partner1@sema.ly'); await go('#/messages');
  await p.click('button:has-text("مراسلة جديدة")'); await p.waitForTimeout(700);
  const subj = 'استفسار الواجهة ' + stamp;
  await p.fill('#ntf [name=title]', subj); await p.fill('#ntf [name=body]', 'هل يلزم تجديد الموافقة على التصميم عند تغيير المقاس فقط؟');
  await p.setInputFiles('#ntf [name=file]', { name: 'sample.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 flows') });
  await p.click('.modal-ft button.primary'); await p.waitForTimeout(1500);
  const thash = await p.evaluate(() => location.hash);
  T('تُفتح المراسلة بعد إرسالها ومعها المرفق', /#\/messages\/\d+/.test(thash) && /sample\.pdf/.test(await body()), thash);
  await login('registry@sema.ly'); await go('#/messages');
  T('تظهر في الوارد بانتظار الأمانة', (await body()).includes(subj));
  await go(thash);
  await p.fill('#rpf [name=body]', 'لا يلزم ما دام التصميم نفسه والنسب محفوظة.');
  await p.click('#rpf button.primary'); await p.waitForTimeout(1200);
  T('رد الأمانة يُضاف والحالة تتغير', /بانتظار الجهة/.test(await body()));
  await login('partner1@sema.ly'); await go(thash);
  t = await body();
  T('الشريك يرى الرد باسم «الأمانة التنفيذية»', /لا يلزم ما دام التصميم/.test(t) && /الأمانة التنفيذية/.test(t));

  console.log('— التحقق بخطوتين عبر الواجهة');
  const TOTP = require('../server/totp');
  await login('appeals3@sema.ly'); await go('#/profile');
  const W = { timeout: 10e3 };
  await p.waitForSelector('button:has-text("تفعيل التحقق بخطوتين")', W);
  await p.click('button:has-text("تفعيل التحقق بخطوتين")');
  await p.waitForSelector('#p2f [name=password]', W);
  await p.fill('#p2f [name=password]', 'Sema@2026'); await p.click('.modal-ft button.primary');
  await p.waitForSelector('.qr2fa svg', W).catch(() => null);
  T('يظهر رمز QR والمفتاح', await p.locator('.qr2fa svg').count() === 1);
  const key = (await p.innerText('.modal .mono')).replace(/\s/g, '');
  await p.fill('#c2f [name=code]', TOTP.generate(key)); await p.click('.modal-ft button.primary');
  await p.waitForSelector('.recov span', W).catch(() => null);
  T('تظهر رموز الاسترداد الثمانية مرة واحدة', await p.locator('.recov span').count() === 8);
  await p.click('.modal-ft button:has-text("حفظتها")'); await p.waitForTimeout(900);
  T('الحالة: مفعَّل', /مفعَّل/.test(await body()));
  await p.evaluate(() => localStorage.clear()); await p.goto(BASE + '/'); await p.reload({ waitUntil: 'networkidle' }); await go('#/login');
  await p.fill('[name=email]', 'appeals3@sema.ly'); await p.fill('[name=password]', 'Sema@2026'); await p.click('#lf button'); await p.waitForTimeout(1000);
  T('الدخول يطلب رمز التحقق', await p.locator('#mf').isVisible());
  await p.fill('#mf [name=code]', TOTP.generate(key, Date.now() + 30e3)); await p.click('#mf button'); await p.waitForTimeout(1500);
  T('الرمز يُكمل الدخول', /#\/dashboard/.test(await p.evaluate(() => location.hash)) && !!(await p.evaluate(() => localStorage.getItem('sema_token'))));

  console.log('— استعادة كلمة المرور عبر الواجهة');
  await p.evaluate(() => localStorage.clear()); await p.goto(BASE + '/'); await p.reload({ waitUntil: 'networkidle' });
  await go('#/login'); await p.click('a:has-text("نسيت كلمة المرور")'); await p.waitForTimeout(600);
  await p.fill('#ff [name=email]', 'partner30@sema.ly'); await p.click('#ff button.primary'); await p.waitForTimeout(900);
  T('رسالة موحّدة بعد الطلب', /إن كان البريد مسجَّلاً/.test(await body()));
  await go('#/reset?token=invalid');
  T('رابط غير صالح يُرفض بوضوح', /غير صالح أو انتهت مدته/.test(await body()));
  const rt = await p.evaluate(async () => (await (await fetch('/api/auth/forgot', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'partner30@sema.ly' }) })).json()).debug_token);
  await go('#/reset?token=' + encodeURIComponent(rt));
  await p.fill('#rf [name=new_password]', 'Flows2026x'); await p.fill('#rf [name=confirm]', 'Flows2026x');
  await p.click('#rf button.primary'); await p.waitForTimeout(1000);
  T('تعيين كلمة المرور من الرابط', /عُيِّنت كلمة المرور/.test(await body()));
  await go('#/login'); await p.fill('[name=email]', 'partner30@sema.ly'); await p.fill('[name=password]', 'Flows2026x');
  await p.click('#lf button'); await p.waitForTimeout(1200);
  T('الدخول بكلمة المرور الجديدة', /#\/dashboard/.test(await p.evaluate(() => location.hash)));

  console.log(`\nالنتيجة: ${pass} ناجح · ${fail} فاشل · أخطاء صفحة: ${errs.length}`); errs.forEach((e) => console.log('  ' + e));
  await b.close(); fs.rmSync(OUT, { recursive: true, force: true }); process.exit(fail || errs.length ? 1 : 0);
})().catch((e) => { console.error('خطأ غير متوقع:', e.stack || e); console.log(`\nالنتيجة: ${pass} ناجح · ${fail + 1} فاشل`); process.exit(1); });
