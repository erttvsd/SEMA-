#!/usr/bin/env node
'use strict';
/**
 * مشغّل الاختبارات — نقطة الدخول الوحيدة (npm test).
 *
 *   node tests/run.js                 كل المجموعات
 *   node tests/run.js --only=unit     مجموعة واحدة (أو أكثر: --only=unit,modules)
 *   node tests/run.js --keep          إبقاء مجلد البيانات المؤقت للفحص بعد التشغيل
 *
 * يبني قاعدة بيانات مستقلة في مجلد مؤقت (SEMA_DATA_DIR) ويشغّل الخادم على منفذ حر،
 * فلا يمسّ storage/ ولا خادم التطوير على المنفذ 3000.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SUITES = [
  { key: 'unit', file: 'tests/unit.test.js', server: false, timeout: 60e3 },
  // مسارات الواجهة أولاً: تعتمد على حالات البذرة (طلب بنواقص، مقترح مرفوع) قبل أن تغيّرها الاختبارات الأخرى
  { key: 'flows', file: 'tests/flows.test.js', server: true, timeout: 300e3 },
  { key: 'rules', file: 'tests/rules.test.js', server: true, timeout: 180e3 },
  { key: 'modules', file: 'tests/modules.test.js', server: true, timeout: 300e3 },
  { key: 'regression', file: 'tests/regression.test.js', server: true, timeout: 180e3 },
  { key: 'phase3', file: 'tests/phase3.test.js', server: true, timeout: 240e3 },
  { key: 'ui', file: 'tests/ui.test.js', server: true, timeout: 600e3 },
];

const args = process.argv.slice(2);
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',').map((s) => s.trim()).filter(Boolean) : null;
const keep = args.includes('--keep');
if (only) {
  const unknown = only.filter((k) => !SUITES.some((s) => s.key === k));
  if (unknown.length) {
    console.error(`مجموعة غير معروفة: ${unknown.join(', ')} — المتاح: ${SUITES.map((s) => s.key).join(', ')}`);
    process.exit(2);
  }
}
const selected = SUITES.filter((s) => !only || only.includes(s.key));
const needServer = selected.some((s) => s.server);

let tmpDir = null;
let server = null;
let serverLog = null;
let current = null; // ملف الاختبار الجاري
let cleaned = false;

function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (current && current.exitCode === null) {
    try { current.kill('SIGTERM'); } catch { /* تجاهل */ }
  }
  if (server && server.exitCode === null && !server.killed) {
    try { server.kill('SIGKILL'); } catch { /* تجاهل */ }
  }
  if (tmpDir) {
    if (keep) console.log(`\n(--keep) مجلد البيانات المؤقت محفوظ: ${tmpDir}`);
    else { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* تجاهل */ } }
  }
}
process.on('exit', cleanup);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { console.error(`\nتلقّى ${sig} — إيقاف الخادم وتنظيف المجلد المؤقت`); cleanup(); process.exit(130); });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

/** يشغّل عملية Node ويُرجع رمز الخروج ومخرجاتها كاملةً. echo=true يعرضها أثناء التشغيل */
function runNode(file, env, { echo = true, timeout = 120e3 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    let out = '';
    const onData = (stream) => (buf) => { const s = buf.toString(); out += s; if (echo) stream.write(s); };
    child.stdout.on('data', onData(process.stdout));
    child.stderr.on('data', onData(process.stderr));
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeout);
    child.on('close', (code, signal) => { clearTimeout(t); current = null; resolve({ code, signal, out, timedOut }); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: out + '\n' + e.message, timedOut }); });
  });
}

async function waitHealthy(base, ms) {
  const until = Date.now() + ms;
  let lastErr = null;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error(`خرج الخادم مبكراً برمز ${server.exitCode}`);
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok && (await r.json()).ok) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`لم يجهز الخادم خلال ${ms / 1000} ثانية${lastErr ? ' — ' + lastErr.message : ''}`);
}

function tail(file, n = 40) {
  try { return fs.readFileSync(file, 'utf8').split('\n').slice(-n).join('\n'); } catch { return ''; }
}

/** يستخرج سطر «النتيجة: X ناجح · Y فاشل» من مخرجات ملف الاختبار */
function parseCounts(out) {
  const m = [...out.matchAll(/النتيجة:\s*(\d+)\s*ناجح\s*·\s*(\d+)\s*فاشل(?:\s*·\s*(\d+)\s*متخطّى)?/g)].pop();
  return m ? { pass: Number(m[1]), fail: Number(m[2]), skip: m[3] ? Number(m[3]) : 0 } : null;
}

