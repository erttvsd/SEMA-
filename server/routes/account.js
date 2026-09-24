'use strict';
/** الحساب: استعادة كلمة المرور · التحقق بخطوتين · صندوق البريد الصادر */
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db } = require('../db');
const { can, requireAuth, hasPerm, log, bcrypt, passwordProblem, loadUser, issueToken } = require('../auth');
const { buildList } = require('../query');
const MAIL = require('../mailer');
const TOTP = require('../totp');

const r = express.Router();
const RESET_MINUTES = 60;

// ترحيل: أي مفتاح مخزَّن قبل التشفير يُشفَّر عند الإقلاع
for (const u of db.prepare("SELECT id, totp_secret, totp_pending FROM users WHERE (totp_secret IS NOT NULL AND totp_secret NOT LIKE 'v1:%') OR (totp_pending IS NOT NULL AND totp_pending NOT LIKE 'v1:%')").all())
  db.prepare('UPDATE users SET totp_secret=?, totp_pending=? WHERE id=?').run(TOTP.seal(TOTP.open(u.totp_secret)), TOTP.seal(TOTP.open(u.totp_pending)), u.id);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const exposeTokens = () => process.env.NODE_ENV !== 'production' && process.env.SEMA_TEST_EXPOSE_TOKENS === '1';
const maskEmail = (e) => String(e).replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => a + '*'.repeat(Math.min(b.length, 6)) + c);

// حدّ طلبات الاستعادة: ثلاثة لكل بريد وعشرة لكل عنوان في الساعة — منعاً لإغراق صندوق أحد
const hits = new Map();
function limited(key, max) {
  const now = Date.now();
  if (hits.size > 20000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k);   // ذاكرة محدودة
  const a = (hits.get(key) || []).filter((t) => now - t < 3600e3);
  a.push(now); hits.set(key, a);
  return a.length > max;
}

/** يُصدر رمز استعادة ويُرسله بالبريد — لا يُعاد الرمز لمن طلبه ولا لمن أصدره */
function issueReset(user, { issuedBy = null, ip = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  // رمز واحد صالح في كل وقت: إصدار رمز جديد يُبطل ما قبله
  db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE user_id=? AND used_at IS NULL").run(user.id);
  db.prepare(`INSERT INTO password_resets (user_id, token_hash, expires_at, issued_by, ip)
      VALUES (?,?,datetime('now', ?),?,?)`).run(user.id, sha(token), `+${RESET_MINUTES} minutes`, issuedBy, ip);
  MAIL.queue({ to_email: user.email, to_user_id: user.id, kind: 'password_reset', sensitive: true,
    subject: 'سِيمَا الخَيْر — استعادة كلمة المرور',
    body: `مرحباً ${user.full_name}،\n\n${issuedBy ? 'أصدرت الأمانة لحسابك رابطاً لتعيين كلمة المرور' : 'طُلبت استعادة كلمة مرور حسابك'}. ` +
      `الرابط صالح ${RESET_MINUTES} دقيقة ولمرة واحدة:\n\n${MAIL.publicUrl()}/#/reset?token=${token}\n\n` +
      'إن لم تطلب ذلك فتجاهل الرسالة؛ كلمة مرورك الحالية باقية كما هي.' });
  return token;
}

const findReset = (token) => db.prepare(`SELECT pr.*, u.email, u.status FROM password_resets pr JOIN users u ON u.id=pr.user_id
    WHERE pr.token_hash=? AND pr.used_at IS NULL AND pr.expires_at > datetime('now')`).get(sha(token || ''));

// ================= استعادة كلمة المرور =================
r.post('/auth/forgot', (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'أدخل بريداً صالحاً' });
  // حدّ العنوان أولاً: من تجاوزه لا يُسجَّل له بريد جديد في الذاكرة
  if (limited('i:' + req.ip, 10) || limited('e:' + email, 3))
    return res.status(429).json({ error: 'طلبات كثيرة — أعد المحاولة بعد ساعة' });
  const u = db.prepare("SELECT id, full_name, email, status FROM users WHERE lower(email)=? AND status='active'").get(email);
  let token = null;
  if (u) {
    token = issueReset(u, { ip: req.ip });
    log({ user: null, ip: req.ip }, 'auth.forgot', 'user', u.id, 'طلب استعادة كلمة المرور');
  }
  // الرد واحد وُجد الحساب أم لم يوجد — فلا تُستعمل الصفحة لمعرفة من له حساب
  res.json({ ok: true, note: 'إن كان البريد مسجَّلاً فستصله رسالة فيها رابط صالح ساعة واحدة.',
    ...(exposeTokens() && token ? { debug_token: token } : {}) });
});

