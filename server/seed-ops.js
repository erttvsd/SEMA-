'use strict';
/** الجزء الثاني من البيانات التصويرية: الطلبات، الإثباتات، الالتزام، التدقيق، الجزاءات، الحوكمة */
const { db, UPLOAD_DIR } = require('./db');
const REF = require('./reference');
const R = require('./rules');
const EV = require('./seed-evidence');
const S = require('./seed');

const { YEAR, rnd, pick, between, dateStr } = S;

function doc({ owner_kind, owner_id, doc_type, title, subtitle, issuer, refNo, date, rows, body,
               uploaded_by, verification = 'verified', verified_by, is_public = 0, confidential = 0,
               issued_on, expires_on, stamp }) {
  const html = EV.page({ title, subtitle, issuer, refNo, date: date || dateStr(YEAR, between(1, 8), between(1, 28)), rows, body, stamp });
  const f = EV.write(UPLOAD_DIR, html);
  const id = db.prepare(`INSERT INTO documents (owner_kind,owner_id,doc_type,title,file_name,stored_name,mime_type,
      size_bytes,sha256,pages,issued_on,expires_on,uploaded_by,verification,verified_by,verified_at,verify_note,
      is_public,confidential,uploaded_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    owner_kind, owner_id, doc_type || null, title, `${title}.html`, f.stored_name, f.mime,
    f.size, f.sha256, f.pages, issued_on || null, expires_on || null, uploaded_by || null,
    verification, verification === 'verified' ? (verified_by || null) : null,
    verification === 'verified' ? dateStr(YEAR, between(2, 9), between(1, 28)) : null,
    verification === 'verified' ? 'مطابق للأصل — تحقّق من المصدر ومن سريان المدة' :
      verification === 'rejected' ? 'المستند منتهي الصلاحية — يلزم تحديثه' : null,
    is_public, confidential, dateStr(YEAR, between(1, 9), between(1, 28)) + ' 09:' + String(between(10, 59))).lastInsertRowid;
  return id;
}

const fmt = (n) => new Intl.NumberFormat('ar-LY', { maximumFractionDigits: 0 }).format(Math.round(n || 0));

// ============ الإثباتات لكل مرخَّص له ============
function seedLicenseeDocs(l, staff) {
  const assessor = pick([staff['assessor1@sema.ly'], staff['assessor2@sema.ly'], staff['assessor3@sema.ly']]);
  const lv = REF.LEVELS.find((x) => x.level === l.level);
  const c = R.computeCommitment({ revenue: l.rev, netProfit: l.np, level: l.level });
  const fees = R.computeFees({ revenue: l.rev, level: l.level });
  const ids = {};
  const base = { owner_kind: 'licensee', owner_id: l.id, uploaded_by: l.uid, verified_by: assessor };

  ids.commercial_reg = doc({ ...base, doc_type: 'commercial_reg', title: `سجل تجاري — ${l.legal}`,
    subtitle: 'مستخرج من السجل التجاري', issuer: 'وزارة الاقتصاد والتجارة — مصلحة السجل التجاري',
    refNo: `CR-${between(100000, 999999)}`, issued_on: dateStr(YEAR - 1, 3, 12), expires_on: dateStr(YEAR + 1, 3, 11),
    rows: [['الاسم القانوني', l.legal], ['الاسم التجاري', l.trade], ['النشاط', l.sector],
      ['المدينة', l.city], ['رأس المال المصرَّح', fmt(l.rev * 0.15) + ' د.ل'], ['حالة السجل', 'ساري']] });

  ids.tax_file = doc({ ...base, doc_type: 'tax_file', title: `ملف ضريبي ساري — ${l.trade}`,
    issuer: 'مصلحة الضرائب — مكتب ' + l.city, refNo: `TX-${between(1000000, 9999999)}`,
    issued_on: dateStr(YEAR, 1, 20), expires_on: dateStr(YEAR + 1, 1, 19), confidential: 1,
    rows: [['رقم الملف', `TX-${between(1000000, 9999999)}`], ['آخر إقرار مقدَّم', `${YEAR - 1}`],
      ['الإيراد المعلن', fmt(l.rev) + ' د.ل'], ['صافي الربح قبل الضريبة', fmt(l.np) + ' د.ل'],
      ['حالة الملف', 'ساري ومنتظم']] });

  ids.tax_clearance = doc({ ...base, doc_type: 'tax_clearance', title: `شهادة عدم مديونية ضريبية — ${l.trade}`,
    issuer: 'مصلحة الضرائب', refNo: `CLR-${between(10000, 99999)}`, issued_on: dateStr(YEAR, 2, 5),
    expires_on: dateStr(YEAR, 12, 31),
    rows: [['المكلَّف', l.legal], ['المديونية القائمة', 'لا توجد'], ['خطة سداد', 'غير مطلوبة']] });

  ids.social_security = doc({ ...base, doc_type: 'social_security', title: `إفادة انتظام الضمان الاجتماعي — ${l.trade}`,
    issuer: 'صندوق الضمان الاجتماعي', refNo: `SS-${between(100000, 999999)}`, issued_on: dateStr(YEAR, 2, 14),
    expires_on: dateStr(YEAR, 8, 14),
    rows: [['عدد المشتركين', between(6, 240)], ['آخر شهر مسدَّد', dateStr(YEAR, 1, 31)], ['المتأخرات', 'لا توجد']] });

  ids.commitment_stmt = doc({ ...base, doc_type: 'commitment_stmt', title: `بيان الالتزام المجتمعي — ${l.legal}`,
    issuer: l.legal, refNo: `STMT-${l.id}`, is_public: 1, issued_on: dateStr(YEAR, 1, 10),
    body: `<p>تعلن <b>${l.legal}</b> التزامها بتخصيص <b>${lv.level === 5 ? 'كامل صافي عائد خط الإنتاج المخصص' : `${lv.pct * 100}% من صافي دخلها السنوي قبل الضريبة`}</b>
      لأعمال خيرية وإنسانية وتنموية <b>داخل ليبيا</b> حصراً، وذلك عبر منظمات مجتمع مدني معتمدة في سجل علامة «سِيمَا الخَيْر».</p>
      <ol><li>لا تُمرَّر كلفة هذا الالتزام إلى سعر المنتج في السلع الأساسية.</li>
      <li>يُقدَّم إقرار امتثال سنوي مسنَد بمستندات خارجية قابلة للتحقق.</li>
      <li>تُمكَّن وحدة التقييم والتحقق من الاطلاع والزيارة، بما يشمل الزيارات غير المعلنة.</li></ol>
      <p>معتمد من الإدارة العليا بتاريخ ${dateStr(YEAR, 1, 10)}.</p>` });

  ids.level_declaration = doc({ ...base, doc_type: 'level_declaration',
    title: `إقرار المستوى المطلوب والمبلغ المقدَّر — ${l.trade}`, issuer: l.legal, refNo: `LVL-${l.id}`,
    rows: [['المستوى المطلوب', `${lv.name} (المستوى ${l.level})`],
      ['شريحة الإيراد', c.tier_name], ['الإيراد السنوي', fmt(l.rev) + ' د.ل'],
      ['صافي الربح قبل الضريبة', fmt(l.np) + ' د.ل'],
      ['النسبة المقررة', lv.pct ? `${lv.pct * 100}%` : '100% من صافي أرباح النطاق المخصص'],
      ['قيمة النسبة', fmt(c.pct_amount) + ' د.ل'], ['الأرضية المطلقة', fmt(c.floor_amount) + ' د.ل'],
      ['الالتزام المقدَّر (الأعلى من الاثنين)', fmt(c.commitment_due) + ' د.ل'], ['أساس الاحتساب', c.basis_note]] });

  ids.conduct_pledge = doc({ ...base, doc_type: 'conduct_pledge', title: `نموذج (3) إقرار الحد الأدنى للسلوك — ${l.trade}`,
    issuer: l.legal, refNo: `F3-${l.id}`,
    body: `<p>نُقرّ ونتعهّد بما يأتي، ويُعدّ ثبوت مخالفة أيٍّ منه سبباً موجباً للتعليق:</p>
      <ol><li>عدم تشغيل من هم دون السن القانونية للعمل.</li><li>سداد أجور العاملين في مواعيدها.</li>
      <li>عدم التمييز في التوظيف على أساس المنطقة أو القبيلة أو الجنس أو الرأي.</li>
      <li>الالتزام باشتراطات السلامة والصحة المهنية.</li>
      <li>عدم الإضرار المتعمّد بالبيئة أو مخالفة الاشتراطات البيئية النافذة.</li>
      <li>صدق وكمال كل ما يُقدَّم إلى العلامة من بيانات ومستندات.</li></ol>` });

  ids.audit_consent = doc({ ...base, doc_type: 'audit_consent', title: `تعهد قبول التدقيق والزيارات غير المعلنة — ${l.trade}`,
    issuer: l.legal, refNo: `AC-${l.id}`,
    body: `<p>نتعهّد بتمكين وحدة التقييم والتحقق من الاطلاع على الدفاتر والمستندات المتعلقة بالالتزام، ومقابلة المسؤول المالي،
      والتحقق من مطابقة العلامة على العبوات ونقاط البيع، ومراسلة المنظمات المتلقية للتحقق من الاستلام —
      <b>بما يشمل الزيارات غير المعلنة دون إخطار مسبق</b>. ونعلم أن عرقلة التدقيق أو رفضه موجبة للتعليق الفوري (المادة 29/10).</p>` });

  if (['active', 'suspended', 'withdrawn', 'expired'].includes(l.status)) {
    ids.financials = doc({ ...base, doc_type: 'financials', title: `قوائم مالية مدققة ${YEAR - 1} — ${l.trade}`,
      issuer: 'مكتب ' + pick(['البيان','الرسالة','الميزان','الثقة']) + ' للمراجعة والتدقيق — محاسب قانوني مقيّد',
      refNo: `FS-${YEAR - 1}-${l.id}`, confidential: 1, issued_on: dateStr(YEAR, 4, 15),
      rows: [['إجمالي الإيرادات', fmt(l.rev) + ' د.ل'], ['إجمالي المصروفات', fmt(l.rev - l.np) + ' د.ل'],
        ['صافي الربح قبل الضريبة', fmt(l.np) + ' د.ل'], ['هامش الربح', ((l.np / l.rev) * 100).toFixed(1) + '%'],
        ['رأي المراجع', 'رأي غير متحفظ']] });

    ids.license_contract = doc({ ...base, doc_type: 'license_contract',
      title: `نموذج (11) عقد ترخيص استعمال العلامة — ${l.no}`, issuer: 'الأمانة التنفيذية للعلامة',
      refNo: l.no, is_public: 0, issued_on: l.start,
      rows: [['المرخَّص له', l.legal], ['رقم الترخيص', l.no], ['المستوى', lv.name],
        ['نطاق الترخيص', l.level === 5 ? 'خط إنتاج مخصص' : 'المنشأة كاملةً'],
        ['مدة العقد', 'سنة واحدة من تاريخ إصدار الشهادة'], ['الرسم السنوي', fmt(fees.annual_fee) + ' د.ل'],
        ['الالتزام السنوي', fmt(c.commitment_due) + ' د.ل']],
      body: `<p><b>المادة الثانية — طبيعة الحق:</b> رخصة استعمال محدودة المدة والنطاق، غير قابلة للتنازل أو الترخيص من الباطن
        أو الرهن أو التوريث، ولا تُكسِب المرخَّص له أي حق ملكية على العلامة (المادة 8 من النظام الداخلي).</p>
        <p><b>المادة السادسة — الالتزامات:</b> يلتزم المرخَّص له بكل ما ورد في البند «ثامناً» من نموذج (1).</p>` });

    ids.certificate = doc({ ...base, doc_type: 'certificate', title: `شهادة ترخيص — ${l.no}`,
      issuer: 'مجلس الأمناء — الأمانة التنفيذية', refNo: l.no, is_public: 1,
      issued_on: l.start, expires_on: l.start ? R.addDays(l.start, 365) : null,
      stamp: l.status === 'active' ? 'ساري' : l.status === 'suspended' ? 'معلَّق' : l.status === 'withdrawn' ? 'مسحوب' : 'منتهٍ',
      rows: [['المرخَّص له', l.legal], ['رقم الترخيص', l.no], ['المستوى الممنوح', `${lv.name} — ${lv.claim}`],
        ['لون شريط المستوى', lv.color], ['النطاق', l.level === 5 ? 'خط إنتاج «قارورة الخير»' : 'المنشأة كاملةً'],
        ['تاريخ البدء', l.start], ['تاريخ الانتهاء', l.start ? R.addDays(l.start, 365) : '—'],
        ['الحالة', l.status]],
      body: `<p><b>الادعاء المسموح به حصراً:</b> «${R.allowedClaim(l.level, l.no)}»</p>
        <p>يجب أن يظهر رقم الترخيص بجوار الشعار في كل تطبيق. ويُعدّ استعمال الشعار دون رقم ترخيص مخالفةً (المادة 35/3).</p>` });
  }
  if (l.rev < 250000 && rnd() < 0.5)
    ids.bank_guarantee = doc({ ...base, doc_type: 'bank_guarantee', title: `ضمان مصرفي — ${l.trade}`,
      issuer: 'مصرف ' + pick(['الجمهورية','الوحدة','الصحاري','التجاري الوطني']), refNo: `BG-${between(10000, 99999)}`,
      rows: [['قيمة الضمان', fmt(c.commitment_due) + ' د.ل'], ['الغرض', 'ضمان الالتزام لمنشأة لم تُكمل سنة مالية'],
        ['سارٍ حتى', dateStr(YEAR + 1, 6, 30)]] });
  return ids;
}

function seedAssociationDocs(a, staff) {
  const assessor = pick([staff['assessor1@sema.ly'], staff['assessor3@sema.ly']]);
  const base = { owner_kind: 'association', owner_id: a.id, uploaded_by: a.uid, verified_by: assessor };
  const cls = R.classifyAdminRatio(a.ratio);
  const ids = {};
  ids.registration_cert = doc({ ...base, doc_type: 'registration_cert', title: `صورة القيد النظامي — ${a.name}`,
    issuer: 'وزارة الشؤون الاجتماعية — مكتب المجتمع المدني', refNo: `REG-${between(1000, 9999)}`,
    issued_on: dateStr(YEAR - 2, 5, 11), expires_on: dateStr(YEAR + 1, 5, 10), is_public: 1,
    rows: [['اسم المنظمة', a.name], ['المدينة', a.city], ['مجال العمل', a.focus], ['حالة القيد', 'ساري']] });
  ids.bylaws = doc({ ...base, doc_type: 'bylaws', title: `النظام الأساسي — ${a.name}`, issuer: a.name,
    refNo: `BL-${a.id}`, is_public: 1,
    body: `<p><b>الغرض:</b> ${a.focus}.</p><p><b>المجلس:</b> يتكون من أعضاء منتخبين لهم حق التصويت، ويجتمع ثلاث مرات سنوياً على الأقل.</p>
      <p><b>الفصل الوظيفي:</b> فصل بين الإدارة التنفيذية والإشراف.</p>
      <p><b>الأيلولة:</b> عند الحل تؤول الأموال إلى منظمة أهلية ليبية لا تستهدف الربح.</p>` });
  ids.financials_3y = doc({ ...base, doc_type: 'financials_3y', title: `القوائم المالية لثلاث سنوات — ${a.name}`,
    issuer: a.name, refNo: `FS3-${a.id}`, is_public: 1, issued_on: dateStr(YEAR, 3, 30),
    rows: [[`إيرادات ${YEAR - 1}`, fmt(a.rev) + ' د.ل'], [`إيرادات ${YEAR - 2}`, fmt(a.rev * 0.86) + ' د.ل'],
      [`إيرادات ${YEAR - 3}`, fmt(a.rev * 0.72) + ' د.ل'], ['إجمالي المصروفات', fmt(a.texp) + ' د.ل'],
      ['المصروفات الإدارية والتسييرية والدعائية', fmt(a.aexp) + ' د.ل'],
      ['نسبة المصروفات الإدارية', (a.ratio * 100).toFixed(1) + '%'],
      ['التصنيف المنشور', cls.name], ['أكبر ميزانية سنوية (3 سنوات)', fmt(a.big3) + ' د.ل'],
      ['سقف الاستيعاب (200%)', fmt(a.big3 * 2) + ' د.ل']] });
  ids.auditor_report = doc({ ...base, doc_type: 'auditor_report', title: `تقرير المراجع الحسابي ${YEAR - 1} — ${a.name}`,
    issuer: R.auditTierFor(a.rev), refNo: `AR-${a.id}`, is_public: 1, issued_on: dateStr(YEAR, 4, 8),
    rows: [['مستوى المراجعة المطلوب (المادة 14)', R.auditTierFor(a.rev)], ['الرأي', 'رأي غير متحفظ'],
      ['ملاحظات جوهرية', a.ratio > 0.25 ? 'تجاوز بند المصروفات الإدارية السقف المقرر' : 'لا توجد']] });
  ids.tax_cert = doc({ ...base, doc_type: 'tax_cert', title: `الشهادة الضريبية — ${a.name}`,
    issuer: 'مصلحة الضرائب', refNo: `TXC-${between(10000, 99999)}`, issued_on: dateStr(YEAR, 2, 2),
    expires_on: dateStr(YEAR + 1, 2, 1), rows: [['حالة الملف', 'ساري'], ['إيداع الحسابات الختامية', 'مودعة']] });
  ids.board_minutes = doc({ ...base, doc_type: 'board_minutes', title: `محاضر اجتماعات المجلس ${YEAR - 1} — ${a.name}`,
    issuer: a.name, refNo: `BM-${a.id}`,
    rows: [['عدد الاجتماعات', between(3, 6)], ['نسبة الحضور المتوسطة', between(62, 96) + '%'],
      ['الأعضاء ذوو حق التصويت', between(5, 11)]] });
  ids.code_of_conduct = doc({ ...base, doc_type: 'code_of_conduct', title: `مدونة السلوك وسياسة تعارض المصالح — ${a.name}`,
    issuer: a.name, refNo: `COC-${a.id}`, is_public: 1,
    body: `<p>تشمل: مدونة سلوك ملزمة، وسياسة تعارض مصالح موقّعة سنوياً من كل عضو مجلس وكل عامل،
      و<b>قناة شكاوى سرّية</b> مع <b>حماية للمبلّغين</b> عن المخالفات (المعيار 13).</p>` });
  ids.annual_report = doc({ ...base, doc_type: 'annual_report', title: `التقرير السنوي ${YEAR - 1} — ${a.name}`,
    issuer: a.name, refNo: `ANN-${a.id}`, is_public: 1,
    rows: [['المستفيدون المباشرون', fmt(between(400, 32000)) + ' شخص'], ['البرامج المنفَّذة', between(3, 14)],
      ['المناطق المشمولة', between(1, 9)], ['نسبة الإنفاق البرامجي', ((1 - a.ratio) * 100).toFixed(1) + '%']] });
  ids.bank_account_form = doc({ ...base, doc_type: 'bank_account_form', title: `نموذج الحساب المصرفي المخصص — ${a.name}`,
    issuer: 'مصرف ' + pick(['الجمهورية','الوحدة','التجاري الوطني']), refNo: `IBAN-LY${between(10, 99)}`,
    confidential: 1, rows: [['اسم الحساب', a.name], ['الغرض', 'حساب مخصص لمساهمات علامة سِيمَا الخَيْر'],
      ['نوع الحساب', 'جارٍ مخصص']] });
  ids.salary_disclosure = doc({ ...base, doc_type: 'salary_disclosure',
    title: `إفصاح أجور الإدارة العليا حسب الوظيفة — ${a.name}`, issuer: a.name, refNo: `SAL-${a.id}`, is_public: 1,
    rows: [['المدير التنفيذي', fmt(between(2400, 7200)) + ' د.ل/شهرياً'],
      ['المدير المالي', fmt(between(1800, 5200)) + ' د.ل/شهرياً'],
      ['مدير البرامج', fmt(between(1600, 4600)) + ' د.ل/شهرياً'],
      ['منهج الإفصاح', 'حسب الوظيفة لا حسب الاسم (المعيار 15)']] });
  return ids;
}

module.exports = { doc, seedLicenseeDocs, seedAssociationDocs, fmt };
