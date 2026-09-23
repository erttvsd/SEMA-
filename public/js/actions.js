(function(){
'use strict';
/* ===== الإجراءات: النماذج والقرارات ===== */
const { S, api, E, num, money, pct, dt, today, L, lb, toast, modal, render, go, has } = window.SEMA;
const { alertBox, legal, kv, stat } = window.UI;

const F = {
  txt: (n, l, v = '', req) => `<div class="fld"><label>${E(l)}</label><input name="${n}" value="${E(v)}" ${req ? 'required' : ''}></div>`,
  numf: (n, l, v = '', req, step = '1') => `<div class="fld"><label>${E(l)}</label><input name="${n}" type="number" step="${step}" value="${E(v)}" ${req ? 'required' : ''}></div>`,
  date: (n, l, v = '') => `<div class="fld"><label>${E(l)}</label><input name="${n}" type="date" value="${E(v)}"></div>`,
  sel: (n, l, opts, v = '', req) => `<div class="fld"><label>${E(l)}</label><select name="${n}" ${req ? 'required' : ''}>
    ${opts.map(([val, lbl]) => `<option value="${E(val)}" ${String(v) === String(val) ? 'selected' : ''}>${E(lbl)}</option>`).join('')}</select></div>`,
  area: (n, l, v = '', rows = 4, req, ph = '') => `<div class="fld wide" style="grid-column:1/-1"><label>${E(l)}</label>
    <textarea name="${n}" rows="${rows}" ${req ? 'required' : ''} placeholder="${E(ph)}">${E(v)}</textarea></div>`,
};
const readForm = (el) => {
  const o = {};
  el.querySelectorAll('[name]').forEach((i) => {
    if (i.type === 'checkbox') o[i.name] = i.checked;
    else o[i.name] = i.value === '' ? null : i.value;
  });
  return o;
};
const post = async (path, body, okMsg, method = 'POST') => {
  try { const r = await api(path, { method, body }); toast(okMsg || 'تم', ''); return r; }
  catch (e) { toast(e.message, 'danger'); throw e; }
};

// ---------- الإثباتات ----------
function uploadDoc(ownerKind, ownerId) {
  const types = (S.ref?.document_types || []).filter((t) =>
    !ownerKind || t.applies_to === 'both' || t.applies_to === ownerKind || !['licensee', 'association'].includes(ownerKind));
  const canAny = has('doc.upload.any');
  const scopes = [];
  if (S.user.scopes.licensee.length) scopes.push(['licensee', 'ملف منشأتي']);
  if (S.user.scopes.association.length) scopes.push(['association', 'ملف منظمتي']);
  if (canAny) scopes.push(['licensee', 'مرخَّص له'], ['association', 'منظمة'], ['secretariat', 'الأمانة']);

  const m = modal({ title: 'تحميل إثبات', body: `<form id="uf" class="form-grid">
    ${ownerKind ? `<input type="hidden" name="owner_kind" value="${E(ownerKind)}">
      <input type="hidden" name="owner_id" value="${E(ownerId)}">`
      : F.sel('owner_kind', 'الجهة', scopes.length ? scopes : [['licensee', 'مرخَّص له']], '', true)
        + F.numf('owner_id', 'رقم الملف', S.user.scopes.licensee[0] || S.user.scopes.association[0] || '', true)}
    ${F.sel('doc_type', 'نوع الإثبات', [['', '— اختر —'], ...types.map((t) => [t.code, t.name_ar + (t.required ? ' (إلزامي)' : '')])], '', true)}
    ${F.txt('title', 'عنوان المستند', '', true)}
    ${F.date('issued_on', 'تاريخ الإصدار')}
    ${F.date('expires_on', 'تاريخ انتهاء الصلاحية')}
    ${canAny ? F.sel('confidential', 'سرّي', [['0', 'لا'], ['1', 'نعم — لا يُطلع عليه إلا من يملك صلاحية السرّية']]) : ''}
    <div class="fld" style="grid-column:1/-1"><label>الملف (حتى 20 ميجابايت)</label>
      <input type="file" name="file" required></div>
    </form>${legal('المادة (3/5) قابلية التحقق: لا يُعتدّ بأي التزام لا يُسنده مستند خارجي. ويحتسب النظام بصمة SHA-256 لكل ملف ويكشف التكرار آلياً.')}`,
    actions: [{ label: 'تحميل', cls: 'primary', run: async (el, close) => {
      const form = el.querySelector('#uf');
      const fd = new FormData(form);
      try {
        const r = await api('/documents', { method: 'POST', body: fd });
        toast('تم تحميل الإثبات' + (r.duplicate_of ? ' — تنبيه: ملف مطابق بالبصمة نفسها موجود مسبقاً' : ''),
          r.duplicate_of ? 'warn' : '');
        close(); render();
      } catch (e) { toast(e.message, 'danger'); }
    } }] });
}

function verifyDoc(id) {
  modal({ title: 'التحقق من الإثبات', body: `<form id="vf" class="form-grid">
    ${F.sel('verification', 'النتيجة', [['verified', 'متحقَّق منه — مطابق للأصل'],
      ['rejected', 'مرفوض'], ['superseded', 'مستبدَل بنسخة أحدث'], ['pending', 'إرجاع لحالة الانتظار']], 'verified', true)}
    ${F.area('note', 'ملاحظة التحقق', '', 3, false, 'مثال: مطابق للأصل — تحقّق من المصدر ومن سريان المدة')}
  </form>`, actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
    await post(`/documents/${id}/verify`, readForm(el.querySelector('#vf')), 'سُجّل التحقق');
    close(); render(); } }] });
}

// ---------- الطلبات ----------
function newApplication(preset) {
  const lic = S.user.scopes.licensee[0], org = S.user.scopes.association[0];
  if (!lic && !org) return toast('حسابك غير مرتبط بملف', 'warn');
  const kind = lic ? 'licensee' : 'association';
  const types = kind === 'licensee'
    ? [['license', 'ترخيص جديد (بعد رفض أو انتهاء)'], ['license_renewal', 'تجديد الترخيص — مع إقرار الامتثال (المادة 18/2)'], ['level_upgrade', 'رفع المستوى (المادة 8/3)']]
    : [['accreditation', 'اعتماد (بعد رفض أو انتهاء)'], ['accreditation_renewal', 'تجديد الاعتماد (المادة 16)']];
  modal({ title: 'تقديم طلب', body: `<form id="af" class="form-grid">
    ${F.sel('app_type', 'نوع الطلب', types, preset || types[1][0], true)}
    ${kind === 'licensee' ? F.sel('requested_level', 'المستوى المطلوب', (S.ref?.levels || []).map((l) => [l.level, `المستوى ${l.level} — ${l.name_ar}`])) : ''}
  </form>${legal(kind === 'association'
    ? 'المادة (12): لا تُحصَّل من منظمة المجتمع المدني أي رسوم مقابل التقديم أو التقييم أو الاعتماد أو التجديد.'
    : 'لا يجوز رفع المستوى المعلن خلال السنة إلا بطلب جديد وموافقة لجنة منح الترخيص وسداد فرق الرسم إن وُجد (المادة 8/3). ويُقدَّم طلب التجديد مع إقرار الامتثال السنوي (المادة 18/2).')}`,
    actions: [{ label: 'تقديم', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#af'));
      b.subject_kind = kind; b.subject_id = kind === 'licensee' ? lic : org;
      if (b.requested_level) b.requested_level = Number(b.requested_level);
      const r = await post('/applications', b, 'قُدِّم الطلب — أمام وحدة التقييم عشرة أيام عمل لفحص الاستيفاء');
      close(); go('applications/' + r.id); } }] });
}

