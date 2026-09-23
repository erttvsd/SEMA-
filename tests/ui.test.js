'use strict';
/**
 * اختبار دخاني للواجهة بمتصفح حقيقي (Playwright/Chromium):
 *  - الصفحات العامة بلا دخول
 *  - لكل حساب: الدخول من النموذج ثم زيارة كل رابط في الشريط الجانبي (يُقرأ ديناميكياً)
 * يفشل عند: pageerror، أو استجابة /api/ بحالة ≥ 500، أو صفحة تحوي «صفحة غير موجودة» أو «تعذّر العرض».
 * تُتجاهل طلبات خطوط Google (لا اتصال بالإنترنت في بيئة الاختبار).
 *
 * يلزم خادم يعمل: node tests/run.js --only=ui
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.SEMA_BASE || 'http://localhost:3000';
const PW = 'Sema@2026';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ACCOUNTS = ['director', 'evaldir', 'assessor1', 'licensing1', 'appeals1', 'integrity1', 'standards1',
  'chair', 'ga1', 'finance', 'auditor.ext', 'partner1', 'org1', 'observer1'].map((a) => `${a}@sema.ly`);
const FONT_RE = /fonts\.(googleapis|gstatic)\.com/;
// لا اتصالات خلفية بخدمات Google (لا إنترنت في بيئة الاختبار)
const QUIET = ['--disable-background-networking', '--disable-component-update', '--disable-domain-reliability', '--no-pings', '--disable-sync'];
const BAD_TEXT = ['صفحة غير موجودة', 'تعذّر العرض'];

let pass = 0, fail = 0;
const T = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra ? '  →  ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)).slice(0, 400) : '')); }
};

function loadPlaywright() {
  const tries = ['playwright', 'playwright-core'];
  const globalRoot = path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules');
  for (const t of tries) {
    try { return require(t); } catch { /* التالي */ }
    try { return require(path.join(globalRoot, t)); } catch { /* التالي */ }
  }
  return null;
}

async function launch(pw) {
  const errs = [];
  if (fs.existsSync(CHROME)) {
    try { return await pw.chromium.launch({ executablePath: CHROME, headless: true, args: QUIET }); }
    catch (e) { errs.push('executablePath: ' + e.message.split('\n')[0]); }
  }
  try { return await pw.chromium.launch({ headless: true, args: QUIET }); }
  catch (e) { errs.push('default: ' + e.message.split('\n')[0]); }
  console.log('  ' + errs.join('\n  '));
  return null;
}

/** سياق متصفح يرصد الأخطاء ويتتبّع طلبات /api/ الجارية */
async function newSession(browser) {
  const context = await browser.newContext({ locale: 'ar-LY', viewport: { width: 1366, height: 900 } });
  await context.route(FONT_RE, (route) => route.abort());
  const page = await context.newPage();
  const s = { context, page, errors: [], inflight: 0, lastApi: Date.now() };
  page.on('pageerror', (e) => s.errors.push('pageerror: ' + (e.message || String(e)).split('\n')[0]));
  page.on('request', (r) => { if (r.url().includes('/api/')) { s.inflight++; s.lastApi = Date.now(); } });
  const done = (r) => { if (r.url().includes('/api/')) { s.inflight = Math.max(0, s.inflight - 1); s.lastApi = Date.now(); } };
  page.on('requestfinished', done);
  page.on('requestfailed', (r) => {
    done(r);
    if (FONT_RE.test(r.url())) return;
    const f = r.failure()?.errorText || '';
    if (/ERR_ABORTED/.test(f)) return; // تنقّل قاطع لطلب سابق
    s.errors.push(`requestfailed: ${r.method()} ${r.url().replace(BASE, '')} ${f}`);
  });
  page.on('response', (r) => {
    if (r.url().includes('/api/') && r.status() >= 500) s.errors.push(`HTTP ${r.status()}: ${r.request().method()} ${r.url().replace(BASE, '')}`);
  });
  return s;
}

/** ينتظر حتى تهدأ طلبات /api/ 300ms متصلة وينتهي العرض (حد أقصى 15 ث) */
async function settle(s, max = 15000) {
  const until = Date.now() + max;
  await s.page.waitForTimeout(80);
  while (Date.now() < until) {
    if (s.inflight === 0 && Date.now() - s.lastApi > 300) {
      const loading = await s.page.evaluate(() => !!document.querySelector('#app > .load')).catch(() => false);
      if (!loading) return true;
    }
    await s.page.waitForTimeout(60);
  }
  return false;
}

