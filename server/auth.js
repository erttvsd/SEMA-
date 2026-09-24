'use strict';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('./db');
const { permissionsFor } = require('./rbac');

const DEV_SECRET = 'sema-alkhayr-dev-secret-change-in-production';
const SECRET = process.env.SEMA_JWT_SECRET || DEV_SECRET;
if (process.env.NODE_ENV === 'production' && SECRET === DEV_SECRET) {
  throw new Error('SEMA_JWT_SECRET يجب تعيينه في بيئة الإنتاج');
}
const TTL = '12h';

function loadUser(userId) {
  const u = db.prepare(`SELECT id, full_name, email, phone, region, gender, job_title, status, totp_enabled, email_notifications,
    must_reset FROM users WHERE id=?`).get(userId);
  if (!u) return null;
  const rows = db.prepare(`
    SELECT ur.role_code, ur.scope_kind, ur.scope_id, r.name_ar, r.category, r.sod_function, r.description
    FROM user_roles ur JOIN roles r ON r.code=ur.role_code WHERE ur.user_id=?`).all(userId);
  u.roles = rows;
  u.role_codes = rows.map((r) => r.role_code);
  u.permissions = permissionsFor(u.role_codes);
  u.scopes = {
    licensee: rows.filter((r) => r.scope_kind === 'licensee').map((r) => r.scope_id),
    association: rows.filter((r) => r.scope_kind === 'association').map((r) => r.scope_id),
  };
  u.totp_enabled = !!u.totp_enabled;
  u.email_notifications = !!u.email_notifications;
  u.must_reset = !!u.must_reset;
  // حسابات الحوكمة والأمانة تُلزَم بالتحقق بخطوتين متى فعّلت الإدارة ذلك
  u.internal = rows.some((r) => ['governance', 'executive'].includes(r.category));
  u.mfa_enroll_required = u.internal && !u.totp_enabled &&
    db.prepare("SELECT v FROM settings WHERE k='require_2fa_internal'").get()?.v === '1';
  return u;
}

function issueToken(user) {
  const tv = db.prepare('SELECT token_version v FROM users WHERE id=?').get(user.id)?.v || 0;
  return jwt.sign({ uid: user.id, email: user.email, tv }, SECRET, { expiresIn: TTL });
}

/** سياسة كلمة المرور: ثمانية أحرف على الأقل تجمع حروفاً وأرقاماً */
function passwordProblem(pw) {
  const p = String(pw || '');
  if (p.length < 8) return 'كلمة المرور ثمانية أحرف على الأقل';
  if (p.length > 128) return 'كلمة المرور طويلة جداً';
  if (!/[0-9]/.test(p) || !/[^0-9\s]/.test(p)) return 'كلمة المرور تجمع حروفاً وأرقاماً';
  return null;
}

// حدّ محاولات الدخول: خمس محاولات فاشلة لكل بريد وعنوان خلال خمس عشرة دقيقة
const attempts = new Map();
const WINDOW = 15 * 60 * 1000, MAX_FAIL = 5;
function throttled(key, max = MAX_FAIL) {
  const a = attempts.get(key);
  if (!a) return false;
  if (Date.now() - a.first > WINDOW) { attempts.delete(key); return false; }
  return a.n >= max;
}
function recordFail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { n: 1, first: Date.now() });
  else a.n++;
}

function login(email, password, ip) {
  // حدّان مستقلان: لكل بريد أياً كان العنوان، ولكل عنوان أياً كان البريد
  const em = 'e:' + String(email || '').trim().toLowerCase(), ipk = 'i:' + (ip || '');
  if (throttled(em) || throttled(ipk, 20)) return { error: 'محاولات كثيرة فاشلة — أعد المحاولة بعد خمس عشرة دقيقة', status: 429 };
  const key = em;
  const row = db.prepare('SELECT id, password_hash, status, totp_enabled FROM users WHERE lower(email)=lower(?)').get(String(email || '').trim());
  if (!row || !bcrypt.compareSync(String(password || ''), row.password_hash)) { recordFail(key); recordFail(ipk); return { error: 'بيانات الدخول غير صحيحة' }; }
  attempts.delete(key);
  if (row.status !== 'active') return { error: 'الحساب موقوف — راجع الأمانة' };
  if (row.totp_enabled) {
    // الخطوة الثانية: رمز مؤقت لا يصلح إلا لإكمال الدخول خلال خمس دقائق
    return { mfa_required: true, mfa_token: jwt.sign({ uid: row.id, purpose: 'mfa' }, SECRET, { expiresIn: '5m' }) };
  }
  return completeLogin(row.id);
}

function completeLogin(userId) {
  db.prepare("UPDATE users SET last_login_at=datetime('now') WHERE id=?").run(userId);
  const user = loadUser(userId);
  return { token: issueToken(user), user };
}

