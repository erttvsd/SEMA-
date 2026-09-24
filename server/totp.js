'use strict';
/**
 * كلمة المرور لمرة واحدة المبنية على الوقت (RFC 6238) — تعمل مع أي تطبيق مصادقة
 * (Google Authenticator · Microsoft Authenticator · FreeOTP) دون خدمة خارجية.
 */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30, DIGITS = 6;

function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) {
    val = ((val << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(str) {
  const s = String(str || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0, val = 0; const out = [];
  for (const c of s) {
    const i = B32.indexOf(c);
    if (i < 0) throw new RangeError('مفتاح غير صالح');
    val = ((val << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

function hotp(key, counter, digits = DIGITS) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const counterAt = (ms = Date.now()) => Math.floor(ms / 1000 / STEP);
const generate = (secretB32, ms = Date.now()) => hotp(b32decode(secretB32), counterAt(ms));

/**
 * يتحقق من الرمز ضمن نافذة ±خطوة واحدة (انحراف الساعة)، ويرفض إعادة استعمال رمز سبق قبوله.
 * @returns رقم الخطوة المقبولة، أو null
 */
function verify(secretB32, code, lastCounter = 0, ms = Date.now(), window = 1) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = b32decode(secretB32), now = counterAt(ms);
  for (let d = -window; d <= window; d++) {
    const ctr = now + d;
    if (ctr <= lastCounter) continue;
    const a = Buffer.from(hotp(key, ctr)), b = Buffer.from(c);
    if (crypto.timingSafeEqual(a, b)) return ctr;
  }
  return null;
}

const newSecret = () => b32encode(crypto.randomBytes(20));
const otpauthUri = (secret, account, issuer = 'Sema Alkhayr') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP}`;

/** رموز الاسترداد: تُعرض مرة واحدة، وتُحفظ بصمتها فقط، وكل رمز يصلح مرة واحدة */
const hashCode = (c) => crypto.createHash('sha256').update(String(c).toUpperCase().replace(/[\s-]/g, '')).digest('hex');
function newRecoveryCodes(n = 8) {
  const codes = Array.from({ length: n }, () => {
    const h = crypto.randomBytes(5).toString('hex').toUpperCase();
    return h.slice(0, 5) + '-' + h.slice(5);
  });
  return { codes, hashes: codes.map(hashCode) };
}

/**
 * تشفير المفتاح في قاعدة البيانات (AES-256-GCM) بمفتاح لا يُخزَّن فيها — فالنسخة الاحتياطية المسرَّبة
 * لا تكفي لتوليد رموز أحد. المفتاح من SEMA_DATA_KEY، وإلا اشتُق من سرّ الجلسات.
 * تغيير أيٍّ منهما يُبطل المفاتيح القائمة: تُسقط الإدارة التحقق عن الحسابات ويُعاد تفعيله.
 */
const dataKey = () => crypto.createHash('sha256').update('sema-totp|' + (process.env.SEMA_DATA_KEY || require('./auth').SECRET)).digest();
function seal(secret) {
  if (!secret) return secret;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', dataKey(), iv);
  const enc = Buffer.concat([c.update(String(secret), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function open(stored) {
  if (!stored || !String(stored).startsWith('v1:')) return stored;   // قيمة قديمة غير مشفَّرة — تُشفَّر عند الإقلاع
  const b = Buffer.from(String(stored).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', dataKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
/** التحقق من رمز مقابل مفتاح مخزَّن مشفَّراً — ومفتاح لا يُفكّ (تغيّر السرّ) يُعامل كرمز خاطئ */
function verifyStored(stored, code, lastCounter = 0) {
  let s; try { s = open(stored); } catch { return null; }
  return s ? verify(s, code, lastCounter) : null;
}

module.exports = { seal, open, verifyStored, b32encode, b32decode, hotp, generate, verify, newSecret, otpauthUri, newRecoveryCodes, hashCode, counterAt, STEP };
