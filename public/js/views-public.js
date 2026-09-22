(function(){
'use strict';
/* ===== الواجهة العامة: الصفحة الرئيسة، السجل، التحقق، الحاسبة، الشفافية ===== */
const { S, api, qs, E, num, money, pct, dt, yr, L, lb, tag, tone, lvlBadge, ic, LOGO, toast, modal,
        route, render, go, has } = window.SEMA;
const { dataTable, bars, meter, stat, alertBox, legal, card, kv, tabs } = window.UI;

function pubShell(content, active) {
  const nav = [['', 'الرئيسة'], ['registry', 'السجل العام'], ['verify', 'التحقق من ترخيص'],
    ['calculator', 'حاسبة الالتزام'], ['levels', 'المستويات والمعايير'], ['transparency', 'الشفافية'],
    ['report-abuse', 'بلاغ أو شكوى']];
  return `<div class="app">
    ${window.UI.topbar()}
    <nav class="pub-nav"><div class="pub-nav-in">${nav.map(([h, t]) =>
      `<a href="#/${h}" class="${active === h ? 'on' : ''}">${E(t)}</a>`).join('')}
      <span class="spacer" style="flex:1"></span>
      ${S.user ? `<a class="btn primary sm" href="#/dashboard">لوحة العمل</a>`
        : `<a class="btn primary sm" href="#/login">بوابة الشركاء والجمعيات</a>`}
    </div></nav>
    ${content}
    <footer class="ft"><div class="ft-in">
      <div><b>علامة سِيمَا الخَيْر</b>العلامة الوطنية الليبية للمساهمة في الأعمال الخيرية والإنسانية والتنموية<br>
        <span style="font-family:var(--fs);color:var(--gold)">تَعْرِفُهُم بِسِيمَاهُم</span></div>
      <div><b>الحوكمة</b>مجلس أمناء من أحد عشر عضواً · فصل وظيفي إلزامي · لجنة حماية نزاهة<br>
        مستوفٍ لمنطق المواصفة ISO/IEC 17065</div>
      <div><b>السجل العام</b>مفتوح للبحث دون تسجيل دخول<br>
        <a href="#/verify">تحقّق من رقم ترخيص</a> · <a href="#/transparency">لوحة الشفافية</a></div>
      <div><b>تنويه</b>هذه نسخة تصويرية لعرض النظام.<br>البيانات افتراضية والمعايير مطابقة للّائحة.</div>
    </div></footer></div>`;
}

// ---------- الرئيسة ----------
route('', async () => {
  const [t, lic] = await Promise.all([
    api('/public/transparency').catch(() => null),
    api('/public/registry/licensees?per_page=6&sort=-verified_commitment').catch(() => ({ rows: [] })),
  ]);
  const levels = (S.ref?.levels || []);
  const html = `
  <section class="hero"><div class="hero-in">
    <h1>علامة «سِيمَا الخَيْر»</h1>
    <div class="wm">تَعْرِفُهُم بِسِيمَاهُم</div>
    <p>العلامة الوطنية الليبية للمساهمة في الأعمال الخيرية والإنسانية والتنموية. مدخلها الترويج لا التبرع:
      تمنح المنشأة قيمةً تسويقيةً موثَّقة مقابل التزام معلن وقابل للتحقق، تديره منظمات المجتمع المدني
      بفصلٍ وظيفيٍّ إلزاميٍّ بين وضع المعيار والتقييم وقرار الترخيص والتظلم.</p>
    <div class="btn-row">
      <a class="btn gold" href="#/verify">تحقّق من رقم ترخيص</a>
      <a class="btn" href="#/registry">استعرض السجل العام</a>
      <a class="btn" href="#/calculator">احسب التزام منشأتك</a>
    </div></div></section>
  <div class="pub">
    <div class="grid g4" style="margin-bottom:18px">
      ${stat('مرخَّص لهم سارون', num(t?.totals?.licensees), 'قطاع الأعمال والحرف والفنون')}
      ${stat('منظمات معتمدة', num(t?.totals?.associations), 'الاعتماد مجاني بالكامل', 'gold')}
      ${stat('موجَّه للخير', money(t?.totals?.directed_total), 'موثَّق ومتحقَّق منه')}
      ${stat('حالات سحب منشورة', num(t?.totals?.withdrawals_published), 'مؤشر مصداقية لا مؤشر فشل', 'danger')}
    </div>
    ${card('المستويات الخمسة', `<div class="grid g5">${levels.map((l) => `
      <div class="badge-lvl"><div class="top" style="background:${E(l.color_hex)}">
        <b>المستوى ${num(l.level)}</b><span>${E(l.name_ar)}</span></div>
      <div class="strip" style="background:${E(l.color_hex)};filter:brightness(.82)">${E(l.claim_ar)}</div>
      <div style="padding:9px 11px;font-size:.78rem;color:var(--ink-2)">
        ${l.profit_pct ? `<b>${(l.profit_pct * 100)}%</b> من صافي الربح قبل الضريبة`
          : '<b>100%</b> من صافي أرباح منتج أو خدمة أو خط إنتاج مخصص'}
        <div class="muted" style="margin-top:4px">تدقيق ميداني ${pct(l.field_audit_pct, 0)}${
          l.mandatory_audit ? ' · إلزامي بلا عيّنة' : ''}</div></div></div>`).join('')}</div>
      ${legal('المادة (4): الالتزام السنوي = الأعلى من النسبة المقررة للمستوى من صافي الربح قبل الضريبة، أو الحد الأدنى المطلق (الأرضية) المقرر لشريحة إيراد المنشأة. وتسري القاعدة سواء حقّقت المنشأة ربحاً أم لم تحقق.')}`)}
    <div class="grid g2">
      ${card('أعلى الملتزمين في السجل', `<div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>المنشأة</th><th>المستوى</th><th>الالتزام المتحقَّق</th></tr></thead><tbody>
        ${lic.rows.map((r) => `<tr><td><a href="#/verify/${E(r.license_no)}">${E(r.legal_name)}</a>
          <div class="muted mono">${E(r.license_no)}</div></td>
          <td>${lvlBadge(r.level, r.level_name, r.color_hex)}</td>
          <td class="num">${money(r.verified_commitment)}</td></tr>`).join('')}
        </tbody></table></div>`, { actions: '<a class="btn sm" href="#/registry">السجل كاملاً</a>' })}
      ${card('كيف تعمل المنظومة', `
        <div class="steps">
          ${[['المنشأة تتقدّم بطلب', 'سجل تجاري ساري، ملف ضريبي، انتظام ضمان اجتماعي، بيان التزام معلن، وإقرار الحد الأدنى للسلوك.'],
             ['وحدة التقييم تفحص وتدقق', 'تدقيق مكتبي وميداني وزيارات غير معلنة، وتقرير وقائع وأدلة بلا توصية.'],
             ['لجنة منح الترخيص تقرر', 'قرار مسبَّب كتابي — وهي وحدها المختصة بالمنح والمستوى والتعليق والسحب.'],
             ['القيد في السجل ورمز التحقق', 'رقم ترخيص فريد ورمز QR يفتح صفحة السجل العام مباشرةً.'],
             ['إقرار امتثال سنوي', 'خلال 120 يوماً من انتهاء السنة المالية، مسنَداً بإثبات مالي وإثبات صرف.'],
             ['التحقق أو الجزاء', 'تدرّج جزائي منشور من التنبيه إلى السحب — والتظلم أمام لجنة مستقلة.']]
            .map(([t, d], i) => `<div class="step done"><span class="dot">${i + 1}</span>
              <div><div class="ti">${E(t)}</div><div class="mt">${E(d)}</div></div></div>`).join('')}
        </div>`)}
    </div>
  </div>`;
  return pubShell(html, '');
});

// ---------- السجل العام ----------
route('registry', async () => {
  const html = pubShell(`<div class="pub">
    <div class="page-hd"><div><h1>السجل العام</h1>
      <p class="sub">مفتوح للبحث دون تسجيل دخول — المادة (33) و(37): الأصل هو النشر.</p></div></div>
    <div id="rtabs"></div></div>`, 'registry');
  setTimeout(() => {
    tabs(document.getElementById('rtabs'), [
      ['lic', 'المرخَّص لهم', null, (el) => { const d = document.createElement('div'); el.appendChild(d);
        dataTable(d, { path: '/public/registry/licensees',
          filters: [
            { k: 'q', t: 'بحث بالاسم أو رقم الترخيص', type: 'text', wide: true, ph: 'مثال: الواحة أو LY-KH-0001-26' },
            { k: 'level', t: 'المستوى', type: 'select', opts: (S.ref?.levels || []).map((l) => [l.level, `${l.level} — ${l.name_ar}`]) },
            { k: 'status', t: 'الحالة', type: 'select', opts: [['active','ساري'],['suspended','معلَّق'],['withdrawn','مسحوب'],['expired','منتهٍ']] },
            { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
            { k: 'sector', t: 'القطاع', type: 'select', opts: (S.ref?.sectors || []).map((s) => [s, s]) },
            { k: 'founding_partner', t: 'شريك مؤسس', type: 'bool' },
          ],
          cols: [
            { t: 'رقم الترخيص', srt: 'license_no', r: (r) => `<a href="#/verify/${E(r.license_no)}" class="mono">${E(r.license_no)}</a>` },
            { t: 'المنشأة', srt: 'legal_name', r: (r) => `<b>${E(r.legal_name)}</b>${r.trade_name ? `<div class="muted">${E(r.trade_name)}</div>` : ''}${r.founding_partner ? ' <span class="tag gold">شريك مؤسس</span>' : ''}` },
            { t: 'المستوى', srt: 'level', r: (r) => lvlBadge(r.level, r.level_name, r.color_hex) },
            { t: 'النطاق', r: (r) => `${E(lb('scopeType', r.scope_type))}<div class="muted">${E(r.scope_desc || '')}</div>` },
            { t: 'القطاع', k: 'sector' },
            { t: 'المنطقة', r: (r) => `${E(r.region || '—')}<div class="muted">${E(r.city || '')}</div>` },
            { t: 'الالتزام المتحقَّق', srt: 'verified_commitment', cls: 'num', r: (r) => r.verified_commitment ? `${money(r.verified_commitment)}<div class="muted">سنة ${yr(r.commitment_year)}</div>` : '<span class="muted">—</span>' },
            { t: 'السريان', r: (r) => `${dt(r.start_date)}<div class="muted">إلى ${dt(r.end_date)}</div>` },
            { t: 'الحالة', r: (r) => tag(r.status) + (r.status_reason ? `<div class="muted" style="max-width:260px;white-space:normal">${E(r.status_reason)}</div>` : '') },
          ],
          rowClick: (r) => go('verify/' + r.license_no) }); }],
      ['org', 'المنظمات المعتمدة', null, (el) => { const d = document.createElement('div'); el.appendChild(d);
        dataTable(d, { path: '/public/registry/associations',
          filters: [
            { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'اسم المنظمة أو رقم الاعتماد' },
            { k: 'admin_class', t: 'التصنيف الإداري', type: 'select', opts: (S.ref?.admin_classes || []).map((c) => [c.code, c.name_ar]) },
            { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
            { k: 'status', t: 'الحالة', type: 'select', opts: [['accredited','معتمد'],['suspended','معلَّق'],['revoked','مسحوب']] },
            { k: 'focus', t: 'مجال العمل', type: 'text', ph: 'صحة، تعليم، مياه…' },
            { k: 'ratio_max', t: 'نسبة إدارية أقل من', type: 'number', ph: '0.18', hint: 'كنسبة عشرية' },
          ],
          cols: [
            { t: 'رقم الاعتماد', r: (r) => `<a href="#/verify/${E(r.accreditation_no)}" class="mono">${E(r.accreditation_no)}</a>` },
            { t: 'المنظمة', srt: 'name', r: (r) => `<b>${E(r.name)}</b><div class="muted">${E(r.focus_areas || '')}</div>` },
            { t: 'المنطقة', r: (r) => `${E(r.region || '—')}<div class="muted">${E(r.city || '')}</div>` },
            { t: 'المصروفات الإدارية', srt: 'admin_expense_ratio', cls: 'num', r: (r) =>
              `<b>${pct(r.admin_expense_ratio)}</b> <span class="tag ${r.admin_class === 'rejected' ? 'danger' : r.admin_class === 'acceptable' ? 'warn' : 'ok'}">${E(r.admin_class_name || '')}</span>` },
            { t: 'سقف الاستيعاب', cls: 'num', r: (r) => `${money(r.absorption_cap)}
              <div class="muted">مستخدَم ${pct(r.absorption_cap ? r.absorption_used / r.absorption_cap : 0, 0)}</div>
              ${meter(r.absorption_used, r.absorption_cap)}` },
            { t: 'صلاحية الاعتماد', srt: 'accredited_to', r: (r) => `${dt(r.accredited_from)}<div class="muted">إلى ${dt(r.accredited_to)}</div>` },
            { t: 'الحالة', r: (r) => tag(r.status) },
          ],
          rowClick: (r) => go('verify/' + r.accreditation_no) }); }],
      ['snc', 'الجزاءات المنشورة', null, (el) => { const d = document.createElement('div'); el.appendChild(d);
        dataTable(d, { path: '/public/registry/sanctions',
          filters: [{ k: 'q', t: 'بحث', type: 'text', wide: true },
            { k: 'measure', t: 'الجزاء', type: 'select', opts: Object.entries(L.measure) },
            { k: 'subject_kind', t: 'الجهة', type: 'select', opts: [['licensee','مرخَّص له'],['association','منظمة'],['unlicensed','غير مرخَّص']] }],
          cols: [
            { t: 'رقم القضية', k: 'case_no', cls: 'mono' },
            { t: 'الجهة', r: (r) => `<b>${E(r.name)}</b><div class="muted">${E(lb('status', r.subject_kind) === r.subject_kind ? ({ licensee:'مرخَّص له', association:'منظمة معتمدة', unlicensed:'غير مرخَّص' }[r.subject_kind]) : '')}</div>` },
            { t: 'المخالفة', r: (r) => `<div style="max-width:320px;white-space:normal">${E(r.violation || '—')}</div>` },
            { t: 'الجزاء', r: (r) => `<span class="tag ${['withdrawal','suspension'].includes(r.measure) ? 'danger' : 'warn'}">${E(lb('measure', r.measure))}</span>` },
            { t: 'التسبيب', r: (r) => `<div class="muted" style="max-width:420px;white-space:normal">${E(r.reason)}</div>` },
            { t: 'التاريخ', srt: 'decided_at', r: (r) => dt(r.decided_at) },
            { t: 'منشور حتى', r: (r) => dt(r.publish_until) },
            { t: 'إعادة التقديم', r: (r) => r.reapply_allowed_from ? dt(r.reapply_allowed_from) : '<span class="muted">—</span>' },
          ] });
        el.insertAdjacentHTML('beforeend', legal('المادة (31): يُنشر السحب في السجل مع السبب ويبقى منشوراً اثني عشر شهراً. ولا يجوز إعادة التقديم قبل انقضاء اثني عشر شهراً من السحب، أو أربعة وعشرين شهراً في حالتَي البند (8) و(9) من المادة (29).')); }],
      ['former', 'المرخَّص لهم السابقون', null, async (el) => {
        const d = await api('/public/registry/former');
        el.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr>
          <th>رقم الترخيص</th><th>المنشأة</th><th>المستوى</th><th>تاريخ الانتهاء</th><th>التصنيف</th><th>السبب</th>
          </tr></thead><tbody>${d.rows.length ? d.rows.map((r) => `<tr>
            <td class="mono">${E(r.license_no)}</td><td><b>${E(r.legal_name)}</b></td>
            <td>${num(r.level)}</td><td>${dt(r.end_date)}</td>
            <td><span class="tag ${r.status === 'withdrawn' ? 'danger' : 'warn'}">${E(r.category)}</span></td>
            <td class="muted" style="white-space:normal;max-width:420px">${E(r.status_reason || '—')}</td></tr>`).join('')
          : '<tr><td colspan="6"><div class="empty"><b>لا قيود</b></div></td></tr>'}</tbody></table></div>
          ${legal(E(d.note))}`; }],
    ]);
  }, 0);
  return html;
});

// ---------- التحقق ----------
route('verify', async (r) => {
  const key = r.params[0] || '';
  if (!key) return pubShell(`<div class="pub">
    <div class="page-hd"><div><h1>التحقق من ترخيص أو اعتماد</h1>
      <p class="sub">المادة (36): يُتاح لكل مرخَّص له رمز QR يفتح صفحة السجل العام الخاصة برقم ترخيصه مباشرةً.</p></div></div>
    ${card('', `<form onsubmit="event.preventDefault();SEMA.go('verify/'+encodeURIComponent(this.k.value.trim()))">
      <div class="filters" style="background:none;border:none;padding:0">
        <div class="fld wide"><label>رقم الترخيص أو رقم الاعتماد أو رمز التحقق</label>
          <input name="k" placeholder="LY-KH-0001-26 أو LY-KH-ORG-001-26" required></div>
        <div class="fld"><label>&nbsp;</label><button class="btn primary">تحقّق</button></div></div></form>
      ${alertBox('warn', 'تنبيه', 'استعمال العلامة من غير مرخَّص مخالفة موجبة لخطاب كفٍّ وامتناع، ثم غرامة تعادل خمسة أضعاف الرسم السنوي لشريحته، ثم دعوى قضائية (المادة 29/11). إن رأيت الشعار بلا رقم ترخيص فأبلغ عبر <a href="#/report-abuse">صفحة البلاغات</a>.')}`)}
    </div>`, 'verify');

  let d;
  try { d = await api('/public/verify/' + encodeURIComponent(key)); }
  catch (e) {
    return pubShell(`<div class="pub"><div class="verify-card">
      <div class="verify-hd no"><div><h2>لا يوجد قيد بهذا الرقم</h2>
        <div class="st mono">${E(key)}</div></div></div>
      <div class="card-bd">${alertBox('danger', 'غير مقيَّد في السجل العام',
        E(e.data?.warning || 'لا يوجد قيد بهذا الرقم.'))}
        <a class="btn" href="#/verify">بحث جديد</a>
        <a class="btn danger" href="#/report-abuse">أبلغ عن استعمال غير مرخَّص</a></div></div></div>`, 'verify');
  }

  const isLic = d.kind === 'licensee';
  const html = `<div class="pub">
    <div class="verify-card">
      <div class="verify-hd ${d.valid ? 'ok' : 'no'}">
        <div style="flex:1"><h2>${E(isLic ? d.legal_name : d.name)}</h2>
          <div class="st mono">${E(isLic ? d.license_no : d.accreditation_no)} · ${E(d.message)}</div></div>
        ${isLic ? `<div class="badge-lvl"><div class="top" style="background:${E(d.color_hex)}">
          <b>المستوى ${num(d.level)}</b><span>${E(d.level_name)}</span></div>
          <div class="strip" style="background:${E(d.color_hex)};filter:brightness(.8)">${E(d.claim_ar)}</div></div>` : ''}
      </div>
      <div class="card-bd">
        ${!d.valid ? alertBox('danger', 'هذا القيد غير ساري', E(d.status_reason || '')) : ''}
        ${isLic ? kv([
          ['الاسم التجاري', E(d.trade_name || '—')],
          ['نطاق الترخيص', `${E(lb('scopeType', d.scope_type))} — ${E(d.scope_desc || '')}`],
          ['القطاع', E(d.sector)], ['الموقع', `${E(d.region)} — ${E(d.city)}`],
          ['تاريخ البدء', dt(d.start_date)], ['تاريخ الانتهاء', dt(d.end_date)],
          ['الحالة', tag(d.status)],
          d.founding_partner ? ['صفة الشراكة', '<span class="tag gold">شريك مؤسس — دون أي تخفيف في المعايير أو التدقيق (المادة 39)</span>'] : null,
          d.verified_commitment ? ['الالتزام المتحقَّق منه',
            `<b>${money(d.verified_commitment.total_paid)}</b> من أصل ${money(d.verified_commitment.commitment_due)}
             عن السنة ${num(d.verified_commitment.fiscal_year)}
             ${meter(d.verified_commitment.total_paid, d.verified_commitment.commitment_due, { warnAt: 0.999, dangerAt: 99 })}`] : null,
        ]) : kv([
          ['الموقع', `${E(d.region)} — ${E(d.city)}`],
          ['مجال العمل', E(d.focus_areas || '—')],
          ['نسبة المصروفات الإدارية', `<b>${pct(d.admin_expense_ratio)}</b>
            <span class="tag ${d.admin_class === 'rejected' ? 'danger' : d.admin_class === 'acceptable' ? 'warn' : 'ok'}">${E(d.admin_class_name)}</span>`],
          ['سقف الاستيعاب', `${money(d.absorption_cap)} — مستخدَم ${money(d.absorption_used)}
            ${meter(d.absorption_used, d.absorption_cap)}`],
          ['صلاحية الاعتماد', `${dt(d.accredited_from)} إلى ${dt(d.accredited_to)}`],
          ['الحالة', tag(d.status)],
          ['الرسوم', 'لا تُحصَّل من منظمة المجتمع المدني أي رسوم في أي مرحلة (المادة 12)'],
        ])}
      </div>
    </div>

    ${isLic && d.allowed_claim ? card('الادعاء المسموح به حصراً', `
      <div class="legal" style="font-size:.95rem">«${E(d.allowed_claim)}»</div>
      ${alertBox('warn', 'ما يُحظر (المادة 19/3)', 'تغيير ألوان العلامة أو نسبها · حذف رقم الترخيص · وضع العلامة على منتج خارج نطاق الترخيص · إيراد ادعاء مطلق من نوع «شركة مسؤولة» أو «الأفضل خيرياً» · وضع العلامة بجوار ادعاء غير مرخَّص.')}`) : ''}

    ${isLic && d.beneficiary_associations?.length ? card('المنظمات المستفيدة', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المنظمة</th><th>رقم الاعتماد</th><th>المنطقة</th></tr></thead><tbody>
      ${d.beneficiary_associations.map((a) => `<tr><td><a href="#/verify/${E(a.accreditation_no)}">${E(a.name)}</a></td>
        <td class="mono">${E(a.accreditation_no)}</td><td>${E(a.region)}</td></tr>`).join('')}
      </tbody></table></div>`) : ''}

    ${!isLic && d.public_documents?.length ? card('المستندات المنشورة', `<ul style="margin:0;padding-inline-start:20px">
      ${d.public_documents.map((x) => `<li>${window.UI.docLink(x)} <span class="muted">— ${E(x.doc_type_name || '')} ${x.issued_on ? '· ' + dt(x.issued_on) : ''}</span></li>`).join('')}
      </ul><p class="muted" style="margin-top:8px">يتطلب العرض تسجيل دخول للاطلاع على الملف.</p>`) : ''}

    ${d.published_sanctions?.length ? card('الجزاءات المنشورة على هذا القيد', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>القضية</th><th>المخالفة</th><th>الجزاء</th><th>التسبيب</th><th>التاريخ</th></tr></thead><tbody>
      ${d.published_sanctions.map((s) => `<tr><td class="mono">${E(s.case_no)}</td><td>${E(s.violation || '')}</td>
        <td><span class="tag danger">${E(lb('measure', s.measure))}</span></td>
        <td class="muted" style="white-space:normal;max-width:420px">${E(s.reason)}</td><td>${dt(s.decided_at)}</td></tr>`).join('')}
      </tbody></table></div>`) : ''}

    <div class="btn-row"><a class="btn" href="#/verify">بحث جديد</a>
      <a class="btn" href="#/registry">السجل العام</a>
      <a class="btn danger" href="#/report-abuse">أبلغ عن مخالفة</a></div>
  </div>`;
  return pubShell(html, 'verify');
});

// ---------- الحاسبة ----------
route('calculator', async () => {
  const html = pubShell(`<div class="pub">
    <div class="page-hd"><div><h1>حاسبة الالتزام والرسوم</h1>
      <p class="sub">المادة (4): الالتزام = الأعلى من النسبة أو الأرضية — وتسري سواء حقّقت المنشأة ربحاً أم لم تحقق.</p></div></div>
    <div class="grid g2">
      ${card('مُعطيات المنشأة', `<form id="calcf">
        <div class="form-grid">
          <div class="fld"><label>الإيراد السنوي (دينار ليبي)</label>
            <input name="revenue" type="number" min="0" step="1000" value="3500000" required></div>
          <div class="fld"><label>صافي الربح قبل الضريبة</label>
            <input name="net_profit" type="number" step="1000" value="900000"></div>
          <div class="fld"><label>المستوى المطلوب</label><select name="level">
            ${(S.ref?.levels || []).map((l) => `<option value="${l.level}" ${l.level === 2 ? 'selected' : ''}>
              المستوى ${l.level} — ${E(l.name_ar)} ${l.profit_pct ? `(${l.profit_pct * 100}%)` : '(الوَقفية)'}</option>`).join('')}
          </select></div>
          <div class="fld"><label>صافي ربح النطاق المخصص <span class="hint">للمستوى الخامس فقط</span></label>
            <input name="scope_net_profit" type="number" step="1000" placeholder="اتركه فارغاً"></div>
        </div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary">احسب</button></div></form>`)}
      <div id="calcout"></div>
    </div>
    ${card('جدول شرائح الإيراد والأرضيات المطلقة', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الشريحة</th><th>الإيراد السنوي (د.ل)</th><th>أرضية م1</th><th>أرضية م2</th><th>أرضية م3</th>
        <th>أرضية م4</th><th>رسم الطلب</th><th>سنوي م1–م2</th><th>سنوي م3–م5</th><th>تدقيق ميداني</th></tr></thead>
      <tbody>${(S.ref?.tiers || []).map((t) => `<tr>
        <td><b>${E(t.code)}</b></td>
        <td>${t.max_revenue ? `${num(t.min_revenue)} – أقل من ${num(t.max_revenue)}` : `${num(t.min_revenue)} فأكثر`}</td>
        ${[1,2,3,4].map((i) => `<td class="num">${t['floor_l' + i] != null ? num(t['floor_l' + i])
          : pct(t['floor_pct_l' + i], 2) + ' من الإيراد'}</td>`).join('')}
        <td class="num">${num(t.app_fee)}</td><td class="num">${num(t.annual_fee_l12)}</td>
        <td class="num">${num(t.annual_fee_l35)}</td><td class="num">${pct(t.field_audit_pct, 0)}</td></tr>`).join('')}
      </tbody></table></div>
      ${legal('المادة (34): رسوم الطلب غير مستردة في جميع الأحوال بما فيها حالة الرفض · خصم 20% على المستويات الثالث والرابع والخامس تكريساً لمبدأ أن من يلتزم أكثر يدفع أقل · سقف مطلق قدره 30,000 دينار للرسم السنوي للمرخَّص الواحد مهما بلغ حجمه، حمايةً لاستقلال العلامة عن أي مرخَّص كبير · الرسوم لا تُحتسب ضمن الالتزام الخيري بأي حال.')}`)}
    </div>`, 'calculator');
  setTimeout(() => {
    const f = document.getElementById('calcf');
    const out = document.getElementById('calcout');
    const run = async () => {
      const b = Object.fromEntries(new FormData(f).entries());
      for (const k of Object.keys(b)) b[k] = b[k] === '' ? null : Number(b[k]);
      out.innerHTML = '<div class="load">جارٍ الاحتساب…</div>';
      const d = await api('/public/calculator', { method: 'POST', body: b });
      const c = d.commitment;
      out.innerHTML = card('النتيجة', `
        <div class="grid g2" style="margin-bottom:12px">
          ${stat('الالتزام السنوي الواجب', money(c.commitment_due), E(c.basis_note), 'gold')}
          ${stat('الرسم السنوي', money(d.fees.annual_fee), d.fees.capped ? 'مطبَّق عليه السقف المطلق 30,000 د.ل' : 'قابل للخصم 20% في المستويات 3–5')}
        </div>
        ${kv([
          ['الشريحة', `${E(c.tier_code)} — ${E(c.tier_name)}`],
          ['المستوى', `${E(c.level_name)} (${c.level_pct ? c.level_pct * 100 + '%' : '100% من النطاق المخصص'})`],
          ['قيمة النسبة', money(c.pct_amount)],
          ['الأرضية المطلقة', money(c.floor_amount)],
          ['أساس الاحتساب', `<b>${E(c.basis_note)}</b>`],
          ['رسم الطلب (غير مستردّ)', money(d.fees.application_fee)],
          ['نسبة التدقيق الميداني', `${pct(d.field_audit.rate, 0)} — <span class="muted">${E(d.field_audit.reason)}</span>`],
          ['الحد الأدنى النقدي', `${money(c.commitment_due * 0.5)} <span class="muted">— لا يقل الجزء النقدي عن 50% (المادة 21)</span>`],
        ])}
        ${c.level5_floor_check ? alertBox('warn', 'تنبيه المستوى الخامس', E(c.level5_floor_check)) : ''}
        <h4 style="margin-top:14px">الأثر الضريبي التقديري</h4>
        ${kv([
          ['سقف الخصم الضريبي (2% من صافي الدخل)', money(d.tax.deduction_cap)],
          ['القابل للخصم من الالتزام', money(d.tax.deductible)],
          ['الكلفة الصافية على المنشأة', `<b>${money(d.tax.net_cost)}</b> <span class="muted">بضريبة دخل شركات 20%</span>`],
        ])}
        ${alertBox('info', 'تنويه', E(d.tax.note))}
        <h4 style="margin-top:14px">الادعاء المسموح به</h4>
        <div class="legal">«${E(d.claim)}»</div>`);
    };
    f.onsubmit = (e) => { e.preventDefault(); run(); };
    run();
  }, 0);
  return html;
});

// ---------- المستويات والمعايير ----------
route('levels', async () => {
  const ref = S.ref || {};
  return pubShell(`<div class="pub">
    <div class="page-hd"><div><h1>المستويات والمعايير والجزاءات</h1>
      <p class="sub">مرجع علني لكل ما تحكمه لائحة الاعتماد والترخيص والرقابة.</p></div></div>

    ${card('معايير اعتماد منظمات المجتمع المدني — خمسة عشر معياراً تُستوفى مجتمعةً', `
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>المعيار</th><th>الاشتراط</th><th>الحد</th></tr></thead>
      <tbody>${(ref.criteria || []).map((c) => `<tr><td><b>${num(c.no)}</b></td><td><b>${E(c.name_ar)}</b></td>
        <td style="white-space:normal">${E(c.requirement_ar)}</td>
        <td class="num">${c.threshold == null ? '—' : c.threshold <= 1 && c.is_quantitative && c.no >= 8 ? pct(c.threshold, 0) : num(c.threshold)}</td></tr>`).join('')}
      </tbody></table></div>
      ${legal('المادة (12): لا تُحصَّل من منظمة المجتمع المدني أي رسوم مقابل التقديم أو التقييم أو الاعتماد أو التجديد أو القيد في السجل. وتُموَّل كلفة الاعتماد من رسوم ترخيص قطاع الأعمال.')}`)}

    ${card('تصنيف المستوى الإداري المنشور (المادة 15)', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>النسبة</th><th>التصنيف</th><th>الأثر</th></tr></thead><tbody>
      ${(ref.admin_classes || []).map((c) => `<tr>
        <td class="num">${c.max_pct == null ? `أكثر من ${pct(c.min_pct, 0)}` : `${pct(c.min_pct, 0)} – أقل من ${pct(c.max_pct, 0)}`}</td>
        <td><span class="tag ${c.accredit ? (c.code === 'acceptable' ? 'warn' : 'ok') : 'danger'}">${E(c.name_ar)}</span></td>
        <td>${c.accredit ? 'يُنشر' : 'لا يُمنح الاعتماد / يُسحب'}</td></tr>`).join('')}
      </tbody></table></div>
      ${alertBox('warn', 'تنبيه إرشادي', 'النسبة الأقل من 5% تستوجب فحصاً إضافياً من وحدة التقييم، لأنها كثيراً ما تدل على تحميل تكاليف إدارية على بنود البرامج أو على منظمة لا تستثمر في قدرتها المؤسسية.')}`)}

    ${card('المسارات المؤهلة للالتزام (المادة 20)', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>البند</th><th>يُحتسب</th><th>السقف من إجمالي الالتزام</th><th>الشرط</th></tr></thead><tbody>
      ${(ref.channels || []).map((c) => `<tr><td><b>${E(c.name_ar)}</b></td>
        <td>${c.counts ? '<span class="tag ok">نعم</span>' : '<span class="tag danger">لا</span>'}</td>
        <td class="num">${c.max_share == null ? (c.counts ? 'لا حد' : '—') : pct(c.max_share, 0)}</td>
        <td style="white-space:normal" class="muted">${E(c.condition_ar)}</td></tr>`).join('')}
      </tbody></table></div>
      ${legal('المادة (21) قاعدة النصف النقدي: لا يقل الجزء النقدي عن 50% من إجمالي الالتزام السنوي. ولا يجوز أن يتكوّن الالتزام بالكامل من تبرعات عينية أو وقت تطوّع.<br>المادة (22): لا يجوز توجيه أكثر من 60% من الالتزام السنوي إلى منظمة واحدة إذا تجاوز الالتزام مئة ألف دينار، إلا بموافقة مسبقة من لجنة المعايير — منعاً لنشوء علاقة تبعية.')}`)}

    ${card('التدرّج الجزائي (المادة 29)', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>الحالة</th><th>الجزاء</th></tr></thead><tbody>
      ${(ref.violations || []).map((v) => `<tr><td><b>${num(v.code)}</b></td>
        <td style="white-space:normal">${E(v.case_ar)}</td>
        <td style="white-space:normal"><span class="tag ${['withdrawal','suspension'].includes(v.default_measure) ? 'danger' : 'warn'}">${E(lb('measure', v.default_measure))}</span>
          <div class="muted">${E(v.measure_ar)}</div></td></tr>`).join('')}
      </tbody></table></div>`)}

    ${card('نسب التدقيق الميداني السنوي (المادة 25)', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الفئة</th><th>النسبة</th></tr></thead><tbody>
      ${[['المستويان الأول والثاني — الشرائح أ، ب، ج','20% عيّنة عشوائية'],
         ['المستويان الأول والثاني — الشريحة د','35%'],
         ['المستوى الثالث — كل الشرائح','35%'],
         ['المستويان الرابع والخامس','100% سنوياً'],
         ['الشريحتان هـ و و — أياً كان المستوى','100% سنوياً'],
         ['أي ملف ورد بشأنه بلاغ أو شكوى','100% وفوري'],
         ['السنة الأولى للعلامة (المرحلة التجريبية)','100% من كل الملفات']]
        .map(([a, b]) => `<tr><td>${E(a)}</td><td><b>${E(b)}</b></td></tr>`).join('')}
      </tbody></table></div>
      ${legal('المادة (26): لا تقل الزيارات غير المعلنة عن 10% من إجمالي الزيارات الميدانية السنوية، وتُختار عشوائياً بآلية موثّقة لا يعلمها المقيّم قبل يوم الزيارة. ويُحظر إخطار المرخَّص له بموعد أي زيارة غير معلنة، بأي وسيلة ومن أي جهة — ومخالفة هذا الحظر من أي منتسب موجبة لإنهاء الخدمة.')}`)}

    ${card('مسار الطلب والمواعيد المعيارية (المادة 17)', `<div class="steps">
      ${(ref.app_stages || []).map((s, i) => `<div class="step done"><span class="dot">${s.stage}</span>
        <div><div class="ti">${E(s.name)}</div>
        <div class="mt">${E(s.body)}${s.max_days ? ` · المدة القصوى ${s.max_days} يوم عمل` : ''}</div></div></div>`).join('')}
      </div><p class="muted" style="margin-top:8px">إجمالي المدة المعيارية: 90 يوم عمل من اكتمال الطلب.
      وتُنشر مدة المعالجة الفعلية المتوسطة في التقرير السنوي.</p>`)}
    </div>`, 'levels');
});

// ---------- الشفافية ----------
route('transparency', async () => {
  const d = await api('/public/transparency');
  const total = d.spending.reduce((s, x) => s + x.amount, 0);
  const over = d.spending.filter((x) => x.category !== 'program').reduce((s, x) => s + x.amount, 0);
  return pubShell(`<div class="pub">
    <div class="page-hd"><div><h1>لوحة الشفافية</h1>
      <p class="sub">${E(d.note)}</p></div></div>
    <div class="grid g4" style="margin-bottom:16px">
      ${stat('مرخَّص لهم سارون', num(d.totals.licensees))}
      ${stat('منظمات معتمدة', num(d.totals.associations), '', 'gold')}
      ${stat('إجمالي الموجَّه للخير', money(d.totals.directed_total))}
      ${stat('متوسط مدة المعالجة', num(d.totals.avg_processing_days) + ' يوماً', 'المدة المعيارية 90 يوم عمل')}
      ${stat('تدقيق ميداني منفَّذ', num(d.totals.field_audits))}
      ${stat('زيارات غير معلنة', num(d.totals.unannounced_visits), 'لا تقل عن 10% من الزيارات')}
      ${stat('حالات سحب منشورة', num(d.totals.withdrawals_published), '', 'danger')}
      ${stat('نسبة الإدارة وجمع التمويل', pct(total ? over / total : 0), 'السقف 25%', over / total > 0.25 ? 'danger' : 'ok')}
    </div>
    ${card('إنفاق الأمانة على الفئات الثلاث (المادة 31)', bars(d.spending.map((s) => ({
      k: s.label + ' — ' + pct(s.share), v: s.amount,
      color: s.category === 'program' ? 'var(--green)' : s.category === 'fundraising' ? 'var(--gold)' : 'var(--silver)' })),
      { fmt: money }) + legal('سقف الإدارة العامة وجمع التمويل 25% كمتوسط ثلاث سنوات — السويد تشترط 75% للغرض، وألمانيا تصنّف ما فوق 30% «غير مقبول».'))}

    ${d.integrity_disclosures.length ? card('ملاحظات لجنة حماية النزاهة المنشورة علناً',
      d.integrity_disclosures.map((n) => alertBox('warn', n.title,
        `${E(n.body)}<div class="muted" style="margin-top:5px">نُشرت في ${dt(n.published_at)} — ${E(n.reference)}</div>`)).join('')
      + legal('المادة (23/3): إذا لم يُستجب لتحذيرات اللجنة خلال تسعين يوماً، كان لها نشر ملاحظاتها علناً في السجل — وهذه الصلاحية جوهرية ولا يجوز تعطيلها أو تقييدها بأي قرار.')) : ''}

    ${card('جولات اختبار السوق (المادة 28)', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الجولة</th><th>المدينة</th><th>التاريخ</th><th>نقاط البيع</th><th>الأصناف</th>
        <th>استعمال صحيح</th><th>بلا رقم ترخيص</th><th>مستوى مخالف</th><th>خارج النطاق</th>
        <th>غير مرخَّص</th><th>نسبة المطابقة</th></tr></thead><tbody>
      ${d.market_tests.map((m) => `<tr><td><b>${E(m.round_name)}</b></td><td>${E(m.city)}</td><td>${dt(m.conducted_on)}</td>
        <td class="num">${num(m.outlets_visited)}</td><td class="num">${num(m.items_checked)}</td>
        <td class="num">${num(m.correct_usage)}</td><td class="num">${num(m.missing_license_no)}</td>
        <td class="num">${num(m.level_mismatch)}</td><td class="num">${num(m.out_of_scope)}</td>
        <td class="num">${num(m.unlicensed_usage)}</td>
        <td class="num"><b>${pct(m.items_checked ? m.correct_usage / m.items_checked : 0)}</b></td></tr>`).join('')}
      </tbody></table></div>`)}

    ${card('سجل المراقبين المقبولين (المادة 34)', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المراقب</th><th>الجهة المرشِّحة</th><th>القطاع</th><th>بداية الدورة</th></tr></thead><tbody>
      ${d.observers.map((o) => `<tr><td><b>${E(o.person_name)}</b></td><td>${E(o.nominating_entity)}</td>
        <td><span class="tag">${E(lb('entityKind', o.entity_kind))}</span></td><td>${dt(o.term_start)}</td></tr>`).join('')}
      </tbody></table></div>
      ${legal('للمراقب حق الحضور والمداخلة، ولا صوت له ولا حق في الاطلاع على ملف فردي قيد التقييم. ولا يزيد عدد المراقبين المقبولين في الدورة الواحدة على خمسة، ولا يمثّل قطاعٌ واحدٌ أكثر من مراقبَين. ويتحمل المراقب مصاريف مشاركته، ولا يترتب على تحمّله لها أي حق إضافي في التأثير على القرار.')}`)}
    </div>`, 'transparency');
});

// ---------- بلاغ ----------
route('report-abuse', async () => {
  const html = pubShell(`<div class="pub">
    <div class="page-hd"><div><h1>بلاغ أو شكوى — نموذج (9)</h1>
      <p class="sub">قناة سرّية وحماية للمبلّغين (المادة 29). وأي ملف يرد بشأنه بلاغ يخضع لتدقيق ميداني 100% وفوري (المادة 25).</p></div></div>
    <div class="grid g2">
      ${card('بيانات البلاغ', `<form id="cf">
        <div class="form-grid">
          <div class="fld"><label>موضوع البلاغ</label><select name="subject_kind">
            <option value="licensee">مرخَّص له</option><option value="association">منظمة معتمدة</option>
            <option value="unlicensed">جهة غير مرخَّصة تستعمل العلامة</option>
            <option value="secretariat">الأمانة أو أحد منتسبيها</option></select></div>
          <div class="fld"><label>اسم الجهة (إن عُرف)</label><input name="subject_name" placeholder="اسم المنشأة أو المنظمة"></div>
          <div class="fld"><label>قناة الإبلاغ</label><select name="channel">
            <option value="portal">البوابة</option><option value="email">بريد</option>
            <option value="phone">هاتف</option><option value="field">ميداني</option></select></div>
          <div class="fld"><label>بلاغ مجهول الهوية؟</label><select name="is_anonymous">
            <option value="1">نعم — لا تُسجَّل هويتي</option><option value="0">لا</option></select></div>
          <div class="fld"><label>الاسم (اختياري)</label><input name="reporter_name"></div>
          <div class="fld"><label>وسيلة التواصل (اختياري)</label><input name="reporter_contact"></div>
        </div>
        <div class="fld" style="margin-top:10px"><label>نص البلاغ — كن محدداً: ماذا ومتى وأين</label>
          <textarea name="body" rows="6" required minlength="10"
            placeholder="مثال: رأيت شعار العلامة على عبوة في متجر بشارع… بتاريخ… دون رقم ترخيص بجواره."></textarea></div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary">إرسال البلاغ</button></div></form>`)}
      ${card('ماذا يحدث بعد الإرسال', `<div class="steps">
        ${[['يُسجَّل البلاغ برقم مرجعي','يُقيَّد فوراً في النظام ويُخطَر به لجنة حماية النزاهة ومدير وحدة التقييم.'],
           ['فرز وإحالة','تُفرز البلاغات وتُحال للتدقيق. وأي ملف ورد بشأنه بلاغ يخضع لتدقيق ميداني 100% وفوري.'],
           ['تدقيق ووقائع','يُنفَّذ التدقيق ويُرفع تقرير وقائع وأدلة بلا توصية.'],
           ['قرار مسبَّب','تبتّ لجنة منح الترخيص في الجزاء وفق التدرّج الجزائي المنشور، ويُنشر ما يوجب النشر.']]
          .map(([t, d], i) => `<div class="step done"><span class="dot">${i + 1}</span>
            <div><div class="ti">${E(t)}</div><div class="mt">${E(d)}</div></div></div>`).join('')}
        </div>
        ${alertBox('ok', 'حماية المبلّغين', 'المعيار (13) يشترط على كل منظمة معتمدة قناة شكاوى سرّية وحماية للمبلّغين، والمادة (29) من النظام الداخلي تقرّر الحماية ذاتها في الأمانة. لا يُفصح عن هوية المبلّغ.')}`)}
    </div></div>`, 'report-abuse');
  setTimeout(() => {
    const f = document.getElementById('cf');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(f).entries());
      b.is_anonymous = b.is_anonymous === '1';
      try {
        const r = await api('/complaints', { method: 'POST', body: b });
        modal({ title: 'تم تسجيل البلاغ', body: `${alertBox('ok', 'الرقم المرجعي: ' + r.reference,
          E(r.note))}<p>احفظ الرقم المرجعي للمتابعة.</p>` });
        f.reset();
      } catch (er) { toast(er.message, 'danger'); }
    };
  }, 0);
  return html;
});

// ---------- الدخول ----------
route('login', async () => {
  const d = await api('/auth/demo-accounts').catch(() => ({ accounts: [], password: 'Sema@2026' }));
  const html = `<div class="login-wrap"><div class="login">
    <div class="login-l">
      <div class="logo" style="margin-bottom:20px"><span class="logo-mark">${LOGO}</span>
        <span class="logo-txt"><b>سِيمَا الخَيْر</b><span>تَعْرِفُهُم بِسِيمَاهُم</span></span></div>
      <h2>بوابة الشركاء والجمعيات والإدارة</h2>
      <p class="muted" style="font-size:.86rem">كل دور يرى ما تُجيزه له مصفوفة الصلاحيات في النظام الداخلي،
        والنظام يمنع آلياً الجمع بين وظيفتين متعارضتين (المادة 18).</p>
      <form id="lf" style="margin-top:16px">
        <div class="fld" style="margin-bottom:10px"><label>البريد الإلكتروني</label>
          <input name="email" type="email" required autocomplete="username" value="director@sema.ly"></div>
        <div class="fld" style="margin-bottom:14px"><label>كلمة المرور</label>
          <input name="password" type="password" required autocomplete="current-password" value="Sema@2026"></div>
        <button class="btn primary" style="width:100%;justify-content:center">تسجيل الدخول</button>
        <div id="lerr" style="margin-top:10px"></div>
      </form>
      <p class="muted" style="font-size:.8rem;margin-top:14px">
        <a href="#/">العودة إلى السجل العام</a> — السجل مفتوح للبحث دون تسجيل دخول.</p>
    </div>
    <div class="login-r">
      <h4>حسابات تصويرية (${d.accounts.length})</h4>
      <p class="muted" style="font-size:.78rem">اضغط أي حساب لتعبئة بياناته. كلمة المرور للجميع
        <code>${E(d.password)}</code></p>
      ${d.accounts.map((a) => `<div class="acct" data-em="${E(a.email)}">
        <div style="flex:1"><div class="nm">${E(a.full_name)}</div>
        <div class="rl">${E(a.roles)}</div>
        <div class="rl mono">${E(a.email)}</div></div></div>`).join('')}
    </div></div></div>`;
  setTimeout(() => {
    document.querySelectorAll('.acct').forEach((a) => a.onclick = () => {
      document.querySelector('[name=email]').value = a.dataset.em;
      document.querySelector('[name=password]').value = d.password;
    });
    document.getElementById('lf').onsubmit = async (e) => {
      e.preventDefault();
      const b = Object.fromEntries(new FormData(e.target).entries());
      try {
        const r = await api('/auth/login', { method: 'POST', body: b });
        S.token = r.token; localStorage.setItem('sema_token', r.token);
        S.user = r.user;
        S.rbac = await api('/rbac').catch(() => null);
        S.notif = await api('/notifications').catch(() => ({ rows: [], unread: 0 }));
        go('dashboard');
      } catch (er) {
        document.getElementById('lerr').innerHTML = alertBox('danger', 'تعذّر الدخول', E(er.message));
      }
    };
  }, 0);
  return html;
});

})();
