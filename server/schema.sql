-- ============================================================
--  نظام إدارة علامة «سِيمَا الخَيْر»
--  العلامة الوطنية الليبية للمساهمة في الأعمال الخيرية
--  مخطط قاعدة البيانات — SQLite
-- ============================================================
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------- 1. المستخدمون والصلاحيات ----------
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  full_name     TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT,
  password_hash TEXT NOT NULL,
  region        TEXT CHECK(region IN ('الغربية','الشرقية','الجنوبية')),
  gender        TEXT CHECK(gender IN ('م','أ')),
  job_title     TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','disabled')),
  must_reset    INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- الوظائف الأربع الواجب الفصل بينها (المادة 18 / ISO-IEC 17065)
CREATE TABLE sod_functions (
  code TEXT PRIMARY KEY,          -- STANDARDS | EVALUATION | LICENSING | APPEAL_INTEGRITY
  name_ar TEXT NOT NULL
);

CREATE TABLE roles (
  code        TEXT PRIMARY KEY,
  name_ar     TEXT NOT NULL,
  category    TEXT NOT NULL,      -- governance | executive | external
  sod_function TEXT REFERENCES sod_functions(code),
  scope_kind  TEXT NOT NULL DEFAULT 'global' CHECK(scope_kind IN ('global','licensee','association')),
  description TEXT,
  sort_order  INTEGER DEFAULT 100
);

CREATE TABLE permissions (
  code      TEXT PRIMARY KEY,
  name_ar   TEXT NOT NULL,
  grp       TEXT NOT NULL
);

CREATE TABLE role_permissions (
  role_code       TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_code, permission_code)
);

CREATE TABLE user_roles (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code  TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  scope_kind TEXT NOT NULL DEFAULT 'global',
  scope_id   INTEGER,
  term_start TEXT,
  term_end   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, role_code, scope_kind, scope_id)
);

-- إقرار السرّية والحياد (المادة 26) وإقرار المصالح السنوي (نموذج 12)
CREATE TABLE integrity_pledges (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK(kind IN ('confidentiality','annual_interests')),
  year       INTEGER,
  has_conflict INTEGER NOT NULL DEFAULT 0,
  details    TEXT,
  signed_at  TEXT NOT NULL DEFAULT (datetime('now')),
  document_id INTEGER
);

-- ---------- 2. المراجع والمعايير ----------
CREATE TABLE revenue_tiers (
  code          TEXT PRIMARY KEY,   -- أ ب ج د هـ و
  name_ar       TEXT NOT NULL,
  min_revenue   REAL NOT NULL,
  max_revenue   REAL,
  floor_l1      REAL, floor_l2 REAL, floor_l3 REAL, floor_l4 REAL,
  floor_pct_l1  REAL, floor_pct_l2 REAL, floor_pct_l3 REAL, floor_pct_l4 REAL,
  app_fee       REAL NOT NULL,
  annual_fee_l12 REAL NOT NULL,
  annual_fee_l35 REAL NOT NULL,
  field_audit_pct REAL NOT NULL DEFAULT 0.20,
  sort_order    INTEGER
);

