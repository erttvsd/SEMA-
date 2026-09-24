'use strict';
/**
 * تهيئة قاعدة إنتاج نظيفة — المراجع النظامية كاملةً (الأدوار والصلاحيات والمستويات والشرائح والمعايير
 * وأنواع الإثباتات والمؤشرات والإعدادات) دون أي بيانات تصويرية، مع حساب المدير التنفيذي الأول.
 *
 *   npm run init -- --email director@example.ly --name "الاسم الكامل"
 *   SEMA_ADMIN_PASSWORD=... npm run init -- --email ... --name ...     (وإلا وُلِّدت كلمة مرور عشوائية تُطبع مرة واحدة)
 *   --force   إعادة التهيئة فوق قاعدة قائمة (تمحو كل شيء)
 */
const crypto = require('crypto');
const arg = (k) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : null; };
const email = String(arg('email') || '').trim().toLowerCase(), name = String(arg('name') || '').trim();
const force = process.argv.includes('--force');

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 3) {
  console.error('الاستعمال: npm run init -- --email <البريد> --name "<الاسم الكامل>" [--force]');
  process.exit(2);
}

const { db } = require('../server/db');
const S = require('../server/seed');
const { bcrypt, passwordProblem } = require('../server/auth');

const hasUsers = (() => { try { return db.prepare('SELECT COUNT(*) n FROM users').get().n > 0; } catch { return false; } })();
if (hasUsers && !force) {
  console.error('في قاعدة البيانات مستخدمون بالفعل — لن تُمحى. لإعادة التهيئة (ومحو كل شيء) أضف --force بعد أخذ نسخة احتياطية.');
  process.exit(1);
}

let password = process.env.SEMA_ADMIN_PASSWORD || '';
const generated = !password;
if (generated) password = crypto.randomBytes(9).toString('base64url') + '7a';
const pw = passwordProblem(password);
if (pw) { console.error('SEMA_ADMIN_PASSWORD: ' + pw); process.exit(2); }

S.reset();
db.transaction(() => {
  S.seedReference();
  const id = db.prepare(`INSERT INTO users (full_name, email, password_hash, job_title, must_reset, password_changed_at)
      VALUES (?,?,?,?,1,datetime('now'))`).run(name, email, bcrypt.hashSync(password, 10), 'المدير التنفيذي').lastInsertRowid;
  db.prepare("INSERT INTO user_roles (user_id, role_code, scope_kind, scope_id, term_start) VALUES (?, 'EXEC_DIRECTOR', 'global', NULL, date('now'))").run(id);
  db.prepare("UPDATE settings SET v=? WHERE k='fiscal_year'").run(String(new Date().getFullYear()));
})();

console.log('\nهُيِّئت قاعدة البيانات بالمراجع النظامية دون بيانات تصويرية.');
console.log(`المدير التنفيذي: ${email}`);
if (generated) console.log(`كلمة المرور المؤقتة (تُعرض مرة واحدة): ${password}`);
console.log(`
الخطوات التالية:
  1. سجّل الدخول وغيّر كلمة المرور من «حسابي»، ثم فعّل التحقق بخطوتين.
  2. أنشئ حسابات الأمانة واللجان من «المستخدمون» — والنظام يمنع الجمع بين الوظائف المتعارضة.
  3. من «الإعدادات» ألزم حسابات الحوكمة والأمانة بالتحقق بخطوتين (require_2fa_internal = 1).
  4. شغّل الخادم بـ NODE_ENV=production و SEMA_DEMO=0 و SEMA_JWT_SECRET و SEMA_SMTP_URL — انظر docs/05.`);