r.get('/auth/reset/check', (req, res) => {
  const pr = findReset(req.query.token);
  if (!pr || pr.status !== 'active') return res.json({ valid: false });
  res.json({ valid: true, email: maskEmail(pr.email), expires_at: pr.expires_at });
});

r.post('/auth/reset', (req, res) => {
  const pr = findReset(req.body.token);
  if (!pr || pr.status !== 'active') return res.status(400).json({ error: 'الرابط غير صالح أو انتهت مدته — اطلب رابطاً جديداً' });
  const pw = passwordProblem(req.body.new_password);
  if (pw) return res.status(422).json({ error: pw });
  const tx = db.transaction(() => {
    db.prepare("UPDATE password_resets SET used_at=datetime('now') WHERE id=?").run(pr.id);
    db.prepare(`UPDATE users SET password_hash=?, password_changed_at=datetime('now'), token_version=token_version+1,
        must_reset=0 WHERE id=?`).run(bcrypt.hashSync(req.body.new_password, 10), pr.user_id);
  });
  tx();
  log({ user: loadUser(pr.user_id), ip: req.ip }, 'auth.reset', 'user', pr.user_id, 'تعيين كلمة مرور برابط الاستعادة');
  MAIL.toUser(pr.user_id, { kind: 'security', subject: 'سِيمَا الخَيْر — عُيِّنت كلمة مرور جديدة',
    body: 'عُيِّنت كلمة مرور جديدة لحسابك وأُغلقت كل الجلسات المفتوحة. إن لم تكن أنت فراجع الأمانة فوراً.' });
  res.json({ ok: true, note: 'عُيِّنت كلمة المرور — سجّل الدخول بها الآن.' });
});

// الإدارة تُرسل رابط تعيين لمستخدم — ولا ترى الرابط ولا كلمة المرور
r.post('/users/:id/reset-link', requireAuth, can('admin.users'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(403).json({ error: 'غيّر كلمة مرورك من «حسابي»' });
  const u = db.prepare('SELECT id, full_name, email, status FROM users WHERE id=?').get(id);
  if (!u) return res.status(404).json({ error: 'غير موجود' });
  if (u.status !== 'active') return res.status(422).json({ error: 'الحساب موقوف — فعّله أولاً' });
  const token = issueReset(u, { issuedBy: req.user.id, ip: req.ip });
  log(req, 'user.reset_link', 'user', id, `إرسال رابط تعيين كلمة المرور إلى ${maskEmail(u.email)}`);
  res.json({ ok: true, note: `أُرسل الرابط إلى ${maskEmail(u.email)} — صالح ${RESET_MINUTES} دقيقة.`,
    ...(exposeTokens() ? { debug_token: token } : {}) });
});

// ================= التحقق بخطوتين =================
const reauth = (req) => {
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  return bcrypt.compareSync(String(req.body.password || ''), row.password_hash);
};
const mfaRow = (id) => db.prepare('SELECT id, email, totp_enabled, totp_secret, totp_pending, totp_last_counter, totp_recovery FROM users WHERE id=?').get(id);
const required2fa = (u) => u.internal && db.prepare("SELECT v FROM settings WHERE k='require_2fa_internal'").get()?.v === '1';

r.get('/auth/2fa', requireAuth, (req, res) => {
  const m = mfaRow(req.user.id);
  res.json({ enabled: !!m.totp_enabled, required: required2fa(req.user), pending: !!m.totp_pending,
    recovery_left: m.totp_enabled ? JSON.parse(m.totp_recovery || '[]').length : 0 });
});

