(function(){
'use strict';
/* ===== التسجيل الذاتي · المشاورات · متابعة البلاغ · الشهادة · المقترحات · المهام الآلية · الحساب ===== */
const { S, api, E, num, money, pct, dt, yr, today, L, lb, tag, toast, modal, route, render, go, has, LOGO } = window.SEMA;
const { shell, dataTable, stat, alertBox, legal, card, kv, tabs } = window.UI;
const mount = (fn) => setTimeout(fn, 0);
const pub = (html, active) => window.UI.pubShell(html, active);

const fld = (name, label, { type = 'text', req = false, val = '', ph = '', opts, hint, step, wide } = {}) => {
  const input = opts
    ? `<select name="${name}" ${req ? 'required' : ''}>${opts.map(([v, l]) =>
        `<option value="${E(v)}" ${String(v) === String(val) ? 'selected' : ''}>${E(l)}</option>`).join('')}</select>`
    : type === 'textarea'
      ? `<textarea name="${name}" rows="3" ${req ? 'required' : ''} placeholder="${E(ph)}">${E(val)}</textarea>`
      : `<input name="${name}" type="${type}" value="${E(val)}" placeholder="${E(ph)}" ${req ? 'required' : ''} ${step ? `step="${step}"` : ''}>`;
  return `<div class="fld" ${wide ? 'style="grid-column:1/-1"' : ''}><label>${E(label)}${req ? ' *' : ''}</label>${input}
    ${hint ? `<span class="hint">${E(hint)}</span>` : ''}</div>`;
};
const check = (name, label) => `<label class="pledge"><input type="checkbox" name="${name}" required><span>${label}</span></label>`;
const formData = (f) => {
  const o = {};
  for (const el of f.querySelectorAll('[name]')) o[el.name] = el.type === 'checkbox' ? el.checked : (el.value === '' ? null : el.value);
  return o;
};
const REGIONS = [['الغربية', 'الغربية'], ['الشرقية', 'الشرقية'], ['الجنوبية', 'الجنوبية']];

// ================= التسجيل الذاتي =================
route('register', async (r) => {
  if (S.user) return pub(`<div class="pub">${alertBox('info', 'أنت مسجَّل الدخول',
    'لتسجيل جهة أخرى سجّل الخروج أولاً. ويمكنك تقديم طلبات جديدة لملفك من «طلباتي».')}
    <a class="btn primary" href="#/dashboard">لوحة العمل</a></div>`, 'register');
  const html = pub(`<div class="pub">
    <div class="page-hd"><div><h1>التسجيل في علامة «سِيمَا الخَيْر»</h1>
      <p class="sub">تسجيل ذاتي يُنشئ حسابك وملفك وطلبك بمراحله التسع — ثم تُحمِّل الإثباتات من بوابتك.</p></div></div>
    <div class="card"><div id="regtabs"></div></div></div>`, 'register');
  mount(() => tabs(document.getElementById('regtabs'), [
    ['biz', 'منشأة أو حرفي أو فنان — نموذج (1)', null, (el) => { el.innerHTML = bizForm(); wireBiz(el); }],
    ['org', 'منظمة مجتمع مدني — نموذج (2)', null, (el) => { el.innerHTML = orgForm(); wireOrg(el); }],
    ['obs', 'ترشيح مراقب — نموذج (8)', null, (el) => { el.innerHTML = obsForm(); wireObs(el); }],
  ], r.params[0] || 'biz'));
  return html;
});

function bizForm() {
  const levels = (S.ref?.levels || []).map((l) => [l.level, `المستوى ${l.level} — ${l.name_ar} ${l.profit_pct ? `(${l.profit_pct * 100}%)` : '(الوَقفية)'}`]);
  return `<div class="card-bd"><form id="bf">
    ${alertBox('info', 'شروط الدخول (المادة 9)', 'سجل تجاري أو ترخيص مزاولة ساري · ملف ضريبي ساري وشهادة عدم مديونية · انتظام الضمان الاجتماعي · سنة مالية كاملة (أو ضمان مصرفي) · بيان التزام معلن · إقرار المستوى · سداد رسم الطلب · تعهد قبول التدقيق والزيارات غير المعلنة.')}
    <h4>بيانات المنشأة</h4><div class="form-grid">
      ${fld('legal_name', 'الاسم القانوني', { req: true })}
      ${fld('trade_name', 'الاسم التجاري')}
      ${fld('applicant_kind', 'نوع الطالب', { opts: Object.entries(L.applicantKind) })}
      ${fld('legal_form', 'الشكل القانوني', { ph: 'شركة ذات مسؤولية محدودة' })}
      ${fld('commercial_reg', 'السجل التجاري أو ترخيص المزاولة', { req: true })}
      ${fld('tax_file_no', 'رقم الملف الضريبي', { req: true })}
      ${fld('social_sec_no', 'رقم الضمان الاجتماعي')}
      ${fld('sector', 'القطاع', { req: true, opts: [['', '— اختر —'], ...(S.ref?.sectors || []).map((s) => [s, s])] })}
      ${fld('region', 'المنطقة', { req: true, opts: REGIONS })}
      ${fld('city', 'المدينة', { req: true })}
      ${fld('address', 'العنوان')}
      ${fld('website', 'الموقع الإلكتروني')}
    </div>
    <h4 style="margin-top:14px">المستوى والنطاق والأرقام</h4><div class="form-grid">
      ${fld('annual_revenue', 'الإيراد السنوي (د.ل)', { type: 'number', req: true, step: '1000' })}
      ${fld('net_profit', 'صافي الربح قبل الضريبة (د.ل)', { type: 'number', req: true, step: '1000', hint: 'يجوز صفراً أو سالباً — الأرضية تسري' })}
      ${fld('requested_level', 'المستوى المطلوب', { req: true, opts: levels, val: 2 })}
      ${fld('scope_type', 'نطاق الترخيص', { opts: Object.entries(L.scopeType) })}
      ${fld('scope_desc', 'وصف النطاق', { ph: 'اسم العلامة أو خط المنتج إن لم يكن المنشأة كاملةً' })}
      ${fld('scope_net_profit', 'صافي ربح النطاق المخصص', { type: 'number', hint: 'للمستوى الخامس فقط' })}
      ${fld('first_fiscal_year_complete', 'أكملت المنشأة سنة مالية كاملة؟', { opts: [['1', 'نعم'], ['0', 'لا — سأقدّم ضماناً مصرفياً']] })}
    </div>
    <div id="bprev" style="margin-top:12px"></div>
    <h4 style="margin-top:14px">الحساب والتواصل</h4><div class="form-grid">
      ${fld('contact_name', 'اسم المسؤول عن الملف', { req: true })}
      ${fld('email', 'البريد الإلكتروني', { type: 'email', req: true })}
      ${fld('contact_phone', 'الهاتف')}
      ${fld('password', 'كلمة المرور', { type: 'password', req: true, hint: 'ثمانية أحرف على الأقل تجمع حروفاً وأرقاماً' })}
      ${fld('commitment_statement', 'بيان الالتزام المجتمعي المعلن', { type: 'textarea', wide: true,
        ph: 'تلتزم المنشأة بتخصيص… لأعمال خيرية وإنسانية وتنموية داخل ليبيا' })}
    </div>
    <h4 style="margin-top:14px">الإقرارات — تُحفظ مستندات موقّعة إلكترونياً في ملفك</h4>
    ${check('pledge_exclusion', 'أُقرّ بأن المنشأة ومالكيها ومديريها غير واقعين في قائمة الاستبعاد: التبغ والنيكوتين، الميسر، السلاح، قوائم العقوبات، أحكام الفساد وغسل الأموال وتهريب المحروقات والاتجار بالبشر (المادة 10).')}
    ${check('pledge_conduct', 'أوقّع إقرار الحد الأدنى للسلوك — نموذج (3): عدم تشغيل القُصّر، سداد الأجور في مواعيدها، عدم التمييز، السلامة المهنية، عدم الإضرار بالبيئة، صدق البيانات (المادة 11).')}
    ${check('pledge_audit', 'أتعهّد بتمكين وحدة التقييم من الاطلاع والزيارة، بما يشمل الزيارات غير المعلنة (المادة 9/8).')}
    ${check('pledge_statement', 'أُقرّ بأن بيان الالتزام المجتمعي معتمد من الإدارة العليا وسيُنشر (المادة 9/5)، وبأن رسم الطلب غير مستردّ في جميع الأحوال (المادة 34/1).')}
    <label class="pledge" id="gack" style="display:none"><input type="checkbox" name="guarantee_ack"><span>أتعهّد بتقديم ضمان مصرفي أو كفالة من شريك مؤسس بقيمة الالتزام المقدَّر (المادة 9/4).</span></label>
    <div class="btn-row" style="margin-top:14px"><button class="btn primary">تقديم الطلب</button></div>
    <div id="berr" style="margin-top:10px"></div></form></div>`;
}
function wireBiz(el) {
  const f = el.querySelector('#bf');
  const prev = el.querySelector('#bprev');
  const refresh = async () => {
    const b = formData(f);
    el.querySelector('#gack').style.display = b.first_fiscal_year_complete === '0' ? 'flex' : 'none';
    if (!b.annual_revenue) { prev.innerHTML = ''; return; }
    try {
      const d = await api('/public/calculator', { method: 'POST', body: { revenue: Number(b.annual_revenue),
        net_profit: Number(b.net_profit || 0), level: Number(b.requested_level), scope_net_profit: b.scope_net_profit ? Number(b.scope_net_profit) : null } });
      prev.innerHTML = `<div class="grid g4">
        ${stat('الشريحة', E(d.commitment.tier_code))}
        ${stat('الالتزام السنوي المقدَّر', money(d.commitment.commitment_due), E(d.commitment.basis_note), 'gold')}
        ${stat('رسم الطلب (غير مستردّ)', money(d.fees.application_fee))}
        ${stat('الرسم السنوي', money(d.fees.annual_fee), d.fees.capped ? 'مطبَّق السقف المطلق' : '')}</div>`;
    } catch { prev.innerHTML = ''; }
  };
  f.addEventListener('change', refresh);
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(f);
    ['annual_revenue', 'net_profit', 'requested_level', 'scope_net_profit'].forEach((k) => { if (b[k] != null) b[k] = Number(b[k]); });
    b.first_fiscal_year_complete = b.first_fiscal_year_complete !== '0';
    try {
      const r = await api('/public/register/business', { method: 'POST', body: b });
      await onRegistered(r, 'licensee');
    } catch (er) { el.querySelector('#berr').innerHTML = alertBox('danger', 'تعذّر التسجيل', E(er.message)); }
  };
}

function orgForm() {
  return `<div class="card-bd"><form id="of">
    ${alertBox('ok', 'الاعتماد مجاني بالكامل', 'لا تُحصَّل من منظمة المجتمع المدني أي رسوم مقابل التقديم أو التقييم أو الاعتماد أو التجديد أو القيد في السجل (المادة 12).')}
    <h4>بيانات المنظمة</h4><div class="form-grid">
      ${fld('name', 'اسم المنظمة', { req: true })}
      ${fld('registration_no', 'رقم القيد النظامي', { req: true })}
      ${fld('registration_authority', 'جهة القيد', { val: 'وزارة الشؤون الاجتماعية — مكتب المجتمع المدني' })}
      ${fld('established_year', 'سنة التأسيس', { type: 'number', req: true })}
      ${fld('region', 'المنطقة', { req: true, opts: REGIONS })}
      ${fld('city', 'المدينة', { req: true })}
      ${fld('address', 'العنوان')}
      ${fld('focus_areas', 'مجالات العمل', { req: true, ph: 'صحة · تعليم · مياه' })}
    </div>
    <h4 style="margin-top:14px">الحوكمة والمالية — تُقاس بها المعايير الخمسة عشر</h4><div class="form-grid">
      ${fld('board_size', 'أعضاء المجلس ذوو حق التصويت', { type: 'number', req: true, hint: 'المعيار 4: خمسة على الأقل' })}
      ${fld('paid_board_members', 'الأعضاء المأجورون', { type: 'number', val: 0, hint: 'المعيار 6' })}
      ${fld('board_meetings_last_year', 'اجتماعات المجلس في السنة الماضية', { type: 'number', req: true, hint: 'المعيار 5: ثلاثة على الأقل' })}
      ${fld('annual_revenue', 'الإيراد السنوي (د.ل)', { type: 'number', req: true, hint: 'المعيار 3: 30,000 على الأقل' })}
      ${fld('total_expenses', 'إجمالي المصروفات', { type: 'number', req: true })}
      ${fld('admin_expenses', 'المصروفات الإدارية والتسييرية والدعائية', { type: 'number', req: true, hint: 'المعيار 8: 25% سقفاً' })}
      ${fld('fundraising_cost_ratio', 'نسبة كلفة جمع التبرعات', { type: 'number', step: '0.01', hint: 'عشرية — المعيار 9: 0.30 سقفاً' })}
      ${fld('largest_budget_3y', 'أكبر ميزانية سنوية في ثلاث سنوات', { type: 'number', req: true, hint: 'المعيار 10: سقف الاستيعاب ضعفها' })}
    </div>
    <div id="oprev" style="margin-top:12px"></div>
    <h4 style="margin-top:14px">الحساب والتواصل</h4><div class="form-grid">
      ${fld('contact_name', 'اسم المنسّق المفوَّض', { req: true })}
      ${fld('email', 'البريد الإلكتروني', { type: 'email', req: true })}
      ${fld('contact_phone', 'الهاتف')}
      ${fld('password', 'كلمة المرور', { type: 'password', req: true, hint: 'ثمانية أحرف على الأقل تجمع حروفاً وأرقاماً' })}
    </div>
    <h4 style="margin-top:14px">الإقرارات</h4>
    ${check('pledge_accuracy', 'أُقرّ بصحة البيانات المقدَّمة وكمالها، وأعلم أن تقديم بيانات غير صحيحة عمداً يوجب سحب الاعتماد (المادة 32).')}
    ${check('pledge_audit', 'نقبل التدقيق المكتبي والميداني، ونتعهّد بإقرار استلام وتقرير أثر عن كل مساهمة ترد عبر العلامة (المادة 23).')}
    <div class="btn-row" style="margin-top:14px"><button class="btn primary">تقديم طلب الاعتماد</button></div>
    <div id="oerr" style="margin-top:10px"></div></form></div>`;
}
function wireOrg(el) {
  const f = el.querySelector('#of');
  f.addEventListener('input', () => {
    const b = formData(f);
    const t = Number(b.total_expenses), a = Number(b.admin_expenses);
    if (!(t > 0) || !(a >= 0)) { el.querySelector('#oprev').innerHTML = ''; return; }
    const ratio = a / t;
    const cls = (S.ref?.admin_classes || []).find((c) => ratio >= c.min_pct && (c.max_pct == null || ratio < c.max_pct));
    el.querySelector('#oprev').innerHTML = `<div class="grid g4">
      ${stat('النسبة الإدارية', pct(ratio), E(cls?.name_ar || ''), ratio > 0.25 ? 'danger' : ratio >= 0.18 ? 'warn' : '')}
      ${stat('سقف الاستيعاب', money((Number(b.largest_budget_3y) || 0) * 2), '200% من أكبر ميزانية')}</div>
      ${ratio > 0.25 ? alertBox('danger', 'تتجاوز سقف 25%', 'يجوز التقديم، لكن لا يُمنح الاعتماد بهذه النسبة (المادة 15).') : ''}
      ${ratio < 0.05 ? alertBox('warn', 'نسبة دون 5%', 'تستوجب فحصاً إضافياً من وحدة التقييم (المادة 15).') : ''}`;
  });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const b = formData(f);
    ['established_year', 'board_size', 'paid_board_members', 'board_meetings_last_year', 'annual_revenue',
      'total_expenses', 'admin_expenses', 'fundraising_cost_ratio', 'largest_budget_3y'].forEach((k) => { if (b[k] != null) b[k] = Number(b[k]); });
    try {
      const r = await api('/public/register/association', { method: 'POST', body: b });
      await onRegistered(r, 'association');
    } catch (er) { el.querySelector('#oerr').innerHTML = alertBox('danger', 'تعذّر التسجيل', E(er.message)); }
  };
}

