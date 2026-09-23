'use strict';
/**
 * التسجيل الذاتي من الواجهة العامة — نماذج (1) و(2) و(8)، ومتابعة البلاغات، ورموز التحقق، والحساب.
 * كل تسجيل يُنشئ حساباً مقيَّد النطاق وملفاً وطلباً بمراحله التسع، ويُولِّد إقرارات التسجيل
 * مستندات موقَّعة إلكترونياً بطابع زمني وعنوان المُقِرّ — فلا يبقى تعهد بلا إثبات.
 */
const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { db, UPLOAD_DIR } = require('../db');
const { requireAuth, log, passwordProblem, issueToken, loadUser, bcrypt } = require('../auth');
const R = require('../rules');
const REF = require('../reference');
const S = require('../services');
const EV = require('../seed-evidence');

const r = express.Router();
const REGIONS = ['الغربية', 'الشرقية', 'الجنوبية'];
const clean = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(e || ''));

// حدّ بسيط للتسجيل لكل عنوان: عشرة في الساعة
const regHits = new Map();
function regLimited(ip) {
  const now = Date.now(), h = (regHits.get(ip) || []).filter((t) => now - t < 3600e3);
  h.push(now); regHits.set(ip, h);
  return h.length > 10;
}

/** يولّد مستند إقرار موقّعاً إلكترونياً ويقيّده في الإثباتات */
function pledgeDoc({ owner_kind, owner_id, doc_type, title, issuer, rows, body, user_id, ip }) {
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const html = EV.page({ title, issuer, refNo: `${doc_type}-${owner_id}`, date: stamp.slice(0, 10),
    rows: [...rows, ['التوقيع الإلكتروني', `أُقِرّ من الحساب ${user_id || '—'} في ${stamp} UTC من العنوان ${ip || '—'}`]],
    body, stamp: 'موقّع إلكترونياً عند التسجيل' });
  const f = EV.write(UPLOAD_DIR, html);
  return db.prepare(`INSERT INTO documents (owner_kind, owner_id, doc_type, title, file_name, stored_name, mime_type,
      size_bytes, sha256, pages, uploaded_by, verification, issued_on) VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', date('now'))`)
    .run(owner_kind, owner_id, doc_type, title, `${title}.html`, f.stored_name, f.mime, f.size, f.sha256, f.pages, user_id || null).lastInsertRowid;
}

function commonAccountChecks(b) {
  if (!clean(b.contact_name)) return 'اسم المسؤول عن الملف مطلوب';
  if (!emailOk(b.email)) return 'البريد الإلكتروني غير صالح';
  if (db.prepare('SELECT 1 FROM users WHERE lower(email)=lower(?)').get(b.email.trim())) return 'البريد مسجَّل مسبقاً — سجّل الدخول بدلاً من ذلك';
  const pw = passwordProblem(b.password);
  if (pw) return pw;
  if (!REGIONS.includes(b.region)) return 'المنطقة غير صالحة';
  if (!clean(b.city)) return 'المدينة مطلوبة';
  return null;
}

