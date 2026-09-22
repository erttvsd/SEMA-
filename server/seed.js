'use strict';
/**
 * بيانات تصويرية شاملة لنظام «سِيمَا الخَيْر».
 * البيانات افتراضية لأغراض العرض، والأرقام والمعايير مطابقة للّائحة والنظام الداخلي.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { db, UPLOAD_DIR, DB_PATH } = require('./db');
const { ROLES, PERMISSIONS, SOD_FUNCTIONS } = require('./rbac');
const REF = require('./reference');
const R = require('./rules');
const { bcrypt } = require('./auth');
const EV = require('./seed-evidence');

const YEAR = 2026;
const PASS = bcrypt.hashSync('Sema@2026', 10);
let rngState = 20260815;
const rnd = () => { rngState = (rngState * 1103515245 + 12345) & 0x7fffffff; return rngState / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));
const dateStr = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const token = () => crypto.randomBytes(8).toString('hex');

function reset() {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
  db.pragma('foreign_keys = OFF');
  const tx = db.transaction(() => { for (const t of tables) db.prepare(`DELETE FROM ${t.name}`).run(); });
  tx();
  db.pragma('foreign_keys = ON');
  for (const f of fs.readdirSync(UPLOAD_DIR)) fs.unlinkSync(path.join(UPLOAD_DIR, f));
}

// ============ 1. المراجع ============
function seedReference() {
  const sf = db.prepare('INSERT INTO sod_functions (code,name_ar) VALUES (?,?)');
  SOD_FUNCTIONS.forEach(([c, n]) => sf.run(c, n));
  const rl = db.prepare('INSERT INTO roles (code,name_ar,category,sod_function,scope_kind,description,sort_order) VALUES (?,?,?,?,?,?,?)');
  ROLES.forEach((x) => rl.run(x.code, x.name_ar, x.category, x.sod || null, x.scope_kind || 'global', x.description, x.sort));
  const pm = db.prepare('INSERT INTO permissions (code,name_ar,grp) VALUES (?,?,?)');
  PERMISSIONS.forEach(([c, n, g]) => pm.run(c, n, g));
  const rp = db.prepare('INSERT OR IGNORE INTO role_permissions (role_code,permission_code) VALUES (?,?)');
  ROLES.forEach((x) => x.perms.forEach((p) => rp.run(x.code, p)));

  const t = db.prepare(`INSERT INTO revenue_tiers (code,name_ar,min_revenue,max_revenue,floor_l1,floor_l2,floor_l3,floor_l4,
      floor_pct_l1,floor_pct_l2,floor_pct_l3,floor_pct_l4,app_fee,annual_fee_l12,annual_fee_l35,field_audit_pct,sort_order)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  REF.TIERS.forEach((x, i) => t.run(x.code, x.name, x.min, x.max, x.f1 ?? null, x.f2 ?? null, x.f3 ?? null, x.f4 ?? null,
    x.p1 ?? null, x.p2 ?? null, x.p3 ?? null, x.p4 ?? null, x.app, x.a12, x.a35, x.audit, i));
  const lv = db.prepare('INSERT INTO brand_levels (level,name_ar,profit_pct,color_hex,claim_ar,field_audit_pct,mandatory_audit) VALUES (?,?,?,?,?,?,?)');
  REF.LEVELS.forEach((x) => lv.run(x.level, x.name, x.pct, x.color, x.claim, x.audit, x.mandatory));
  const cr = db.prepare('INSERT INTO accreditation_criteria (no,name_ar,requirement_ar,is_quantitative,threshold) VALUES (?,?,?,?,?)');
  REF.CRITERIA.forEach((x) => cr.run(...x));
  const ac = db.prepare('INSERT INTO admin_expense_classes (code,name_ar,min_pct,max_pct,accredit) VALUES (?,?,?,?,?)');
  REF.ADMIN_CLASSES.forEach((x) => ac.run(x.code, x.name, x.min, x.max, x.accredit));
  const ec = db.prepare('INSERT INTO eligible_channels (code,name_ar,counts,max_share,condition_ar) VALUES (?,?,?,?,?)');
  REF.CHANNELS.forEach((x) => ec.run(...x));
  const vc = db.prepare('INSERT INTO violation_codes (code,case_ar,measure_ar,default_measure,reapply_ban_months,publish) VALUES (?,?,?,?,?,?)');
  REF.VIOLATIONS.forEach((x) => vc.run(...x));
  const dt = db.prepare('INSERT INTO document_types (code,name_ar,applies_to,required,expires,form_no) VALUES (?,?,?,?,?,?)');
  REF.DOC_TYPES.forEach((x) => dt.run(...x));
  const kp = db.prepare('INSERT INTO kpis (code,name_ar,unit,method_ar,benchmark_ar,higher_is_better) VALUES (?,?,?,?,?,?)');
  REF.KPIS.forEach((x) => kp.run(...x));
  const kv = db.prepare('INSERT INTO kpi_values (kpi_code,year_no,kind,value) VALUES (?,?,?,?)');
  Object.entries(REF.KPI_TARGETS).forEach(([code, arr]) => arr.forEach((v, i) => kv.run(code, i + 1, 'target', v)));
  const rk = db.prepare('INSERT INTO risk_register (risk_ar,likelihood,impact,mitigation_ar,owner_body) VALUES (?,?,?,?,?)');
  REF.RISKS.forEach((x) => rk.run(...x));

  const st = db.prepare('INSERT INTO settings (k,v,note) VALUES (?,?,?)');
  st.run('brand_name', 'سِيمَا الخَيْر', 'اسم العلامة');
  st.run('wordmark', 'تَعْرِفُهُم بِسِيمَاهُم', 'الشعار اللفظي');
  st.run('brand_green', '#0B4533', 'أخضر العلامة');
  st.run('brand_gold', '#C38E29', 'ذهبي العلامة');
  st.run('pilot_year', '1', 'المرحلة التجريبية: تدقيق ميداني 100% لكل الملفات (المادة 38/2)');
  st.run('pilot_scope', 'طرابلس الكبرى', 'النطاق الجغرافي للسنة الأولى (المادة 38/1)');
  st.run('fiscal_year', String(YEAR), 'السنة المالية الجارية');
  st.run('volunteer_hour_rate', '18', 'سعر ساعة التطوع الموحَّد بالدينار (المادة 20)');
  st.run('annual_fee_cap', '30000', 'سقف مطلق للرسم السنوي (المادة 34/5)');
  st.run('single_org_cap', '0.60', 'سقف توجيه الالتزام لمنظمة واحدة فوق 100 ألف دينار (المادة 22/2)');
  st.run('absorption_multiple', '2.0', 'سقف الاستيعاب: 200% من أكبر ميزانية (المعيار 10)');
  st.run('overhead_cap', '0.25', 'سقف المصروفات الإدارية والتسييرية (المعيار 8)');
  st.run('unannounced_min', '0.10', 'الحد الأدنى للزيارات غير المعلنة (المادة 26/1)');
  st.run('decision_matrix', JSON.stringify(DECISION_MATRIX), 'ملحق مصفوفة الصلاحيات في النظام الداخلي');
}

const DECISION_MATRIX = {
  legend: { م: 'يملك القرار', ت: 'ينفّذ', ي: 'يُستشار', خ: 'يُخطَر', '✕': 'محظور عليه', '—': 'لا علاقة' },
  bodies: ['الجمعية العمومية','مجلس الأمناء','لجنة المعايير','وحدة التقييم','لجنة الترخيص','لجنة التظلمات','لجنة النزاهة','المدير التنفيذي'],
  rows: [
    ['وضع المعايير والنسب',        'خ','م','ت','ي','ي','—','ي','ي'],
    ['تعديل جدول الرسوم والأرضيات','خ','م','ي','—','—','—','ي','ي'],
    ['فحص طلب وتدقيقه',            '—','✕','✕','ت','✕','—','—','خ'],
    ['منح الترخيص / رفضه',         '—','✕','✕','✕','م','—','—','خ'],
    ['تحديد المستوى',              '—','✕','ي','ت','م','—','—','خ'],
    ['التعليق والسحب',             '—','✕','✕','ت','م','—','خ','ت'],
    ['البتّ في التظلم',            '—','✕','—','—','✕','م','خ','ت'],
    ['اعتماد منظمة مجتمع مدني',    '—','✕','ي','ت','م','—','—','خ'],
    ['تعيين المدير التنفيذي',      'خ','م','—','—','—','—','ي','—'],
    ['تعيين أعضاء اللجان',         'خ','م','—','—','—','—','ي','—'],
    ['اعتماد الموازنة',            'ي','م','—','—','—','—','—','ت'],
    ['قبول تمويل يتجاوز الحدود',   'خ','م','—','—','—','—','ي','ت'],
    ['اعتماد القوائم المالية',     'م','ي','—','—','—','—','ي','ت'],
    ['تعديل النظام الداخلي',       'م','ي','ي','—','—','—','ي','ت'],
    ['نشر ملاحظات نزاهة علنية',    '—','خ','—','—','—','—','م','ت'],
  ],
};

// ============ 2. المستخدمون ============
const STAFF = [
  // الحوكمة — مجلس الأمناء (11 عضواً: 3 منظمات، 3 أعمال، 4 مستقلون، 1 مؤسسون)
  ['عبدالسلام محمد الزروق','chair@sema.ly','BOARD_CHAIR','الشرقية','م','رئيس مجلس الأمناء — ممثل مستقل (محامٍ ممارس)'],
  ['نجاة إبراهيم العبيدي','board1@sema.ly','BOARD_MEMBER','الغربية','أ','عضو مجلس الأمناء — ممثلة منظمات المجتمع المدني'],
  ['مفتاح علي الشريف','board2@sema.ly','BOARD_MEMBER','الجنوبية','م','عضو مجلس الأمناء — ممثل منظمات المجتمع المدني'],
  ['سعاد الهادي بن عامر','board3@sema.ly','BOARD_MEMBER','الغربية','أ','عضو مجلس الأمناء — ممثلة قطاع الأعمال'],
  ['خالد رمضان الفيتوري','board4@sema.ly','BOARD_MEMBER','الشرقية','م','عضو مجلس الأمناء — ممثل قطاع الحرف والمهن'],
  ['فاطمة عمر الدرسي','board5@sema.ly','BOARD_MEMBER','الجنوبية','أ','عضو مجلس الأمناء — محاسبة قانونية مقيّدة (مستقلة)'],
  ['يوسف أحمد القمودي','board6@sema.ly','BOARD_MEMBER','الغربية','م','عضو مجلس الأمناء — شخصية أكاديمية (مستقل)'],
  ['محمد الصادق بن نصر','board7@sema.ly','BOARD_MEMBER','الشرقية','م','عضو مجلس الأمناء — ممثل الشركاء المؤسسين'],
  ['عائشة سالم الورفلي','ga1@sema.ly','GENERAL_ASSEMBLY','الغربية','أ','عضو الجمعية العمومية'],
  // لجنة المعايير
  ['إدريس البشير المقصبي','standards1@sema.ly','STANDARDS_COMMITTEE','الغربية','م','رئيس لجنة المعايير — محاسب قانوني'],
  ['رقية عبدالله الزوي','standards2@sema.ly','STANDARDS_COMMITTEE','الشرقية','أ','عضو لجنة المعايير — خبيرة في العمل الأهلي'],
  ['طارق منصور الجربي','standards3@sema.ly','STANDARDS_COMMITTEE','الغربية','م','عضو لجنة المعايير — ممثل قطاع الأعمال'],
  // وحدة التقييم
  ['سليمان أحمد الترهوني','evaldir@sema.ly','EVAL_DIRECTOR','الغربية','م','مدير وحدة التقييم والتحقق'],
  ['هدى مصطفى الغرياني','assessor1@sema.ly','ASSESSOR','الغربية','أ','مقيّمة أولى'],
  ['عمر عبدالرحمن الكيلاني','assessor2@sema.ly','ASSESSOR','الشرقية','م','مقيّم'],
  ['أسماء الطاهر بوزيد','assessor3@sema.ly','ASSESSOR','الجنوبية','أ','مقيّمة'],
  ['بشير الصديق العماري','auditor1@sema.ly','FIELD_AUDITOR','الغربية','م','مدقق ميداني أول'],
  ['نورة حسن المسماري','auditor2@sema.ly','FIELD_AUDITOR','الشرقية','أ','مدققة ميدانية'],
  // لجنة منح الترخيص
  ['عبدالحكيم يوسف الأطرش','licensing1@sema.ly','LICENSING_COMMITTEE','الشرقية','م','رئيس لجنة منح الترخيص (عضو مستقل من المجلس)'],
  ['زينب علي الشلوي','licensing2@sema.ly','LICENSING_COMMITTEE','الغربية','أ','عضو لجنة منح الترخيص'],
  ['المهدي سالم القذافي','licensing3@sema.ly','LICENSING_COMMITTEE','الجنوبية','م','عضو لجنة منح الترخيص'],
  // لجنة التظلمات
  ['صلاح الدين محمد بالراس','appeals1@sema.ly','APPEALS_COMMITTEE','الغربية','م','رئيس لجنة التظلمات — قانوني مستقل'],
  ['حنان عبدالسلام الصويعي','appeals2@sema.ly','APPEALS_COMMITTEE','الشرقية','أ','عضو لجنة التظلمات — محاسبة قانونية'],
  ['علي عمران الحاسي','appeals3@sema.ly','APPEALS_COMMITTEE','الجنوبية','م','عضو لجنة التظلمات — خبير عمل أهلي'],
  // لجنة حماية النزاهة
  ['مريم الصديق بن غشير','integrity1@sema.ly','INTEGRITY_COMMITTEE','الغربية','أ','رئيسة لجنة حماية النزاهة — شخصية عامة مستقلة'],
  ['أحمد ميلاد الزنتاني','integrity2@sema.ly','INTEGRITY_COMMITTEE','الغربية','م','عضو لجنة النزاهة — ممثل المستهلكين'],
  ['سميرة خليفة العوامي','integrity3@sema.ly','INTEGRITY_COMMITTEE','الشرقية','أ','عضو لجنة النزاهة — ممثلة المنظمات'],
  ['جمال الدين عثمان الهوني','integrity4@sema.ly','INTEGRITY_COMMITTEE','الجنوبية','م','عضو لجنة النزاهة — ممثل قطاع الأعمال'],
  // الأمانة التنفيذية
  ['ليلى محمود القلال','director@sema.ly','EXEC_DIRECTOR','الغربية','أ','المدير التنفيذي'],
  ['وليد عبدالناصر السويحلي','registry@sema.ly','REGISTRY_OFFICER','الغربية','م','مسؤول وحدة السجل والنظم'],
  ['ابتسام رجب الفاخري','finance@sema.ly','FINANCE_OFFICER','الغربية','أ','مسؤولة الوحدة المالية والإدارية'],
  ['أنس فتحي المشيرقي','comms@sema.ly','COMMS_OFFICER','الغربية','م','مسؤول وحدة الاتصال والتسويق'],
  ['خديجة علي الأسمر','orgrel@sema.ly','ORG_RELATIONS','الشرقية','أ','مسؤولة وحدة العلاقة بالمنظمات'],
  // مراجع خارجي
  ['مكتب البيان للمراجعة — عصام الككلي','auditor.ext@sema.ly','EXTERNAL_AUDITOR','الغربية','م','مراجع حسابات خارجي معتمد'],
];

function seedUsers() {
  const iu = db.prepare('INSERT INTO users (full_name,email,phone,password_hash,region,gender,job_title) VALUES (?,?,?,?,?,?,?)');
  const ir = db.prepare('INSERT INTO user_roles (user_id,role_code,scope_kind,scope_id,term_start,term_end) VALUES (?,?,?,?,?,?)');
  const ids = {};
  STAFF.forEach(([name, email, role, region, gender, title], i) => {
    const id = iu.run(name, email, `09${between(1, 6)}-${between(1000000, 9999999)}`, PASS, region, gender, title).lastInsertRowid;
    ir.run(id, role, 'global', null, dateStr(YEAR, 1, 15), dateStr(YEAR + 3, 1, 14));
    ids[email] = id;
  });
  // إقرارات السرّية والمصالح السنوية
  const ip = db.prepare('INSERT INTO integrity_pledges (user_id,kind,year,has_conflict,details,signed_at) VALUES (?,?,?,?,?,?)');
  for (const id of Object.values(ids)) {
    ip.run(id, 'confidentiality', null, 0, 'إقرار سرّية وحياد يسري أثناء الخدمة وبعدها بثلاث سنوات (المادة 26/2)', dateStr(YEAR, 1, 20));
    ip.run(id, 'annual_interests', YEAR, 0, 'لا توجد مصالح مباشرة أو غير مباشرة مع أي جهة خاضعة للتقييم', dateStr(YEAR, 2, 1));
  }
  // حالة تعارض معلنة واحدة
  ip.run(ids['assessor2@sema.ly'], 'annual_interests', YEAR, 1,
    'قدّمتُ خدمة استشارية محاسبية لشركة «النهضة للمقاولات» (الملف 7) في 2025 — يُحظر تكليفي بتقييمها (المادة 20/4)', dateStr(YEAR, 2, 3));
  return ids;
}

// ============ 3. الجهات ============
const SECTORS = ['أغذية ومشروبات','اتصالات وتقنية','مقاولات وإنشاءات','تجارة تجزئة','صيرفة وتمويل','نقل ولوجستيات',
  'أدوية ومستلزمات طبية','طاقة ومحروقات','تعليم خاص','ضيافة ومطاعم','صناعات بلاستيكية','مستحضرات تجميل',
  'حِرف تقليدية','فنون وتصميم','خدمات استشارية','مزارع ودواجن'];

const CITY_REGION = { 'طرابلس':'الغربية','مصراتة':'الغربية','الزاوية':'الغربية','الخمس':'الغربية','غريان':'الغربية',
  'زليتن':'الغربية','بنغازي':'الشرقية','البيضاء':'الشرقية','درنة':'الشرقية','طبرق':'الشرقية','أجدابيا':'الشرقية',
  'سبها':'الجنوبية','أوباري':'الجنوبية','مرزق':'الجنوبية','براك الشاطئ':'الجنوبية','غات':'الجنوبية' };

const BUSINESSES = [
  // [الاسم, الاسم التجاري, القطاع, المدينة, الإيراد, صافي الربح, المستوى, الحالة, مؤسس, نوع]
  ['شركة الواحة للصناعات الغذائية','واحة','أغذية ومشروبات','طرابلس',18400000,2460000,3,'active',1,'business'],
  ['شركة ليبيانا للاتصالات المحمولة','ليبيانا','اتصالات وتقنية','طرابلس',221000000,30200000,1,'active',1,'business'],
  ['مجموعة النهضة للمقاولات','النهضة','مقاولات وإنشاءات','طرابلس',9600000,880000,2,'active',1,'business'],
  ['أسواق المدينة للتجزئة','أسواق المدينة','تجارة تجزئة','طرابلس',6300000,540000,1,'active',1,'business'],
  ['مصرف الأمان الإسلامي','الأمان','صيرفة وتمويل','طرابلس',42000000,7100000,2,'active',1,'business'],
  ['شركة الخليج للنقل البري','الخليج نقل','نقل ولوجستيات','مصراتة',4100000,310000,1,'active',1,'business'],
  ['مصنع طرابلس للأدوية','طرابلس فارما','أدوية ومستلزمات طبية','طرابلس',27500000,4200000,4,'active',1,'business'],
  ['شركة الساحل للمياه المعدنية','ساحل','أغذية ومشروبات','الزاوية',3200000,410000,5,'active',1,'business'],
  ['أكاديمية المستقبل التعليمية','المستقبل','تعليم خاص','طرابلس',2800000,620000,3,'active',1,'business'],
  ['مطاعم دار الكسكسي','دار الكسكسي','ضيافة ومطاعم','طرابلس',1450000,190000,2,'active',1,'business'],
  ['شركة النور للبلاستيك','النور بلاست','صناعات بلاستيكية','الخمس',2100000,145000,1,'active',1,'business'],
  ['مؤسسة الصفا لمستحضرات التجميل','الصفا','مستحضرات تجميل','طرابلس',780000,96000,2,'active',1,'business'],
  ['شركة الفتح لتوزيع المحروقات','الفتح','طاقة ومحروقات','طرابلس',68000000,9400000,1,'active',0,'business'],
  ['مخابز الرغيف الذهبي','الرغيف','أغذية ومشروبات','طرابلس',920000,110000,1,'active',0,'business'],
  ['شركة بن غشير للدواجن','بن غشير','مزارع ودواجن','طرابلس',5400000,470000,2,'active',0,'business'],
  ['مجموعة الأندلس الاستشارية','الأندلس','خدمات استشارية','طرابلس',1900000,520000,3,'active',0,'business'],
  ['شركة زليتن للزيوت','زليتن أويل','أغذية ومشروبات','زليتن',7800000,690000,2,'active',0,'business'],
  ['ورشة الأصيل للنحاسيات','الأصيل','حِرف تقليدية','طرابلس',185000,36000,2,'active',0,'craftsman'],
  ['مشغل يد الخير للتطريز','يد الخير','حِرف تقليدية','مصراتة',142000,28000,3,'active',0,'craftsman'],
  ['استوديو سيمياء للتصميم','سيمياء','فنون وتصميم','طرابلس',240000,72000,4,'active',0,'creative'],
  ['معرض ألوان الجنوب للفنون','ألوان الجنوب','فنون وتصميم','سبها',96000,19000,1,'active',0,'artist'],
  ['محترف الفخّار الليبي','الفخّار','حِرف تقليدية','غريان',210000,41000,2,'active',0,'craftsman'],
  ['شركة برنيق للمقاولات','برنيق','مقاولات وإنشاءات','بنغازي',12400000,1120000,1,'active',0,'business'],
  ['أسواق الجبل للتجزئة','الجبل','تجارة تجزئة','البيضاء',3900000,280000,1,'active',0,'business'],
  ['شركة الهلال للنقل','الهلال','نقل ولوجستيات','بنغازي',2600000,190000,2,'active',0,'business'],
  ['مصنع درنة للمعلبات','درنة فود','أغذية ومشروبات','درنة',4700000,530000,3,'active',0,'business'],
  ['شركة الصحارى للخدمات النفطية','الصحارى','طاقة ومحروقات','أجدابيا',31000000,4900000,2,'active',0,'business'],
  ['مركز سبها الطبي الخاص','سبها ميد','أدوية ومستلزمات طبية','سبها',1700000,240000,2,'active',0,'business'],
  ['شركة فزّان للمواد الغذائية','فزّان','أغذية ومشروبات','سبها',2300000,175000,1,'active',0,'business'],
  ['مؤسسة أوباري للتمور','أوباري','مزارع ودواجن','أوباري',640000,88000,3,'active',0,'business'],
  // حالات غير سارية
  ['شركة الأفق للمواد الإنشائية','الأفق','مقاولات وإنشاءات','طرابلس',5100000,320000,2,'suspended',0,'business'],
  ['مؤسسة البركة للتجارة العامة','البركة','تجارة تجزئة','مصراتة',1200000,95000,1,'suspended',0,'business'],
  ['شركة الريادة للاستيراد','الريادة','تجارة تجزئة','طرابلس',3300000,240000,3,'withdrawn',0,'business'],
  ['مصنع الوفاء للمرطبات','الوفاء','أغذية ومشروبات','الخمس',2700000,210000,2,'withdrawn',0,'business'],
  ['شركة المنارة للخدمات','المنارة','خدمات استشارية','بنغازي',890000,130000,1,'expired',0,'business'],
  ['ورشة السنابل للخشب','السنابل','حِرف تقليدية','طرابلس',160000,24000,1,'expired',0,'craftsman'],
  // قيد المعالجة
  ['شركة الجزيرة للمقاولات','الجزيرة','مقاولات وإنشاءات','طرابلس',14200000,1380000,3,'under_review',0,'business'],
  ['مصنع الوطن للأثاث','الوطن','صناعات بلاستيكية','مصراتة',3800000,290000,2,'under_review',0,'business'],
  ['شركة الأمل للأدوية','الأمل','أدوية ومستلزمات طبية','طرابلس',8900000,1240000,4,'submitted',0,'business'],
  ['مقهى ركن القراءة','ركن القراءة','ضيافة ومطاعم','طرابلس',410000,62000,1,'submitted',0,'business'],
  ['مشغل نول الوطن','نول الوطن','حِرف تقليدية','طبرق',118000,21000,2,'submitted',0,'craftsman'],
  ['شركة التقدم للتقنية','التقدم','اتصالات وتقنية','طرابلس',5600000,1180000,3,'draft',0,'business'],
  // مرفوض
  ['شركة الشمس للتبغ','الشمس','تجارة تجزئة','طرابلس',7400000,980000,1,'rejected',0,'business'],
];

const ASSOCIATIONS = [
  // [الاسم, المدينة, سنة التأسيس, الإيراد, إجمالي المصروفات, المصروفات الإدارية, أكبر ميزانية 3 سنوات, نسبة كلفة الجمع, المجال, الحالة, مؤسس]
  ['جمعية الهلال الأحمر الليبي — فرع طرابلس','طرابلس',1985,4200000,3980000,520000,4200000,0.14,'إغاثة وصحة','accredited',1],
  ['مؤسسة نماء للتنمية المجتمعية','طرابلس',2014,1850000,1740000,243000,1850000,0.18,'تنمية مجتمعية · تدريب','accredited',1],
  ['جمعية البر والتقوى الخيرية','مصراتة',2009,960000,910000,118000,980000,0.21,'كفالة أيتام · إغاثة','accredited',1],
  ['منظمة بذرة للتعليم','طرابلس',2016,640000,598000,71000,640000,0.16,'تعليم · منح دراسية','accredited',1],
  ['جمعية شفاء لدعم مرضى السرطان','بنغازي',2011,2400000,2280000,296000,2400000,0.19,'صحة · علاج','accredited',1],
  ['جمعية إعمار الجنوب','سبها',2013,780000,742000,111000,790000,0.24,'تنمية · مياه','accredited',1],
  ['مؤسسة الأمل لرعاية ذوي الإعاقة','طرابلس',2007,1320000,1250000,150000,1320000,0.15,'إعاقة · تأهيل','accredited',1],
  ['جمعية زاد الخير لتوزيع الغذاء','طرابلس',2018,540000,512000,46000,540000,0.12,'أمن غذائي','accredited',1],
  ['منظمة سواعد لإعادة الإعمار','بنغازي',2012,3100000,2940000,353000,3100000,0.20,'إعمار · إسكان','accredited',1],
  ['جمعية نور المعرفة لمحو الأمية','الزاوية',2015,310000,294000,38000,320000,0.17,'تعليم · محو أمية','accredited',1],
  ['مؤسسة ميّاه للمياه النظيفة','أوباري',2017,420000,398000,52000,430000,0.22,'مياه وإصحاح','accredited',1],
  ['جمعية رفق لرعاية المسنين','مصراتة',2010,680000,645000,84000,690000,0.18,'رعاية مسنين','accredited',1],
  ['جمعية درنة للتنمية الحضرية','درنة',2019,1100000,1042000,146000,1100000,0.23,'تنمية حضرية','accredited',0],
  ['منظمة أمان لحماية الطفل','طرابلس',2015,890000,846000,101000,890000,0.19,'حماية الطفل','accredited',0],
  ['جمعية الوفاء لأسر الشهداء','بنغازي',2012,1450000,1375000,192000,1450000,0.21,'دعم أسر','accredited',0],
  ['مؤسسة خبير لبناء القدرات','طرابلس',2016,520000,494000,64000,530000,0.20,'تدريب مهني','accredited',0],
  ['جمعية مرزق للتنمية الريفية','مرزق',2014,260000,247000,34000,270000,0.24,'زراعة · ريف','accredited',0],
  ['جمعية البيضاء الخيرية','البيضاء',2008,720000,684000,89000,730000,0.18,'إغاثة · كفالة','accredited',0],
  // حالات خاصة
  ['جمعية العطاء للتكافل','طرابلس',2017,430000,408000,118000,440000,0.33,'تكافل اجتماعي','suspended',0],
  ['مؤسسة الإحسان للتنمية','الخمس',2019,290000,276000,11000,300000,0.09,'تنمية صغيرة','accredited',0],
  ['جمعية النخبة للأعمال الخيرية','بنغازي',2020,180000,171000,62000,190000,0.41,'خيري عام','revoked',0],
  ['منظمة أفق للشباب','طرابلس',2021,150000,142000,22000,160000,0.20,'شباب · ريادة','submitted',0],
  ['جمعية غات للتراث','غات',2018,95000,90000,13000,100000,0.19,'تراث · ثقافة','submitted',0],
  ['جمعية الصفوة الخيرية','طبرق',2022,48000,45000,9000,50000,0.25,'خيري عام','under_review',0],
];

function seedEntities(staff) {
  const il = db.prepare(`INSERT INTO licensees (license_no,legal_name,trade_name,legal_form,applicant_kind,commercial_reg,
      tax_file_no,social_sec_no,sector,region,city,address,contact_name,contact_email,contact_phone,website,
      tier_code,level,scope_type,scope_desc,annual_revenue,net_profit,fiscal_year,founding_partner,partner_class,
      status,status_reason,start_date,end_date,excluded,exclusion_reason,qr_token)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const iu = db.prepare('INSERT INTO users (full_name,email,phone,password_hash,region,gender,job_title) VALUES (?,?,?,?,?,?,?)');
  const ir = db.prepare('INSERT INTO user_roles (user_id,role_code,scope_kind,scope_id) VALUES (?,?,?,?)');
  const licensees = [];
  let serial = 0;
  BUSINESSES.forEach((b, i) => {
    const [legal, trade, sector, city, rev, np, level, status, founding, kind] = b;
    const region = CITY_REGION[city];
    const tier = R.tierFor(rev).code;
    const active = ['active', 'suspended', 'withdrawn', 'expired'].includes(status);
    const no = active ? R.licenseNo(++serial, YEAR) : null;
    const scopeType = level === 5 ? 'product_line' : (i % 7 === 0 ? 'brand' : 'enterprise');
    const scopeDesc = level === 5 ? 'خط إنتاج «قارورة الخير» — عبوة 0.5 لتر' :
      (scopeType === 'brand' ? `العلامة التجارية «${trade}»` : 'المنشأة كاملةً');
    const start = active ? dateStr(YEAR, between(1, 7), between(1, 28)) : null;
    const reason = status === 'suspended' ? 'عجز في الالتزام يتجاوز 20% عن السنة المالية 2025 (المادة 29/4)'
      : status === 'withdrawn' ? 'تقديم بيانات غير صحيحة عمداً — سحب فوري وحظر إعادة التقديم 24 شهراً (المادة 29/8)'
      : status === 'expired' ? 'انقضت مهلة تقديم إقرار الامتثال دون تقديمه (المادة 18/3)'
      : status === 'rejected' ? 'مدرجة على قائمة الاستبعاد — منشآت التبغ ومنتجات النيكوتين (المادة 10/1)' : null;
    const id = il.run(no, legal, trade, kind === 'business' ? pick(['شركة مساهمة','شركة ذات مسؤولية محدودة','شركة تضامن']) : 'مؤسسة فردية',
      kind, `CR-${between(100000, 999999)}`, `TX-${between(1000000, 9999999)}`, `SS-${between(100000, 999999)}`,
      sector, region, city, `${city} — ${pick(['شارع الجمهورية','طريق المطار','شارع عمر المختار','المنطقة الصناعية','شارع البلدية'])}`,
      pick(['م. ','أ. ','د. ']) + pick(['محمد','علي','فاطمة','خالد','نادية','عبدالله','سعاد','عمر']) + ' ' + pick(['الصويعي','بن علي','الترهوني','المصراتي','البرعصي','الفيتوري']),
      `info@${trade.replace(/\s/g, '')}.ly`.replace(/[^\x00-\x7F@.]/g, 'x'), `02${between(1, 9)}-${between(1000000, 9999999)}`,
      null, tier, level, scopeType, scopeDesc, rev, np, YEAR - 1, founding,
      founding ? 'founding' : (active && start && start < dateStr(YEAR, 7, 1) ? 'working' : 'none'),
      status, reason, start, start ? R.addDays(start, 365) : null,
      status === 'rejected' ? 1 : 0, status === 'rejected' ? 'منشآت التبغ ومنتجات النيكوتين (المادة 10/1)' : null,
      active ? token() : null).lastInsertRowid;
    // حساب الشريك
    const uid = iu.run(`${legal} — حساب الشريك`, `partner${i + 1}@sema.ly`, `02${between(1,9)}-${between(1000000,9999999)}`,
      PASS, region, null, 'مسؤول ملف العلامة').lastInsertRowid;
    ir.run(uid, 'PARTNER_BUSINESS', 'licensee', id);
    licensees.push({ id, no, legal, trade, sector, city, region, rev, np, level, status, tier, founding, kind, start, uid });
  });

  const ia = db.prepare(`INSERT INTO associations (accreditation_no,name,registration_no,registration_authority,region,city,
      address,established_year,contact_name,contact_email,contact_phone,board_size,paid_board_members,
      board_meetings_last_year,annual_revenue,total_expenses,admin_expenses,admin_expense_ratio,admin_class,
      admin_ratio_3y_avg,fundraising_cost_ratio,largest_budget_3y,absorption_cap,absorption_used,audit_tier,
      focus_areas,status,status_reason,accredited_from,accredited_to,partner_class,qr_token)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const associations = [];
  let aserial = 0;
  ASSOCIATIONS.forEach((a, i) => {
    const [name, city, est, rev, texp, aexp, big3, frCost, focus, status, founding] = a;
    const region = CITY_REGION[city];
    const ratio = R.round4(aexp / texp);
    const cls = R.classifyAdminRatio(ratio);
    const accredited = ['accredited', 'suspended', 'revoked', 'expired'].includes(status);
    const no = accredited ? R.accreditationNo(++aserial, YEAR) : null;
    const from = accredited ? dateStr(YEAR, between(1, 6), between(1, 28)) : null;
    const reason = status === 'suspended' ? 'تجاوز سقف المصروفات الإدارية 25% — إمهال لمعالجة الوضع (المادة 32)'
      : status === 'revoked' ? 'تجاوز سقف المصروفات الإدارية ثلاث سنوات مالية متتالية دون ظروف استثنائية مقبولة (المادة 32)' : null;
    const id = ia.run(no, name, `REG-${between(1000, 9999)}/${est}`, 'وزارة الشؤون الاجتماعية — مكتب المجتمع المدني',
      region, city, `${city} — ${pick(['حي الأندلس','شارع النصر','المنطقة المركزية','حي الزهور'])}`, est,
      pick(['أ. ','د. ']) + pick(['خالد','نجاة','سليمان','آمنة','مصطفى','هدى']) + ' ' + pick(['الزوي','بن سعود','القمودي','الورفلي','الشريف']),
      `contact@org${i + 1}.ly`, `02${between(1, 9)}-${between(1000000, 9999999)}`,
      between(5, 11), i % 9 === 0 ? 1 : 0, between(3, 6), rev, texp, aexp, ratio, cls.code,
      R.round4(ratio * (0.95 + rnd() * 0.1)), frCost, big3, big3 * 2, 0, R.auditTierFor(rev),
      focus, status, reason, from, from ? R.addDays(from, 730) : null,
      founding ? 'founding' : (accredited ? 'working' : 'none'), accredited ? token() : null).lastInsertRowid;
    const uid = iu.run(`${name} — حساب المنظمة`, `org${i + 1}@sema.ly`, `02${between(1,9)}-${between(1000000,9999999)}`,
      PASS, region, null, 'المنسّق المفوَّض').lastInsertRowid;
    ir.run(uid, 'PARTNER_ASSOCIATION', 'association', id);
    associations.push({ id, no, name, region, city, rev, texp, aexp, ratio, cls: cls.code, big3, status, focus, uid });
  });
  return { licensees, associations };
}

module.exports = { reset, seedReference, seedUsers, seedEntities, DECISION_MATRIX,
  YEAR, PASS, rnd, pick, between, dateStr, token, SECTORS, CITY_REGION, EV };