function resubmitApp(id) {
  modal({ title: 'استكمال النواقص (المرحلة 3)', body: `
    ${alertBox('info', 'قبل الإرسال', 'حمّل المستندات الناقصة من «إثباتاتي» أولاً، ثم أرسل الاستكمال — فيعود الطلب إلى وحدة التقييم للفحص.')}
    <form id="rf" class="form-grid">${F.area('note', 'بيان ما استُكمل', '', 3, true, 'مثال: حُمِّلت شهادة عدم المديونية المحدَّثة وسجل ساعات التطوع')}</form>`,
    actions: [{ label: 'إرسال الاستكمال', cls: 'primary', run: async (el, close) => {
      await post(`/applications/${id}/resubmit`, readForm(el.querySelector('#rf')), 'أُرسل الاستكمال'); close(); render(); } },
      { label: 'تحميل إثبات أولاً', run: (_e, close) => { close(); uploadDoc(); } }] });
}

function screenApp(id) {
  modal({ title: 'فحص الاستيفاء الشكلي (المرحلة 2)', body: `<form id="sf" class="form-grid">
    ${F.sel('complete', 'النتيجة', [['1', 'مستوفى شكلياً — ينتقل للتقييم الموضوعي'],
      ['0', 'به نواقص — إخطار الطالب']], '1', true)}
    ${F.area('deficiencies', 'بيان النواقص (عند عدم الاستيفاء)', '', 4, false,
      'مثال: شهادة عدم المديونية الضريبية منتهية · لم يُرفق سجل ساعات التطوع')}
  </form>${legal('المادة (17/3): أمام الطالب عشرون يوم عمل لاستكمال النواقص وإلا حُفظ الطلب.')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#sf'));
      await post(`/applications/${id}/screen`, { complete: b.complete === '1', deficiencies: b.deficiencies }, 'سُجّل الفحص');
      close(); render(); } }] });
}

function factsReport(id) {
  modal({ title: 'رفع تقرير الوقائع (المرحلة 6)', body: `
    ${alertBox('danger', 'وقائع وأدلة بلا توصية',
      'المادة (20/3): يجب أن يقتصر تقرير الوحدة على الوقائع والأدلة دون توصية بالمنح أو الرفض. والنظام يرفض أي تقرير يحتوي حقل توصية.')}
    <form id="ff" class="form-grid">
      ${F.area('facts_summary', 'ملخص الوقائع والأدلة', '', 6, true,
        'مثال: طوبقت الدفاتر مع إيصالات التحويل وكشوف الحساب المصرفي؛ وتوافقت أرقام الالتزام مع الإقرار الضريبي المقدَّم. عُوينت العبوات في ثلاث نقاط بيع وظهر رقم الترخيص في كل التطبيقات الملحوظة.')}
      ${F.txt('f_area', 'مجال الواقعة (اختياري)')}
      ${F.area('f_fact', 'نص الواقعة (اختياري)', '', 2)}
      ${F.sel('f_sev', 'الجسامة', [['info', 'إفادة'], ['minor', 'بسيطة'], ['major', 'جسيمة'], ['critical', 'جوهرية']], 'info')}
      ${F.sel('f_vc', 'بند المخالفة', [['', '— لا ينطبق —'],
        ...(S.ref?.violations || []).map((v) => [v.code, `29/${v.code} — ${v.case_ar.slice(0, 44)}`])])}
    </form>`,
    actions: [{ label: 'رفع التقرير', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#ff'));
      const findings = b.f_fact ? [{ area: b.f_area || 'عام', fact: b.f_fact, severity: b.f_sev,
        violation_code: b.f_vc ? Number(b.f_vc) : null }] : [];
      await post(`/applications/${id}/facts-report`, { facts_summary: b.facts_summary, findings },
        'رُفع تقرير الوقائع — أمام لجنة منح الترخيص خمسة عشر يوم عمل');
      close(); render(); } }] });
}

function decideApp(id, level) {
  modal({ title: 'القرار المسبَّب — لجنة منح الترخيص', body: `
    ${alertBox('warn', 'حدود اختصاص اللجنة (المادة 21)',
      'تختص اللجنة وحدها بالمنح والرفض وتحديد المستوى والتجديد والتعليق والسحب. ويُحظر عليها التفاوض مع الطالب أو تعديل الوقائع الواردة في تقرير وحدة التقييم؛ ولها أن تطلب استكمالاً أو إعادة تدقيق. وتصدر قراراتها مسبَّبة وكتابية.')}
    <form id="df" class="form-grid">
      ${F.sel('decision', 'القرار', [['grant', 'منح'], ['grant_lower_level', 'منح بمستوى أدنى'], ['reject', 'رفض']], 'grant', true)}
      ${F.sel('granted_level', 'المستوى الممنوح', (S.ref?.levels || []).map((l) => [l.level, `المستوى ${l.level} — ${l.name_ar}`]), level)}
      ${F.area('reason', 'التسبيب الكتابي (إلزامي)', '', 5, true,
        'مثال: مستوفٍ لشروط الدخول في المادة (9)، ولمعايير المستوى المطلوب. تقرير الوقائع لم يسجّل أي مخالفة لقائمة الاستبعاد.')}
    </form>`,
    actions: [{ label: 'إصدار القرار', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#df'));
      if (b.granted_level) b.granted_level = Number(b.granted_level);
      await post(`/applications/${id}/decide`, b, 'صدر القرار وقُيّد في السجل');
      close(); render(); } }] });
}

// ---------- المساهمات ----------
async function newContribution() {
  const lic = S.user.scopes.licensee[0];
  if (!lic) return toast('حسابك غير مرتبط بملف مرخَّص له', 'warn');
  const orgs = await api('/associations?status=accredited&per_page=200');
  modal({ title: 'تسجيل مساهمة', body: `<form id="cf" class="form-grid">
    ${F.sel('channel', 'المسار', (S.ref?.channels || []).filter((c) => c.counts)
      .map((c) => [c.code, `${c.name_ar}${c.max_share ? ` — سقف ${Math.round(c.max_share * 100)}%` : ''}`]), 'cash', true)}
    ${F.sel('association_id', 'المنظمة المعتمدة', [['', '— لا ينطبق (برنامج ذاتي) —'],
      ...orgs.rows.map((o) => [o.id, `${o.name} — ${o.accreditation_no} (متبقٍ من السقف: ${money(o.absorption_cap - o.absorption_used)})`])], '', false)}
    ${F.numf('amount', 'المبلغ بالدينار', '', true, '0.01')}
    ${F.numf('fiscal_year', 'السنة المالية', 2026, true)}
    ${F.date('transfer_date', 'تاريخ التحويل', today())}
    ${F.txt('bank_ref', 'مرجع الحوالة')}
    ${F.numf('volunteer_hours', 'ساعات التطوع (لمسار التطوّع)')}
    ${F.numf('hour_rate', 'سعر الساعة الموحَّد', 18)}
    ${F.txt('valuation_by', 'الجهة المقيِّمة (للتبرع العيني)')}
    ${F.area('purpose', 'الغرض المعلن', '', 2, true, 'مثال: كفالة 40 أسرة متعففة لستة أشهر')}
  </form>${legal('المادة (21): لا يقل الجزء النقدي عن 50% من إجمالي الالتزام السنوي · المادة (20): العيني ≤ 25% والتطوّع ≤ 10% والبرامج الذاتية ≤ 40% · المادة (22/3): تُخطَر الأمانة بجهة التوجيه قبل التحويل للتأكد من سريان الاعتماد ومن عدم تجاوز سقف الاستيعاب.')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#cf'));
      b.licensee_id = lic;
      ['amount', 'fiscal_year', 'association_id', 'volunteer_hours', 'hour_rate'].forEach((k) => {
        if (b[k]) b[k] = Number(b[k]); });
      const r = await post('/contributions', b, 'سُجّلت المساهمة — بانتظار إقرار الاستلام من المنظمة');
      if (r.warnings?.length) r.warnings.forEach((w) => toast(w, 'warn'));
      close(); render(); } }] });
}

