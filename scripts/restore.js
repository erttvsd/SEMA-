'use strict';
/**
 * استعادة نسخة احتياطية — والخادم متوقف:  npm run restore -- <ملف النسخة>
 * يتحقق من سلامة النسخة وأنها قاعدة «سِيمَا الخَيْر» قبل أي تغيير، ويحفظ القاعدة الحالية جانباً.
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('الاستعمال: npm run restore -- <مسار ملف النسخة>'); process.exit(2); }
const DATA_DIR = process.env.SEMA_DATA_DIR || path.join(__dirname, '..', 'storage');
const DB_PATH = path.join(DATA_DIR, 'sema.db');

// 1) فحص النسخة قبل لمس أي شيء
let integrity, tables, users;
try {
  const check = new Database(src, { readonly: true, fileMustExist: true });
  integrity = check.pragma('integrity_check', { simple: true });
  tables = check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  users = tables.includes('users') ? check.prepare('SELECT COUNT(*) n FROM users').get().n : 0;
  check.close();
} catch (e) { console.error('✗ الملف ليس قاعدة SQLite صالحة: ' + e.message); process.exit(1); }
if (integrity !== 'ok') { console.error('✗ فحص السلامة فشل: ' + integrity); process.exit(1); }
for (const t of ['users', 'roles', 'licensees', 'associations', 'applications', 'documents'])
  if (!tables.includes(t)) { console.error(`✗ ليست قاعدة «سِيمَا الخَيْر»: الجدول ${t} غير موجود`); process.exit(1); }

// 2) الخادم يجب أن يكون متوقفاً — وإلا كتب فوق القاعدة المستعادة
const port = Number(process.env.PORT) || 3000;
fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) })
  .then(() => { console.error(`✗ الخادم يعمل على المنفذ ${port} — أوقفه أولاً ثم أعد الاستعادة.`); process.exit(1); })
  .catch(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_PATH)) {
      // لقطة كاملة للقاعدة الحالية — بما في ذلك ما بقي في سجل الكتابة (WAL) إن أُوقف الخادم دون إغلاق نظيف
      const aside = `${DB_PATH}.before-restore-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}`;
      const cur = new Database(DB_PATH);
      cur.exec(`VACUUM INTO '${aside.replace(/'/g, "''")}'`);
      cur.close();
      console.log(`حُفظت القاعدة الحالية جانباً: ${aside}`);
    }
    for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(DB_PATH + ext); } catch { /* غير موجود */ } }
    fs.copyFileSync(src, DB_PATH);
    console.log(`✓ استُعيدت ${path.basename(src)} (${users} مستخدماً) إلى ${DB_PATH}`);
    console.log('  تذكّر استعادة مجلد uploads من النسخة المقابلة زمنياً، ثم شغّل الخادم.');
  });
