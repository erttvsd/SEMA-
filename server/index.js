'use strict';
const express = require('express');
const path = require('path');
const { db } = require('./db');
const { login, attachUser, requireAuth } = require('./auth');

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(attachUser);

// ---------- الدخول ----------
app.post('/api/auth/login', (req, res) => {
  const out = login(req.body.email, req.body.password);
  if (out.error) return res.status(401).json({ error: out.error });
  res.json(out);
});

app.get('/api/auth/me', requireAuth, (req, res) => res.json(req.user));

app.get('/api/auth/demo-accounts', (_req, res) => {
  const rows = db.prepare(`SELECT u.email, u.full_name, u.job_title,
      GROUP_CONCAT(r.name_ar, ' · ') roles, GROUP_CONCAT(r.code) role_codes, MIN(r.sort_order) so
      FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.code=ur.role_code
      WHERE u.status='active' GROUP BY u.id ORDER BY so`).all();
  res.json({ password: 'Sema@2026', accounts: rows });
});

// ---------- الواجهات ----------
app.use('/api/public', require('./routes/public'));
app.use('/api', require('./routes/entities'));
app.use('/api', require('./routes/workflow'));
app.use('/api', require('./routes/oversight'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/admin'));

app.get('/api/health', (_req, res) => res.json({ ok: true, at: new Date().toISOString() }));

// ---------- الموقع ----------
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'خطأ في الخادم' });
});

const PORT = Number(process.env.PORT) || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`نظام «سِيمَا الخَيْر» يعمل على http://localhost:${PORT}`);
  });
}
module.exports = app;