function confirmReceipt(id) {
  modal({ title: 'إقرار استلام مساهمة — نموذج (5)', body: `
    ${alertBox('info', 'مضمون الإقرار',
      'نتعهد بأن يُصرف هذا المبلغ في الغرض المذكور حصراً، وبتقديم تقرير أثر عنه وفق نموذج (6)، وبإتاحة مستنداته لوحدة التقييم والتحقق عند الطلب.')}
    <form id="rf" class="form-grid"><div class="fld" style="grid-column:1/-1"><label>الإقرار الموقّع والمختوم (PDF أو صورة) — اختياري</label>
      <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp"></div></form>`,
    actions: [{ label: 'أقرّ الاستلام', cls: 'primary', run: async (el, close) => {
      const fd = new FormData(el.querySelector('#rf'));
      if (!fd.get('file') || !fd.get('file').size) fd.delete('file');
      try { await api(`/contributions/${id}/confirm-receipt`, { method: 'POST', body: fd }); toast('سُجّل إقرار الاستلام'); close(); render(); }
      catch (e) { toast(e.message, 'danger'); } } }] });
}

function uploadImpact(id) {
  modal({ title: 'تقرير الأثر — نموذج (6)', body: `
    ${legal('المادة (23/3): تقرير أثر مختصر عن الأموال الواردة عبر العلامة تحديداً، لا عن نشاط المنظمة كله. ويُنشر في السجل العام.')}
    <form id="if" class="form-grid">
      ${F.numf('beneficiaries', 'عدد المستفيدين المباشرين')}
      ${F.numf('spent_pct', 'نسبة الصرف %')}
      <div class="fld" style="grid-column:1/-1"><label>ملف التقرير (PDF أو Word أو صورة)</label><input type="file" name="file" required
        accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx"></div></form>`,
    actions: [{ label: 'تقديم التقرير', cls: 'primary', run: async (el, close) => {
      const fd = new FormData(el.querySelector('#if'));
      try { await api(`/contributions/${id}/impact`, { method: 'POST', body: fd }); toast('قُدِّم تقرير الأثر ونُشر'); close(); render(); }
      catch (e) { toast(e.message, 'danger'); } } }] });
}

function preapproveProgram(id) {
  modal({ title: 'الموافقة المسبقة على برنامج تنموي ذاتي', body: `
    ${legal('المادة (20): البرنامج التنموي الذي تنفّذه المنشأة مباشرةً يُحتسب حتى 40% من الالتزام بشرط موافقة مسبقة من لجنة المعايير وتقرير أثر.')}
    <form id="pf" class="form-grid">${F.sel('approve', 'القرار', [['1', 'موافقة'], ['0', 'رفض']], '1', true)}
      ${F.area('reason', 'السبب (عند الرفض)', '', 3)}</form>`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#pf'));
      await post(`/contributions/${id}/preapprove`, { approve: b.approve === '1', reason: b.reason }, 'سُجّل القرار'); close(); render(); } }] });
}