// ---------- نموذج (1): طلب ترخيص — منشأة أو حرفي أو فنان أو مبدع ----------
r.post('/public/register/business', (req, res) => {
  if (regLimited(req.ip)) return res.status(429).json({ error: 'طلبات تسجيل كثيرة من هذا العنوان — حاول لاحقاً' });
  const b = req.body || {};
  const err = commonAccountChecks(b);
  if (err) return res.status(422).json({ error: err });
  for (const [k, lbl] of [['legal_name', 'الاسم القانوني'], ['commercial_reg', 'السجل التجاري أو ترخيص المزاولة'],
    ['tax_file_no', 'الملف الضريبي'], ['sector', 'القطاع']])
    if (!clean(b[k])) return res.status(422).json({ error: `${lbl} مطلوب (المادة 9)` });
  const kind = ['business', 'craftsman', 'artist', 'creative'].includes(b.applicant_kind) ? b.applicant_kind : 'business';
  const revenue = Number(b.annual_revenue), profit = Number(b.net_profit), level = Number(b.requested_level);
  if (!(revenue > 0)) return res.status(422).json({ error: 'الإيراد السنوي مطلوب لتحديد الشريحة (المادة 5)' });
  if (!Number.isFinite(profit)) return res.status(422).json({ error: 'صافي الربح قبل الضريبة مطلوب — ويجوز أن يكون صفراً أو سالباً' });
  if (!(level >= 1 && level <= 5)) return res.status(422).json({ error: 'المستوى المطلوب بين 1 و5' });
  const scope = ['enterprise', 'brand', 'product_line'].includes(b.scope_type) ? b.scope_type : 'enterprise';
  if (level === 5 && scope !== 'product_line')
    return res.status(422).json({ error: 'المستوى الخامس لمنتج أو خدمة أو خط إنتاج مخصص بمركز تكلفة مستقل (المادة 7)' });
  if (scope !== 'enterprise' && !clean(b.scope_desc)) return res.status(422).json({ error: 'حدّد النطاق صراحةً (المادة 8)' });
  // الإقرارات الإلزامية: قائمة الاستبعاد، والحد الأدنى للسلوك، وقبول التدقيق، وصدق البيانات
  for (const [k, lbl] of [['pledge_exclusion', 'الإقرار بعدم الوقوع في قائمة الاستبعاد (المادة 10)'],
    ['pledge_conduct', 'إقرار الحد الأدنى للسلوك — نموذج (3) (المادة 11)'],
    ['pledge_audit', 'تعهد قبول التدقيق والزيارات غير المعلنة (المادة 9/8)'],
    ['pledge_statement', 'البيان المعلن للالتزام المجتمعي (المادة 9/5)']])
    if (b[k] !== true) return res.status(422).json({ error: `يلزم: ${lbl}` });
  if (b.first_fiscal_year_complete === false && b.guarantee_ack !== true)
    return res.status(422).json({ error: 'المنشأة التي لم تُكمل سنة مالية تُقبل بشرط ضمان مصرفي أو كفالة بقيمة الالتزام المقدَّر (المادة 9/4)' });

  const tier = R.tierFor(revenue);
  const commitment = R.computeCommitment({ revenue, netProfit: profit, level, scopeNetProfit: Number(b.scope_net_profit) || null });
  const fees = R.computeFees({ revenue, level });

  const out = db.transaction(() => {
    const uid = db.prepare(`INSERT INTO users (full_name, email, phone, password_hash, region, job_title)
        VALUES (?,?,?,?,?,?)`).run(clean(b.contact_name), b.email.trim(), clean(b.contact_phone, 40),
      bcrypt.hashSync(b.password, 10), b.region, `مسؤول ملف العلامة — ${clean(b.legal_name)}`).lastInsertRowid;
    const lid = db.prepare(`INSERT INTO licensees (legal_name, trade_name, legal_form, applicant_kind, commercial_reg,
        tax_file_no, social_sec_no, sector, region, city, address, contact_name, contact_email, contact_phone, website,
        owner_user_id, tier_code, level, scope_type, scope_desc, annual_revenue, net_profit, fiscal_year,
        first_fiscal_year_complete, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`).run(
      clean(b.legal_name), clean(b.trade_name), clean(b.legal_form, 80), kind, clean(b.commercial_reg, 60),
      clean(b.tax_file_no, 60), clean(b.social_sec_no, 60), clean(b.sector, 80), b.region, clean(b.city, 80),
      clean(b.address), clean(b.contact_name), b.email.trim(), clean(b.contact_phone, 40), clean(b.website),
      uid, tier.code, level, scope, scope === 'enterprise' ? 'المنشأة كاملةً' : clean(b.scope_desc),
      revenue, profit, new Date().getFullYear() - 1, b.first_fiscal_year_complete === false ? 0 : 1).lastInsertRowid;
    db.prepare("INSERT INTO user_roles (user_id, role_code, scope_kind, scope_id) VALUES (?, 'PARTNER_BUSINESS', 'licensee', ?)").run(uid, lid);
    const lv = REF.LEVELS.find((x) => x.level === level);
    const base = { owner_kind: 'licensee', owner_id: lid, user_id: uid, ip: req.ip, issuer: clean(b.legal_name) };
    pledgeDoc({ ...base, doc_type: 'conduct_pledge', title: `نموذج (3) إقرار الحد الأدنى للسلوك — ${clean(b.legal_name)}`,
      rows: [['المُقِرّ', clean(b.contact_name)], ['الجهة', clean(b.legal_name)]],
      body: `<ol><li>عدم تشغيل من هم دون السن القانونية للعمل.</li><li>سداد أجور العاملين في مواعيدها.</li>
        <li>عدم التمييز في التوظيف على أساس المنطقة أو القبيلة أو الجنس أو الرأي.</li><li>الالتزام باشتراطات السلامة والصحة المهنية.</li>
        <li>عدم الإضرار المتعمّد بالبيئة.</li><li>صدق وكمال كل ما يُقدَّم إلى العلامة من بيانات ومستندات.</li></ol>` });
    pledgeDoc({ ...base, doc_type: 'audit_consent', title: `تعهد قبول التدقيق والزيارات غير المعلنة — ${clean(b.legal_name)}`,
      rows: [['الجهة', clean(b.legal_name)]], body: '<p>نتعهّد بتمكين وحدة التقييم والتحقق من الاطلاع والزيارة، بما يشمل الزيارات غير المعلنة (المادة 9/8).</p>' });
    pledgeDoc({ ...base, doc_type: 'level_declaration', title: `إقرار المستوى المطلوب والمبلغ المقدَّر — ${clean(b.legal_name)}`,
      rows: [['المستوى', `${lv.name} (${level})`], ['الشريحة', tier.name], ['الإيراد', revenue], ['صافي الربح', profit],
        ['قيمة النسبة', commitment.pct_amount], ['الأرضية', commitment.floor_amount], ['الالتزام المقدَّر', commitment.commitment_due]] });
    pledgeDoc({ ...base, doc_type: 'commitment_stmt', title: `بيان الالتزام المجتمعي — ${clean(b.legal_name)}`,
      rows: [['الالتزام', lv.claim]], body: `<p>${clean(b.commitment_statement, 2000) || 'تلتزم المنشأة بتخصيص النسبة المقررة لمستواها لأعمال خيرية وإنسانية وتنموية داخل ليبيا عبر منظمات معتمدة.'}</p>` });
    const app = S.createApplication({ app_type: 'license', subject_kind: 'licensee', subject_id: lid,
      applicant_user_id: uid, requested_level: level, self_registered: true });
    return { uid, lid, app };
  })();
  log({ user: loadUser(out.uid), ip: req.ip }, 'register.business', 'licensee', out.lid, `تسجيل ذاتي: ${clean(b.legal_name)}`);
  const user = loadUser(out.uid);
  res.status(201).json({ token: issueToken(user), user, licensee_id: out.lid, application: out.app,
    preview: { tier: tier.code, commitment, fees,
      audit: R.fieldAuditRate({ level, tierCode: tier.code }),
      missing_documents: db.prepare(`SELECT code, name_ar FROM document_types WHERE applies_to IN ('licensee','both') AND required=1
        AND code NOT IN (SELECT doc_type FROM documents WHERE owner_kind='licensee' AND owner_id=?)`).all(out.lid) },
    next: 'حمّل الإثباتات الإلزامية الناقصة من «إثباتاتي»، وسدِّد رسم الطلب — وتفحص وحدة التقييم الاستيفاء خلال عشرة أيام عمل.' });
});