function obsForm() {
  return `<div class="card-bd"><form id="obf">
    ${legal('المادة (34): لكل صاحب مصلحة من القطاع العام أو الخاص أو الأهلي أن يرشّح مراقباً لحضور اجتماعات مجلس الأمناء. للمراقب حق الحضور والمداخلة، ولا صوت له ولا حق في الاطلاع على ملف فردي قيد التقييم. ولا يزيد المقبولون في الدورة على خمسة، ولا يمثّل قطاعٌ واحدٌ أكثر من مراقبَين.')}
    <div class="form-grid">
      ${fld('person_name', 'اسم المراقب المرشَّح', { req: true })}
      ${fld('nominating_entity', 'الجهة المرشِّحة', { req: true })}
      ${fld('entity_kind', 'قطاع الجهة', { req: true, opts: Object.entries(L.entityKind) })}
      ${fld('sector', 'وصف القطاع')}
      ${fld('contact_email', 'بريد التواصل', { type: 'email', req: true })}
      ${fld('motivation', 'دواعي الترشيح', { type: 'textarea', wide: true })}
    </div>
    ${check('pledge_confidentiality', 'يوقّع المرشَّح إقرار السرّية والحياد، ويلتزم بأحكام تعارض المصالح (المادة 34/4).')}
    ${check('pledge_costs', 'نتحمّل مصاريف المشاركة، ولا يترتب على ذلك أي حق إضافي في التأثير على القرار (المادة 34/5).')}
    <div class="btn-row" style="margin-top:14px"><button class="btn primary">تقديم الترشيح</button></div>
    <div id="obres" style="margin-top:10px"></div></form></div>`;
}
function wireObs(el) {
  const f = el.querySelector('#obf');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/public/register/observer', { method: 'POST', body: formData(f) });
      el.querySelector('#obres').innerHTML = alertBox('ok', `قُيّد الترشيح برقم ${r.reference}`, E(r.note));
      f.reset();
    } catch (er) { el.querySelector('#obres').innerHTML = alertBox('danger', 'تعذّر الترشيح', E(er.message)); }
  };
}