function verifyContribution(id) {
  modal({ title: 'التحقق من المساهمة', body: `<form id="vf" class="form-grid">
    ${F.sel('status', 'النتيجة', [['verified', 'متحقَّق منه — مسنَد بمستند خارجي'],
      ['documented', 'موثَّق — بانتظار مطابقة'], ['rejected', 'مرفوض'],
      ['excluded', 'مستبعَد — لا يُحتسب ضمن الالتزام']], 'verified', true)}
    ${F.area('reject_reason', 'السبب (عند الرفض أو الاستبعاد)', '', 3)}
  </form>${legal('المادة (3/5): لا يُعتدّ بأي التزام لا يُسنده مستند خارجي — ولا يقبل النظام التحقق قبل إقرار الاستلام من المنظمة المتلقية.')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      await post(`/contributions/${id}/verify`, readForm(el.querySelector('#vf')), 'سُجّل التحقق');
      close(); render(); } }] });
}

function submitDeclaration(id, tier) {
  const smallTier = ['أ', 'ب'].includes(tier);
  modal({ title: 'إقرار الامتثال السنوي — نموذج (4)', body: `<form id="df" class="form-grid">
    ${F.sel('basis_type', 'أساس الإثبات المالي (المادة 23/2أ)', [
      ['tax_return', 'الإقرار الضريبي المقدَّم لمصلحة الضرائب'],
      ['audited_statements', 'قوائم مالية مدققة من محاسب قانوني مقيّد'],
      ...(smallTier ? [['bank_statement_accountant', 'كشف حساب مصرفي مع إقرار محاسب (للشريحتين أ وب)']] : []),
    ], 'tax_return', true)}
    ${F.numf('basis_doc_id', 'رقم مستند الإثبات المحمَّل')}
    ${F.numf('declared_revenue', 'الإيراد المعلن', '', true)}
    ${F.numf('declared_net_profit', 'صافي الربح قبل الضريبة', '', true)}
    ${F.numf('declared_total', 'إجمالي المصروف والموثَّق', '', true)}
  </form>${legal('المادة (23): يُقدَّم الإقرار خلال مئة وعشرين يوماً من انتهاء السنة المالية، مرفقاً بإثبات الأساس المالي وإثبات الصرف (إيصالات التحويل وكشوف الحساب وإقرارات الاستلام من كل منظمة متلقية).<br>المادة (29/1): التأخر أقل من ثلاثين يوماً موجب لتنبيه كتابي وغرامة تأخير 10% من الرسم السنوي. والمادة (18/3): ينقضي حق استعمال الشعار تلقائياً بانقضاء مهلة تقديم الإقرار دون تقديمه.')}`,
    actions: [{ label: 'تقديم الإقرار', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#df'));
      ['basis_doc_id', 'declared_revenue', 'declared_net_profit', 'declared_total'].forEach((k) => {
        if (b[k]) b[k] = Number(b[k]); });
      await post(`/declarations/${id}/submit`, b, 'قُدّم الإقرار — بدأت مواعيد المعالجة في المادة (24)');
      close(); render(); } }] });
}

function processDeclaration(id) {
  modal({ title: 'معالجة إقرار الامتثال — وحدة التقييم (المادة 24)', body: `
    ${alertBox('danger', 'وقائع بلا توصية', 'تُسجّل الوحدة ما ثبت من الإثبات المالي وإثبات الصرف، ولجنة منح الترخيص وحدها تقرر التجديد أو الخفض أو التعليق.')}
    <form id="pf" class="form-grid">
      ${F.sel('status', 'المرحلة', [['desk_review', 'تدقيق مكتبي جارٍ'], ['field_audit', 'تدقيق ميداني جارٍ'],
        ['accepted', 'اكتملت الوقائع — الالتزام موثَّق'], ['deficient', 'اكتملت الوقائع — عجز أو نقص']], 'accepted', true)}
      ${F.area('facts_note', 'بيان الوقائع', '', 5, true, 'مثال: طوبق الإقرار الضريبي مع القوائم المالية؛ وطوبقت إيصالات التحويل مع إقرارات الاستلام من ثلاث منظمات…')}
    </form>`, actions: [{ label: 'تسجيل الوقائع', cls: 'primary', run: async (el, close) => {
      const r = await post(`/declarations/${id}/process`, readForm(el.querySelector('#pf')), 'سُجّلت الوقائع');
      if (r.commitment_assessment) toast('تكييف الالتزام: ' + r.commitment_assessment.message, r.commitment_assessment.status === 'fulfilled' ? '' : 'warn');
      close(); render(); } }] });
}
function decideDeclaration(id) {
  modal({ title: 'قرار لجنة منح الترخيص على الإقرار (المادة 24)', body: `<form id="df" class="form-grid">
    ${F.sel('outcome', 'القرار', [['renew', 'تجديد'], ['downgrade', 'خفض المستوى — عجز دون 20% (المادة 29/3)'],
      ['suspend', 'تعليق — عجز يتجاوز 20% (المادة 29/4)'], ['withdraw', 'سحب — بيانات غير صحيحة عمداً (المادة 29/8)']], 'renew', true)}
    ${F.area('reason', 'التسبيب الكتابي', '', 5, true)}</form>`,
    actions: [{ label: 'إصدار القرار', cls: 'primary', run: async (el, close) => {
      await post(`/declarations/${id}/decide`, readForm(el.querySelector('#df')), 'صدر القرار'); close(); render(); } }] });
}
function scheduleAudit(kind, id) {
  modal({ title: 'جدولة تدقيق', body: `<form id="sf" class="form-grid">
    ${F.sel('audit_type', 'النوع', [['field', 'تدقيق ميداني معلن'], ['desk', 'تدقيق مكتبي'], ['unannounced', 'زيارة غير معلنة'], ['compliance_review', 'مراجعة امتثال']], 'field', true)}
    ${F.sel('trigger', 'السبب', Object.entries(L.trigger), 'random', true)}
    ${F.date('scheduled_date', 'الموعد', today())}</form>
    ${legal('المادة (26/3): يُحظر إخطار المرخَّص له بموعد أي زيارة غير معلنة بأي وسيلة — ولا تظهر في ملفه قبل تنفيذها. والمادة (20/4): يُحظر على المقيّم تقييم جهة سبق أن قدّم لها خدمة خلال سنتين.')}`,
    actions: [{ label: 'جدولة', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#sf')); b.subject_kind = kind; b.subject_id = id;
      const r = await post('/audits', b, 'جُدول التدقيق'); close(); go('audits/' + r.id); } }] });
}
function newMarketTest() {
  modal({ title: 'تسجيل جولة اختبار سوق (المادة 28)', wide: true, body: `<form id="mf" class="form-grid">
    ${F.txt('round_name', 'اسم الجولة', '', true)}${F.txt('city', 'المدينة', '', true)}${F.date('conducted_on', 'التاريخ', today())}
    ${F.numf('outlets_visited', 'نقاط البيع المزارة', '', true)}${F.numf('items_checked', 'الأصناف المفحوصة', '', true)}
    ${F.numf('correct_usage', 'استعمال صحيح', 0)}${F.numf('missing_license_no', 'بلا رقم ترخيص', 0)}
    ${F.numf('level_mismatch', 'مستوى معلن مخالف', 0)}${F.numf('out_of_scope', 'خارج نطاق الترخيص', 0)}
    ${F.numf('unlicensed_usage', 'استعمال من غير مرخَّص', 0)}
    ${F.sel('published', 'النشر في التقرير السنوي', [['1', 'نعم'], ['', 'لا']], '1')}</form>`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#mf'));
      for (const k of Object.keys(b)) if (!['round_name', 'city', 'conducted_on'].includes(k)) b[k] = Number(b[k] || 0);
      await post('/market-tests', b, 'سُجّلت الجولة'); close(); render(); } }] });
}
async function newMeeting() {
  const [users, obs] = await Promise.all([api('/users?per_page=200').catch(() => ({ rows: [] })), api('/observers?status=admitted&per_page=50')]);
  const members = users.rows.filter((u) => u.roles.some((r) => ['BOARD_MEMBER', 'BOARD_CHAIR', 'STANDARDS_COMMITTEE', 'LICENSING_COMMITTEE',
    'APPEALS_COMMITTEE', 'INTEGRITY_COMMITTEE', 'GENERAL_ASSEMBLY'].includes(r.role_code)));
  modal({ title: 'تسجيل اجتماع ومحضره', wide: true, body: `<form id="mf" class="form-grid">
    ${F.sel('body', 'الجهة', Object.entries(L.body), 'board', true)}
    ${F.txt('title', 'العنوان', '', true)}${F.txt('meeting_no', 'رقم الاجتماع')}${F.date('held_on', 'التاريخ', today())}
    ${F.sel('is_public', 'المحضر منشور', [['1', 'نعم'], ['', 'لا']], '1')}
    ${F.area('decisions', 'القرارات', '', 4, true)}</form>
    <h4 style="margin-top:12px">الحاضرون ذوو الصوت</h4>
    <div class="form-grid">${members.map((u) => `<label style="font-size:.82rem;display:flex;gap:6px"><input type="checkbox" class="att" value="${u.id}">
      ${E(u.full_name)} <span class="muted">— ${E(u.roles.map((r) => r.name_ar).join('، '))}</span></label>`).join('')}</div>
    <h4 style="margin-top:12px">المراقبون (اجتماعات المجلس فقط — بلا صوت)</h4>
    <div class="form-grid">${obs.rows.map((o) => `<label style="font-size:.82rem;display:flex;gap:6px"><input type="checkbox" class="obs" value="${o.id}">
      ${E(o.person_name)} <span class="muted">— ${E(o.nominating_entity)}</span></label>`).join('') || '<span class="muted">لا مراقبين مقبولين</span>'}</div>
    ${legal('النصاب: المجلس ستة من أحد عشر، ولجنة المعايير ثلاثة، ولجان الترخيص والتظلمات اثنان، ولجنة النزاهة ثلاثة (المادة 16).')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#mf'));
      b.is_public = b.is_public === '1';
      b.attendee_ids = [...el.querySelectorAll('.att:checked')].map((c) => Number(c.value));
      b.observer_ids = [...el.querySelectorAll('.obs:checked')].map((c) => Number(c.value));
      await post('/meetings', b, 'سُجّل الاجتماع'); close(); render(); } }] });
}

// ---------- التصاميم ----------
async function newDesign() {
  const lic = S.user.scopes.licensee[0];
  if (!lic) return toast('حسابك غير مرتبط بملف مرخَّص له', 'warn');
  const l = await api('/licensees/' + lic);
  modal({ title: 'طلب موافقة مسبقة على تصميم — نموذج (7)', body: `<form id="gf" class="form-grid">
    ${F.sel('material_type', 'نوع المادة', Object.entries(L.material), 'packaging', true)}
    ${F.txt('title', 'عنوان المادة', '', true)}
    ${F.sel('logo_variant', 'نسخة الشعار', [['full', 'كاملة بالشعار اللفظي — للمقاسات فوق 40 مم'],
      ['compact', 'مختصرة دون الشعار اللفظي — للعبوات والشارات الصغيرة']], 'full', true)}
    ${F.sel('shows_license_no', 'رقم الترخيص ظاهر بجوار الشعار', [['1', 'نعم'], ['0', 'لا']], '1', true)}
    ${F.numf('file_doc_id', 'رقم ملف التصميم المحمَّل')}
    ${F.area('claim_text', 'الادعاء المكتوب على المادة', l.allowed_claim || '', 3, true)}
  </form>${legal('المادة (19): تُرسل النسخة الرقمية من كل عبوة أو مادة إعلانية أو صفحة إلكترونية تحمل العلامة قبل الإنتاج، وتبتّ الوحدة خلال عشرة أيام عمل، ويُعدّ عدم الرد خلالها موافقةً ضمنية.<br>ويُحظر: تغيير ألوان العلامة أو نسبها؛ حذف رقم الترخيص؛ وضع العلامة على منتج خارج نطاق الترخيص؛ إيراد ادعاء مطلق من نوع «شركة مسؤولة» أو «الأفضل خيرياً».<br><b>الادعاء المسموح به:</b> «' + E(l.allowed_claim || '') + '»')}`,
    actions: [{ label: 'تقديم', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#gf'));
      b.licensee_id = lic;
      b.shows_license_no = b.shows_license_no === '1';
      if (b.file_doc_id) b.file_doc_id = Number(b.file_doc_id);
      const r = await post('/designs', b, 'قُدّم الطلب — الموعد الأقصى للرد عشرة أيام عمل');
      if (r.claim_screen && !r.claim_screen.ok)
        r.claim_screen.issues.forEach((i) => toast('تنبيه فحص الادعاء: ' + i, 'warn'));
      close(); render(); } }] });
}