// ---------- نموذج (2): طلب اعتماد منظمة مجتمع مدني — مجاناً ----------
r.post('/public/register/association', (req, res) => {
  if (regLimited(req.ip)) return res.status(429).json({ error: 'طلبات تسجيل كثيرة من هذا العنوان — حاول لاحقاً' });
  const b = req.body || {};
  const err = commonAccountChecks(b);
  if (err) return res.status(422).json({ error: err });
  for (const [k, lbl] of [['name', 'اسم المنظمة'], ['registration_no', 'رقم القيد النظامي'], ['focus_areas', 'مجالات العمل']])
    if (!clean(b[k])) return res.status(422).json({ error: `${lbl} مطلوب` });
  const n = (k) => Number(b[k]);
  for (const k of ['established_year', 'board_size', 'board_meetings_last_year', 'annual_revenue', 'total_expenses', 'admin_expenses', 'largest_budget_3y'])
    if (!Number.isFinite(n(k)) || n(k) < 0) return res.status(422).json({ error: 'البيانات الرقمية للمنظمة مطلوبة وغير سالبة' });
  if (n('admin_expenses') > n('total_expenses')) return res.status(422).json({ error: 'المصروفات الإدارية لا تتجاوز إجمالي المصروفات' });
  if (b.pledge_accuracy !== true || b.pledge_audit !== true)
    return res.status(422).json({ error: 'يلزم الإقرار بصدق البيانات وقبول التدقيق' });
  const ratio = n('total_expenses') > 0 ? R.round4(n('admin_expenses') / n('total_expenses')) : 0;
  const cls = R.classifyAdminRatio(ratio);
  const year = new Date().getFullYear();
  // فحص مبدئي للمعايير الكمية — لا يمنع التقديم، لكنه يُعلِم المنظمة بما سيُقيَّم (المادة 13)
  const warnings = [];
  if (year - n('established_year') < 2) warnings.push('المعيار 2: سنتان ماليتان كاملتان موثقتان على الأقل');
  if (n('annual_revenue') < 30000) warnings.push('المعيار 3: إيرادات سنوية لا تقل عن 30,000 دينار');
  if (n('board_size') < 5) warnings.push('المعيار 4: خمسة أعضاء مجلس على الأقل لهم حق التصويت');
  if (n('board_meetings_last_year') < 3) warnings.push('المعيار 5: ثلاثة اجتماعات سنوياً على الأقل');
  if (ratio > 0.25) warnings.push(`المعيار 8: النسبة الإدارية ${(ratio * 100).toFixed(1)}% تتجاوز سقف 25% — لا يُمنح الاعتماد`);
  if (Number(b.fundraising_cost_ratio) > 0.30) warnings.push('المعيار 9: كلفة جمع التبرعات تتجاوز 30%');
  if (cls.flag) warnings.push(cls.flag);

  const out = db.transaction(() => {
    const uid = db.prepare(`INSERT INTO users (full_name, email, phone, password_hash, region, job_title) VALUES (?,?,?,?,?,?)`)
      .run(clean(b.contact_name), b.email.trim(), clean(b.contact_phone, 40), bcrypt.hashSync(b.password, 10), b.region,
        `المنسّق المفوَّض — ${clean(b.name)}`).lastInsertRowid;
    const aid = db.prepare(`INSERT INTO associations (name, registration_no, registration_authority, region, city, address,
        established_year, contact_name, contact_email, contact_phone, owner_user_id, board_size, paid_board_members,
        board_meetings_last_year, annual_revenue, total_expenses, admin_expenses, admin_expense_ratio, admin_class,
        fundraising_cost_ratio, largest_budget_3y, absorption_cap, audit_tier, focus_areas, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'draft')`).run(
      clean(b.name), clean(b.registration_no, 60), clean(b.registration_authority), b.region, clean(b.city, 80), clean(b.address),
      n('established_year'), clean(b.contact_name), b.email.trim(), clean(b.contact_phone, 40), uid, n('board_size'),
      Number(b.paid_board_members) || 0, n('board_meetings_last_year'), n('annual_revenue'), n('total_expenses'),
      n('admin_expenses'), ratio, cls.code, Number(b.fundraising_cost_ratio) || null, n('largest_budget_3y'),
      n('largest_budget_3y') * 2, R.auditTierFor(n('annual_revenue')), clean(b.focus_areas)).lastInsertRowid;
    db.prepare("INSERT INTO user_roles (user_id, role_code, scope_kind, scope_id) VALUES (?, 'PARTNER_ASSOCIATION', 'association', ?)").run(uid, aid);
    pledgeDoc({ owner_kind: 'association', owner_id: aid, user_id: uid, ip: req.ip, issuer: clean(b.name),
      doc_type: 'code_of_conduct', title: `إقرار صدق البيانات وقبول التدقيق — ${clean(b.name)}`,
      rows: [['المنظمة', clean(b.name)], ['المنسّق', clean(b.contact_name)], ['النسبة الإدارية المعلنة', `${(ratio * 100).toFixed(1)}% — ${cls.name}`]],
      body: '<p>نُقرّ بصحة البيانات المقدَّمة، ونقبل التدقيق المكتبي والميداني، ونتعهد بتقديم إقرار استلام وتقرير أثر عن كل مساهمة ترد عبر العلامة.</p>' });
    const app = S.createApplication({ app_type: 'accreditation', subject_kind: 'association', subject_id: aid,
      applicant_user_id: uid, self_registered: true });
    return { uid, aid, app };
  })();
  log({ user: loadUser(out.uid), ip: req.ip }, 'register.association', 'association', out.aid, `تسجيل ذاتي: ${clean(b.name)}`);
  const user = loadUser(out.uid);
  res.status(201).json({ token: issueToken(user), user, association_id: out.aid, application: out.app,
    preview: { admin_ratio: ratio, admin_class: cls, absorption_cap: n('largest_budget_3y') * 2,
      audit_tier: R.auditTierFor(n('annual_revenue')), warnings, fees: 'صفر — الاعتماد مجاني في كل مرحلة (المادة 12)' },
    next: 'حمّل الإثباتات الإلزامية للمعايير الخمسة عشر من «إثباتاتي» — وتفحص وحدة التقييم الاستيفاء خلال عشرة أيام عمل.' });
});