async function onRegistered(r, kind) {
  S.token = r.token; localStorage.setItem('sema_token', r.token);
  S.user = r.user;
  S.rbac = await api('/rbac').catch(() => null);
  S.notif = await api('/notifications').catch(() => ({ rows: [], unread: 0 }));
  const p = r.preview || {};
  const body = kind === 'licensee'
    ? `${alertBox('ok', `قُدِّم الطلب ${r.application.reference}`, E(r.next))}
       ${kv([['الشريحة', E(p.tier)], ['الالتزام السنوي المقدَّر', money(p.commitment?.commitment_due)],
         ['رسم الطلب', money(p.fees?.application_fee)], ['نسبة التدقيق الميداني', `${pct(p.audit?.rate, 0)} — ${E(p.audit?.reason || '')}`]])}
       ${p.missing_documents?.length ? `<h4 style="margin-top:12px">إثباتات إلزامية ما زالت ناقصة</h4><ul>${p.missing_documents.map((d) => `<li>${E(d.name_ar)}</li>`).join('')}</ul>` : ''}`
    : `${alertBox('ok', `قُدِّم طلب الاعتماد ${r.application.reference}`, E(r.next))}
       ${kv([['النسبة الإدارية', `${pct(p.admin_ratio)} — ${E(p.admin_class?.name || '')}`], ['سقف الاستيعاب', money(p.absorption_cap)],
         ['مستوى المراجعة المطلوب', E(p.audit_tier)], ['الرسوم', E(p.fees)]])}
       ${p.warnings?.length ? alertBox('warn', 'ما ستقيّمه الوحدة بعناية', p.warnings.map(E).join('<br>')) : ''}`;
  modal({ title: 'مرحباً بك في بوابة «سِيمَا الخَيْر»', wide: true, body,
    actions: [{ label: 'تحميل الإثباتات الآن', cls: 'primary', run: (_e, close) => { close(); go('documents'); } },
      { label: 'لوحة العمل', run: (_e, close) => { close(); go('dashboard'); } }] });
  go('dashboard');
}