function decideDesign(id) {
  modal({ title: 'البتّ في طلب الموافقة على التصميم', body: `<form id="df" class="form-grid">
    ${F.sel('decision', 'القرار', [['approved', 'موافقة'], ['changes_required', 'تعديلات مطلوبة'],
      ['rejected', 'رفض']], 'approved', true)}
    ${F.area('notes', 'ملاحظات القرار', '', 4, true,
      'مثال: مطابق لدليل الهوية البصرية — نسخة الشعار مناسبة للمقاس، وشريط المستوى بلونه المقرر، ورقم الترخيص ظاهر بالحد الأدنى للحجم، والادعاء محدد.')}
  </form>`, actions: [{ label: 'تسجيل القرار', cls: 'primary', run: async (el, close) => {
    await post(`/designs/${id}/decide`, readForm(el.querySelector('#df')), 'سُجّل القرار');
    close(); render(); } }] });
}

// ---------- التدقيق ----------
function auditReport(id) {
  modal({ title: 'رفع تقرير وقائع التدقيق', body: `
    ${alertBox('danger', 'وقائع وأدلة بلا توصية (المادة 20/3)',
      'يقتصر التقرير على الوقائع والأدلة. وليس للمقيّم الاطلاع على أسرار تجارية لا صلة لها بالالتزام (المادة 27).')}
    <form id="af" class="form-grid">
      ${F.area('facts_summary', 'ملخص الوقائع', '', 6, true)}
      ${F.numf('hours_spent', 'ساعات التدقيق')}
      ${F.txt('f_area', 'مجال الواقعة')}
      ${F.area('f_fact', 'نص الواقعة', '', 2)}
      ${F.sel('f_sev', 'الجسامة', [['info', 'إفادة'], ['minor', 'بسيطة'], ['major', 'جسيمة'], ['critical', 'جوهرية']], 'info')}
      ${F.sel('f_vc', 'بند المخالفة', [['', '— لا ينطبق —'],
        ...(S.ref?.violations || []).map((v) => [v.code, `29/${v.code} — ${v.case_ar.slice(0, 44)}`])])}
    </form>`,
    actions: [{ label: 'رفع التقرير', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#af'));
      const findings = b.f_fact ? [{ area: b.f_area || 'عام', fact: b.f_fact, severity: b.f_sev,
        violation_code: b.f_vc ? Number(b.f_vc) : null }] : [];
      await post(`/audits/${id}/report`, { facts_summary: b.facts_summary,
        hours_spent: b.hours_spent ? Number(b.hours_spent) : null, findings }, 'رُفع التقرير');
      close(); render(); } }] });
}

// ---------- الجزاءات ----------
function newSanction(kind, id, vc, auditId) {
  const V = S.ref?.violations || [];
  modal({ title: 'إصدار جزاء — لجنة منح الترخيص', body: `
    ${alertBox('warn', 'التدرّج الجزائي (المادة 29)',
      'الجزاء يتدرّج بحسب الحالة. والتعليق لا يتجاوز ستة أشهر، فإن لم تُزَل أسبابه خلالها تحوّل تلقائياً إلى سحب (المادة 30/2). والسحب يُنشر في السجل مع السبب ويبقى منشوراً اثني عشر شهراً (المادة 31/1).')}
    <form id="sf" class="form-grid">
      ${F.sel('subject_kind', 'نوع الجهة', [['licensee', 'مرخَّص له'], ['association', 'منظمة معتمدة'],
        ['unlicensed', 'جهة غير مرخَّصة']], kind || 'licensee', true)}
      ${F.numf('subject_id', 'رقم الملف', id || '')}
      ${F.txt('subject_name', 'اسم الجهة (للجهات غير المرخَّصة)')}
      ${F.sel('violation_code', 'بند المخالفة', V.map((v) => [v.code, `29/${v.code} — ${v.case_ar}`]), vc || 1, true)}
      ${F.sel('measure', 'الجزاء', Object.entries(L.measure), '', false)}
      ${F.numf('fine_amount', 'قيمة الغرامة (إن وُجدت)')}
      ${F.numf('grace_days', 'مدة الإمهال بالأيام')}
      ${F.numf('source_audit_id', 'رقم تقرير التدقيق المستند إليه', auditId || '')}
      ${F.area('reason', 'التسبيب الكتابي (إلزامي)', '', 5, true,
        'مثال: عجز في الالتزام بنسبة 28.4% يتجاوز حدّ 20% المقرر في المادة (29/4). قُدِّر الالتزام بـ… والموثَّق…')}
    </form>
    <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>#</th><th>الحالة</th><th>الجزاء المقرر</th></tr></thead>
      <tbody>${V.map((v) => `<tr><td>${v.code}</td><td style="white-space:normal">${E(v.case_ar)}</td>
        <td style="white-space:normal">${E(v.measure_ar)}</td></tr>`).join('')}</tbody></table></div>`,
    wide: true,
    actions: [{ label: 'إصدار الجزاء', cls: 'danger', run: async (el, close) => {
      const b = readForm(el.querySelector('#sf'));
      ['subject_id', 'violation_code', 'fine_amount', 'grace_days', 'source_audit_id'].forEach((k) => {
        if (b[k]) b[k] = Number(b[k]); });
      await post('/sanctions', b, 'صدر الجزاء وقُيّد في السجل');
      close(); render(); } }] });
}

// ---------- التظلمات ----------
function fileAppeal(sanctionId, kind, id) {
  modal({ title: 'تقديم تظلم — نموذج (10)', body: `<form id="pf" class="form-grid">
    ${F.area('grounds', 'أسباب التظلم', '', 6, true,
      'اذكر الوقائع والمستندات التي تسند طلبك، وما تطلبه تحديداً من اللجنة.')}
  </form>${legal('المادة (22): يجوز التظلم من كل قرار صادر عن لجنة منح الترخيص خلال ثلاثين يوماً من الإخطار، وتفصل اللجنة خلال ستين يوماً، وقرارها نهائي في النطاق الداخلي للعلامة دون إخلال بحق اللجوء إلى القضاء. ولا يوقف التظلم تنفيذ قرار التعليق أو السحب إلا بقرار مسبَّب من اللجنة نفسها.')}`,
    actions: [{ label: 'تقديم التظلم', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#pf'));
      await post('/appeals', { sanction_id: sanctionId, appellant_kind: kind, appellant_id: id, grounds: b.grounds },
        'قُدّم التظلم — تفصل اللجنة خلال ستين يوماً');
      close(); render(); } }] });
}
function fileAppealApp(appId, kind, id) {
  modal({ title: 'تظلم من قرار على طلب', body: `<form id="pf" class="form-grid">
    ${F.area('grounds', 'أسباب التظلم', '', 6, true)}</form>`,
    actions: [{ label: 'تقديم', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#pf'));
      await post('/appeals', { application_id: appId, appellant_kind: kind, appellant_id: id, grounds: b.grounds }, 'قُدّم التظلم');
      close(); render(); } }] });
}

