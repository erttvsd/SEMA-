'use strict';
/**
 * نقطة دخول الحاوية — تجعل النشر على Dokploy أو أي منصة حاويات بلا خطوات يدوية:
 *  1. سرّ الجلسات: من SEMA_JWT_SECRET، وإلا وُلِّد مرة واحدة وحُفظ في مجلد البيانات فيبقى بعد إعادة النشر.
 *  2. أول تشغيل على مجلد بيانات فارغ، بحسب SEMA_AUTO_SEED:
 *       demo  ← البيانات التصويرية كاملةً وحساباتها (للعرض)
 *       init  ← قاعدة إنتاج نظيفة وحساب المدير التنفيذي من SEMA_ADMIN_EMAIL و SEMA_ADMIN_NAME (و SEMA_ADMIN_PASSWORD)
 *       (فارغ) ← لا شيء — ويُطبع ما يلزم
 *  3. تشغيل الخادم.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.SEMA_DATA_DIR || path.join(ROOT, 'storage');
fs.mkdirSync(DATA_DIR, { recursive: true });

function persistentSecret(envName, file) {
  if (process.env[envName]) return;
  const f = path.join(DATA_DIR, file);
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, crypto.randomBytes(48).toString('base64url'), { mode: 0o600 });
    console.log(`[entrypoint] وُلِّد ${envName} وحُفظ في ${f} — يبقى ثابتاً ما بقي مجلد البيانات`);
  }
  process.env[envName] = fs.readFileSync(f, 'utf8').trim();
}
persistentSecret('SEMA_JWT_SECRET', '.jwt-secret');
persistentSecret('SEMA_DATA_KEY', '.data-key');

function hasUsers() {
  const dbPath = path.join(DATA_DIR, 'sema.db');
  if (!fs.existsSync(dbPath)) return false;
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true });
    const n = db.prepare('SELECT COUNT(*) n FROM users').get().n;
    db.close();
    return n > 0;
  } catch { return false; }
}

const mode = String(process.env.SEMA_AUTO_SEED || '').trim().toLowerCase();
if (!hasUsers()) {
  const run = (args) => {
    const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit', env: process.env });
    if (r.status !== 0) { console.error(`[entrypoint] فشل: node ${args.join(' ')}`); process.exit(r.status || 1); }
  };
  if (mode === 'demo') {
    console.log('[entrypoint] مجلد بيانات فارغ — بناء البيانات التصويرية (SEMA_AUTO_SEED=demo)…');
    run(['server/seed-run.js']);
  } else if (mode === 'init') {
    const email = process.env.SEMA_ADMIN_EMAIL, name = process.env.SEMA_ADMIN_NAME;
    if (!email || !name) { console.error('[entrypoint] SEMA_AUTO_SEED=init يلزمه SEMA_ADMIN_EMAIL و SEMA_ADMIN_NAME'); process.exit(1); }
    console.log('[entrypoint] مجلد بيانات فارغ — تهيئة قاعدة إنتاج نظيفة (SEMA_AUTO_SEED=init)…');
    run(['scripts/init.js', '--email', email, '--name', name]);
  } else {
    console.warn('[entrypoint] قاعدة البيانات فارغة. اضبط SEMA_AUTO_SEED=demo للعرض، أو SEMA_AUTO_SEED=init مع SEMA_ADMIN_EMAIL و SEMA_ADMIN_NAME للإنتاج، ثم أعد النشر.');
  }
}

require('../server/index.js').start();