// الخطوة الأولى: مفتاح جديد معلَّق حتى يُثبت المستخدم أن تطبيقه يولّد الرمز الصحيح
r.post('/auth/2fa/setup', requireAuth, async (req, res) => {
  const m = mfaRow(req.user.id);
  if (m.totp_enabled) return res.status(409).json({ error: 'التحقق بخطوتين مفعَّل بالفعل' });
  if (!reauth(req)) return res.status(422).json({ error: 'كلمة المرور غير صحيحة' });
  const secret = TOTP.newSecret();
  db.prepare('UPDATE users SET totp_pending=? WHERE id=?').run(TOTP.seal(secret), req.user.id);
  const uri = TOTP.otpauthUri(secret, req.user.email);
  const svg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0B4533', light: '#FFFFFF' } });
  res.json({ secret, otpauth: uri, qr_svg: svg });
});

r.post('/auth/2fa/enable', requireAuth, (req, res) => {
  const m = mfaRow(req.user.id);
  if (m.totp_enabled) return res.status(409).json({ error: 'التحقق بخطوتين مفعَّل بالفعل' });
  if (!m.totp_pending) return res.status(422).json({ error: 'ابدأ الإعداد أولاً' });
  const ctr = TOTP.verifyStored(m.totp_pending, req.body.code, 0);
  if (ctr === null) return res.status(422).json({ error: 'الرمز غير صحيح — تأكد من ضبط ساعة الهاتف وأعد المحاولة' });
  const rc = TOTP.newRecoveryCodes();
  db.prepare(`UPDATE users SET totp_secret=totp_pending, totp_pending=NULL, totp_enabled=1, totp_last_counter=?, totp_recovery=? WHERE id=?`)
    .run(ctr, JSON.stringify(rc.hashes), req.user.id);
  log(req, 'user.2fa.enable', 'user', req.user.id, 'تفعيل التحقق بخطوتين');
  MAIL.toUser(req.user.id, { kind: 'security', subject: 'سِيمَا الخَيْر — فُعِّل التحقق بخطوتين',
    body: 'فُعِّل التحقق بخطوتين على حسابك. احفظ رموز الاسترداد في مكان آمن؛ فهي طريقك الوحيد إن فقدت هاتفك.' });
  res.json({ ok: true, recovery_codes: rc.codes, user: loadUser(req.user.id) });
});

r.post('/auth/2fa/disable', requireAuth, (req, res) => {
  const m = mfaRow(req.user.id);
  if (!m.totp_enabled) return res.status(409).json({ error: 'التحقق بخطوتين غير مفعَّل' });
  if (required2fa(req.user)) return res.status(422).json({ error: 'التحقق بخطوتين إلزامي لحسابات الحوكمة والأمانة — لا يُعطَّل' });
  if (!reauth(req)) return res.status(422).json({ error: 'كلمة المرور غير صحيحة' });
  if (TOTP.verifyStored(m.totp_secret, req.body.code, m.totp_last_counter) === null) return res.status(422).json({ error: 'رمز التحقق غير صحيح' });
  db.prepare('UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_pending=NULL, totp_recovery=NULL, totp_last_counter=0 WHERE id=?').run(req.user.id);
  log(req, 'user.2fa.disable', 'user', req.user.id, 'تعطيل التحقق بخطوتين');
  MAIL.toUser(req.user.id, { kind: 'security', subject: 'سِيمَا الخَيْر — عُطِّل التحقق بخطوتين',
    body: 'عُطِّل التحقق بخطوتين على حسابك. إن لم تكن أنت فغيّر كلمة المرور فوراً وراجع الأمانة.' });
  res.json({ ok: true, user: loadUser(req.user.id) });
});

r.post('/auth/2fa/recovery', requireAuth, (req, res) => {
  const m = mfaRow(req.user.id);
  if (!m.totp_enabled) return res.status(409).json({ error: 'التحقق بخطوتين غير مفعَّل' });
  if (!reauth(req)) return res.status(422).json({ error: 'كلمة المرور غير صحيحة' });
  const ctr = TOTP.verifyStored(m.totp_secret, req.body.code, m.totp_last_counter);
  if (ctr === null) return res.status(422).json({ error: 'رمز التحقق غير صحيح' });
  const rc = TOTP.newRecoveryCodes();
  db.prepare('UPDATE users SET totp_recovery=?, totp_last_counter=? WHERE id=?').run(JSON.stringify(rc.hashes), ctr, req.user.id);
  log(req, 'user.2fa.recovery', 'user', req.user.id, 'توليد رموز استرداد جديدة');
  res.json({ ok: true, recovery_codes: rc.codes });
});