// ================= متابعة البلاغ =================
route('track', async (r) => {
  const html = pub(`<div class="pub">
    <div class="page-hd"><div><h1>متابعة بلاغ</h1>
      <p class="sub">بالرقم المرجعي ورمز المتابعة اللذين ظهرا عند تقديم البلاغ — دون الإفصاح عن هويتك.</p></div></div>
    ${card('', `<form id="tf"><div class="form-grid">
      ${fld('reference', 'الرقم المرجعي', { req: true, ph: 'CMP-00012', val: r.query.reference || '' })}
      ${fld('code', 'رمز المتابعة', { req: true, ph: 'A1B2C3D4' })}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary">استعلام</button></div></form>
      <div id="tout" style="margin-top:12px"></div>`)}</div>`, 'track');
  mount(() => {
    document.getElementById('tf').onsubmit = async (e) => {
      e.preventDefault();
      const b = formData(e.target);
      const out = document.getElementById('tout');
      try {
        const d = await api(`/public/complaints/track?reference=${encodeURIComponent(b.reference)}&code=${encodeURIComponent(b.code)}`);
        out.innerHTML = kv([['الرقم المرجعي', `<span class="mono">${E(d.reference)}</span>`], ['الحالة', `<b>${E(d.status_label)}</b>`],
          ['تاريخ التقديم', dt(d.filed_at)], ['فُتح تدقيق ميداني', d.audit_opened ? 'نعم — 100% وفوري (المادة 25)' : 'لا'],
          ['تاريخ الإغلاق', dt(d.closed_at)], ['الخلاصة', E(d.resolution || '—')]]);
      } catch (er) { out.innerHTML = alertBox('danger', 'لم يُعثر على البلاغ', E(er.message)); }
    };
  });
  return html;
});