async function visit(s, hash) {
  const before = s.errors.length;
  const cur = await s.page.evaluate(() => location.hash).catch(() => null);
  if (cur === null) await s.page.goto(BASE + '/' + hash, { waitUntil: 'domcontentloaded' });
  else if (cur === hash) await s.page.evaluate(() => window.SEMA && window.SEMA.render());
  else await s.page.evaluate((h) => { location.hash = h; }, hash);
  const settled = await settle(s);
  const body = await s.page.evaluate(() => document.body.innerText).catch(() => '');
  const bad = BAD_TEXT.filter((t) => body.includes(t));
  const errs = s.errors.slice(before);
  if (!settled) errs.push('لم تستقر الصفحة خلال 15 ث');
  if (bad.length) errs.push('نص الخطأ في الصفحة: ' + bad.join('، ') + ' — ' + body.slice(body.indexOf(bad[0]), body.indexOf(bad[0]) + 160).replace(/\s+/g, ' '));
  return errs;
}

(async () => {
  const pw = loadPlaywright();
  if (!pw) { console.log('UI tests skipped: playwright module not found'); return process.exit(0); }
  const browser = await launch(pw);
  if (!browser) { console.log('UI tests skipped: no chromium'); return process.exit(0); }

  try {
    // ---------- الصفحات العامة ----------
    console.log('\n=== الصفحات العامة بلا دخول ===');
    const reg = await (await fetch(BASE + '/api/public/registry/licensees?status=active&per_page=1')).json().catch(() => ({ rows: [] }));
    const lno = reg.rows?.[0]?.license_no;
    const pub = ['#/', '#/registry', lno ? `#/verify/${lno}` : null, '#/verify/LY-KH-9999-99', '#/calculator', '#/levels',
      '#/transparency', '#/report-abuse', '#/register', '#/track', '#/consultations',
      lno ? `#/certificate/${lno}` : null, '#/login'].filter(Boolean);
    {
      const s = await newSession(browser);
      await s.page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
      await settle(s);
      for (const h of pub) {
        const errs = await visit(s, h);
        T(`عام ${h}`, errs.length === 0, errs.join(' | '));
      }
      if (lno) {
        await visit(s, `#/verify/${lno}`);
        const vt = await s.page.evaluate(() => document.body.innerText);
        T('صفحة التحقق تعرض رقم الترخيص', vt.includes(lno), vt.slice(0, 120));
      }
      await s.context.close();
    }

    // ---------- الحسابات ----------
    for (const email of ACCOUNTS) {
      console.log(`\n=== ${email} ===`);
      const s = await newSession(browser);
      try {
        await s.page.goto(BASE + '/#/login', { waitUntil: 'domcontentloaded' });
        await settle(s);
        await s.page.fill('[name=email]', email);
        await s.page.fill('[name=password]', PW);
        const before = s.errors.length;
        await s.page.click('#lf button');
        await s.page.waitForFunction(() => location.hash.startsWith('#/dashboard') && !!document.querySelector('.side a'), null, { timeout: 15000 })
          .catch(() => null);
        await settle(s);
        const ok = await s.page.evaluate(() => !!document.querySelector('.side a'));
        const lerr = await s.page.evaluate(() => document.getElementById('lerr')?.innerText || '').catch(() => '');
        const derr = s.errors.slice(before);
        const body = await s.page.evaluate(() => document.body.innerText).catch(() => '');
        const bad = BAD_TEXT.filter((t) => body.includes(t));
        T('الدخول من النموذج ولوحة البداية', ok && !derr.length && !bad.length, [lerr, ...derr, ...bad].filter(Boolean).join(' | ') || 'لا شريط جانبي بعد الدخول');
        if (!ok) continue;
        const links = await s.page.evaluate(() => [...new Set([...document.querySelectorAll('.side a')]
          .map((a) => a.getAttribute('href')).filter((h) => h && h.startsWith('#/')))]);
        for (const h of links) {
          if (h === '#/dashboard') continue; // فُحصت عند الدخول
          const errs = await visit(s, h);
          T(`${h}`, errs.length === 0, errs.join(' | '));
        }
        console.log(`    (${links.length} رابطاً في الشريط الجانبي)`);
      } catch (e) {
        T('الجلسة اكتملت دون استثناء', false, e.message.split('\n')[0]);
      } finally {
        await s.context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`\n======== النتيجة: ${pass} ناجح · ${fail} فاشل ========`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('خطأ غير متوقع:', e); console.log(`\n======== النتيجة: ${pass} ناجح · ${fail + 1} فاشل ========`); process.exit(1); });
