(function(){
'use strict';
/* ===== التقارير · المؤشرات · المالية · المعايير · الصلاحيات · المستخدمون · التتبع ===== */
const { S, api, E, num, money, pct, dt, yr, today, L, lb, tag, toast, modal, route, go, has, kfmt } = window.SEMA;
const { shell, dataTable, bars, meter, spark, stat, alertBox, legal, card, kv, tabs, docLink, sodName } = window.UI;
const guard = () => { if (!S.user) { location.hash = '#/login'; return false; } return true; };
const mount = (fn) => setTimeout(fn, 0);

// ================= التقارير =================
route('reports', async (r) => {
  if (!guard()) return '';
  const list = await api('/reports');
  const key = r.params[0];
  if (!key) return shell(`<div class="grid g2">${list.reports.map((x) => `
    <div class="card"><div class="card-bd">
      <h3><a href="#/reports/${E(x.key)}">${E(x.title)}</a></h3>
      <p class="muted" style="font-size:.82rem">${E(x.note)}</p>
      <div class="btn-row"><a class="btn sm primary" href="#/reports/${E(x.key)}">عرض</a>
      ${has('report.export') ? `<a class="btn sm" href="/api/reports/${E(x.key)}/export.csv?token=${encodeURIComponent(S.token)}" target="_blank">CSV</a>` : ''}</div>
    </div></div>`).join('')}</div>`, { title: 'التقارير الجاهزة',
      sub: 'تقارير مبنية على نصوص اللائحة والنظام الداخلي — قابلة للفلترة بالسنة والمنطقة والتصدير' });

  const year = S.route.query.year || 2026;
  const d = await api(`/reports/${key}?year=${year}${S.route.query.region ? '&region=' + encodeURIComponent(S.route.query.region) : ''}`);
  const rows = Array.isArray(d.data) ? d.data : (d.data.rows || [d.data]);
  const cols = rows.length && typeof rows[0] === 'object' ? Object.keys(rows[0]) : [];
  const HDR = { license_no:'رقم الترخيص', legal_name:'المنشأة', sector:'القطاع', region:'المنطقة',
    tier_code:'الشريحة', level:'المستوى', level_name:'اسم المستوى', status:'الحالة', start_date:'البدء',
    end_date:'الانتهاء', commitment_due:'الالتزام الواجب', total_paid:'الموثَّق', deficit_pct:'نسبة العجز',
    basis:'الأساس', fiscal_year:'السنة', deficit_amount:'قيمة العجز', cash_share:'حصة النقدي',
    assessment:'التكييف', accreditation_no:'رقم الاعتماد', name:'الاسم', annual_revenue:'الإيراد',
    total_expenses:'إجمالي المصروفات', admin_expenses:'المصروفات الإدارية', admin_expense_ratio:'النسبة الإدارية',
    admin_class:'التصنيف', class_name:'التصنيف المنشور', fundraising_cost_ratio:'كلفة الجمع',
    absorption_cap:'سقف الاستيعاب', absorption_used:'المستخدَم', flag:'تنبيه', active:'سارية',
    audited:'مدقَّقة', unannounced:'غير معلنة', required_rate:'النسبة المقررة', required_reason:'السند',
    actual_rate:'النسبة الفعلية', compliant:'مطابق', case_no:'القضية', violation:'المخالفة', measure:'الجزاء',
    fine_amount:'الغرامة', reason:'التسبيب', decided_at:'تاريخ القرار', effective_to:'نهاية السريان',
    published:'منشور', publish_until:'منشور حتى', reapply_allowed_from:'إعادة التقديم',
    licensee:'المساهم', association:'المنظمة', channel:'المسار', amount:'المبلغ', transfers:'عدد التحويلات',
    stage:'المرحلة', stage_name_ar:'اسم المرحلة', responsible_body:'الجهة', max_days:'المدة القصوى',
    n:'العدد', breached:'تجاوزات', avg_days:'المتوسط الفعلي', category:'الفئة', share:'الحصة',
    partner_class:'صفة الشراكة', accredited_from:'بداية الاعتماد', commitment_year:'سنة الالتزام',
    trade_name:'الاسم التجاري', city:'المدينة' };
  const NUMC = new Set(['commitment_due','total_paid','deficit_amount','annual_revenue','total_expenses',
    'admin_expenses','absorption_cap','absorption_used','amount','fine_amount','n','transfers','active',
    'audited','unannounced','breached','max_days','stage','level','outlets_visited','items_checked']);
  const PCTC = new Set(['deficit_pct','cash_share','admin_expense_ratio','fundraising_cost_ratio',
    'required_rate','actual_rate','share','overhead_ratio']);
  const YEARC = new Set(['fiscal_year', 'commitment_year', 'established_year', 'year_no']);
  const fmtv = (c, v) => v == null ? '<span class="muted">—</span>'
    : YEARC.has(c) ? yr(v) : PCTC.has(c) ? pct(v) : NUMC.has(c) ? num(v)
    : typeof v === 'boolean' ? (v ? '<span class="tag ok">نعم</span>' : '<span class="tag danger">لا</span>')
    : (c === 'status' || c === 'basis' || c === 'measure' || c === 'admin_class') ? tag(v, c === 'measure' ? 'measure' : 'status')
    : `<span style="white-space:normal">${E(String(v).slice(0, 320))}</span>`;

  const isFounders = key === 'founding_partners';
  const extra = key === 'transparency' ? `
    <div class="grid g4" style="margin-bottom:12px">
      ${stat('إجمالي الإنفاق', money(d.data.total))}
      ${stat('نسبة الإدارة وجمع التمويل', pct(d.data.overhead_ratio), 'السقف ' + pct(d.data.cap, 0),
        d.data.compliant ? 'ok' : 'danger')}
      ${stat('مطابق للسقف', d.data.compliant ? 'نعم' : 'لا', '', d.data.compliant ? '' : 'danger')}
    </div>${legal(E(d.data.note))}` : '';

  return shell(`
    <div class="filters">
      <div class="fld"><label>السنة</label><select id="yr">
        ${[2026, 2025].map((y) => `<option ${String(year) === String(y) ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      <div class="fld"><label>المنطقة</label><select id="rg"><option value="">الكل</option>
        ${(S.ref?.regions || []).map((x) => `<option ${S.route.query.region === x ? 'selected' : ''}>${E(x)}</option>`).join('')}</select></div>
      <div class="fld"><label>&nbsp;</label><button class="btn primary" onclick="SEMA.go('reports/${E(key)}?year='+document.getElementById('yr').value+'&region='+encodeURIComponent(document.getElementById('rg').value))">تطبيق</button></div>
      <div class="fld"><label>&nbsp;</label><a class="btn" href="/api/reports/${E(key)}/export.csv?year=${year}&token=${encodeURIComponent(S.token)}" target="_blank">تصدير CSV</a></div>
      <div class="fld"><label>&nbsp;</label><button class="btn" onclick="window.print()">طباعة</button></div>
    </div>
    ${legal(E(d.note))}
    ${extra}
    ${isFounders ? `
      ${card('الشركاء المؤسسون والعاملون — قطاع الأعمال', tbl(d.data.licensees, HDR, fmtv))}
      ${card('الشركاء من المنظمات', tbl(d.data.associations, HDR, fmtv))}
      ${legal('المادة (39): يُمنح الشركاء المؤسسون أولوية في المعالجة وصفة «شريك مؤسس» في السجل بصفة دائمة، دون أي تخفيف في المعايير أو في التدقيق، ودون أن يؤثر ذلك على قرار المنح.')}`
      : card('', tbl(rows, HDR, fmtv), { tight: false })}`,
    { title: d.title, sub: `السنة ${E(String(year))} — ${num(rows.length)} سجلاً` });
});
const tbl = (rows, HDR, fmtv) => { if (!rows || !rows.length) return '<div class="empty"><b>لا بيانات</b></div>';
  const cols = Object.keys(rows[0]);
  return `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) =>
    `<th>${E(HDR[c] || c)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) =>
    `<tr>${cols.map((c) => `<td>${fmtv(c, r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`; };

// ================= المؤشرات =================
route('kpis', async () => {
  if (!guard()) return '';
  const d = await api('/kpis');
  return shell(`
    ${alertBox('info', 'مستهدفات خمس سنوات',
      'السنة صفر (ستة أشهر تأسيس) تسبق السنة الأولى: تسجيل العلامة، تشكيل الحوكمة، بناء السجل، 12–15 شريكاً مؤسساً. والنطاق الجغرافي: طرابلس الكبرى في السنة الأولى، ثلاث مدن في الثانية، وطني في الثالثة.')}
    <div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>المؤشر</th><th>الوحدة</th><th>س1</th><th>س2</th><th>س3</th><th>س4</th><th>س5</th>
      <th>الفعلي س1</th><th>الإنجاز</th><th>المسار</th><th>طريقة القياس</th><th>المرجع العالمي</th>
      ${has('kpi.manage') ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.kpis.map((k) => { const a1 = k.actuals[0], t1 = k.targets[0];
        const ach = t1 ? a1 / t1 : null;
        return `<tr><td><b>${E(k.name_ar)}</b></td><td class="muted">${E(k.unit || '')}</td>
        ${k.targets.map((t, i) => `<td class="num ${i === 0 ? '' : 'muted'}">${t == null ? '—' : num(t)}</td>`).join('')}
        <td class="num"><b>${a1 == null ? '—' : num(a1)}</b></td>
        <td class="num">${ach == null ? '—' : `<span class="tag ${ach >= 1 ? 'ok' : ach >= 0.7 ? 'warn' : 'danger'}">${pct(ach, 0)}</span>`}</td>
        <td style="min-width:90px">${spark(k.targets.map((x) => x || 0))}</td>
        <td class="muted" style="white-space:normal;max-width:240px">${E(k.method_ar || '')}</td>
        <td class="muted" style="white-space:normal;max-width:240px">${E(k.benchmark_ar || '')}</td>
        ${has('kpi.manage') ? `<td><button class="btn sm" onclick="APP.editKpi('${E(k.code)}','${E(k.name_ar)}',${a1 == null ? 'null' : a1})">تحديث</button></td>` : ''}
        </tr>`; }).join('')}
    </tbody></table></div>`, { title: 'المؤشرات والمستهدفات', sub: 'مستهدفات خمس سنوات مقابل الفعلي المسجَّل' });
});

route('risks', async () => {
  if (!guard()) return '';
  const d = await api('/risks');
  return shell(card('سجل المخاطر', `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>#</th><th>الخطر</th><th>الاحتمال</th><th>الأثر</th><th>إجراء التخفيف</th><th>الجهة المسؤولة</th></tr></thead>
    <tbody>${d.rows.map((r, i) => `<tr><td>${num(i + 1)}</td>
      <td style="white-space:normal;max-width:380px"><b>${E(r.risk_ar)}</b></td>
      <td><span class="tag ${r.likelihood === 'عالية' ? 'danger' : r.likelihood === 'متوسطة' ? 'warn' : ''}">${E(r.likelihood)}</span></td>
      <td><span class="tag ${String(r.impact).includes('جداً') ? 'danger' : r.impact === 'عالٍ' ? 'warn' : ''}">${E(r.impact)}</span></td>
      <td style="white-space:normal;max-width:420px">${E(r.mitigation_ar)}</td>
      <td class="muted">${E(r.owner_body)}</td></tr>`).join('')}</tbody></table></div>`),
    { title: 'سجل المخاطر', sub: 'المخاطر النظامية والتشغيلية وإجراءات التخفيف والجهة المسؤولة' });
});

// ================= المالية =================
route('finance', async () => {
  if (!guard()) return '';
  const b = await api('/budget?year=2026').catch(() => null);
  const html = shell(`<div id="fb"></div>`, { title: 'الرسوم والمالية',
    sub: 'المادة (33) و(34) جدول الرسوم · المادة (31) تصنيف الإنفاق الثلاثي · المادة (28) حدود التمويل' });
  mount(() => tabs(document.getElementById('fb'), [
    ['inv', 'الفواتير والتحصيل', null, (el) => { const d = document.createElement('div'); el.appendChild(d);
      dataTable(d, { path: '/invoices',
        filters: [
          { k: 'q', t: 'بحث', type: 'text', wide: true },
          { k: 'fee_type', t: 'نوع الرسم', type: 'select', opts: Object.entries(L.feeType) },
          { k: 'status', t: 'الحالة', type: 'select', opts: [['issued','مستحق'],['paid','مسدَّد'],['overdue','متأخر'],['waived','معفى'],['void','ملغى']] },
          { k: 'tier_code', t: 'الشريحة', type: 'select', opts: (S.ref?.tiers || []).map((t) => [t.code, t.code]) },
          { k: 'fiscal_year', t: 'السنة', type: 'select', opts: [[2026, '2026'], [2025, '2025']] },
          { k: 'issued_from', t: 'إصدار من', type: 'date' },
          { k: 'overdue_before', t: 'استحقاق قبل', type: 'date' },
        ],
        cols: [
          { t: 'الفاتورة', r: (r) => `<span class="mono">${E(r.invoice_no)}</span>` },
          { t: 'الجهة', r: (r) => r.subject_id
            ? `<a href="#/licensees/${r.subject_id}">${E(r.resolved_name)}</a><div class="muted mono">${E(r.license_no || '')}</div>`
            : E(r.resolved_name || '—') },
          { t: 'النوع', r: (r) => `<span class="tag">${E(lb('feeType', r.fee_type))}</span>` },
          { t: 'الشريحة / المستوى', r: (r) => `${E(r.tier_code || '—')} ${r.level ? '· م' + num(r.level) : ''}` },
          { t: 'الأساس', cls: 'num', r: (r) => money(r.base_amount) },
          { t: 'الخصم', cls: 'num', r: (r) => r.discount_pct ? `${r.discount_pct}%
            <div class="muted" style="white-space:normal;max-width:220px">${E(r.discount_reason || '')}</div>` : '—' },
          { t: 'المستحق', srt: 'amount', cls: 'num', r: (r) => `<b>${money(r.amount)}</b>
            ${r.capped ? '<div><span class="tag warn">سقف مطلق</span></div>' : ''}` },
          { t: 'الإصدار', srt: 'issued_at', r: (r) => dt(r.issued_at) },
          { t: 'الاستحقاق', srt: 'due_at', r: (r) => r.status === 'issued' && r.due_at < today()
            ? `<span class="tag danger">${dt(r.due_at)}</span>` : dt(r.due_at) },
          { t: 'السداد', r: (r) => r.paid_at ? `${dt(r.paid_at)}<div class="muted mono">${E(r.payment_ref || '')}</div>` : '—' },
          { t: 'الحالة', srt: 'status', r: (r) => tag(r.status) },
          ...(has('finance.invoice') ? [{ t: '', r: (r) => r.status !== 'paid'
            ? `<button class="btn sm primary" onclick="APP.payInvoice(${r.id})">تسجيل سداد</button>` : '' }] : []),
        ],
        summary: (d2) => `<div class="grid g4" style="padding:12px 16px 0">
          ${(d2.summary || []).map((s) => stat(lb('status', s.status), money(s.s), num(s.n) + ' فاتورة',
            s.status === 'paid' ? 'ok' : s.status === 'overdue' ? 'danger' : '')).join('')}</div>`,
      }); }],
    ['bud', 'موازنة الأمانة', null, () => {
      if (!b) return '<div class="empty"><b>غير متاح</b></div>';
      const byCat = {};
      for (const r of b.rows) { byCat[r.category] = byCat[r.category] || { rows: [], total: 0 };
        byCat[r.category].rows.push(r); byCat[r.category].total += (r.actual || r.budgeted || 0); }
      const total = Object.values(byCat).reduce((s, x) => s + x.total, 0);
      const over = (byCat.admin?.total || 0) + (byCat.fundraising?.total || 0);
      const CN = { program: 'برامجي', fundraising: 'جمع تمويل', admin: 'إدارة عامة' };
      return `<div class="card-bd">
        <div class="grid g4" style="margin-bottom:14px">
          ${stat('إجمالي الإنفاق', money(total))}
          ${Object.entries(byCat).map(([k, v]) => stat(CN[k], money(v.total), pct(total ? v.total / total : 0),
            k === 'program' ? 'gold' : '')).join('')}
          ${stat('الإدارة + جمع التمويل', pct(total ? over / total : 0), 'السقف 25%',
            over / total > 0.25 ? 'danger' : 'ok')}
        </div>
        ${Object.entries(byCat).map(([k, v]) => card(CN[k] + ' — ' + money(v.total),
          `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>البند</th><th>الموازنة</th><th>الفعلي</th><th>الانحراف</th></tr></thead>
          <tbody>${v.rows.map((r) => `<tr><td>${E(r.line_item)}</td><td class="num">${money(r.budgeted)}</td>
            <td class="num">${money(r.actual)}</td>
            <td class="num ${(r.actual || 0) > (r.budgeted || 0) ? '' : ''}">${money((r.actual || 0) - (r.budgeted || 0))}</td></tr>`).join('')}
          </tbody></table></div>`)).join('')}
        ${legal('المادة (31): يُصنَّف إنفاق الأمانة على ثلاث فئات — برامجي، وجمع تمويل، وإدارة عامة — ويُنشر التوزيع في القوائم المالية السنوية.')}</div>`; }],
    ['src', 'مصادر التمويل وحدودها', null, () => {
      if (!b) return '<div class="empty"><b>غير متاح</b></div>';
      return `<div class="card-bd">
        ${stat('إجمالي الموارد', money(b.total_funding))}
        <div style="margin-top:14px">${bars(b.sources.map((s) => ({
          k: `${s.source_name} (${pct(s.share)})`, v: s.amount,
          color: s.share > 0.25 ? 'var(--danger)' : s.source_kind === 'fees' ? 'var(--green)' : 'var(--gold)' })),
          { fmt: money })}</div>
        <div class="tbl-wrap" style="margin-top:14px"><table class="tbl">
          <thead><tr><th>المصدر</th><th>النوع</th><th>المبلغ</th><th>الحصة</th><th>مشروط</th>
            <th>موافقة المجلس مطلوبة</th><th>معتمد</th></tr></thead><tbody>
          ${b.sources.map((s) => `<tr><td><b>${E(s.source_name)}</b></td>
            <td class="muted">${E({ fees:'رسوم', grant:'منحة', donation:'تبرع', sponsorship:'رعاية',
              training:'تدريب', other:'أخرى' }[s.source_kind] || s.source_kind)}</td>
            <td class="num">${money(s.amount)}</td>
            <td class="num">${s.share > 0.25 ? `<span class="tag danger">${pct(s.share)}</span>` : pct(s.share)}</td>
            <td>${s.conditional ? '<span class="tag warn">مشروط</span>' : '<span class="tag ok">غير مشروط</span>'}</td>
            <td>${s.board_approval_required ? 'نعم' : 'لا'}</td>
            <td>${s.board_approved ? '<span class="tag ok">معتمد</span>' : (s.board_approval_required ? '<span class="tag danger">بانتظار</span>' : '—')}</td></tr>`).join('')}
        </tbody></table></div>
        ${legal(E(b.limits_note) + '<br>المادة (34/5): سقف مطلق قدره 30,000 دينار للرسم السنوي للمرخَّص الواحد مهما بلغ حجمه، حمايةً لاستقلال العلامة عن أي مرخَّص كبير.')}</div>`; }],
  ]));
  return html;
});

// ================= المعايير والرسوم =================
route('standards', async () => {
  if (!guard()) return '';
  const ref = S.ref || {};
  return shell(`
    ${alertBox('info', 'اختصاص لجنة المعايير (المادة 19)',
      'صياغة معايير الأهلية والمستويات والنسب والأرضيات، ومراجعتها دورياً كل ثلاث سنوات وجوباً، وإصدار التفسيرات الملزمة، والموافقة المسبقة على البرامج التنموية الذاتية. ويُحظر عليها تقييم أي طلب أو منح أي ترخيص. وتعرض كل تعديل جوهري على مشاورة عامة لا تقل عن ثلاثين يوماً قبل رفعه للمجلس.')}
    ${card('المستويات الخمسة والنسب', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المستوى</th><th>التسمية</th><th>النسبة من صافي الربح</th><th>اللون</th>
        <th>العبارة المعتمدة</th><th>التدقيق الميداني</th><th>إلزامي</th></tr></thead><tbody>
      ${(ref.levels || []).map((l) => `<tr><td><b>${num(l.level)}</b></td>
        <td><span class="lvl"><i style="background:${E(l.color_hex)}"></i>${E(l.name_ar)}</span></td>
        <td class="num">${l.profit_pct ? pct(l.profit_pct, 0) : '100% من النطاق المخصص'}</td>
        <td class="mono">${E(l.color_hex)}</td><td>${E(l.claim_ar)}</td>
        <td class="num">${pct(l.field_audit_pct, 0)}</td>
        <td>${l.mandatory_audit ? '<span class="tag danger">بلا عيّنة</span>' : '—'}</td></tr>`).join('')}
      </tbody></table></div>
      ${legal('المادة (7): يُشترط لمنح المستوى الخامس تخصيص محاسبي منفصل (مركز تكلفة مستقل) للمنتج أو الخدمة أو خط الإنتاج المخصص. ويخضع لتدقيق سنوي إلزامي بلا استثناء ولا عيّنة. ولا يقل الالتزام الناتج عنه عن أرضية المستوى الثالث لشريحة المنشأة.')}`)}
    ${card('شرائح الإيراد والأرضيات وجدول الرسوم', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الشريحة</th><th>الإيراد السنوي</th><th>أرضية م1</th><th>أرضية م2</th><th>أرضية م3</th>
        <th>أرضية م4</th><th>رسم الطلب</th><th>سنوي م1–م2</th><th>سنوي م3–م5</th><th>تدقيق</th></tr></thead><tbody>
      ${(ref.tiers || []).map((t) => `<tr><td><b>${E(t.code)}</b></td>
        <td>${t.max_revenue ? `${num(t.min_revenue)} – أقل من ${num(t.max_revenue)}` : `${num(t.min_revenue)} فأكثر`}</td>
        ${[1,2,3,4].map((i) => `<td class="num">${t['floor_l' + i] != null ? num(t['floor_l' + i]) : pct(t['floor_pct_l' + i], 2)}</td>`).join('')}
        <td class="num">${num(t.app_fee)}</td><td class="num">${num(t.annual_fee_l12)}</td>
        <td class="num">${num(t.annual_fee_l35)}</td><td class="num">${pct(t.field_audit_pct, 0)}</td></tr>`).join('')}
      </tbody></table></div>
      ${legal('المادة (5): يُراجع جدول الشرائح والأرضيات سنوياً وجوباً بقرار من مجلس الأمناء، ويُنشر التعديل قبل بدء السنة المالية التالية بستين يوماً على الأقل.')}`)}
    ${card('معايير اعتماد المنظمات — خمسة عشر معياراً', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>المعيار</th><th>الاشتراط</th></tr></thead><tbody>
      ${(ref.criteria || []).map((c) => `<tr><td><b>${num(c.no)}</b></td><td><b>${E(c.name_ar)}</b></td>
        <td style="white-space:normal">${E(c.requirement_ar)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${card('المسارات المؤهلة وسقوفها', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>البند</th><th>يُحتسب</th><th>السقف</th><th>الشرط</th></tr></thead><tbody>
      ${(ref.channels || []).map((c) => `<tr><td><b>${E(c.name_ar)}</b></td>
        <td>${c.counts ? '<span class="tag ok">نعم</span>' : '<span class="tag danger">لا</span>'}</td>
        <td class="num">${c.max_share == null ? (c.counts ? 'لا حد' : '—') : pct(c.max_share, 0)}</td>
        <td class="muted" style="white-space:normal">${E(c.condition_ar)}</td></tr>`).join('')}</tbody></table></div>`)}
    ${card('التدرّج الجزائي', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>#</th><th>الحالة</th><th>الجزاء المقرر</th><th>حظر إعادة التقديم</th><th>النشر</th></tr></thead><tbody>
      ${(ref.violations || []).map((v) => `<tr><td><b>${num(v.code)}</b></td>
        <td style="white-space:normal">${E(v.case_ar)}</td>
        <td style="white-space:normal">${E(v.measure_ar)}</td>
        <td class="num">${v.reapply_ban_months ? num(v.reapply_ban_months) + ' شهراً' : '—'}</td>
        <td>${v.publish ? '<span class="tag danger">علني</span>' : '—'}</td></tr>`).join('')}</tbody></table></div>`)}`,
    { title: 'المعايير والرسوم', sub: 'المرجع النظامي الكامل — وأي تعديل يمرّ بمشاورة عامة ثلاثين يوماً ثم اعتماد المجلس' });
});

// ================= الأدوار والصلاحيات =================
route('rbac', async () => {
  if (!guard()) return '';
  const d = S.rbac || await api('/rbac');
  const M = d.decision_matrix;
  const CLS = { 'م':'m-m', 'ت':'m-t', 'ي':'m-y', 'خ':'m-kh', '✕':'m-x', '—':'m-n' };
  const html = shell('<div id="rb"></div>', { title: 'الأدوار والصلاحيات',
    sub: 'مبنية على المادة (18) الفصل الوظيفي وملحق مصفوفة الصلاحيات في النظام الداخلي' });
  mount(() => tabs(document.getElementById('rb'), [
    ['roles', 'الأدوار', d.roles.length, () => `<div class="card-bd">
      ${alertBox('danger', 'قاعدة الفصل الوظيفي (المادة 18)', E(d.rule) +
        '<br>والنظام يرفض آلياً أي تعيين يخالف ذلك — مستمد من المواصفة ISO/IEC 17065 التي توجب أن يتخذ قرار منح الشهادة شخصٌ مستقل عمّن نفّذ التقييم.')}
      <div class="grid g2" style="margin-bottom:14px">
        ${d.sod_functions.map((f) => `<div class="stat gold"><div class="k">وظيفة محجوزة</div>
          <div class="v" style="font-size:1.05rem">${E(f.name_ar)}</div>
          <div class="d">${E(d.roles.filter((r) => r.sod_function === f.code).map((r) => r.name_ar).join(' · '))}</div></div>`).join('')}
      </div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الدور</th><th>الفئة</th><th>الوظيفة المحجوزة</th>
        <th>النطاق</th><th>عدد الصلاحيات</th><th>الوصف النظامي</th></tr></thead><tbody>
      ${d.roles.map((r) => `<tr><td><b>${E(r.name_ar)}</b><div class="muted mono">${E(r.code)}</div></td>
        <td><span class="tag">${E({ governance:'حوكمة', executive:'تنفيذي', external:'خارجي' }[r.category])}</span></td>
        <td>${r.sod_function ? `<span class="tag gold">${E(sodName(r.sod_function))}</span>` : '<span class="muted">—</span>'}</td>
        <td class="muted">${E({ global:'عام', licensee:'ملف مرخَّص له', association:'ملف منظمة' }[r.scope_kind])}</td>
        <td class="num"><button class="btn link" onclick="APP.showRolePerms('${E(r.code)}')">${num(r.permission_count)}</button></td>
        <td style="white-space:normal;max-width:520px" class="muted">${E(r.description)}</td></tr>`).join('')}
      </tbody></table></div></div>`],
    ['matrix', 'مصفوفة الصلاحيات', M ? M.rows.length : 0, () => !M ? '<div class="empty"><b>غير متاحة</b></div>'
      : `<div class="card-bd">
      <div style="display:flex;gap:9px;flex-wrap:wrap;margin-bottom:10px">
        ${Object.entries(M.legend).map(([k, v]) => `<span class="tag ${CLS[k]}"><b>${E(k)}</b> ${E(v)}</span>`).join('')}</div>
      <div class="tbl-wrap"><table class="tbl matrix"><thead><tr><th>القرار</th>
        ${M.bodies.map((b) => `<th>${E(b)}</th>`).join('')}</tr></thead><tbody>
        ${M.rows.map((r) => `<tr><td>${E(r[0])}</td>${r.slice(1).map((c) =>
          `<td class="${CLS[c] || ''}">${E(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${legal('م = يملك القرار · ت = ينفّذ · ي = يُستشار · خ = يُخطَر · ✕ = محظور عليه')}</div>`],
    ['perms', 'الصلاحيات', d.permissions.length, () => {
      const g = {};
      for (const p of d.permissions) { g[p.grp] = g[p.grp] || []; g[p.grp].push(p); }
      const GN = d.permission_groups || {};
      return `<div class="card-bd">${Object.entries(g).map(([k, v]) => `
        <h4 style="margin-top:14px">${E(GN[k] || k)} <span class="pill">${num(v.length)}</span></h4>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الصلاحية</th><th>الرمز</th><th>الأدوار المانحة</th></tr></thead><tbody>
        ${v.map((p) => `<tr><td><b>${E(p.name_ar)}</b></td><td class="mono muted">${E(p.code)}</td>
          <td>${d.roles.filter((r) => r.permissions.includes(p.code)).map((r) =>
            `<span class="tag">${E(r.name_ar)}</span>`).join(' ') || '<span class="muted">—</span>'}</td></tr>`).join('')}
        </tbody></table></div>`).join('')}</div>`; }],
    ['check', 'فحص تعيين', null, () => `<div class="card-bd">
      <p class="muted">اختر أدواراً للتأكد من مطابقتها لقاعدة الفصل الوظيفي قبل التعيين.</p>
      <div class="form-grid">${d.roles.map((r) => `<label style="display:flex;gap:7px;align-items:flex-start;font-size:.84rem">
        <input type="checkbox" class="sodchk" value="${E(r.code)}">
        <span><b>${E(r.name_ar)}</b>${r.sod_function ? `<br><span class="tag gold">${E(sodName(r.sod_function))}</span>` : ''}</span></label>`).join('')}</div>
      <div class="btn-row" style="margin-top:12px"><button class="btn primary" onclick="APP.sodCheck()">افحص</button></div>
      <div id="sodout" style="margin-top:12px"></div></div>`],
  ]));
  return html;
});

// ================= المستخدمون =================
route('users', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'المستخدمون والأدوار',
    sub: 'النظام يرفض آلياً أي تعيين يجمع بين وظيفتين متعارضتين (المادة 18)',
    actions: '<button class="btn primary" onclick="APP.newUser()">إضافة مستخدم</button>' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/users',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'الاسم، البريد، الوظيفة' },
      { k: 'status', t: 'الحالة', type: 'select', opts: [['active','نشط'],['suspended','موقوف'],['disabled','معطَّل']] },
      { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
      { k: 'role', t: 'الدور', type: 'select', opts: (S.rbac?.roles || []).map((r) => [r.code, r.name_ar]) },
    ],
    cols: [
      { t: 'الاسم', srt: 'full_name', r: (r) => `<b>${E(r.full_name)}</b><div class="muted mono">${E(r.email)}</div>` },
      { t: 'الوظيفة', r: (r) => `<div class="muted" style="white-space:normal;max-width:300px">${E(r.job_title || '—')}</div>` },
      { t: 'المنطقة', k: 'region' },
      { t: 'الأدوار', r: (r) => r.roles.map((x) => `<span class="tag ${x.sod_function ? 'gold' : ''}">${E(x.name_ar)}
        ${x.scope_name ? `— ${E(String(x.scope_name).slice(0, 26))}` : ''}</span>`).join(' ') || '<span class="muted">—</span>' },
      { t: 'الصلاحيات', cls: 'num', r: (r) => num(r.permission_count) },
      { t: 'آخر دخول', srt: 'last_login_at', r: (r) => dt(r.last_login_at) },
      { t: 'الحالة', r: (r) => tag(r.status === 'active' ? 'active' : r.status === 'suspended' ? 'suspended' : 'rejected') },
      { t: '', r: (r) => `<button class="btn sm" onclick="event.stopPropagation();APP.editRoles(${r.id},'${E(r.full_name)}')">الأدوار</button>` },
    ],
  }));
  return html;
});

// ================= سجل التتبع =================
route('audit-log', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'سجل التتبع',
    sub: 'كل إجراء مؤثر مقيَّد بالفاعل ودوره ووقته — سند المراجعة الداخلية والخارجية' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/audit-log',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'الفاعل، الإجراء، الملخص' },
      { k: 'action', t: 'الإجراء', type: 'text', ph: 'مثال: sanction' },
      { k: 'entity_kind', t: 'نوع الكيان', type: 'select', opts: ['licensee','association','application','document','audit','sanction','appeal','user','report','invoice','observer','integrity_note','complaint','design','kpi','setting','market_test'].map((x) => [x, x]) },
      { k: 'from', t: 'من', type: 'date' }, { k: 'to', t: 'إلى', type: 'date' },
    ],
    cols: [
      { t: 'الوقت', srt: 'at', r: (r) => `<span class="mono" style="font-size:.78rem">${E(String(r.at).slice(0, 19))}</span>` },
      { t: 'الفاعل', r: (r) => `<b>${E(r.actor_name || 'زائر')}</b>
        <div class="muted" style="font-size:.7rem">${E(r.actor_roles || '')}</div>` },
      { t: 'الإجراء', srt: 'action', r: (r) => `<span class="tag">${E(r.action)}</span>` },
      { t: 'الكيان', r: (r) => r.entity_kind ? `${E(r.entity_kind)}${r.entity_id ? ' #' + num(r.entity_id) : ''}` : '—' },
      { t: 'الملخص', r: (r) => `<div style="white-space:normal;max-width:520px">${E(r.summary || '')}</div>` },
      { t: '', r: (r) => (r.before_json || r.after_json)
        ? `<button class="btn sm" onclick='APP.showDiff(${JSON.stringify(JSON.stringify({ b: r.before_json, a: r.after_json }))})'>التغيير</button>` : '' },
    ],
  }));
  return html;
});

// ================= الإعدادات =================
route('settings', async () => {
  if (!guard()) return '';
  const d = await api('/settings');
  return shell(card('إعدادات النظام', `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>المفتاح</th><th>القيمة</th><th>الوصف</th>${has('admin.settings') ? '<th></th>' : ''}</tr></thead><tbody>
    ${d.rows.filter((r) => r.k !== 'decision_matrix').map((r) => `<tr><td class="mono">${E(r.k)}</td>
      <td><b>${E(r.v)}</b></td><td class="muted" style="white-space:normal;max-width:520px">${E(r.note || '')}</td>
      ${has('admin.settings') ? `<td><button class="btn sm" onclick="APP.editSetting('${E(r.k)}','${E(r.v)}')">تحديث</button></td>` : ''}</tr>`).join('')}
    </tbody></table></div>
    ${legal('تغيير الإعدادات المرتبطة بالمعايير أو الرسوم أو الأرضيات لا يُعتدّ به نظاماً إلا بقرار من مجلس الأمناء وبعد نشره قبل بدء السنة المالية التالية بستين يوماً (المادة 5 و34/7).')}`),
    { title: 'الإعدادات', sub: 'القيم الحاكمة للنظام ومصدرها النظامي' });
});

})();