/** إكمال الدخول برمز تطبيق المصادقة أو برمز استرداد */
function loginSecondStep(mfaToken, code, ip) {
  let p;
  try { p = jwt.verify(String(mfaToken || ''), SECRET); } catch { return { error: 'انتهت مهلة الخطوة الثانية — أعد تسجيل الدخول', status: 401 }; }
  if (p.purpose !== 'mfa') return { error: 'رمز غير صالح', status: 401 };
  const key = 'm:' + p.uid, ipk = 'i:' + (ip || '');
  if (throttled(key) || throttled(ipk, 20)) return { error: 'محاولات كثيرة فاشلة — أعد المحاولة بعد خمس عشرة دقيقة', status: 429 };
  const row = db.prepare('SELECT id, status, totp_enabled, totp_secret, totp_last_counter, totp_recovery FROM users WHERE id=?').get(p.uid);
  if (!row || row.status !== 'active' || !row.totp_enabled) return { error: 'الحساب غير متاح', status: 401 };
  const TOTP = require('./totp');
  const c = String(code || '').trim();
  const ctr = TOTP.verify(row.totp_secret, c, row.totp_last_counter);
  if (ctr !== null) {
    db.prepare('UPDATE users SET totp_last_counter=? WHERE id=?').run(ctr, row.id);
  } else {
    const hashes = JSON.parse(row.totp_recovery || '[]'), h = TOTP.hashCode(c);
    const i = c.length >= 10 ? hashes.indexOf(h) : -1;
    if (i < 0) { recordFail(key); recordFail(ipk); return { error: 'رمز التحقق غير صحيح', status: 401 }; }
    hashes.splice(i, 1);
    db.prepare('UPDATE users SET totp_recovery=? WHERE id=?').run(JSON.stringify(hashes), row.id);
    require('./mailer').toUser(row.id, { kind: 'security', subject: 'سِيمَا الخَيْر — استُعمل رمز استرداد',
      body: `دخل أحدٌ حسابك برمز استرداد. بقي لديك ${hashes.length} رموز. إن لم تكن أنت فغيّر كلمة المرور فوراً وراجع الأمانة.` });
  }
  attempts.delete(key);
  return completeLogin(row.id);
}

/** يقرأ المستخدم من الترويسة إن وُجد، دون منع */
function attachUser(req, _res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (t) {
    try {
      const p = jwt.verify(t, SECRET);
      if (p.purpose) throw new Error('رمز لغرض آخر');   // رمز الخطوة الثانية لا يصلح جلسةً
      const row = db.prepare('SELECT status, token_version FROM users WHERE id=?').get(p.uid);
      // الرمز يسقط بإيقاف الحساب أو بتغيير كلمة المرور (رقم إصدار الرموز يزيد عند كل تغيير)
      if (row && row.status === 'active' && (p.tv || 0) === (row.token_version || 0)) req.user = loadUser(p.uid);
    } catch { /* رمز غير صالح — يُعامل كزائر */ }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
  next();
}

/** صلاحية واحدة أو أكثر (أي منها) */
function can(...perms) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'يلزم تسجيل الدخول' });
    if (perms.some((p) => req.user.permissions.includes(p))) return next();
    return res.status(403).json({
      error: 'لا تملك الصلاحية لهذا الإجراء',
      required: perms,
      hint: 'مصفوفة الصلاحيات في النظام الداخلي تحدد الجهة المختصة بهذا القرار',
    });
  };
}

function hasPerm(user, p) { return !!user && user.permissions.includes(p); }

/** نطاق الجهة: صاحب الملف يرى ملفه فقط ما لم يملك صلاحية عامة */
function ownsLicensee(user, id) { return user.scopes.licensee.includes(Number(id)); }
function ownsAssociation(user, id) { return user.scopes.association.includes(Number(id)); }

function log(req, action, entity_kind, entity_id, summary, before, after) {
  db.prepare(`INSERT INTO audit_log (actor_id, actor_name, actor_roles, action, entity_kind, entity_id, summary, before_json, after_json, ip)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    req.user ? req.user.id : null,
    req.user ? req.user.full_name : 'زائر',
    req.user ? req.user.role_codes.join(',') : '',
    action, entity_kind, entity_id || null, summary || null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    req.ip || null);
}

/** مصدر واحد للإشعار (مع نسخته البريدية) في services.js */
function notify(o) { return require('./services').notify(o); }

module.exports = { passwordProblem, issueToken, login, loginSecondStep, completeLogin, SECRET, loadUser, attachUser, requireAuth, can, hasPerm, ownsLicensee, ownsAssociation, log, notify, bcrypt };