// ---------- نموذج (8): ترشيح مراقب ----------
r.post('/public/register/observer', (req, res) => {
  if (regLimited(req.ip)) return res.status(429).json({ error: 'طلبات كثيرة — حاول لاحقاً' });
  const b = req.body || {};
  if (!clean(b.person_name) || !clean(b.nominating_entity)) return res.status(422).json({ error: 'اسم المراقب والجهة المرشِّحة مطلوبان' });
  if (!emailOk(b.contact_email)) return res.status(422).json({ error: 'بريد التواصل غير صالح' });
  if (!['public', 'private', 'civil', 'academic', 'media'].includes(b.entity_kind)) return res.status(422).json({ error: 'قطاع الجهة غير صالح' });
  if (b.pledge_confidentiality !== true) return res.status(422).json({ error: 'يلزم التوقيع على إقرار السرّية والحياد (المادة 34/4)' });
  if (b.pledge_costs !== true) return res.status(422).json({ error: 'يلزم الإقرار بتحمّل مصاريف المشاركة دون أي حق إضافي في التأثير (المادة 34/5)' });
  const id = db.prepare(`INSERT INTO observers (reference, person_name, nominating_entity, entity_kind, sector, cycle,
      status, contact_email, motivation) VALUES (?,?,?,?,?,?, 'nominated', ?, ?)`).run(S.nextRef('OBS', 'observers'),
    clean(b.person_name), clean(b.nominating_entity), b.entity_kind, clean(b.sector, 80), String(new Date().getFullYear()),
    b.contact_email.trim(), clean(b.motivation, 1500)).lastInsertRowid;
  const doc = pledgeDoc({ owner_kind: 'observer', owner_id: id, doc_type: 'observer_pledge', ip: req.ip, issuer: clean(b.nominating_entity),
    title: `نموذج (8) إقرار سرّية وحياد المراقب — ${clean(b.person_name)}`,
    rows: [['المراقب', clean(b.person_name)], ['الجهة المرشِّحة', clean(b.nominating_entity)], ['حق التصويت', 'لا يوجد'],
      ['الاطلاع على الملفات الفردية', 'محظور']] });
  db.prepare('UPDATE observers SET pledge_doc_id=? WHERE id=?').run(doc, id);
  S.notify({ role_code: 'BOARD_CHAIR', title: 'ترشيح مراقب جديد عبر البوابة', body: `${clean(b.person_name)} — ${clean(b.nominating_entity)}`, link: '#/observers' });
  const o = db.prepare('SELECT reference, status, cycle FROM observers WHERE id=?').get(id);
  const admitted = db.prepare("SELECT COUNT(*) n FROM observers WHERE status='admitted' AND cycle=?").get(o.cycle).n;
  res.status(201).json({ ...o, note: `قُيّد الترشيح في سجل المراقبين. المقبولون حالياً ${admitted} من خمسة في الدورة، ولا يمثّل قطاعٌ واحدٌ أكثر من مراقبَين (المادة 34/3).` });
});

