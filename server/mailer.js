'use strict';
/**
 * البريد الصادر — كل رسالة تُقيَّد في الصندوق أولاً ثم تُرسَل، فلا يضيع إشعار بتعطّل الخادم البريدي.
 *
 *  SEMA_SMTP_URL        عنوان الخادم البريدي، مثل smtps://user:pass@smtp.example.ly:465
 *  SEMA_MAIL_TRANSPORT  json  ← إرسال صوري يُقيِّد الرسالة مُرسَلةً دون شبكة (للتجربة والاختبار)
 *  وبلا أيٍّ منهما تبقى الرسائل «محتجَزة» في الصندوق ظاهرةً للإدارة حتى يُضبط الخادم البريدي.
 */
const { db } = require('./db');

const MAX_ATTEMPTS = 5;
let enabled = true;
let transport, transportReady = false;

function getTransport() {
  if (transportReady) return transport;
  transportReady = true;
  const nodemailer = require('nodemailer');
  if (process.env.SEMA_MAIL_TRANSPORT === 'json') transport = nodemailer.createTransport({ jsonTransport: true });
  else if (process.env.SEMA_SMTP_URL) transport = nodemailer.createTransport(process.env.SEMA_SMTP_URL);
  else transport = null;
  return transport;
}
const configured = () => !!getTransport();
const setting = (k, d) => db.prepare('SELECT v FROM settings WHERE k=?').get(k)?.v ?? d;
const publicUrl = () => (process.env.SEMA_PUBLIC_URL || 'http://localhost:' + (process.env.PORT || 3000)).replace(/\/$/, '');

const FOOTER = '\n\n—\nسِيمَا الخَيْر · العلامة الوطنية للمساهمة في الأعمال الخيرية والإنسانية والتنموية\n' +
  'رسالة آلية — لا تُرسل كلمة مرورك أو رمز التحقق لأحد، فالأمانة لا تطلبهما أبداً.';

/** يُقيِّد رسالة في الصندوق ويحاول إرسالها فوراً دون انتظار */
function queue({ to_email, to_user_id = null, subject, body, kind = 'notification', sensitive = false }) {
  if (!enabled || !to_email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to_email)) return null;
  const id = db.prepare(`INSERT INTO email_outbox (to_email, to_user_id, subject, body_text, kind, sensitive)
      VALUES (?,?,?,?,?,?)`).run(to_email, to_user_id, String(subject).slice(0, 300), String(body || ''), kind, sensitive ? 1 : 0).lastInsertRowid;
  setImmediate(() => deliver(id).catch(() => {}));
  return id;
}

/** رسالة لمستخدم: الإشعارات العادية تحترم تفضيله، ورسائل الأمان تصله دائماً */
function toUser(userId, { subject, body, kind = 'notification', sensitive = false }) {
  const u = db.prepare('SELECT id, email, status, email_notifications FROM users WHERE id=?').get(userId);
  if (!u || u.status !== 'active') return null;
  if (kind === 'notification' && !u.email_notifications) return null;
  return queue({ to_email: u.email, to_user_id: u.id, subject, body, kind, sensitive });
}

async function deliver(id) {
  const m = db.prepare('SELECT * FROM email_outbox WHERE id=?').get(id);
  if (!m || m.status === 'sent' || m.attempts >= MAX_ATTEMPTS) return m;
  const t = getTransport();
  if (!t) {
    db.prepare("UPDATE email_outbox SET status='held', last_error=? WHERE id=? AND status IN ('queued','held')")
      .run('لم يُضبط خادم بريد (SEMA_SMTP_URL)', id);
    return db.prepare('SELECT * FROM email_outbox WHERE id=?').get(id);
  }
  try {
    await t.sendMail({ from: setting('mail_from', 'no-reply@sema.ly'), to: m.to_email, subject: m.subject, text: m.body_text + FOOTER });
    // ما يحمل رمزاً يُمحى متنه بعد الإرسال — لا يبقى في قاعدة البيانات ما يُستعمل للاستيلاء على حساب
    db.prepare(`UPDATE email_outbox SET status='sent', sent_at=datetime('now'), attempts=attempts+1, last_error=NULL,
        body_text=CASE WHEN sensitive=1 THEN '[محتوى أمني — مُحي بعد الإرسال]' ELSE body_text END WHERE id=?`).run(id);
  } catch (e) {
    db.prepare(`UPDATE email_outbox SET attempts=attempts+1, last_error=?,
        status=CASE WHEN attempts+1 >= ? THEN 'failed' ELSE 'queued' END WHERE id=?`).run(String(e.message).slice(0, 300), MAX_ATTEMPTS, id);
  }
  return db.prepare('SELECT * FROM email_outbox WHERE id=?').get(id);
}

/** إعادة محاولة كل ما لم يُرسَل — تستدعيها المهمة الآلية */
function flush() {
  const rows = db.prepare(`SELECT id FROM email_outbox WHERE status IN ('queued','held') AND attempts < ? ORDER BY id LIMIT 500`).all(MAX_ATTEMPTS);
  if (!configured()) return { pending: rows.length, attempted: 0 };
  rows.forEach((r) => deliver(r.id).catch(() => {}));
  return { pending: rows.length, attempted: rows.length };
}

module.exports = { queue, toUser, deliver, flush, configured, publicUrl, setEnabled: (v) => { enabled = !!v; }, MAX_ATTEMPTS };