// من فقد هاتفه ورموزه: الإدارة تُسقط التحقق بخطوتين عن حسابه بعد التثبت من هويته — ولا تفعل ذلك لنفسها
r.post('/users/:id/2fa/reset', requireAuth, can('admin.users'), (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(403).json({ error: 'لا تُسقط الإدارة التحقق بخطوتين عن حسابها بنفسها' });
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 10) return res.status(422).json({ error: 'اذكر سبب الإسقاط وكيف ثبتت هوية صاحب الحساب' });
  const m = mfaRow(id);
  if (!m) return res.status(404).json({ error: 'غير موجود' });
  if (!m.totp_enabled) return res.status(409).json({ error: 'التحقق بخطوتين غير مفعَّل على هذا الحساب' });
  db.prepare(`UPDATE users SET totp_enabled=0, totp_secret=NULL, totp_pending=NULL, totp_recovery=NULL, totp_last_counter=0,
      token_version=token_version+1 WHERE id=?`).run(id);
  log(req, 'user.2fa.reset', 'user', id, `إسقاط التحقق بخطوتين: ${reason}`);
  MAIL.toUser(id, { kind: 'security', subject: 'سِيمَا الخَيْر — أُسقط التحقق بخطوتين عن حسابك',
    body: `أسقطت الأمانة التحقق بخطوتين عن حسابك بناءً على طلبك، وأُغلقت كل الجلسات. فعّله من جديد عند دخولك التالي.` });
  res.json({ ok: true });
});

// ================= البريد الصادر =================
// متون الإشعارات قد تحمل ما لا يطّلع عليه كل حامل لسجل التتبع — فالصندوق لمن يدير الإعدادات وحده
r.get('/outbox', requireAuth, can('admin.settings'), (req, res) => {
  const out = buildList(db, {
    table: 'email_outbox m LEFT JOIN users u ON u.id=m.to_user_id',
    columns: `m.id, m.to_email, u.full_name to_name, m.subject, m.kind, m.status, m.attempts, m.last_error, m.created_at, m.sent_at,
              CASE WHEN m.sensitive=1 THEN '[رسالة أمنية تحمل رمزاً — لا يُعرض متنها]' ELSE m.body_text END body_text`,
    filters: { status: { op: 'in', col: 'm.status' }, kind: { op: 'in', col: 'm.kind' },
      from: { op: 'gte', col: 'm.created_at' }, to: { op: 'lte', col: 'm.created_at' } },
    search: ['m.to_email', 'm.subject', 'u.full_name'],
    allowSort: ['created_at', 'status', 'kind'], defaultSort: 'm.created_at DESC, m.id DESC', req,
  });
  out.summary = db.prepare('SELECT status, COUNT(*) n FROM email_outbox GROUP BY status').all();
  out.transport = MAIL.configured() ? (process.env.SEMA_MAIL_TRANSPORT === 'json' ? 'json' : 'smtp') : null;
  res.json(out);
});

r.post('/outbox/:id/retry', requireAuth, can('admin.settings'), async (req, res) => {
  const m = db.prepare('SELECT * FROM email_outbox WHERE id=?').get(Number(req.params.id));
  if (!m) return res.status(404).json({ error: 'غير موجود' });
  if (m.status === 'sent') return res.status(409).json({ error: 'أُرسلت الرسالة بالفعل' });
  if (m.sensitive) return res.status(422).json({ error: 'رسالة أمنية لا يُحفظ متنها ولا يُعاد إرسالها — يطلب صاحبها رابطاً جديداً' });
  if (!MAIL.configured()) return res.status(422).json({ error: 'لم يُضبط خادم بريد — اضبط SEMA_SMTP_URL ثم أعد المحاولة' });
  db.prepare("UPDATE email_outbox SET attempts=0, status='queued' WHERE id=?").run(m.id);
  const after = await MAIL.deliver(m.id);
  log(req, 'outbox.retry', 'email', m.id, `إعادة إرسال: ${after.status}`);
  res.json({ id: after.id, status: after.status, last_error: after.last_error });
});

void hasPerm; void issueToken;
module.exports = r;