CREATE TABLE brand_levels (
  level        INTEGER PRIMARY KEY,   -- 1..5
  name_ar      TEXT NOT NULL,
  profit_pct   REAL,                  -- NULL للمستوى الخامس
  color_hex    TEXT NOT NULL,
  claim_ar     TEXT NOT NULL,
  field_audit_pct REAL NOT NULL,
  mandatory_audit INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE accreditation_criteria (
  no        INTEGER PRIMARY KEY,   -- 1..15
  name_ar   TEXT NOT NULL,
  requirement_ar TEXT NOT NULL,
  is_quantitative INTEGER NOT NULL DEFAULT 0,
  threshold REAL
);

CREATE TABLE eligible_channels (           -- المادة 20: ما يُحتسب وما لا يُحتسب
  code       TEXT PRIMARY KEY,
  name_ar    TEXT NOT NULL,
  counts     INTEGER NOT NULL,
  max_share  REAL,
  condition_ar TEXT
);

CREATE TABLE violation_codes (             -- المادة 29: التدرّج الجزائي
  code       INTEGER PRIMARY KEY,
  case_ar    TEXT NOT NULL,
  measure_ar TEXT NOT NULL,
  default_measure TEXT NOT NULL,
  reapply_ban_months INTEGER DEFAULT 0,
  publish    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE admin_expense_classes (       -- المادة 15
  code TEXT PRIMARY KEY, name_ar TEXT NOT NULL,
  min_pct REAL NOT NULL, max_pct REAL, accredit INTEGER NOT NULL
);

CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, note TEXT);

-- ---------- 3. الجهات ----------
CREATE TABLE licensees (                   -- المرخَّص لهم (قطاع الأعمال والحرف)
  id             INTEGER PRIMARY KEY,
  license_no     TEXT UNIQUE,              -- LY-KH-0000-YY
  legal_name     TEXT NOT NULL,
  trade_name     TEXT,
  legal_form     TEXT,
  applicant_kind TEXT NOT NULL DEFAULT 'business' CHECK(applicant_kind IN ('business','craftsman','artist','creative')),
  commercial_reg TEXT,
  tax_file_no    TEXT,
  social_sec_no  TEXT,
  sector         TEXT,
  region         TEXT, city TEXT, address TEXT,
  contact_name   TEXT, contact_email TEXT, contact_phone TEXT,
  website        TEXT,
  owner_user_id  INTEGER REFERENCES users(id),
  tier_code      TEXT REFERENCES revenue_tiers(code),
  level          INTEGER REFERENCES brand_levels(level),
  scope_type     TEXT CHECK(scope_type IN ('enterprise','brand','product_line')),
  scope_desc     TEXT,
  annual_revenue REAL, net_profit REAL, fiscal_year INTEGER,
  first_fiscal_year_complete INTEGER DEFAULT 1,
  bank_guarantee_doc_id INTEGER,
  founding_partner INTEGER NOT NULL DEFAULT 0,
  partner_class  TEXT DEFAULT 'none' CHECK(partner_class IN ('none','founding','working','honorary')),
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK(status IN ('draft','submitted','under_review','approved','active','suspended','withdrawn','expired','rejected')),
  status_reason  TEXT,
  start_date     TEXT, end_date TEXT,
  excluded       INTEGER NOT NULL DEFAULT 0, exclusion_reason TEXT,
  qr_token       TEXT UNIQUE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT
);

CREATE TABLE associations (                -- منظمات المجتمع المدني المعتمدة
  id                  INTEGER PRIMARY KEY,
  accreditation_no    TEXT UNIQUE,         -- LY-KH-ORG-000-YY
  name                TEXT NOT NULL,
  registration_no     TEXT,
  registration_authority TEXT,
  region TEXT, city TEXT, address TEXT,
  established_year    INTEGER,
  contact_name TEXT, contact_email TEXT, contact_phone TEXT,
  owner_user_id       INTEGER REFERENCES users(id),
  board_size          INTEGER,
  paid_board_members  INTEGER DEFAULT 0,
  board_meetings_last_year INTEGER,
  annual_revenue      REAL,
  total_expenses      REAL,
  admin_expenses      REAL,
  admin_expense_ratio REAL,
  admin_class         TEXT REFERENCES admin_expense_classes(code),
  admin_ratio_3y_avg  REAL,
  fundraising_cost_ratio REAL,
  largest_budget_3y   REAL,
  absorption_cap      REAL,               -- 200% من أكبر ميزانية
  absorption_used     REAL DEFAULT 0,
  audit_tier          TEXT,
  focus_areas         TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK(status IN ('draft','submitted','under_review','accredited','suspended','revoked','expired','rejected')),
  status_reason       TEXT,
  accredited_from TEXT, accredited_to TEXT,
  interim_report_year INTEGER,
  partner_class TEXT DEFAULT 'none' CHECK(partner_class IN ('none','founding','working','honorary')),
  qr_token TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- ---------- 4. الطلبات ومسارها (المادة 17) ----------
CREATE TABLE applications (
  id              INTEGER PRIMARY KEY,
  reference        TEXT UNIQUE NOT NULL,
  app_type        TEXT NOT NULL CHECK(app_type IN ('license','license_renewal','accreditation','accreditation_renewal','observer','level_upgrade')),
  subject_kind    TEXT NOT NULL CHECK(subject_kind IN ('licensee','association','observer')),
  subject_id      INTEGER,
  applicant_user_id INTEGER REFERENCES users(id),
  requested_level INTEGER,
  requested_tier  TEXT,
  stage           INTEGER NOT NULL DEFAULT 1,   -- 1..9
  status          TEXT NOT NULL DEFAULT 'submitted'
                  CHECK(status IN ('submitted','deficiencies','completing','assessment','field_visit','facts_report','decision_pending','approved','rejected','shelved','withdrawn')),
  submitted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completeness_due_at TEXT, completeness_done_at TEXT,
  deficiencies    TEXT,
  assessment_due_at TEXT, assessment_done_at TEXT,
  facts_report_id INTEGER,
  decision        TEXT CHECK(decision IN ('grant','reject','grant_lower_level')),
  granted_level   INTEGER,
  decision_reason TEXT,
  decided_by      INTEGER REFERENCES users(id),
  decided_at      TEXT,
  sla_due_at      TEXT,
  processing_days INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE application_stages (
  id INTEGER PRIMARY KEY,
  application_id INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  stage INTEGER NOT NULL,
  stage_name_ar TEXT NOT NULL,
  responsible_body TEXT NOT NULL,
  max_days INTEGER,
  started_at TEXT, completed_at TEXT,
  actor_id INTEGER REFERENCES users(id),
  note TEXT,
  breached_sla INTEGER DEFAULT 0
);

-- ---------- 5. الإثباتات والمستندات ----------
CREATE TABLE document_types (
  code TEXT PRIMARY KEY, name_ar TEXT NOT NULL, applies_to TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 0, expires INTEGER NOT NULL DEFAULT 0, form_no INTEGER
);

CREATE TABLE documents (
  id            INTEGER PRIMARY KEY,
  owner_kind    TEXT NOT NULL CHECK(owner_kind IN ('licensee','association','application','audit','contribution','sanction','appeal','observer','user','secretariat','design','complaint')),
  owner_id      INTEGER,
  doc_type      TEXT REFERENCES document_types(code),
  title         TEXT NOT NULL,
  file_name     TEXT NOT NULL,
  stored_name   TEXT NOT NULL,
  mime_type     TEXT,
  size_bytes    INTEGER,
  sha256        TEXT,
  pages         INTEGER,
  issued_on     TEXT, expires_on TEXT,
  uploaded_by   INTEGER REFERENCES users(id),
  uploaded_at   TEXT NOT NULL DEFAULT (datetime('now')),
  verification  TEXT NOT NULL DEFAULT 'pending' CHECK(verification IN ('pending','verified','rejected','superseded')),
  verified_by   INTEGER REFERENCES users(id),
  verified_at   TEXT,
  verify_note   TEXT,
  is_public     INTEGER NOT NULL DEFAULT 0,
  confidential  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_doc_owner ON documents(owner_kind, owner_id);

-- ---------- 6. تقييم معايير الاعتماد ----------
CREATE TABLE criteria_assessments (
  id INTEGER PRIMARY KEY,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  criterion_no  INTEGER NOT NULL REFERENCES accreditation_criteria(no),
  cycle_year    INTEGER NOT NULL,
  result        TEXT NOT NULL CHECK(result IN ('met','not_met','partial','na')),
  measured_value REAL,
  note          TEXT,
  evidence_doc_id INTEGER REFERENCES documents(id),
  assessed_by   INTEGER REFERENCES users(id),
  assessed_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(association_id, criterion_no, cycle_year)
);

-- ---------- 7. الالتزام السنوي والمساهمات ----------
CREATE TABLE commitments (
  id INTEGER PRIMARY KEY,
  licensee_id  INTEGER NOT NULL REFERENCES licensees(id) ON DELETE CASCADE,
  fiscal_year  INTEGER NOT NULL,
  level        INTEGER NOT NULL,
  tier_code    TEXT NOT NULL,
  annual_revenue REAL, net_profit REAL,
  pct_amount   REAL NOT NULL,
  floor_amount REAL NOT NULL,
  commitment_due REAL NOT NULL,          -- الأعلى من الاثنين
  basis        TEXT NOT NULL CHECK(basis IN ('percent','floor')),
  cash_paid REAL DEFAULT 0, inkind_paid REAL DEFAULT 0,
  volunteer_paid REAL DEFAULT 0, direct_program_paid REAL DEFAULT 0,
  total_paid   REAL DEFAULT 0,
  cash_share   REAL,
  deficit_amount REAL DEFAULT 0, deficit_pct REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','fulfilled','deficient','breach','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(licensee_id, fiscal_year)
);

CREATE TABLE contributions (
  id INTEGER PRIMARY KEY,
  reference    TEXT UNIQUE NOT NULL,
  licensee_id  INTEGER NOT NULL REFERENCES licensees(id) ON DELETE CASCADE,
  association_id INTEGER REFERENCES associations(id),
  fiscal_year  INTEGER NOT NULL,
  channel      TEXT NOT NULL REFERENCES eligible_channels(code),
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'LYD',
  purpose      TEXT,
  transfer_date TEXT,
  bank_ref     TEXT,
  volunteer_hours REAL,
  hour_rate    REAL,
  valuation_by TEXT,
  notified_secretariat INTEGER NOT NULL DEFAULT 0,
  transfer_doc_id INTEGER REFERENCES documents(id),
  receipt_doc_id  INTEGER REFERENCES documents(id),   -- نموذج 5
  impact_doc_id   INTEGER REFERENCES documents(id),   -- نموذج 6
  receipt_confirmed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'declared'
         CHECK(status IN ('declared','documented','verified','rejected','excluded')),
  verified_by INTEGER REFERENCES users(id), verified_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_contrib_lic ON contributions(licensee_id, fiscal_year);
CREATE INDEX idx_contrib_org ON contributions(association_id, fiscal_year);

-- إقرار الامتثال السنوي (المادة 23 / نموذج 4)
CREATE TABLE compliance_declarations (
  id INTEGER PRIMARY KEY,
  licensee_id INTEGER NOT NULL REFERENCES licensees(id) ON DELETE CASCADE,
  fiscal_year INTEGER NOT NULL,
  fiscal_year_end TEXT,
  due_at      TEXT NOT NULL,               -- 120 يوماً
  submitted_at TEXT,
  late_days   INTEGER DEFAULT 0,
  basis_type  TEXT CHECK(basis_type IN ('tax_return','audited_statements','bank_statement_accountant')),
  basis_doc_id INTEGER REFERENCES documents(id),
  declared_revenue REAL, declared_net_profit REAL, declared_total REAL,
  status TEXT NOT NULL DEFAULT 'pending'
         CHECK(status IN ('pending','submitted','desk_review','field_audit','accepted','deficient','rejected','late')),
  desk_review_due TEXT, field_audit_due TEXT, facts_report_due TEXT, decision_due TEXT,
  processed_by INTEGER REFERENCES users(id), processed_at TEXT,
  outcome TEXT CHECK(outcome IN ('renew','suspend','withdraw','downgrade')),
  note TEXT,
  UNIQUE(licensee_id, fiscal_year)
);

-- ---------- 8. التدقيق والتفتيش (الفصل الثامن) ----------
CREATE TABLE audits (
  id INTEGER PRIMARY KEY,
  reference   TEXT UNIQUE NOT NULL,
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('licensee','association')),
  subject_id  INTEGER NOT NULL,
  fiscal_year INTEGER,
  audit_type  TEXT NOT NULL CHECK(audit_type IN ('desk','field','unannounced','market_test','compliance_review')),
  trigger     TEXT CHECK(trigger IN ('sample','mandatory','complaint','pilot_year','renewal','random')),
  sample_seed TEXT,
  scheduled_date TEXT, executed_date TEXT,
  assessor_id INTEGER REFERENCES users(id),
  second_assessor_id INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'planned'
         CHECK(status IN ('planned','in_progress','facts_reported','closed','cancelled')),
  facts_summary TEXT,                     -- وقائع فقط بلا توصية (المادة 20/3)
  facts_report_doc_id INTEGER REFERENCES documents(id),
  hours_spent REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_findings (
  id INTEGER PRIMARY KEY,
  audit_id INTEGER NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  area TEXT NOT NULL,
  fact TEXT NOT NULL,
  evidence_doc_id INTEGER REFERENCES documents(id),
  severity TEXT CHECK(severity IN ('info','minor','major','critical')),
  violation_code INTEGER REFERENCES violation_codes(code),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- 9. الجزاءات والتظلمات ----------
CREATE TABLE sanctions (
  id INTEGER PRIMARY KEY,
  case_no TEXT UNIQUE NOT NULL,
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('licensee','association','unlicensed')),
  subject_id INTEGER,
  subject_name TEXT,
  violation_code INTEGER REFERENCES violation_codes(code),
  measure TEXT NOT NULL CHECK(measure IN ('written_warning','formal_notice','late_fine','grace_period','level_downgrade','suspension','withdrawal','cease_and_desist','fine','legal_action')),
  fine_amount REAL,
  grace_days INTEGER,
  reason TEXT NOT NULL,
  source_audit_id INTEGER REFERENCES audits(id),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  effective_from TEXT, effective_to TEXT,
  auto_escalate_to TEXT,
  published INTEGER NOT NULL DEFAULT 0, publish_until TEXT,
  reapply_allowed_from TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','lifted','escalated','appealed','overturned','closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE appeals (
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  sanction_id INTEGER REFERENCES sanctions(id),
  application_id INTEGER REFERENCES applications(id),
  appellant_kind TEXT CHECK(appellant_kind IN ('licensee','association')),
  appellant_id INTEGER, appellant_name TEXT,
  filed_at TEXT NOT NULL DEFAULT (datetime('now')),
  filing_deadline TEXT,                  -- 30 يوماً من الإخطار
  decision_due_at TEXT,                  -- 60 يوماً
  grounds TEXT NOT NULL,
  stay_of_execution INTEGER NOT NULL DEFAULT 0, stay_reason TEXT,
  decision TEXT CHECK(decision IN ('upheld','overturned','partially_upheld','inadmissible')),
  decision_reason TEXT,
  decided_at TEXT, decided_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'filed' CHECK(status IN ('filed','under_review','decided','withdrawn','inadmissible'))
);

-- ---------- 10. المراقبون والنزاهة والحوكمة ----------
CREATE TABLE observers (
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  user_id INTEGER REFERENCES users(id),
  person_name TEXT NOT NULL,
  nominating_entity TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('public','private','civil','academic','media')),
  sector TEXT,
  term_start TEXT, term_end TEXT, cycle TEXT,
  pledge_doc_id INTEGER REFERENCES documents(id),
  status TEXT NOT NULL DEFAULT 'nominated'
         CHECK(status IN ('nominated','admitted','rejected','ended')),
  end_reason TEXT,
  cost_borne_by_observer INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE meetings (
  id INTEGER PRIMARY KEY,
  body TEXT NOT NULL,                   -- board | standards | licensing | appeals | integrity | general_assembly
  title TEXT NOT NULL,
  meeting_no TEXT,
  held_on TEXT NOT NULL,
  quorum_required INTEGER, attendees_count INTEGER, observers_count INTEGER,
  minutes_doc_id INTEGER REFERENCES documents(id),
  decisions TEXT,
  is_public INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE meeting_attendance (
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  observer_id INTEGER REFERENCES observers(id),
  role_at_meeting TEXT, attended INTEGER NOT NULL DEFAULT 1, voting INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (meeting_id, user_id, observer_id)
);

CREATE TABLE integrity_notes (            -- المادة 23
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL,
  category TEXT CHECK(category IN ('independence','pressure','conflict_of_interest','transparency','other')),
  raised_by INTEGER REFERENCES users(id),
  raised_at TEXT NOT NULL DEFAULT (datetime('now')),
  board_notified_at TEXT,
  response_due_at TEXT,                  -- 90 يوماً
  board_response TEXT, responded_at TEXT,
  public_disclosure INTEGER NOT NULL DEFAULT 0, published_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','escalated','published','closed'))
);

CREATE TABLE complaints (                 -- نموذج 9 + المادة 29 (الإبلاغ)
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  channel TEXT CHECK(channel IN ('portal','email','phone','letter','field')),
  is_anonymous INTEGER NOT NULL DEFAULT 0,
  reporter_name TEXT, reporter_contact TEXT,
  subject_kind TEXT CHECK(subject_kind IN ('licensee','association','secretariat','unlicensed')),
  subject_id INTEGER, subject_name TEXT,
  body TEXT NOT NULL,
  filed_at TEXT NOT NULL DEFAULT (datetime('now')),
  assigned_to INTEGER REFERENCES users(id),
  triggered_audit_id INTEGER REFERENCES audits(id),
  status TEXT NOT NULL DEFAULT 'received'
         CHECK(status IN ('received','triage','investigating','substantiated','unsubstantiated','closed')),
  resolution TEXT, closed_at TEXT,
  whistleblower_protected INTEGER NOT NULL DEFAULT 0
);

-- ---------- 11. الموافقة المسبقة على التصاميم (المادة 19) ----------
CREATE TABLE design_approvals (
  id INTEGER PRIMARY KEY,
  reference TEXT UNIQUE NOT NULL,
  licensee_id INTEGER NOT NULL REFERENCES licensees(id) ON DELETE CASCADE,
  material_type TEXT NOT NULL CHECK(material_type IN ('packaging','ad','website','social','signage','vehicle','other')),
  title TEXT NOT NULL,
  logo_variant TEXT CHECK(logo_variant IN ('full','compact')),
  shows_license_no INTEGER NOT NULL DEFAULT 1,
  claim_text TEXT,
  file_doc_id INTEGER REFERENCES documents(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT NOT NULL,                  -- 10 أيام عمل
  decision TEXT CHECK(decision IN ('approved','rejected','implicit_approval','changes_required')),
  decision_notes TEXT,
  decided_by INTEGER REFERENCES users(id), decided_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','decided','expired_implicit'))
);

-- ---------- 12. الرسوم والمالية ----------
CREATE TABLE invoices (
  id INTEGER PRIMARY KEY,
  invoice_no TEXT UNIQUE NOT NULL,
  subject_kind TEXT NOT NULL CHECK(subject_kind IN ('licensee','association','unlicensed')),
  subject_id INTEGER, subject_name TEXT,
  fee_type TEXT NOT NULL CHECK(fee_type IN ('application','annual','annual_prorated','late_fine','unlicensed_fine','level_diff')),
  fiscal_year INTEGER,
  tier_code TEXT, level INTEGER,
  base_amount REAL NOT NULL,
  discount_pct REAL DEFAULT 0, discount_reason TEXT,
  amount REAL NOT NULL,
  capped INTEGER NOT NULL DEFAULT 0,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at TEXT,
  paid_at TEXT, payment_ref TEXT, receipt_doc_id INTEGER REFERENCES documents(id),
  status TEXT NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','paid','waived','void','overdue')),
  refundable INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE secretariat_budget (
  id INTEGER PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('program','fundraising','admin')),
  line_item TEXT NOT NULL,
  budgeted REAL, actual REAL,
  UNIQUE(fiscal_year, category, line_item)
);

CREATE TABLE funding_sources (            -- المادة 28 حدود التمويل
  id INTEGER PRIMARY KEY,
  fiscal_year INTEGER NOT NULL,
  source_name TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('fees','grant','donation','sponsorship','training','other')),
  amount REAL NOT NULL,
  share_of_total REAL,
  conditional INTEGER NOT NULL DEFAULT 0,
  board_approval_required INTEGER NOT NULL DEFAULT 0,
  board_approved INTEGER NOT NULL DEFAULT 0,
  approved_meeting_id INTEGER REFERENCES meetings(id)
);

-- ---------- 13. المؤشرات والتقارير ----------
CREATE TABLE kpis (
  code TEXT PRIMARY KEY, name_ar TEXT NOT NULL, unit TEXT,
  method_ar TEXT, benchmark_ar TEXT, higher_is_better INTEGER DEFAULT 1
);

CREATE TABLE kpi_values (
  id INTEGER PRIMARY KEY,
  kpi_code TEXT NOT NULL REFERENCES kpis(code) ON DELETE CASCADE,
  year_no INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('target','actual')),
  value REAL,
  UNIQUE(kpi_code, year_no, kind)
);

CREATE TABLE risk_register (
  id INTEGER PRIMARY KEY,
  risk_ar TEXT NOT NULL, likelihood TEXT, impact TEXT,
  mitigation_ar TEXT, owner_body TEXT, status TEXT DEFAULT 'open'
);

CREATE TABLE market_tests (               -- المادة 28 اختبار السوق
  id INTEGER PRIMARY KEY,
  round_name TEXT NOT NULL, city TEXT, conducted_on TEXT,
  outlets_visited INTEGER, items_checked INTEGER,
  correct_usage INTEGER, missing_license_no INTEGER,
  level_mismatch INTEGER, out_of_scope INTEGER, unlicensed_usage INTEGER,
  report_doc_id INTEGER REFERENCES documents(id),
  published INTEGER NOT NULL DEFAULT 0
);

-- ---------- 14. التتبع والإشعارات ----------
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  actor_name TEXT, actor_roles TEXT,
  action TEXT NOT NULL,
  entity_kind TEXT, entity_id INTEGER,
  summary TEXT, before_json TEXT, after_json TEXT,
  ip TEXT, at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_log_entity ON audit_log(entity_kind, entity_id);
CREATE INDEX idx_log_at ON audit_log(at);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  role_code TEXT,
  title TEXT NOT NULL, body TEXT,
  severity TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','danger','success')),
  link TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- 15. السجل العام ----------
CREATE VIEW v_public_registry_licensees AS
SELECT l.license_no, l.legal_name, l.trade_name, b.name_ar AS level_name, l.level,
       b.color_hex, l.scope_type, l.scope_desc, l.region, l.city, l.sector,
       l.start_date, l.end_date, l.status, l.status_reason, l.founding_partner,
       l.qr_token,
       (SELECT c.total_paid FROM commitments c WHERE c.licensee_id=l.id ORDER BY c.fiscal_year DESC LIMIT 1) AS verified_commitment,
       (SELECT c.fiscal_year FROM commitments c WHERE c.licensee_id=l.id ORDER BY c.fiscal_year DESC LIMIT 1) AS commitment_year
FROM licensees l LEFT JOIN brand_levels b ON b.level=l.level
WHERE l.status IN ('active','suspended','withdrawn','expired');

CREATE VIEW v_public_registry_associations AS
SELECT a.accreditation_no, a.name, a.region, a.city, a.accredited_from, a.accredited_to,
       a.admin_expense_ratio, a.admin_class, c.name_ar AS admin_class_name,
       a.status, a.status_reason, a.absorption_cap, a.absorption_used, a.focus_areas, a.qr_token
FROM associations a LEFT JOIN admin_expense_classes c ON c.code=a.admin_class
WHERE a.status IN ('accredited','suspended','revoked','expired');