(async () => {
  const started = Date.now();
  // الخادم لا يثق بـX-Forwarded-For، فكل التسجيلات تأتي من العنوان نفسه — يُرفع حدّها لنسخة الاختبار وحدها
  // البريد بإرسال صوري بلا شبكة، ورموز الاستعادة تُعاد في الرد لنسخة الاختبار وحدها (لا تعمل في الإنتاج)
  const env = { ...process.env, SEMA_JOBS: '0', SEMA_REG_LIMIT: '1000', SEMA_MAIL_TRANSPORT: 'json', SEMA_TEST_EXPOSE_TOKENS: '1' };
  delete env.NODE_ENV;
  const results = [];
  let harnessError = null;

  try {
    if (needServer) {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sema-test-'));
      const port = await freePort();
      env.SEMA_DATA_DIR = tmpDir;
      env.PORT = String(port);
      env.SEMA_BASE = `http://127.0.0.1:${port}`;
      console.log(`مجلد البيانات المؤقت: ${tmpDir}\nالمنفذ: ${port}`);

      console.log('\n>>> بناء البيانات التصويرية (server/seed-run.js)…');
      const t0 = Date.now();
      const seed = await runNode('server/seed-run.js', env, { echo: false, timeout: 300e3 });
      if (seed.code !== 0) {
        console.error(seed.out.split('\n').slice(-40).join('\n'));
        throw new Error(`فشل بناء البيانات (رمز ${seed.code}${seed.timedOut ? '، انتهت المهلة' : ''})`);
      }
      console.log(`    تمّ في ${((Date.now() - t0) / 1000).toFixed(1)} ث`);

      console.log('>>> تشغيل الخادم (server/index.js)…');
      serverLog = path.join(tmpDir, 'server.log');
      const logFd = fs.openSync(serverLog, 'a');
      server = spawn(process.execPath, ['server/index.js'], { cwd: ROOT, env, stdio: ['ignore', logFd, logFd] });
      fs.closeSync(logFd);
      await waitHealthy(env.SEMA_BASE, 20e3);
      console.log(`    جاهز على ${env.SEMA_BASE}`);
    }

    for (const s of selected) {
      console.log(`\n${'='.repeat(70)}\n>>> ${s.file}\n${'='.repeat(70)}`);
      const t0 = Date.now();
      const r = await runNode(s.file, env, { timeout: s.timeout });
      const counts = parseCounts(r.out);
      const skipped = /UI tests skipped/.test(r.out);
      const ok = r.code === 0 && !r.timedOut && (counts ? counts.fail === 0 : skipped || r.code === 0);
      results.push({ ...s, code: r.code, timedOut: r.timedOut, counts, skipped, ok, secs: (Date.now() - t0) / 1000 });
      if (s.server && server && server.exitCode !== null) {
        harnessError = new Error(`توقف الخادم أثناء ${s.file} (رمز ${server.exitCode})`);
        break;
      }
    }
  } catch (e) {
    harnessError = e;
  }

  // ---------- الملخّص ----------
  console.log(`\n${'='.repeat(70)}\nملخّص الاختبارات\n${'='.repeat(70)}`);
  let totalPass = 0, totalFail = 0;
  for (const r of results) {
    const c = r.counts;
    if (c) { totalPass += c.pass; totalFail += c.fail; }
    const status = r.ok ? 'ناجح' : 'فاشل';
    const detail = r.timedOut ? 'انتهت المهلة'
      : c ? `${c.pass} ناجح · ${c.fail} فاشل${c.skip ? ` · ${c.skip} متخطّى` : ''}`
      : r.skipped ? 'متخطّى (لا متصفح)'
      : `لا سطر نتيجة — رمز الخروج ${r.code}`;
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.file.padEnd(24)} ${status.padEnd(5)}  ${detail}  (${r.secs.toFixed(1)} ث)`);
  }
  for (const s of selected.filter((x) => !results.some((r) => r.key === x.key)))
    console.log(`  - ${s.file.padEnd(24)} لم يُشغَّل`);

  if (serverLog) {
    const log = fs.existsSync(serverLog) ? fs.readFileSync(serverLog, 'utf8') : '';
    const errs = log.split('\n').filter((l) => /Error|خطأ في الخادم|\[jobs\]/.test(l));
    if (errs.length) {
      console.log(`\n  تنبيه: سجّل الخادم ${errs.length} سطر خطأ (أول خمسة):`);
      errs.slice(0, 5).forEach((l) => console.log('    ' + l.slice(0, 200)));
    }
  }
  if (harnessError) {
    console.log(`\n  ✗ خطأ في المشغّل: ${harnessError.message}`);
    if (serverLog) console.log('  آخر سجل الخادم:\n' + tail(serverLog, 30).replace(/^/gm, '    '));
  }
  const failed = !!harnessError || results.some((r) => !r.ok) || results.length < selected.length;
  console.log(`\n  الإجمالي: ${totalPass} ناجح · ${totalFail} فاشل — ${((Date.now() - started) / 1000).toFixed(1)} ث`);
  console.log(`  ${failed ? '✗ فشل التشغيل' : '✓ نجحت كل المجموعات'}\n`);

  if (server && server.exitCode === null) {
    server.kill('SIGTERM');
    await Promise.race([new Promise((r) => server.once('exit', r)), new Promise((r) => setTimeout(r, 3000))]);
  }
  cleanup();
  process.exit(failed ? 1 : 0);
})();