function decideAppeal(id) {
  modal({ title: 'البتّ في التظلم — لجنة التظلمات', body: `
    ${alertBox('info', 'استقلال اللجنة (المادة 22/1)',
      'ثلاثة أعضاء مستقلين من خارج المجلس واللجان: قانوني، ومحاسب قانوني، وشخصية ذات خبرة في العمل الأهلي، لمدة ثلاث سنوات غير قابلة للتجديد المتصل.')}
    <form id="af" class="form-grid">
      ${F.sel('decision', 'القرار', [['upheld', 'تأييد القرار المتظلَّم منه'],
        ['overturned', 'إلغاء القرار'], ['partially_upheld', 'قبول التظلم جزئياً'],
        ['inadmissible', 'عدم قبول التظلم شكلاً']], 'upheld', true)}
      ${F.area('reason', 'التسبيب الكتابي (إلزامي)', '', 6, true)}
    </form>`,
    actions: [{ label: 'إصدار القرار', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#af'));
      await post(`/appeals/${id}/decide`, b, 'صدر قرار اللجنة — نهائي في النطاق الداخلي للعلامة');
      close(); render(); } }] });
}
function stayAppeal(id) {
  modal({ title: 'وقف تنفيذ الجزاء أثناء نظر التظلم', body: `
    ${legal('المادة (22/4): لا يوقف التظلم تنفيذ قرار التعليق أو السحب إلا بقرار مسبَّب من اللجنة نفسها. ووقف التنفيذ يوقف التصعيد الآلي من التعليق إلى السحب حتى الفصل في التظلم.')}
    <form id="sf" class="form-grid">${F.area('reason', 'تسبيب وقف التنفيذ', '', 4, true)}</form>`,
    actions: [{ label: 'وقف التنفيذ', cls: 'primary', run: async (el, close) => {
      await post(`/appeals/${id}/stay`, readForm(el.querySelector('#sf')), 'قُرّر وقف التنفيذ'); close(); render(); } }] });
}

// ---------- الشكاوى ----------
function triageComplaint(id) {
  modal({ title: 'فرز البلاغ وإحالته', body: `<form id="tf" class="form-grid">
    ${F.sel('status', 'الحالة', [['triage', 'قيد الفرز'], ['investigating', 'قيد التحقيق'],
      ['substantiated', 'ثابت'], ['unsubstantiated', 'غير ثابت'], ['closed', 'مغلق']], 'investigating', true)}
    ${F.sel('open_audit', 'فتح تدقيق ميداني فوري', [['1', 'نعم — 100% وفوري (المادة 25)'], ['', 'لا']], '1')}
    ${F.area('resolution', 'الخلاصة أو الإجراء', '', 4)}
  </form>${legal('المادة (25): أي ملف ورد بشأنه بلاغ أو شكوى يخضع لتدقيق ميداني 100% وفوري. والمادة (29) من النظام الداخلي تقرّر حماية المبلّغين وسرّية القناة.')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#tf'));
      b.open_audit = b.open_audit === '1';
      await post(`/complaints/${id}/triage`, b, 'سُجّل الفرز');
      close(); render(); } }] });
}

// ---------- النزاهة ----------
function newIntegrityNote() {
  modal({ title: 'تسجيل ملاحظة نزاهة', body: `<form id="nf" class="form-grid">
    ${F.txt('title', 'العنوان', '', true)}
    ${F.sel('category', 'التصنيف', [['independence', 'استقلال المنظومة'], ['pressure', 'ضغط أو تدخل'],
      ['conflict_of_interest', 'تعارض مصالح'], ['transparency', 'شفافية'], ['other', 'أخرى']], 'independence', true)}
    ${F.area('body', 'نص الملاحظة', '', 6, true)}
  </form>${legal('المادة (23): تختص اللجنة بمراقبة استقلال المنظومة ونزاهتها ككل — لا بمراجعة الملفات الفردية. وترفع تقريرها إلى مجلس الأمناء مرتين سنوياً. وإذا لم يُستجب لتحذيراتها خلال تسعين يوماً، كان لها نشر ملاحظاتها علناً في السجل.')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      await post('/integrity-notes', readForm(el.querySelector('#nf')), 'سُجّلت الملاحظة وأُخطر المجلس');
      close(); render(); } }] });
}
function publishIntegrity(id) {
  modal({ title: 'النشر العلني لملاحظة النزاهة', body: alertBox('danger', 'إجراء لا رجعة فيه',
    'ستُنشر الملاحظة علناً في السجل العام. وهذه صلاحية جوهرية للجنة لا يجوز تعطيلها أو تقييدها بأي قرار (المادة 23/3)، وتُمارَس عند انقضاء تسعين يوماً دون استجابة من المجلس.'),
    actions: [{ label: 'نشر علني', cls: 'danger', run: async (_el, close) => {
      await post(`/integrity-notes/${id}/publish`, {}, 'نُشرت الملاحظة في السجل العام');
      close(); render(); } }] });
}
function respondIntegrity(id) {
  modal({ title: 'رد مجلس الأمناء', body: `<form id="rf" class="form-grid">
    ${F.area('response', 'نص الرد والإجراء المتخذ', '', 5, true)}</form>`,
    actions: [{ label: 'تسجيل الرد', cls: 'primary', run: async (el, close) => {
      await post(`/integrity-notes/${id}/respond`, readForm(el.querySelector('#rf')), 'سُجّل رد المجلس');
      close(); render(); } }] });
}