// ---------- متابعة البلاغ برقمه ورمز المتابعة ----------
r.get('/public/complaints/track', (req, res) => {
  const { reference, code } = req.query;
  const c = db.prepare(`SELECT reference, status, filed_at, closed_at, resolution, subject_kind, triggered_audit_id, tracking_code
      FROM complaints WHERE reference=?`).get(String(reference || '').trim().toUpperCase());
  // رسالة واحدة للحالتين حتى لا يُستدلّ على وجود المرجع
  if (!c || !c.tracking_code || c.tracking_code !== String(code || '').trim().toUpperCase())
    return res.status(404).json({ error: 'لا بلاغ بهذا الرقم ورمز المتابعة' });
  const labels = { received: 'مستلَم', triage: 'قيد الفرز', investigating: 'قيد التحقيق',
    substantiated: 'ثابت — اتُّخذ الإجراء', unsubstantiated: 'لم يثبت', closed: 'مغلق' };
  res.json({ reference: c.reference, status: c.status, status_label: labels[c.status] || c.status, filed_at: c.filed_at,
    closed_at: c.closed_at, audit_opened: !!c.triggered_audit_id,
    resolution: ['substantiated', 'unsubstantiated', 'closed'].includes(c.status) ? c.resolution : null });
});

// ---------- رمز QR للتحقق (المادة 36) ----------
r.get('/public/qr/:key.svg', async (req, res) => {
  const key = req.params.key;
  const ok = db.prepare('SELECT 1 FROM licensees WHERE license_no=? OR qr_token=?').get(key, key)
    || db.prepare('SELECT 1 FROM associations WHERE accreditation_no=? OR qr_token=?').get(key, key);
  if (!ok) return res.status(404).json({ error: 'لا قيد بهذا الرقم' });
  // الرمز يوجّه إلى صفحة السجل التابعة للأمانة حصراً، لا إلى موقع المرخَّص له (المادة 36/2)
  const base = process.env.SEMA_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  const svg = await QRCode.toString(`${base}/#/verify/${encodeURIComponent(key)}`,
    { type: 'svg', errorCorrectionLevel: 'M', margin: 1, color: { dark: '#0B4533', light: '#FFFFFF' } });
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(svg);
});

