-- ============================================================
--  امتدادات المخطط — تُطبَّق عند كل تشغيل (IF NOT EXISTS)
-- ============================================================

-- مقترحات تعديل المعايير والمشاورة العامة (المادة 19/3 و35 من النظام الداخلي)
CREATE TABLE IF NOT EXISTS standards_proposals (
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  article_ref TEXT,
  kind TEXT NOT NULL DEFAULT 'standard' CHECK(kind IN ('standard','fees','floors','bylaws','interpretation')),
  is_material INTEGER NOT NULL DEFAULT 1,          -- التعديل الجوهري يلزمه مشاورة 30 يوماً
  proposed_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','consultation','consultation_closed','submitted_to_board','approved','rejected','withdrawn')),
  consultation_start TEXT, consultation_end TEXT,
  response_summary TEXT,
  board_decision TEXT, board_decision_reason TEXT,
  board_decided_by INTEGER REFERENCES users(id), board_decided_at TEXT,
  effective_from TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS consultation_comments (
  id INTEGER PRIMARY KEY,
  proposal_id INTEGER NOT NULL REFERENCES standards_proposals(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK(author_kind IN ('licensee','association','public','expert','government')),
  organization TEXT,
  body TEXT NOT NULL,
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  response TEXT, responded_by INTEGER REFERENCES users(id), responded_at TEXT,
  is_published INTEGER NOT NULL DEFAULT 1
);

-- سجل تشغيل المهام الآلية
CREATE TABLE IF NOT EXISTS job_runs (
  id INTEGER PRIMARY KEY,
  job TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  affected INTEGER DEFAULT 0,
  details TEXT,
  triggered_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_at ON job_runs(started_at);

-- السجل العام يعرض الالتزام «المتحقَّق منه» فقط — لا الموثَّق بانتظار التحقق (المادة 37)
DROP VIEW IF EXISTS v_public_registry_licensees;
CREATE VIEW v_public_registry_licensees AS
SELECT l.license_no, l.legal_name, l.trade_name, b.name_ar AS level_name, l.level,
       b.color_hex, l.scope_type, l.scope_desc, l.region, l.city, l.sector,
       l.start_date, l.end_date, l.status, l.status_reason, l.founding_partner, l.qr_token,
       (SELECT COALESCE(SUM(ct.amount),0) FROM contributions ct WHERE ct.licensee_id=l.id AND ct.status='verified'
          AND ct.fiscal_year=(SELECT MAX(fiscal_year) FROM commitments c WHERE c.licensee_id=l.id)) AS verified_commitment,
       (SELECT MAX(fiscal_year) FROM commitments c WHERE c.licensee_id=l.id) AS commitment_year
FROM licensees l LEFT JOIN brand_levels b ON b.level=l.level
WHERE l.status IN ('active','suspended','withdrawn','expired');

-- ============================================================
--  المرحلة الثالثة: الحساب والمراسلات والنسخ الاحتياطي
-- ============================================================

-- رموز استعادة كلمة المرور: تُحفظ بصمتها لا قيمتها، وتصلح مرة واحدة ولمدة محدودة
CREATE TABLE IF NOT EXISTS password_resets (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  issued_by INTEGER REFERENCES users(id),
  ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);

-- صندوق البريد الصادر: كل رسالة تُقيَّد قبل إرسالها، ويُعاد المتعثر منها
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY,
  to_email TEXT NOT NULL,
  to_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'notification'
    CHECK(kind IN ('notification','password_reset','security','thread','system')),
  sensitive INTEGER NOT NULL DEFAULT 0,          -- رسالة تحمل رمزاً: لا يُعرض متنها ويُمحى بعد الإرسال
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','failed','held')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON email_outbox(status);

-- المراسلات بين الجهة والأمانة — لكل ملف سجل مكتوب بدل البريد والهاتف
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('licensee','association','user')),
  subject_id INTEGER NOT NULL,
  topic_kind TEXT CHECK(topic_kind IN ('application','invoice','declaration','contribution','design','sanction')),
  topic_id INTEGER,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'inquiry'
    CHECK(category IN ('inquiry','deficiency','financial','technical','complaint_followup','other')),
  status TEXT NOT NULL DEFAULT 'awaiting_staff'
    CHECK(status IN ('awaiting_staff','awaiting_entity','closed')),
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT, closed_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_threads_subject ON threads(subject_kind, subject_id);

CREATE TABLE IF NOT EXISTS thread_messages (
  id INTEGER PRIMARY KEY,
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id),
  author_side TEXT NOT NULL CHECK(author_side IN ('entity','staff')),
  internal INTEGER NOT NULL DEFAULT 0,           -- ملاحظة داخلية للأمانة لا تراها الجهة
  body TEXT NOT NULL,
  document_id INTEGER REFERENCES documents(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tmsg_thread ON thread_messages(thread_id);

CREATE TABLE IF NOT EXISTS thread_reads (
  thread_id INTEGER NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (thread_id, user_id)
);

-- سجل النسخ الاحتياطية
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY,
  file_name TEXT NOT NULL,
  size_bytes INTEGER,
  sha256 TEXT,
  integrity TEXT,
  triggered_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
