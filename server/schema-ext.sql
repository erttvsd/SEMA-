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