// ================= المشاورات العامة =================
route('consultations', async () => {
  const d = await api('/public/consultations');
  const KIND = { standard: 'معيار', fees: 'رسوم', floors: 'أرضيات', bylaws: 'النظام الداخلي', interpretation: 'تفسير ملزم' };
  const STAT = { consultation: ['مفتوحة للمداخلات', 'ok'], consultation_closed: ['أُغلقت المشاورة', 'warn'],
    submitted_to_board: ['مرفوعة للقرار', 'info'], approved: ['اعتُمد', 'ok'], rejected: ['رُفض', 'danger'] };
  return pub(`<div class="pub">
    <div class="page-hd"><div><h1>المشاورات العامة على المعايير</h1><p class="sub">${E(d.note)}</p></div></div>
    ${d.rows.length ? d.rows.map((p) => `<div class="card"><div class="card-hd">
      <span class="tag gold">${E(KIND[p.kind] || p.kind)}</span><h3>${E(p.title)}</h3>
      <span class="tag ${(STAT[p.status] || [])[1] || ''}">${E((STAT[p.status] || [p.status])[0])}</span>
      <span class="muted mono">${E(p.reference)}</span></div>
      <div class="card-bd">
        <p><b>${E(p.summary)}</b></p>
        <p style="font-family:var(--fs);white-space:pre-wrap">${E(p.body)}</p>
        ${kv([['السند', E(p.article_ref || '—')], ['مدة المشاورة', `${dt(p.consultation_start)} — ${dt(p.consultation_end)}`],
          p.open ? ['المتبقي', `<b>${num(p.days_left)} يوماً</b>`] : null,
          p.effective_from ? ['تاريخ النفاذ', dt(p.effective_from)] : null])}
        ${p.response_summary ? alertBox('info', 'ملخص المداخلات وردود اللجنة (المادة 19/3)', E(p.response_summary)) : ''}
        <h4 style="margin-top:12px">المداخلات (${num(p.comments.length)})</h4>
        ${p.comments.map((c) => `<div class="legal"><b>${E(c.author_name)}</b>${c.organization ? ` — ${E(c.organization)}` : ''}
          <span class="muted"> · ${dt(c.submitted_at)}</span><div>${E(c.body)}</div>
          ${c.response ? `<div style="margin-top:6px;color:var(--green)"><b>رد اللجنة:</b> ${E(c.response)}</div>` : ''}</div>`).join('') || '<p class="muted">لا مداخلات بعد.</p>'}
        ${p.open ? `<form class="cmt" data-id="${p.id}" style="margin-top:12px"><div class="form-grid">
          ${fld('author_name', 'الاسم', { req: true })}
          ${fld('organization', 'الجهة')}
          ${fld('author_kind', 'الصفة', { opts: [['public', 'مواطن'], ['licensee', 'مرخَّص له'], ['association', 'منظمة مجتمع مدني'], ['expert', 'خبير'], ['government', 'جهة حكومية']] })}
          ${fld('body', 'المداخلة', { type: 'textarea', req: true, wide: true })}</div>
          <div class="btn-row" style="margin-top:10px"><button class="btn primary">إرسال المداخلة</button></div></form>` : ''}
      </div></div>`).join('') : '<div class="empty"><b>لا مشاورات منشورة</b></div>'}
  </div>`, 'consultations') + mountComments();
});
function mountComments() {
  mount(() => document.querySelectorAll('form.cmt').forEach((f) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await api(`/public/consultations/${f.dataset.id}/comments`, { method: 'POST', body: formData(f) });
        toast(r.note); render(); } catch (er) { toast(er.message, 'danger'); }
    };
  }));
  return '';
}

// ================= الشهادة القابلة للطباعة =================
route('certificate', async (r) => {
  const key = decodeURIComponent(r.params[0] || '');
  let d;
  try { d = await api('/public/verify/' + encodeURIComponent(key)); }
  catch { return pub(`<div class="pub">${alertBox('danger', 'لا قيد بهذا الرقم', '')}</div>`, ''); }
  const isLic = d.kind === 'licensee';
  const no = isLic ? d.license_no : d.accreditation_no;
  const color = isLic ? d.color_hex : '#0B4533';
  return `<div class="cert-page">
    <div class="cert-actions"><button class="btn primary" onclick="window.print()">طباعة الشهادة</button>
      <a class="btn" href="#/verify/${encodeURIComponent(no)}">صفحة التحقق</a></div>
    <div class="cert" style="--lv:${E(color)}">
      <div class="cert-hd"><span class="logo-mark" style="width:62px;height:62px">${LOGO}</span>
        <div><div class="cert-brand">علامة «سِيمَا الخَيْر»</div>
        <div class="cert-sub">العلامة الوطنية الليبية للمساهمة في الأعمال الخيرية والإنسانية والتنموية</div></div></div>
      <h1 class="cert-title">${isLic ? 'شهادة ترخيص باستعمال العلامة' : 'شهادة اعتماد منظمة مجتمع مدني'}</h1>
      <p class="cert-lead">تشهد الأمانة التنفيذية لعلامة «سِيمَا الخَيْر»، بناءً على قرار لجنة منح الترخيص، بأن</p>
      <div class="cert-name">${E(isLic ? d.legal_name : d.name)}</div>
      <p class="cert-lead">${isLic ? `مرخَّص لها باستعمال العلامة في <b>${E(lb('scopeType', d.scope_type))}</b> — ${E(d.scope_desc || '')}`
        : `منظمة معتمدة يجوز توجيه المساهمات إليها — ${E(d.focus_areas || '')}`}</p>
      ${isLic ? `<div class="cert-level"><span>المستوى ${num(d.level)} — ${E(d.level_name)}</span><b>${E(d.claim_ar)}</b></div>` :
        `<div class="cert-level"><span>التصنيف الإداري المنشور</span><b>${E(d.admin_class_name)} — ${pct(d.admin_expense_ratio)}</b></div>`}
      <div class="cert-grid">
        <div><small>${isLic ? 'رقم الترخيص' : 'رقم الاعتماد'}</small><b class="mono">${E(no)}</b></div>
        <div><small>تاريخ البدء</small><b>${dt(isLic ? d.start_date : d.accredited_from)}</b></div>
        <div><small>تاريخ الانتهاء</small><b>${dt(isLic ? d.end_date : d.accredited_to)}</b></div>
        <div><small>الحالة</small><b>${E(d.message)}</b></div>
      </div>
      ${isLic && d.allowed_claim ? `<p class="cert-claim"><small>الادعاء المسموح به حصراً (المادة 19/4)</small>«${E(d.allowed_claim)}»</p>` : ''}
      <div class="cert-ft">
        <img src="/api/public/qr/${encodeURIComponent(no)}.svg" alt="QR" width="118" height="118">
        <div><p>امسح الرمز للتحقق من سريان هذه الشهادة في السجل العام. الشهادة لا تُكسِب حق ملكية على العلامة،
          وإنما رخصة استعمال محدودة المدة والنطاق، غير قابلة للتنازل أو الترخيص من الباطن (المادة 8).</p>
          <div class="cert-sign"><span>رئيس لجنة منح الترخيص</span><span>المدير التنفيذي</span></div></div>
      </div>
      ${!d.valid ? `<div class="cert-void">${E(d.message)}</div>` : ''}
      <div class="cert-wm">تَعْرِفُهُم بِسِيمَاهُم</div>
    </div></div>`;
});

