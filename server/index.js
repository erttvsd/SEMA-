'use strict';
const express = require('express');
const path = require('path');
const { db } = require('./db');
const { login, attachUser, requireAuth, can, log } = require('./auth');
const { runJobs, startScheduler, JOBS } = require('./jobs');

const app = express();
app.set('trust proxy', true);
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
app.use(attachUser);

// ---------- الدخول ----------
app.post('/api/auth/login', (req, res) => {
  const out = login(req.body.email, req.body.password, req.ip);
  if (out.error) return res.status(out.status || 401).json({ error: out.error });
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
  console.error(err);
  res.status(err.status || 500).json({ error: 'خطأ في الخادم' });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  if (process.env.SEMA_JOBS !== '0') startScheduler(Number(process.env.SEMA_JOBS_HOURS) || 6);
  app.listen(PORT, '0.0.0.0', () => console.log(`نظام «سِيمَا الخَيْر» يعمل على http://localhost:${PORT}`));
}
module.exports = app;