// ---------- المراقبون ----------
function nominateObserver() {
  modal({ title: 'ترشيح مراقب — نموذج (8)', body: `<form id="of" class="form-grid">
    ${F.txt('person_name', 'اسم المراقب', '', true)}
    ${F.txt('nominating_entity', 'الجهة المرشِّحة', '', true)}
    ${F.sel('entity_kind', 'قطاع الجهة', Object.entries(L.entityKind), 'civil', true)}
    ${F.txt('sector', 'وصف القطاع')}
    ${F.txt('cycle', 'الدورة', String(new Date().getFullYear()))}
  </form>${legal('المادة (34): يُقدَّم الترشيح كتابةً ويُقيَّد في سجل المراقبين المنشور علناً بأسماء الجهات المرشِّحة. ولا يزيد عدد المراقبين المقبولين في الدورة الواحدة على خمسة، ولا يمثّل قطاعٌ واحدٌ أكثر من مراقبَين. ويوقّع المراقب على إقرار سرّية وحياد.')}`,
    actions: [{ label: 'ترشيح', cls: 'primary', run: async (el, close) => {
      await post('/observers', readForm(el.querySelector('#of')), 'قُيّد الترشيح');
      close(); render(); } }] });
}
function decideObserver(id) {
  modal({ title: 'البتّ في صفة المراقب', body: `<form id="of" class="form-grid">
    ${F.sel('decision', 'القرار', [['admitted', 'قبول'], ['rejected', 'رفض'], ['ended', 'إنهاء الصفة']], 'admitted', true)}
    ${F.area('reason', 'التسبيب', '', 3)}
  </form>${legal('لمجلس الأمناء إنهاء صفة المراقب بقرار مسبَّب عند الإخلال بالضوابط (المادة 34/6). والنظام يرفض القبول عند بلوغ السقف العددي أو القطاعي.')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      await post(`/observers/${id}/decide`, readForm(el.querySelector('#of')), 'سُجّل القرار');
      close(); render(); } }] });
}

// ---------- المستخدمون والأدوار ----------
function roleChecks(selected = []) {
  return (S.rbac?.roles || []).map((r) => `<label style="display:flex;gap:7px;align-items:flex-start;font-size:.83rem">
    <input type="checkbox" class="rolechk" value="${E(r.code)}" ${selected.includes(r.code) ? 'checked' : ''}>
    <span><b>${E(r.name_ar)}</b>${r.sod_function
      ? `<br><span class="tag gold">${E(window.UI.sodName(r.sod_function))}</span>` : ''}</span></label>`).join('');
}
function newUser() {
  modal({ title: 'إضافة مستخدم', wide: true, body: `<form id="uf" class="form-grid">
    ${F.txt('full_name', 'الاسم الكامل', '', true)}
    ${F.txt('email', 'البريد الإلكتروني', '', true)}
    ${F.txt('phone', 'الهاتف')}
    ${F.sel('region', 'المنطقة', [['', '—'], ...(S.ref?.regions || []).map((r) => [r, r])])}
    ${F.txt('job_title', 'الوظيفة')}
    ${F.txt('password', 'كلمة المرور', 'Sema@2026', true)}
  </form>
  <h4 style="margin-top:14px">الأدوار</h4>
  <div class="form-grid">${roleChecks()}</div>
  ${legal('المادة (18): لا يجوز أن يجمع شخصٌ واحدٌ بين وظيفتين من الوظائف الأربع — والنظام يرفض التعيين المخالف.')}`,
    actions: [{ label: 'إضافة', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#uf'));
      b.roles = [...el.querySelectorAll('.rolechk:checked')].map((c) => c.value);
      await post('/users', b, 'أُضيف المستخدم');
      close(); render(); } }] });
}
async function editRoles(id, name) {
  const users = await api('/users?per_page=200');
  const u = users.rows.find((x) => x.id === id);
  const sel = (u?.roles || []).map((r) => r.role_code);
  modal({ title: 'أدوار ' + name, wide: true, body: `
    <div class="form-grid">${roleChecks(sel)}</div>
    <h4 style="margin-top:14px">نطاق محدد (اختياري)</h4>
    <div class="form-grid">
      ${F.numf('scope_licensee', 'رقم ملف المرخَّص له (لدور الشريك)',
        (u?.roles || []).find((r) => r.scope_kind === 'licensee')?.scope_id || '')}
      ${F.numf('scope_association', 'رقم ملف المنظمة (لدور الجمعية)',
        (u?.roles || []).find((r) => r.scope_kind === 'association')?.scope_id || '')}
    </div>
    ${legal('المادة (18): النظام يرفض أي تعيين يجمع بين وضع المعيار والتقييم وقرار الترخيص والتظلم/النزاهة.')}`,
    actions: [{ label: 'حفظ الأدوار', cls: 'primary', run: async (el, close) => {
      const f = readForm(el);
      const roles = [...el.querySelectorAll('.rolechk:checked')].map((c) => {
        const r = (S.rbac?.roles || []).find((x) => x.code === c.value);
        if (r?.scope_kind === 'licensee') return { role_code: c.value, scope_kind: 'licensee', scope_id: Number(f.scope_licensee) || null };
        if (r?.scope_kind === 'association') return { role_code: c.value, scope_kind: 'association', scope_id: Number(f.scope_association) || null };
        return c.value;
      });
      await post(`/users/${id}/roles`, { roles }, 'حُدّثت الأدوار');
      close(); render(); } }] });
}
async function sodCheck() {
  const codes = [...document.querySelectorAll('.sodchk:checked')].map((c) => c.value);
  const r = await api('/rbac/check', { method: 'POST', body: { roles: codes } });
  document.getElementById('sodout').innerHTML = r.conflict
    ? alertBox('danger', 'تعيين مرفوض', E(r.message))
    : alertBox('ok', 'تعيين مقبول', `لا تعارض في الوظائف. عدد الصلاحيات الناتج: <b>${r.permissions.length}</b>
      <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">${r.permissions.map((p) =>
        `<span class="tag">${E(window.UI.permName(p))}</span>`).join('')}</div>`);
}
function showRolePerms(code) {
  const r = (S.rbac?.roles || []).find((x) => x.code === code);
  if (!r) return;
  modal({ title: 'صلاحيات ' + r.name_ar, wide: true, body: `
    <p class="muted">${E(r.description)}</p>
    ${r.sod_function ? alertBox('warn', 'وظيفة محجوزة: ' + window.UI.sodName(r.sod_function),
      'لا يجوز الجمع بين هذا الدور وأي دور ينتمي لوظيفة أخرى من الوظائف الأربع.') : ''}
    <div style="display:flex;gap:5px;flex-wrap:wrap">${r.permissions.map((p) =>
      `<span class="tag">${E(window.UI.permName(p))}</span>`).join('')}</div>` });
}

// ---------- تحديث الملفات ----------
async function editLicensee(id) {
  const d = await api('/licensees/' + id);
  const all = has('licensee.edit.all');
  modal({ title: 'تحديث بيانات ' + d.legal_name, wide: true, body: `<form id="ef" class="form-grid">
    ${all ? F.txt('legal_name', 'الاسم القانوني', d.legal_name, true) : ''}
    ${F.txt('trade_name', 'الاسم التجاري', d.trade_name || '')}
    ${all ? F.sel('sector', 'القطاع', (S.ref?.sectors || []).map((s) => [s, s]), d.sector) : ''}
    ${F.txt('city', 'المدينة', d.city || '')}
    ${F.txt('address', 'العنوان', d.address || '')}
    ${F.txt('contact_name', 'جهة الاتصال', d.contact_name || '')}
    ${F.txt('contact_email', 'البريد', d.contact_email || '')}
    ${F.txt('contact_phone', 'الهاتف', d.contact_phone || '')}
    ${all ? F.numf('annual_revenue', 'الإيراد السنوي', d.annual_revenue || '') : ''}
    ${all ? F.numf('net_profit', 'صافي الربح قبل الضريبة', d.net_profit || '', false, 'any') : ''}
    ${all ? F.numf('fiscal_year', 'السنة المالية المرجعية', d.fiscal_year || '') : ''}
    ${all ? F.txt('scope_desc', 'وصف نطاق الترخيص', d.scope_desc || '') : ''}
    ${all ? F.txt('commercial_reg', 'السجل التجاري', d.commercial_reg || '') : ''}
    ${all ? F.txt('tax_file_no', 'الملف الضريبي', d.tax_file_no || '') : ''}
  </form>${legal(all ? 'تغيير الإيراد يعيد احتساب الشريحة والأرضية آلياً (المادة 5) — ويُعدَّل بعد مطابقته مع الإثبات المالي.'
    : 'تعدّل هنا بيانات التواصل. أما الإيراد وصافي الربح والقطاع والنطاق فتحدد الشريحة والرسم والالتزام، فتُحدَّث عبر إقرار الامتثال السنوي بإثباته المالي وتعتمدها الأمانة (المادة 23).')}`,
    actions: [{ label: 'حفظ', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#ef'));
      ['annual_revenue', 'net_profit', 'fiscal_year'].forEach((k) => { if (b[k]) b[k] = Number(b[k]); });
      await post('/licensees/' + id, b, 'حُدّثت البيانات', 'PATCH');
      close(); render(); } }] });
}
async function editOrg(id) {
  const d = await api('/associations/' + id);
  const all = has('org.edit.all');
  modal({ title: 'تحديث بيانات ' + d.name, wide: true, body: `<form id="ef" class="form-grid">
    ${all ? F.txt('name', 'اسم المنظمة', d.name, true) : ''}
    ${F.txt('city', 'المدينة', d.city || '')}
    ${F.txt('address', 'العنوان', d.address || '')}
    ${F.txt('focus_areas', 'مجالات العمل', d.focus_areas || '')}
    ${F.txt('contact_name', 'جهة الاتصال', d.contact_name || '')}
    ${F.txt('contact_email', 'البريد', d.contact_email || '')}
    ${F.txt('contact_phone', 'الهاتف', d.contact_phone || '')}
    ${all ? `${F.numf('board_size', 'حجم المجلس (ذوو حق التصويت)', d.board_size || '')}
    ${F.numf('paid_board_members', 'الأعضاء المأجورون', d.paid_board_members || 0)}
    ${F.numf('board_meetings_last_year', 'اجتماعات المجلس السنة الماضية', d.board_meetings_last_year || '')}
    ${F.numf('annual_revenue', 'الإيراد السنوي', d.annual_revenue || '')}
    ${F.numf('total_expenses', 'إجمالي المصروفات', d.total_expenses || '')}
    ${F.numf('admin_expenses', 'المصروفات الإدارية والتسييرية والدعائية', d.admin_expenses || '')}
    ${F.numf('fundraising_cost_ratio', 'نسبة كلفة جمع التبرعات', d.fundraising_cost_ratio || '', false, '0.01')}
    ${F.numf('largest_budget_3y', 'أكبر ميزانية سنوية في ثلاث سنوات', d.largest_budget_3y || '')}` : ''}
  </form>${legal(all ? 'يعيد النظام احتساب النسبة الإدارية وتصنيفها المنشور وسقف الاستيعاب ومستوى المراجعة المطلوب آلياً بعد الحفظ (المواد 14 و15 والمعيار 10).'
    : 'تعدّل هنا بيانات التواصل. أما أرقام الحوكمة والمالية فيُحسب منها التصنيف المنشور وسقف الاستيعاب، فتحدّثها الأمانة بعد مطابقتها مع القوائم المالية المدققة المحمَّلة في «إثباتاتي».')}`,
    actions: [{ label: 'حفظ', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#ef'));
      ['board_size', 'paid_board_members', 'board_meetings_last_year', 'annual_revenue',
       'total_expenses', 'admin_expenses', 'fundraising_cost_ratio', 'largest_budget_3y']
        .forEach((k) => { if (b[k]) b[k] = Number(b[k]); });
      await post('/associations/' + id, b, 'حُدّثت البيانات', 'PATCH');
      close(); render(); } }] });
}

async function assessCriteria(id) {
  const d = await api('/associations/' + id);
  const year = new Date().getFullYear();
  const cur = d.criteria.filter((c) => c.cycle_year === year);
  const crit = S.ref?.criteria || [];
  modal({ title: 'تقييم معايير الاعتماد — ' + d.name, wide: true, body: `
    ${alertBox('info', 'المعايير تُستوفى مجتمعةً', 'المادة (13): خمسة عشر معياراً. وعدم استيفاء أيٍّ منها يمنع الاعتماد.')}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>المعيار</th><th>النتيجة</th>
      <th>القيمة المقيسة</th><th>ملاحظة</th></tr></thead><tbody>
    ${crit.map((c) => { const e = cur.find((x) => x.criterion_no === c.no) || {};
      return `<tr><td><b>${c.no}</b></td>
      <td><b>${E(c.name_ar)}</b><div class="muted" style="white-space:normal;max-width:300px">${E(c.requirement_ar)}</div></td>
      <td><select data-c="${c.no}" data-k="result">
        ${[['met', 'مستوفى'], ['not_met', 'غير مستوفى'], ['partial', 'جزئي'], ['na', 'لا يسري']].map(([v, l]) =>
          `<option value="${v}" ${(e.result || 'met') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input data-c="${c.no}" data-k="measured_value" type="number" step="0.0001" style="width:100px"
        value="${e.measured_value ?? ''}"></td>
      <td><input data-c="${c.no}" data-k="note" style="width:220px" value="${E(e.note || '')}"></td></tr>`; }).join('')}
    </tbody></table></div>`,
    actions: [{ label: 'حفظ التقييم', cls: 'primary', run: async (el, close) => {
      const items = crit.map((c) => ({ criterion_no: c.no,
        result: el.querySelector(`[data-c="${c.no}"][data-k="result"]`).value,
        measured_value: el.querySelector(`[data-c="${c.no}"][data-k="measured_value"]`).value || null,
        note: el.querySelector(`[data-c="${c.no}"][data-k="note"]`).value || null }));
      const r = await post(`/associations/${id}/criteria`, { cycle_year: year, items }, 'حُفظ التقييم');
      toast(r.verdict, r.not_met.length ? 'danger' : '');
      close(); render(); } }] });
}

// ---------- أخرى ----------
function payInvoice(id) {
  modal({ title: 'تسجيل سداد', body: `<form id="pf" class="form-grid">
    ${F.txt('payment_ref', 'مرجع السداد', '', true)}</form>
    ${legal('المادة (34/2): يُسدَّد الرسم السنوي بعد صدور قرار المنح وقبل إصدار الشهادة. ورسوم الطلب غير مستردة في جميع الأحوال.')}`,
    actions: [{ label: 'تسجيل', cls: 'primary', run: async (el, close) => {
      await post(`/invoices/${id}/pay`, readForm(el.querySelector('#pf')), 'سُجّل السداد');
      close(); render(); } }] });
}
function editKpi(code, name, cur) {
  modal({ title: 'تحديث المؤشر — ' + name, body: `<form id="kf" class="form-grid">
    ${F.numf('year_no', 'السنة (1–5)', 1, true)}
    ${F.sel('kind', 'النوع', [['actual', 'الفعلي'], ['target', 'المستهدف']], 'actual', true)}
    ${F.numf('value', 'القيمة', cur ?? '', true, '0.01')}</form>`,
    actions: [{ label: 'حفظ', cls: 'primary', run: async (el, close) => {
      const b = readForm(el.querySelector('#kf'));
      await post(`/kpis/${code}/${Number(b.year_no)}`, { value: Number(b.value), kind: b.kind }, 'حُدّث المؤشر', 'PUT');
      close(); render(); } }] });
}
function editSetting(k, v) {
  modal({ title: 'تحديث الإعداد', body: `<form id="sf" class="form-grid">
    <div class="fld"><label>المفتاح</label><input value="${E(k)}" disabled></div>
    ${F.txt('value', 'القيمة', v, true)}</form>`,
    actions: [{ label: 'حفظ', cls: 'primary', run: async (el, close) => {
      await post(`/settings/${encodeURIComponent(k)}`, { value: readForm(el.querySelector('#sf')).value }, 'حُدّث الإعداد', 'PUT');
      close(); render(); } }] });
}
function showDiff(json) {
  let d; try { d = JSON.parse(json); } catch { return; }
  const pp = (s) => { try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s || '—'; } };
  modal({ title: 'تفصيل التغيير', wide: true, body: `
    <div class="grid g2"><div><h4>قبل</h4><pre class="mono" style="background:var(--surface-2);padding:10px;
      border-radius:7px;overflow:auto;max-height:420px;font-size:.74rem">${E(pp(d.b))}</pre></div>
    <div><h4>بعد</h4><pre class="mono" style="background:var(--surface-2);padding:10px;border-radius:7px;
      overflow:auto;max-height:420px;font-size:.74rem">${E(pp(d.a))}</pre></div></div>` });
}

window.APP = { stayAppeal, resubmitApp, uploadImpact, preapproveProgram, processDeclaration, decideDeclaration, scheduleAudit,
  newMarketTest, newMeeting, uploadDoc, verifyDoc, newApplication, screenApp, factsReport, decideApp,
  newContribution, confirmReceipt, verifyContribution, submitDeclaration, newDesign, decideDesign,
  auditReport, newSanction, fileAppeal, fileAppealApp, decideAppeal, triageComplaint,
  newIntegrityNote, publishIntegrity, respondIntegrity, nominateObserver, decideObserver,
  newUser, editRoles, sodCheck, showRolePerms, editLicensee, editOrg, assessCriteria,
  payInvoice, editKpi, editSetting, showDiff };

})();