// ================= مقترحات المعايير (داخلي) =================
route('proposals', async (r) => {
  if (!S.user) { location.hash = '#/login'; return ''; }
  if (r.params[0]) return proposalDetail(r.params[0]);
  const html = shell('<div id="t"></div>', { title: 'مقترحات تعديل المعايير والمشاورة العامة',
    sub: 'المادة (19/3): كل تعديل جوهري يُعرض على مشاورة عامة لا تقل عن ثلاثين يوماً قبل رفعه للمجلس',
    actions: has('standards.propose') ? '<button class="btn primary" onclick="APPX.newProposal()">مقترح جديد</button>' : '' });
  mount(() => dataTable(document.getElementById('t'), { path: '/proposals',
    filters: [{ k: 'q', t: 'بحث', type: 'text', wide: true },
      { k: 'status', t: 'الحالة', type: 'select', opts: [['draft', 'مسوّدة'], ['consultation', 'في المشاورة'], ['consultation_closed', 'أُغلقت المشاورة'],
        ['submitted_to_board', 'مرفوع للقرار'], ['approved', 'معتمد'], ['rejected', 'مرفوض']] },
      { k: 'kind', t: 'النوع', type: 'select', opts: [['standard', 'معيار'], ['fees', 'رسوم'], ['floors', 'أرضيات'], ['bylaws', 'النظام الداخلي'], ['interpretation', 'تفسير ملزم']] }],
    cols: [
      { t: 'المرجع', r: (x) => `<span class="mono">${E(x.reference)}</span>` },
      { t: 'المقترح', r: (x) => `<b>${E(x.title)}</b><div class="muted" style="white-space:normal;max-width:380px">${E(x.summary)}</div>` },
      { t: 'النوع', r: (x) => `<span class="tag gold">${E({ standard: 'معيار', fees: 'رسوم', floors: 'أرضيات', bylaws: 'النظام الداخلي', interpretation: 'تفسير' }[x.kind])}</span>${x.is_material ? ' <span class="tag">جوهري</span>' : ''}` },
      { t: 'المشاورة', r: (x) => x.consultation_start ? `${dt(x.consultation_start)}<div class="muted">إلى ${dt(x.consultation_end)}</div>` : '—' },
      { t: 'المداخلات', cls: 'num', r: (x) => `${num(x.comments_count)}${x.unanswered ? ` <span class="tag warn">${num(x.unanswered)} بلا رد</span>` : ''}` },
      { t: 'الحالة', r: (x) => `<span class="tag ${x.status === 'approved' ? 'ok' : x.status === 'rejected' ? 'danger' : x.status === 'consultation' ? 'info' : ''}">${E(PSTAT[x.status] || x.status)}</span>` },
    ],
    rowClick: (x) => go('proposals/' + x.id) }));
  return html;
});
const PSTAT = { draft: 'مسوّدة', consultation: 'في المشاورة', consultation_closed: 'أُغلقت المشاورة',
  submitted_to_board: 'مرفوع للقرار', approved: 'معتمد', rejected: 'مرفوض', withdrawn: 'مسحوب' };

