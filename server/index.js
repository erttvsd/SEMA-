'use strict';
const express = require('express');
const path = require('path');
const { db } = require('./db');
const { login, loginSecondStep, attachUser, requireAuth, can, log } = require('./auth');
const { runJobs, startScheduler, JOBS } = require('./jobs');

const app = express();
// لا يُوثَق بترويسة X-Forwarded-For إلا خلف وكيل عكسي مُعلَن — وإلا تجاوز العميل حدود المحاولات بتغييرها
app.set('trust proxy', process.env.SEMA_TRUST_PROXY ? (/^\d+$/.test(process.env.SEMA_TRUST_PROXY)
  ? Number(process.env.SEMA_TRUST_PROXY) : process.env.SEMA_TRUST_PROXY) : false);
app.disable('x-powered-by');

// ---------- ترويسات الأمان ----------
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (!req.path.startsWith('/api/documents/')) {
    // الواجهة تستعمل معالجات أحداث داخلية — فيُسمح بالسكربت الداخلي من المصدر نفسه فقط
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "connect-src 'self'",
      "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join('; '));
  }
  next();
});
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use((req, _res, next) => { if (req.body == null || typeof req.body !== 'object') req.body = {}; next(); });
app.use(attachUser);
// إلزام التحقق بخطوتين: الحساب الداخلي غير المُفعِّل له لا يصل إلا إلى إعداد حسابه حتى يُفعّله
const MFA_OPEN = ['/api/auth/', '/api/public/', '/api/notifications', '/api/rbac', '/api/health'];
app.use((req, res, next) => {
  // كلمة مرور مؤقتة وضعتها الإدارة: لا عمل قبل تغييرها
  if (req.user?.must_reset && req.path.startsWith('/api/') && !MFA_OPEN.some((p) => req.path.startsWith(p)))
    return res.status(403).json({ error: 'كلمة مرورك مؤقتة — غيّرها من «حسابي» أولاً', code: 'PASSWORD_CHANGE_REQUIRED' });
  if (req.user?.mfa_enroll_required && req.path.startsWith('/api/') && !MFA_OPEN.some((p) => req.path.startsWith(p)))
    return res.status(403).json({ error: 'يلزم تفعيل التحقق بخطوتين قبل متابعة العمل — من «حسابي»', code: 'MFA_ENROLL_REQUIRED' });
  next();
});

// ---------- الدخول ----------
app.post('/api/auth/login', (req, res) => {
  const out = login(req.body.email, req.body.password, req.ip);
  if (out.error) return res.status(out.status || 401).json({ error: out.error });
  if (out.user) log({ user: out.user, ip: req.ip }, 'auth.login', 'user', out.user.id, 'دخول');
  res.json(out);
});
app.post('/api/auth/login/2fa', (req, res) => {
  const out = loginSecondStep(req.body.mfa_token, req.body.code, req.ip);
  if (out.error) return res.status(out.status || 401).json({ error: out.error });
  log({ user: out.user, ip: req.ip }, 'auth.login', 'user', out.user.id, 'دخول بالتحقق بخطوتين');
  res.json(out);
});
app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

// حسابات العرض — تُعطَّل في الإنتاج بـ SEMA_DEMO=0
app.get('/api/auth/demo-accounts', (_req, res) => {
  if (process.env.SEMA_DEMO === '0') return res.json({ password: null, accounts: [] });
  const rows = db.prepare(`SELECT u.email, u.full_name, u.job_title,
      GROUP_CONCAT(r.name_ar, ' · ') roles, GROUP_CONCAT(r.code) role_codes, MIN(r.sort_order) so
      FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.code=ur.role_code
      WHERE u.status='active' AND u.email LIKE '%@sema.ly' GROUP BY u.id ORDER BY so, u.id`).all();
  res.json({ password: 'Sema@2026', accounts: rows });
});

// ---------- الواجهات ----------
app.use('/api/public', require('./routes/public'));
app.use('/api', require('./routes/onboarding'));
app.use('/api', require('./routes/standards'));
app.use('/api', require('./routes/entities'));
app.use('/api', require('./routes/workflow'));
app.use('/api', require('./routes/oversight'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/admin'));
app.use('/api', require('./routes/account'));
app.use('/api', require('./routes/threads'));
app.use('/api', require('./routes/workspace'));

// ---------- المهام الآلية ----------
app.get('/api/jobs', requireAuth, can('admin.settings', 'admin.log'), (_req, res) => {
  res.json({
    jobs: Object.entries(JOBS).map(([k, j]) => ({ key: k, title: j.title, article: j.article,
      last: db.prepare('SELECT * FROM job_runs WHERE job=? ORDER BY id DESC LIMIT 1').get(k) || null })),
    runs: db.prepare('SELECT * FROM job_runs ORDER BY id DESC LIMIT 200').all(),
  });
});
app.post('/api/jobs/run', requireAuth, can('admin.settings'), (req, res) => {
  if (req.body.job && !JOBS[req.body.job]) return res.status(400).json({ error: 'مهمة غير معروفة' });
  const results = runJobs(`manual:${req.user.full_name}`, req.body.job);
  log(req, 'jobs.run', 'job', null, results.map((r) => `${r.job}=${r.affected}`).join(' · '));
  res.json({ results });
});

app.get('/api/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'مسار غير موجود' }));

// ---------- الموقع ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'حجم الملف يتجاوز 20 ميجابايت' });
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'صيغة الطلب غير صالحة' });
  // مخالفة قيود قاعدة البيانات (قيمة خارج المسموح، مرجع غير موجود، حقل إلزامي) خطأ في المدخلات لا في الخادم
  if (err && /^SQLITE_CONSTRAINT/.test(err.code || '')) return res.status(400).json({ error: 'بيانات غير صالحة أو مرجع غير موجود', code: err.code });
  if (err instanceof TypeError || err instanceof RangeError) { console.error(err); return res.status(400).json({ error: 'مدخلات غير صالحة' }); }
  console.error(err);
  res.status(err.status || 500).json({ error: 'خطأ في الخادم' });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  if (process.env.SEMA_JOBS !== '0') startScheduler(Number(process.env.SEMA_JOBS_HOURS) || 6);
  app.listen(PORT, '0.0.0.0', () => console.log(`نظام «سِيمَا الخَيْر» يعمل على http://localhost:${PORT}`));
}
module.exports = app;