// ---------- الحساب ----------
r.post('/auth/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  const row = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(current_password || ''), row.password_hash)) return res.status(422).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  const pw = passwordProblem(new_password);
  if (pw) return res.status(422).json({ error: pw });
  if (current_password === new_password) return res.status(422).json({ error: 'اختر كلمة مرور مختلفة' });
  // الطابع الزمني بدقة الثانية: الرموز الصادرة قبل التغيير تسقط، ويُصدَر رمز جديد بعده
  db.prepare("UPDATE users SET password_hash=?, password_changed_at=datetime('now','-1 second'), must_reset=0 WHERE id=?")
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  log(req, 'user.password', 'user', req.user.id, 'تغيير كلمة المرور');
  res.json({ ok: true, token: issueToken(loadUser(req.user.id)), note: 'تغيّرت كلمة المرور وأُلغيت الجلسات الأخرى.' });
});

r.patch('/auth/profile', requireAuth, (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE users SET phone=COALESCE(?,phone), job_title=COALESCE(?,job_title) WHERE id=?')
    .run(clean(b.phone, 40), clean(b.job_title, 120), req.user.id);
  log(req, 'user.profile', 'user', req.user.id, 'تحديث الملف الشخصي');
  res.json(loadUser(req.user.id));
});

r.get('/auth/pledges/mine', requireAuth, (req, res) => {
  res.json({ rows: db.prepare('SELECT * FROM integrity_pledges WHERE user_id=? ORDER BY signed_at DESC').all(req.user.id) });
});

module.exports = r;