async function proposalDetail(id) {
  const p = await api('/proposals/' + id);
  const t = today();
  const btn = [];
  if (has('standards.propose')) {
    if (p.status === 'draft') btn.push(`<button class="btn primary sm" onclick="APPX.openConsultation(${p.id},${p.is_material})">فتح المشاورة العامة</button>`);
    if (p.status === 'consultation' && t >= p.consultation_end) btn.push(`<button class="btn primary sm" onclick="APPX.closeConsultation(${p.id})">إغلاق المشاورة ونشر الملخص</button>`);
    if (p.status === 'consultation_closed' || (p.status === 'draft' && !p.is_material)) btn.push(`<button class="btn gold sm" onclick="APPX.submitProposal(${p.id})">رفع للقرار</button>`);
  }
  if (p.status === 'submitted_to_board' && has(p.kind === 'bylaws' ? 'gov.bylaws.amend' : 'standards.approve'))
    btn.push(`<button class="btn gold sm" onclick="APPX.decideProposal(${p.id},'${p.kind}')">القرار</button>`);
  return shell(`
    <div class="grid g4" style="margin-bottom:14px">
      ${stat('الحالة', E(PSTAT[p.status]), p.is_material ? 'تعديل جوهري' : 'غير جوهري')}
      ${stat('المشاورة', p.consultation_start ? `${dt(p.consultation_start)}` : '—', p.consultation_end ? `إلى ${dt(p.consultation_end)}` : '')}
      ${stat('المتبقي', p.days_left != null ? num(p.days_left) + ' يوماً' : '—')}
      ${stat('المداخلات', num(p.comments.length), `${num(p.comments.filter((c) => !c.response).length)} بلا رد`, p.comments.some((c) => !c.response) ? 'warn' : '')}
    </div>
    ${card('نص المقترح', `<p><b>${E(p.summary)}</b></p><p style="font-family:var(--fs);white-space:pre-wrap">${E(p.body)}</p>
      ${kv([['السند', E(p.article_ref || '—')], ['قدّمه', E(p.proposed_by_name || '—')],
        p.board_decision ? ['القرار', `${E(p.board_decision === 'approved' ? 'اعتُمد' : 'رُفض')} — ${E(p.board_decision_reason || '')}<div class="muted">${E(p.board_decided_by_name || '')} · ${dt(p.board_decided_at)}</div>`] : null,
        p.effective_from ? ['النفاذ', dt(p.effective_from)] : null])}
      ${p.response_summary ? alertBox('info', 'ملخص المداخلات وردود اللجنة', E(p.response_summary)) : ''}`, { actions: btn.join(' ') })}
    ${card('المداخلات', p.comments.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>المتداخل</th><th>المداخلة</th><th>رد اللجنة</th><th></th></tr></thead><tbody>
      ${p.comments.map((c) => `<tr><td><b>${E(c.author_name)}</b><div class="muted">${E(c.organization || '')} · ${dt(c.submitted_at)}</div></td>
        <td style="white-space:normal;max-width:420px">${E(c.body)}</td>
        <td style="white-space:normal;max-width:380px">${c.response ? `${E(c.response)}<div class="muted">${E(c.responded_by_name || '')}</div>` : '<span class="tag warn">بلا رد</span>'}</td>
        <td>${!c.response && has('standards.propose') ? `<button class="btn sm" onclick="APPX.respondComment(${p.id},${c.id})">رد</button>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty"><b>لا مداخلات</b></div>')}`,
    { title: p.title, sub: `${E(p.reference)} — <a href="#/consultations">الصفحة العامة للمشاورات</a>` });
}

// ================= المهام الآلية =================
route('jobs', async () => {
  if (!S.user) { location.hash = '#/login'; return ''; }
  const d = await api('/jobs');
  return shell(`
    ${alertBox('info', 'لماذا مهام آلية؟', 'المواعيد النظامية لا تنتظر تذكّر أحد: التعليق يتحول إلى سحب بعد ستة أشهر، والموافقة على التصميم تصير ضمنية بعد عشرة أيام عمل، وحق الاستعمال ينقضي بانقضاء مهلة الإقرار. تعمل المهام عند التشغيل وكل ست ساعات، ويمكن تشغيلها يدوياً.')}
    ${card('المهام', `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>المهمة</th><th>السند</th><th>آخر تشغيل</th><th>المتأثر</th><th>بواسطة</th>${has('admin.settings') ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.jobs.map((j) => `<tr><td><b>${E(j.title)}</b><div class="muted mono">${E(j.key)}</div></td><td class="muted">${E(j.article)}</td>
        <td>${j.last ? E(String(j.last.started_at).slice(0, 16)) : '—'}</td>
        <td class="num">${j.last ? (j.last.details ? `<span class="tag danger">${E(j.last.details)}</span>` : num(j.last.affected)) : '—'}</td>
        <td class="muted">${E(j.last?.triggered_by || '—')}</td>
        ${has('admin.settings') ? `<td><button class="btn sm" onclick="APPX.runJobs('${E(j.key)}')">تشغيل</button></td>` : ''}</tr>`).join('')}
      </tbody></table></div>`, { actions: has('admin.settings') ? '<button class="btn primary sm" onclick="APPX.runJobs()">تشغيل الكل الآن</button>' : '' })}
    ${card('سجل التشغيل', `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>الوقت</th><th>المهمة</th><th>المتأثر</th><th>بواسطة</th></tr></thead><tbody>
      ${d.runs.filter((x) => x.affected || x.details).slice(0, 60).map((x) => `<tr><td class="mono">${E(String(x.started_at).slice(0, 16))}</td>
        <td>${E((d.jobs.find((j) => j.key === x.job) || {}).title || x.job)}</td><td class="num">${x.details ? E(x.details) : num(x.affected)}</td>
        <td class="muted">${E(x.triggered_by)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty"><b>لا تغييرات مسجَّلة</b></div></td></tr>'}
      </tbody></table></div>`, { note: 'التشغيلات التي أحدثت أثراً فقط' })}`,
    { title: 'المهام الآلية', sub: 'إنفاذ المواعيد النظامية تلقائياً' });
});

// ================= حسابي =================
route('profile', async () => {
  if (!S.user) { location.hash = '#/login'; return ''; }
  const u = S.user;
  const pl = await api('/auth/pledges/mine').catch(() => ({ rows: [] }));
  const y = new Date().getFullYear();
  const signed = pl.rows.some((p) => p.kind === 'annual_interests' && p.year === y);
  const html = shell(`<div class="grid g2">
    ${card('بياناتي', `<form id="pf"><div class="form-grid">
      <div class="fld"><label>الاسم</label><input value="${E(u.full_name)}" disabled></div>
      <div class="fld"><label>البريد</label><input value="${E(u.email)}" disabled></div>
      ${fld('phone', 'الهاتف', { val: u.phone || '' })}
      ${fld('job_title', 'الوظيفة', { val: u.job_title || '' })}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary">حفظ</button></div></form>`)}
    ${card('تغيير كلمة المرور', `<form id="pw"><div class="form-grid">
      ${fld('current_password', 'كلمة المرور الحالية', { type: 'password', req: true })}
      ${fld('new_password', 'كلمة المرور الجديدة', { type: 'password', req: true, hint: 'ثمانية أحرف على الأقل تجمع حروفاً وأرقاماً' })}
      ${fld('confirm', 'تأكيد كلمة المرور', { type: 'password', req: true })}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary">تغيير</button></div></form>
      ${legal('تغيير كلمة المرور يُسقط كل الجلسات المفتوحة الأخرى فوراً.')}`)}
    </div>
    ${card('إقرار المصالح السنوي — نموذج (12)', `
      ${signed ? alertBox('ok', `وُقِّع إقرار ${y}`, '') : alertBox('warn', `لم يُوقَّع إقرار ${y} بعد`, 'يوقّع كل عامل ومقيّم وعضو لجنة إقراراً سنوياً بالمصالح (المادة 27).')}
      <form id="if"><div class="form-grid">
        ${fld('has_conflict', 'هل لديك مصلحة مع جهة خاضعة للتقييم؟', { opts: [['0', 'لا'], ['1', 'نعم']] })}
        ${fld('details', 'التفاصيل', { type: 'textarea', wide: true, ph: 'اذكر الجهة ورقم ملفها بين قوسين، مثل: (الملف 7)، وطبيعة العلاقة' })}</div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary">توقيع الإقرار</button></div></form>
      ${pl.rows.length ? `<div class="tbl-wrap" style="margin-top:12px"><table class="tbl"><thead><tr><th>النوع</th><th>السنة</th><th>تعارض</th><th>التفاصيل</th><th>التوقيع</th></tr></thead><tbody>
        ${pl.rows.map((p) => `<tr><td>${p.kind === 'confidentiality' ? 'سرّية وحياد' : 'مصالح سنوي'}</td><td>${yr(p.year)}</td>
          <td>${p.has_conflict ? '<span class="tag warn">نعم</span>' : 'لا'}</td><td class="muted" style="white-space:normal">${E(p.details || '')}</td>
          <td>${dt(p.signed_at)}</td></tr>`).join('')}</tbody></table></div>` : ''}`)}`,
    { title: 'حسابي', sub: E(u.roles.map((x) => x.name_ar).join(' · ')) });
  mount(() => {
    document.getElementById('pf').onsubmit = async (e) => { e.preventDefault();
      try { S.user = await api('/auth/profile', { method: 'PATCH', body: formData(e.target) }); toast('حُفظت البيانات'); } catch (er) { toast(er.message, 'danger'); } };
    document.getElementById('pw').onsubmit = async (e) => { e.preventDefault();
      const b = formData(e.target);
      if (b.new_password !== b.confirm) return toast('التأكيد لا يطابق كلمة المرور الجديدة', 'danger');
      try { const r = await api('/auth/password', { method: 'POST', body: b });
        S.token = r.token; localStorage.setItem('sema_token', r.token); toast(r.note); e.target.reset(); } catch (er) { toast(er.message, 'danger'); } };
    document.getElementById('if').onsubmit = async (e) => { e.preventDefault();
      const b = formData(e.target);
      try { await api('/pledges', { method: 'POST', body: { kind: 'annual_interests', year: y, has_conflict: b.has_conflict === '1', details: b.details } });
        toast('وُقِّع الإقرار'); render(); } catch (er) { toast(er.message, 'danger'); } };
  });
  return html;
});

// ================= إجراءات =================
const F = (id) => document.getElementById(id);
window.APPX = {
  newProposal() {
    modal({ title: 'مقترح تعديل جديد', wide: true, body: `<form id="npf"><div class="form-grid">
      ${fld('title', 'العنوان', { req: true, wide: true })}
      ${fld('kind', 'النوع', { opts: [['standard', 'معيار'], ['fees', 'جدول الرسوم'], ['floors', 'الأرضيات والشرائح'], ['bylaws', 'النظام الداخلي'], ['interpretation', 'تفسير ملزم']] })}
      ${fld('is_material', 'تعديل جوهري؟', { opts: [['1', 'نعم — مشاورة 30 يوماً على الأقل'], ['0', 'لا']] })}
      ${fld('article_ref', 'السند / المادة', { ph: 'المادة 5 من لائحة الاعتماد' })}
      ${fld('summary', 'الملخص', { req: true, wide: true })}
      ${fld('body', 'النص المقترح والتسبيب', { type: 'textarea', req: true, wide: true })}</div></form>`,
      actions: [{ label: 'حفظ كمسوّدة', cls: 'primary', run: async (el, close) => {
        const b = formData(el.querySelector('#npf')); b.is_material = b.is_material !== '0';
        try { const p = await api('/proposals', { method: 'POST', body: b }); close(); go('proposals/' + p.id); } catch (er) { toast(er.message, 'danger'); } } }] });
  },
  openConsultation(id, material) {
    modal({ title: 'فتح المشاورة العامة', body: `<form id="ocf">${fld('days', 'مدة المشاورة بالأيام', { type: 'number', val: 30, req: true,
      hint: material ? 'التعديل الجوهري: ثلاثون يوماً على الأقل (المادة 19/3)' : '' })}</form>`,
      actions: [{ label: 'فتح', cls: 'primary', run: async (el, close) => {
        try { await api(`/proposals/${id}/open-consultation`, { method: 'POST', body: { days: Number(formData(el.querySelector('#ocf')).days) } });
          close(); toast('فُتحت المشاورة ونُشرت في الصفحة العامة'); render(); } catch (er) { toast(er.message, 'danger'); } } }] });
  },
  respondComment(pid, cid) {
    modal({ title: 'رد اللجنة على المداخلة', body: `<form id="rcf">${fld('response', 'الرد', { type: 'textarea', req: true, wide: true })}</form>`,
      actions: [{ label: 'نشر الرد', cls: 'primary', run: async (el, close) => {
        try { await api(`/proposals/${pid}/comments/${cid}/respond`, { method: 'POST', body: formData(el.querySelector('#rcf')) }); close(); render(); }
        catch (er) { toast(er.message, 'danger'); } } }] });
  },
  closeConsultation(id) {
    modal({ title: 'إغلاق المشاورة', body: `<form id="ccf">${fld('response_summary', 'ملخص المداخلات وردود اللجنة — يُنشر', { type: 'textarea', req: true, wide: true })}</form>`,
      actions: [{ label: 'إغلاق ونشر', cls: 'primary', run: async (el, close) => {
        try { await api(`/proposals/${id}/close-consultation`, { method: 'POST', body: formData(el.querySelector('#ccf')) }); close(); render(); }
        catch (er) { toast(er.message, 'danger'); } } }] });
  },
  async submitProposal(id) {
    try { await api(`/proposals/${id}/submit`, { method: 'POST', body: {} }); toast('رُفع المقترح للقرار'); render(); }
    catch (er) { toast(er.message, 'danger'); }
  },
  decideProposal(id, kind) {
    modal({ title: kind === 'bylaws' ? 'قرار الجمعية العمومية' : 'قرار مجلس الأمناء', body: `<form id="dpf"><div class="form-grid">
      ${fld('decision', 'القرار', { opts: [['approved', 'اعتماد'], ['rejected', 'رفض']] })}
      ${fld('effective_from', 'تاريخ النفاذ', { type: 'date', hint: ['fees', 'floors'].includes(kind) ? 'الرسوم والأرضيات: ستون يوماً على الأقل من اليوم (المادة 5)' : '' })}
      ${fld('reason', 'التسبيب', { type: 'textarea', req: true, wide: true })}</div></form>`,
      actions: [{ label: 'إصدار القرار', cls: 'primary', run: async (el, close) => {
        try { await api(`/proposals/${id}/decide`, { method: 'POST', body: formData(el.querySelector('#dpf')) }); close(); render(); }
        catch (er) { toast(er.message, 'danger'); } } }] });
  },
  async runJobs(job) {
    try { const r = await api('/jobs/run', { method: 'POST', body: job ? { job } : {} });
      toast('نُفِّذت المهام: ' + r.results.map((x) => `${x.title} (${x.affected})`).join(' · ')); render(); }
    catch (er) { toast(er.message, 'danger'); }
  },
};
void F;
})();
