(function(){
'use strict';
/* ===== المنظمات · الطلبات · الإثباتات · الالتزام · المساهمات · التصاميم ===== */
const { S, api, E, A, num, money, pct, dt, yr, today, days, L, lb, tag, lvlBadge, toast, modal,
        route, render, go, has } = window.SEMA;
const { shell, dataTable, bars, meter, stat, alertBox, legal, card, kv, tabs, docLink } = window.UI;
const guard = () => { if (!S.user) { location.hash = '#/login'; return false; } return true; };
const mount = (fn) => setTimeout(fn, 0);

// ================= المنظمات =================
async function orgList() {
  const html = shell('<div id="t"></div>', { title: 'منظمات المجتمع المدني',
    sub: 'الاعتماد مجاني بالكامل في كل مرحلة (المادة 12) — وتُموَّل كلفته من رسوم ترخيص قطاع الأعمال',
    actions: has('report.export') ? `<a class="btn" href="/api/reports/admin_ratio/export.csv?token=${encodeURIComponent(S.token)}" target="_blank">تصدير CSV</a>` : '' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/associations',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'الاسم، رقم الاعتماد، القيد النظامي، المجال' },
      { k: 'status', t: 'الحالة', type: 'select', opts: (S.ref?.statuses?.association || []).map((s) => [s, lb('status', s)]) },
      { k: 'admin_class', t: 'التصنيف الإداري', type: 'select', opts: (S.ref?.admin_classes || []).map((c) => [c.code, c.name_ar]) },
      { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
      { k: 'focus', t: 'مجال العمل', type: 'text' },
      { k: 'ratio_min', t: 'نسبة إدارية من', type: 'number', hint: 'عشري: 0.25' },
      { k: 'ratio_max', t: 'نسبة إدارية إلى', type: 'number' },
      { k: 'revenue_min', t: 'إيراد من', type: 'number' },
      { k: 'expiring_before', t: 'اعتماد ينتهي قبل', type: 'date' },
    ],
    cols: [
      { t: 'رقم الاعتماد', r: (r) => r.accreditation_no ? `<span class="mono">${E(r.accreditation_no)}</span>` : '<span class="muted">لم يُصدر</span>' },
      { t: 'المنظمة', srt: 'name', r: (r) => `<b>${E(r.name)}</b><div class="muted">${E(r.focus_areas || '')}</div>` },
      { t: 'الموقع', r: (r) => `${E(r.region || '—')}<div class="muted">${E(r.city || '')}</div>` },
      { t: 'التأسيس', k: 'established_year' },
      { t: 'الإيراد', srt: 'annual_revenue', cls: 'num', r: (r) => money(r.annual_revenue) },
      { t: 'النسبة الإدارية', srt: 'admin_expense_ratio', cls: 'num', r: (r) => `<b>${pct(r.admin_expense_ratio)}</b>
        <div><span class="tag ${r.admin_class === 'rejected' ? 'danger' : r.admin_class === 'acceptable' ? 'warn' : 'ok'}">${E(r.admin_class_name || '')}</span></div>` },
      { t: 'كلفة الجمع', cls: 'num', r: (r) => `${pct(r.fundraising_cost_ratio)}<div class="muted">سقف 30%</div>` },
      { t: 'سقف الاستيعاب', cls: 'num', r: (r) => `${money(r.absorption_cap)}${meter(r.absorption_used, r.absorption_cap)}
        <span class="muted">${pct(r.absorption_cap ? r.absorption_used / r.absorption_cap : 0, 0)} مستخدَم</span>` },
      { t: 'مستوى المراجعة', r: (r) => `<div class="muted" style="white-space:normal;max-width:210px">${E(r.audit_tier || '—')}</div>` },
      { t: 'صلاحية الاعتماد', srt: 'accredited_to', r: (r) => r.accredited_to ? `${dt(r.accredited_from)}<div class="muted">${dt(r.accredited_to)}</div>` : '—' },
      { t: 'الحالة', srt: 'status', r: (r) => tag(r.status) },
    ],
    rowClick: (r) => go('associations/' + r.id),
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('متوسط النسبة الإدارية', pct(d.rows.length ? d.rows.reduce((s, r) => s + (r.admin_expense_ratio || 0), 0) / d.rows.length : 0))}
      ${stat('فوق السقف 25%', num(d.rows.filter((r) => r.admin_expense_ratio > 0.25).length), 'لا يُمنح الاعتماد / يُسحب',
        d.rows.filter((r) => r.admin_expense_ratio > 0.25).length ? 'danger' : '')}
      ${stat('دون 5%', num(d.rows.filter((r) => r.admin_expense_ratio < 0.05).length), 'تستوجب فحصاً إضافياً',
        d.rows.filter((r) => r.admin_expense_ratio < 0.05).length ? 'warn' : '')}</div>`,
  }));
  return html;
}

route('associations', async (r) => {
  if (!guard()) return '';
  if (!r.params[0]) return orgList();
  const d = await api('/associations/' + r.params[0]);
  const cycle = Math.max(...(d.criteria.map((c) => c.cycle_year).concat([0])));
  const cur = d.criteria.filter((c) => c.cycle_year === cycle);
  const notMet = cur.filter((c) => c.result === 'not_met');
  const html = shell(`
    <div class="grid g4" style="margin-bottom:14px">
      ${stat('رقم الاعتماد', `<span class="mono" style="font-size:.62em">${E(d.accreditation_no || 'لم يُصدر')}</span>`, E(lb('status', d.status)),
        d.status === 'accredited' ? '' : d.status === 'suspended' ? 'warn' : ['revoked', 'rejected'].includes(d.status) ? 'danger' : '')}
      ${stat('النسبة الإدارية', pct(d.admin_expense_ratio), E(d.admin_class_name || ''),
        d.admin_class === 'rejected' ? 'danger' : d.admin_class === 'acceptable' ? 'warn' : '')}
      ${stat('الوارد عبر العلامة', money(d.absorption.used), `من سقف ${money(d.absorption.cap)}`, 'gold')}
      ${stat('المتبقي من السقف', money(d.absorption.remaining), pct(d.absorption.utilization) + ' مستهلك',
        d.absorption.breached ? 'danger' : '')}
      ${stat('المعايير المستوفاة', `${num(cur.filter((c) => c.result === 'met').length)} / ${num(cur.length)}`,
        notMet.length ? `${num(notMet.length)} غير مستوفى` : 'مستوفٍ مجتمعةً', notMet.length ? 'danger' : '')}
      ${stat('الرسوم', 'صفر', 'مجاني في كل مرحلة (المادة 12)', 'gold')}
      ${stat('صلاحية الاعتماد', dt(d.accredited_to), 'سنتان قابلة للتجديد')}
      ${stat('إثباتات متحقَّق منها', `${num(d.documents.filter((x) => x.verification === 'verified').length)} / ${num(d.documents.length)}`)}
    </div>
    ${d.status_reason ? alertBox(['revoked', 'rejected'].includes(d.status) ? 'danger' : 'warn', 'سبب الحالة', E(d.status_reason)) : ''}
    ${d.absorption.breached ? alertBox('danger', 'تجاوز سقف الاستيعاب (المعيار 10)', E(d.absorption.message)) : ''}
    ${d.admin_classification.flag ? alertBox('warn', 'تنبيه إرشادي', E(d.admin_classification.flag)) : ''}
    ${!d.admin_classification.accredit ? alertBox('danger', 'التصنيف الإداري «غير مقبول»',
      'النسبة تتجاوز 25% — لا يُمنح الاعتماد أو يُسحب (المادة 15). وتجاوز السقف ثلاث سنوات مالية متتالية دون ظروف استثنائية مقبولة يوجب سحب صفة الاعتماد (المادة 32).') : ''}
    <div class="card"><div id="tb"></div></div>`, {
    title: d.name, sub: `${E(d.focus_areas || '')} · ${E(d.region || '')} — ${E(d.city || '')} · تأسّست ${yr(d.established_year)}`,
    actions: `${d.accreditation_no ? `<a class="btn" href="#/verify/${E(d.accreditation_no)}">صفحة التحقق العامة</a>` : ''}
      ${d.accreditation_no && ['accredited', 'suspended'].includes(d.status) ? `<a class="btn" href="#/certificate/${E(d.accreditation_no)}">الشهادة</a>` : ''}
      ${has('audit.execute') ? `<button class="btn" onclick="APP.scheduleAudit('association',${d.id})">جدولة تدقيق</button>` : ''}
      ${has('app.create') && S.user.scopes.association.includes(d.id) ? `<button class="btn gold" onclick="APP.newApplication('accreditation_renewal')">طلب تجديد</button>` : ''}
      ${has('org.assess_criteria') ? `<button class="btn primary" onclick="APP.assessCriteria(${d.id})">تقييم المعايير</button>` : ''}
      ${has('org.edit.all') || has('org.edit.own') ? `<button class="btn" onclick="APP.editOrg(${d.id})">تحديث البيانات</button>` : ''}` });

  mount(() => tabs(document.getElementById('tb'), [
    ['info', 'البيانات النظامية', null, () => `<div class="card-bd"><div class="grid g2">
      ${kv([['الاسم', E(d.name)], ['القيد النظامي', `<span class="mono">${E(d.registration_no || '—')}</span>`],
        ['جهة القيد', E(d.registration_authority || '—')], ['سنة التأسيس', yr(d.established_year)],
        ['حجم المجلس', `${num(d.board_size)} عضواً${d.paid_board_members ? ` — منهم ${num(d.paid_board_members)} مأجور` : ''}`],
        ['اجتماعات المجلس السنة الماضية', num(d.board_meetings_last_year)],
        ['جهة الاتصال', `${E(d.contact_name || '—')}<div class="muted">${E(d.contact_email || '')} · ${E(d.contact_phone || '')}</div>`],
        ['صفة الشراكة', E(lb('partnerClass', d.partner_class))]])}
      ${kv([['الإيراد السنوي', money(d.annual_revenue)], ['إجمالي المصروفات', money(d.total_expenses)],
        ['المصروفات الإدارية والتسييرية والدعائية', money(d.admin_expenses)],
        ['النسبة', `<b>${pct(d.admin_expense_ratio)}</b> — ${E(d.admin_class_name || '')}`],
        ['متوسط النسبة لثلاث سنوات', pct(d.admin_ratio_3y_avg)],
        ['كلفة جمع التبرعات', `${pct(d.fundraising_cost_ratio)} <span class="muted">— السقف 30%</span>`],
        ['أكبر ميزانية سنوية (3 سنوات)', money(d.largest_budget_3y)],
        ['مستوى المراجعة المطلوب (المادة 14)', E(d.required_audit_tier)]])}
      </div>
      ${legal(E(d.fees_note))}</div>`],

    ['crit', 'المعايير الخمسة عشر', cur.length, () => `<div class="card-bd">
      ${notMet.length ? alertBox('danger', 'معايير غير مستوفاة',
        'المعايير تُستوفى مجتمعةً. غير المستوفى: ' + notMet.map((c) => `(${c.criterion_no}) ${E(c.name_ar)}`).join(' · ')) : ''}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>المعيار</th><th>الاشتراط</th>
        <th>النتيجة</th><th>القيمة المقيسة</th><th>ملاحظة المقيّم</th><th>تاريخ التقييم</th></tr></thead><tbody>
        ${cur.sort((a, b) => a.criterion_no - b.criterion_no).map((c) => `<tr>
          <td><b>${num(c.criterion_no)}</b></td><td><b>${E(c.name_ar)}</b></td>
          <td class="muted" style="white-space:normal;max-width:300px">${E(c.requirement_ar)}</td>
          <td>${tag(c.result, 'criteria')}</td>
          <td class="num">${c.measured_value == null ? '—' : (c.criterion_no >= 8 && c.measured_value <= 1 ? pct(c.measured_value) : num(c.measured_value))}</td>
          <td class="muted" style="white-space:normal;max-width:300px">${E(c.note || '')}</td>
          <td>${dt(c.assessed_at)}</td></tr>`).join('')}</tbody></table></div></div>`],

    ['docs', 'الإثباتات', d.documents.length, () => `<div class="card-bd">
      <h4>الإثباتات المطلوبة</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الإثبات</th><th>إلزامي</th><th>محمَّل</th><th>متحقَّق منه</th></tr></thead>
        <tbody>${d.required_docs.map((x) => `<tr><td>${E(x.name_ar)}</td>
          <td>${x.required ? '<span class="tag danger">إلزامي</span>' : '<span class="muted">اختياري</span>'}</td>
          <td>${x.uploaded ? '<span class="tag ok">نعم</span>' : '<span class="tag warn">لا</span>'}</td>
          <td>${x.verified ? '<span class="tag ok">نعم</span>' : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>
      <h4 style="margin-top:16px">الملفات المحمَّلة</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الإثبات</th><th>النوع</th><th>الإصدار</th>
        <th>الانتهاء</th><th>النشر</th><th>الحالة</th>${has('doc.verify') ? '<th></th>' : ''}</tr></thead><tbody>
        ${d.documents.map((x) => `<tr><td>${docLink(x)}${x.confidential ? ' <span class="tag danger">سرّي</span>' : ''}</td>
          <td class="muted">${E(x.doc_type_name || '—')}</td><td>${dt(x.issued_on)}</td>
          <td>${x.expires_on ? (x.expires_on < today() ? `<span class="tag danger">${dt(x.expires_on)}</span>` : dt(x.expires_on)) : '—'}</td>
          <td>${x.is_public ? '<span class="tag info">منشور في السجل</span>' : '<span class="muted">داخلي</span>'}</td>
          <td>${tag(x.verification, 'verification')}</td>
          ${has('doc.verify') ? `<td><button class="btn sm" onclick="APP.verifyDoc(${x.id})">تحقّق</button></td>` : ''}</tr>`).join('')}
        </tbody></table></div>
      ${has('doc.upload.own') || has('doc.upload.any') ? `<div class="btn-row" style="margin-top:12px">
        <button class="btn primary" onclick="APP.uploadDoc('association',${d.id})">تحميل إثبات جديد</button></div>` : ''}
      ${legal('المعيار (14) الشفافية: نشر النظام الأساسي، وأسماء المجلس، والقوائم المالية، وتقرير الأثر السنوي. والمعيار (15): الإفصاح عن أجور الإدارة العليا حسب الوظيفة لا حسب الاسم.')}</div>`],

    ['contrib', 'المساهمات الواردة', d.contributions.length, () => `<div class="card-bd">
      ${card('استهلاك سقف الاستيعاب', meter(d.absorption.used, d.absorption.cap) + kv([
        ['أكبر ميزانية سنوية', money(d.largest_budget_3y)], ['السقف (200%)', money(d.absorption.cap)],
        ['المستخدَم', money(d.absorption.used)], ['المتبقي', `<b>${money(d.absorption.remaining)}</b>`]]))}
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>المرجع</th><th>المساهم</th><th>رقم الترخيص</th>
        <th>المستوى</th><th>المسار</th><th>المبلغ</th><th>التاريخ</th><th>الغرض</th><th>إقرار الاستلام</th>
        <th>تقرير الأثر</th><th>الحالة</th>${has('contribution.confirm') ? '<th></th>' : ''}</tr></thead><tbody>
        ${d.contributions.length ? d.contributions.map((x) => `<tr>
          <td class="mono">${E(x.reference)}</td>
          <td><a href="#/licensees/${x.licensee_id}">${E(x.licensee_name)}</a></td>
          <td class="mono">${E(x.license_no || '—')}</td><td>${num(x.level)}</td>
          <td><span class="tag">${E(x.channel_name || x.channel)}</span></td>
          <td class="num"><b>${money(x.amount)}</b></td><td>${dt(x.transfer_date)}</td>
          <td class="muted" style="white-space:normal;max-width:220px">${E(x.purpose || '—')}</td>
          <td>${x.receipt_confirmed ? '<span class="tag ok">مُقرّ</span>' : '<span class="tag warn">مطلوب</span>'}</td>
          <td>${x.impact_doc_id ? '<span class="tag ok">مقدَّم</span>' : '<span class="tag warn">مستحق</span>'}</td>
          <td>${tag(x.status)}</td>
          ${has('contribution.confirm') ? `<td>${!x.receipt_confirmed
            ? `<button class="btn sm primary" onclick="APP.confirmReceipt(${x.id})">أقرّ الاستلام</button>`
            : (!x.impact_doc_id && has('impact.submit') ? `<button class="btn sm gold" onclick="APP.uploadImpact(${x.id})">تقرير الأثر</button>` : '')}</td>` : ''}</tr>`).join('')
          : '<tr><td colspan="12"><div class="empty"><b>لا مساهمات</b></div></td></tr>'}</tbody></table></div>
      ${legal('المادة (23/3): يُقدَّم من المنظمة المعتمدة تقرير أثر مختصر عن الأموال الواردة إليها عبر العلامة تحديداً، لا عن نشاطها كله.')}</div>`],

    ['aud', 'التدقيق والجزاءات', d.audits.length + d.sanctions.length, () => `<div class="card-bd">
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>المرجع</th><th>النوع</th><th>المنفَّذ</th>
        <th>المقيّم</th><th>الوقائع</th><th>الحالة</th></tr></thead><tbody>
      ${d.audits.map((x) => `<tr class="clk" onclick="SEMA.go('audits/${x.id}')"><td class="mono">${E(x.reference)}</td>
        <td><span class="tag">${E(lb('auditType', x.audit_type))}</span></td><td>${dt(x.executed_date)}</td>
        <td>${E(x.assessor_name || '—')}</td>
        <td class="muted" style="white-space:normal;max-width:440px">${E((x.facts_summary || '').slice(0, 240))}</td>
        <td>${tag(x.status)}</td></tr>`).join('')}</tbody></table></div>
      ${d.sanctions.length ? `<h4 style="margin-top:16px">الجزاءات</h4><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>القضية</th><th>الجزاء</th><th>التسبيب</th><th>التاريخ</th><th>منشور</th><th>الحالة</th></tr></thead><tbody>
        ${d.sanctions.map((x) => `<tr><td class="mono">${E(x.case_no)}</td>
          <td><span class="tag danger">${E(lb('measure', x.measure))}</span></td>
          <td class="muted" style="white-space:normal;max-width:460px">${E(x.reason)}</td>
          <td>${dt(x.decided_at)}</td><td>${x.published ? '<span class="tag danger">منشور</span>' : '—'}</td>
          <td>${tag(x.status)}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`],
  ], 'info'));
  return html;
});

route('my-org', async () => {
  if (!guard()) return '';
  const id = S.user.scopes.association[0];
  if (!id) return shell(alertBox('warn', 'لا ملف مرتبط', 'حسابك غير مرتبط بملف منظمة.'), { title: 'ملف منظمتي' });
  location.hash = '#/associations/' + id; return '';
});

// ================= الطلبات =================
async function appList() {
  const html = shell('<div id="t"></div>', { title: 'الطلبات ومساراتها',
    sub: 'المادة (17): إجمالي المدة المعيارية 90 يوم عمل من اكتمال الطلب',
    actions: has('app.create') ? '<button class="btn primary" onclick="APP.newApplication()">تقديم طلب جديد</button>' : '' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/applications',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'المرجع أو اسم الجهة' },
      { k: 'app_type', t: 'نوع الطلب', type: 'select', opts: Object.entries(L.appType) },
      { k: 'status', t: 'الحالة', type: 'select', opts: ['submitted','deficiencies','completing','assessment','field_visit','facts_report','decision_pending','approved','rejected','shelved'].map((s) => [s, lb('status', s)]) },
      { k: 'stage', t: 'المرحلة', type: 'select', opts: (S.ref?.app_stages || []).map((s) => [s.stage, `${s.stage} — ${s.name.slice(0, 30)}`]) },
      { k: 'subject_kind', t: 'الجهة', type: 'select', opts: [['licensee','مرخَّص له'],['association','منظمة']] },
      { k: 'decision', t: 'القرار', type: 'select', opts: [['grant','منح'],['reject','رفض'],['grant_lower_level','منح بمستوى أدنى']] },
      { k: 'requested_level', t: 'المستوى المطلوب', type: 'select', opts: (S.ref?.levels || []).map((l) => [l.level, l.name_ar]) },
      { k: 'submitted_from', t: 'تقديم من', type: 'date' },
      { k: 'submitted_to', t: 'تقديم إلى', type: 'date' },
      { k: 'overdue', t: 'موعد نظامي قبل', type: 'date', hint: 'لعرض المتأخر' },
    ],
    cols: [
      { t: 'المرجع', srt: 'reference', r: (r) => `<span class="mono">${E(r.reference)}</span>` },
      { t: 'النوع', r: (r) => `<span class="tag">${E(lb('appType', r.app_type))}</span>` },
      { t: 'الجهة', r: (r) => `<b>${E(r.subject_name || '—')}</b><div class="muted">${E(r.subject_kind === 'licensee' ? 'مرخَّص له' : 'منظمة')}</div>` },
      { t: 'المستوى المطلوب', r: (r) => r.requested_level ? num(r.requested_level) : '—' },
      { t: 'المرحلة', srt: 'stage', r: (r) => `<b>${num(r.stage)}</b> / 9
        <div class="muted" style="white-space:normal;max-width:180px">${E(((S.ref?.app_stages || []).find((s) => s.stage === r.stage) || {}).name || '')}</div>` },
      { t: 'الحالة', srt: 'status', r: (r) => tag(r.status) + (r.sla_breached ? ' <span class="tag danger">تجاوز المدة</span>' : '') },
      { t: 'التقديم', srt: 'submitted_at', r: (r) => dt(r.submitted_at) },
      { t: 'الموعد النظامي', srt: 'sla_due_at', r: (r) => dt(r.sla_due_at) },
      { t: 'القرار', r: (r) => r.decision ? `${tag(r.decision, 'decision')}<div class="muted">${dt(r.decided_at)}</div>` : '—' },
      { t: 'المدة الفعلية', srt: 'processing_days', cls: 'num', r: (r) => r.processing_days ? num(r.processing_days) + ' يوماً' : '—' },
    ],
    rowClick: (r) => go('applications/' + r.id),
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('متأخر عن المدة', num(d.rows.filter((r) => r.sla_breached).length), '90 يوم عمل',
        d.rows.filter((r) => r.sla_breached).length ? 'danger' : '')}
      ${stat('مفصول فيه', num(d.rows.filter((r) => r.decision).length))}
      ${stat('متوسط المدة', num(d.rows.filter((r) => r.processing_days).length
        ? d.rows.filter((r) => r.processing_days).reduce((s, r) => s + r.processing_days, 0) / d.rows.filter((r) => r.processing_days).length : 0) + ' يوماً')}</div>`,
  }));
  return html;
}

route('applications', async (r) => {
  if (!guard()) return '';
  if (!r.params[0]) return appList();
  const d = await api('/applications/' + r.params[0]);
  const html = shell(`
    <div class="grid g4" style="margin-bottom:14px">
      ${stat('المرجع', `<span class="mono" style="font-size:.7em">${E(d.reference)}</span>`, E(lb('appType', d.app_type)))}
      ${stat('المرحلة', `${num(d.stage)} / 9`, E(lb('status', d.status)))}
      ${stat('الموعد النظامي', dt(d.sla_due_at), d.decided_at ? 'مفصول فيه' : (d.sla_due_at < today() ? 'تجاوز المدة' : 'داخل المدة'),
        !d.decided_at && d.sla_due_at < today() ? 'danger' : '')}
      ${stat('المدة الفعلية', d.processing_days ? num(d.processing_days) + ' يوماً' : '—', 'المعياري 90 يوم عمل')}
    </div>
    ${d.deficiencies ? alertBox('warn', 'إخطار بالنواقص (المادة 17/3)',
      `${E(d.deficiencies)}<br>أمام الطالب 20 يوم عمل لاستكمالها وإلا حُفظ الطلب.`) : ''}
    ${d.decision ? alertBox(d.decision === 'reject' ? 'danger' : 'ok',
      'القرار المسبَّب — ' + lb('decision', d.decision),
      `${E(d.decision_reason || '')}<div class="muted" style="margin-top:6px">صادر عن ${E(d.decided_by_name || 'لجنة منح الترخيص')} في ${dt(d.decided_at)}
      ${d.granted_level ? ` — المستوى الممنوح: ${num(d.granted_level)}` : ''}</div>`) : ''}

    ${card('مسار الطلب', `<div class="steps">${d.stages.map((s) => {
      const cls = s.completed_at ? (s.breached_sla ? 'done late' : 'done') : (s.started_at ? 'now' : '');
      return `<div class="step ${cls}"><span class="dot">${s.stage}</span><div>
        <div class="ti">${E(s.stage_name_ar)}</div>
        <div class="mt">${E(s.responsible_body)}${s.max_days ? ` · المدة القصوى ${s.max_days} يوم عمل` : ''}
          ${s.started_at ? ` · بدأت ${dt(s.started_at)}` : ''}${s.completed_at ? ` · أُنجزت ${dt(s.completed_at)}` : ''}
          ${s.actor_name ? ` · ${E(s.actor_name)}` : ''}${s.breached_sla ? ' · <b style="color:var(--danger)">تجاوزت المدة</b>' : ''}</div>
        ${s.note ? `<div class="mt" style="color:var(--ink-2)">${E(s.note)}</div>` : ''}</div></div>`;
    }).join('')}</div>`, { actions: actionBtns(d) })}

    ${card('البيانات', kv([
      ['نوع الطلب', E(lb('appType', d.app_type))],
      ['الجهة', d.subject_kind === 'licensee'
        ? `<a href="#/licensees/${d.subject_id}">${E(d.subject_name)}</a>`
        : `<a href="#/associations/${d.subject_id}">${E(d.subject_name)}</a>`],
      ['المستوى المطلوب', d.requested_level ? num(d.requested_level) : '—'],
      ['الشريحة', E(d.requested_tier || '—')],
      ['تاريخ التقديم', dt(d.submitted_at)],
      ['موعد فحص الاستيفاء', dt(d.completeness_due_at)],
      ['موعد التقييم', dt(d.assessment_due_at)],
      ['تقرير الوقائع', d.facts_report_id ? `<a href="#/audits/${d.facts_report_id}">عرض التقرير</a>` : '<span class="muted">لم يُرفع</span>'],
    ]))}
    ${legal('المادة (21/4): يُحظر على لجنة منح الترخيص التفاوض مع الطالب أو تعديل الوقائع الواردة في تقرير وحدة التقييم؛ ولها أن تطلب استكمالاً أو إعادة تدقيق.<br>المادة (20/3): يجب أن يقتصر تقرير الوحدة على الوقائع والأدلة دون توصية بالمنح أو الرفض.')}`,
    { title: 'الطلب ' + d.reference, sub: E(d.subject_name || '') });
  return html;
});

function actionBtns(d) {
  const b = [];
  if (has('app.screen') && ['submitted', 'completing'].includes(d.status))
    b.push(`<button class="btn primary sm" onclick="APP.screenApp(${d.id})">فحص الاستيفاء الشكلي</button>`);
  if (has('app.create') && d.status === 'deficiencies' && (S.user.scopes.licensee.includes(d.subject_id) && d.subject_kind === 'licensee'
      || S.user.scopes.association.includes(d.subject_id) && d.subject_kind === 'association'))
    b.push(`<button class="btn gold sm" onclick="APP.resubmitApp(${d.id})">استكمال النواقص</button>`);
  if (has('app.facts_report') && ['assessment', 'field_visit'].includes(d.status) && !d.facts_report_id)
    b.push(`<button class="btn primary sm" onclick="APP.factsReport(${d.id})">رفع تقرير الوقائع</button>`);
  if (has('app.decide') && d.status === 'decision_pending')
    b.push(`<button class="btn gold sm" onclick="APP.decideApp(${d.id},${d.requested_level || 1})">القرار المسبَّب</button>`);
  if (has('appeal.file') && d.decision === 'reject')
    b.push(`<button class="btn sm" onclick="APP.fileAppealApp(${A(d.id)},${A(d.subject_kind)},${A(d.subject_id)})">تقديم تظلم</button>`);
  return b.join(' ');
}

// ================= الإثباتات =================
route('documents', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'الإثباتات والمستندات',
    sub: 'المادة (3/5) قابلية التحقق: لا يُعتدّ بأي التزام لا يُسنده مستند خارجي',
    actions: has('doc.upload.own') || has('doc.upload.any') ? '<button class="btn primary" onclick="APP.uploadDoc()">تحميل إثبات</button>' : '' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/documents',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'العنوان أو اسم الجهة' },
      { k: 'owner_kind', t: 'الجهة', type: 'select', opts: [['licensee','مرخَّص له'],['association','منظمة'],
        ['audit','تدقيق'],['application','طلب'],['observer','مراقب'],['secretariat','الأمانة'],['design','تصميم'],['user','مستخدم']] },
      { k: 'doc_type', t: 'نوع الإثبات', type: 'select', opts: (S.ref?.document_types || []).map((t) => [t.code, t.name_ar]) },
      { k: 'verification', t: 'حالة التحقق', type: 'select', opts: Object.entries(L.verification) },
      { k: 'is_public', t: 'منشور', type: 'bool' },
      { k: 'expiring_before', t: 'تنتهي صلاحيته قبل', type: 'date' },
      { k: 'uploaded_from', t: 'حُمِّل من', type: 'date' },
      { k: 'uploaded_to', t: 'حُمِّل إلى', type: 'date' },
    ],
    cols: [
      { t: 'الإثبات', r: (r) => `${docLink(r)}
        <div class="muted">${E(r.doc_type_name || '')} ${r.confidential ? '<span class="tag danger">سرّي</span>' : ''}${r.is_public ? '<span class="tag info">منشور</span>' : ''}</div>` },
      { t: 'الجهة', r: (r) => r.owner_name
        ? `<a href="#/${r.owner_kind === 'licensee' ? 'licensees' : 'associations'}/${r.owner_id}">${E(r.owner_name)}</a>`
        : `<span class="muted">${E(lb('status', r.owner_kind) === r.owner_kind ? r.owner_kind : '')}</span>` },
      { t: 'الإصدار', r: (r) => dt(r.issued_on) },
      { t: 'الانتهاء', srt: 'expires_on', r: (r) => !r.expires_on ? '—'
        : r.expires_on < today() ? `<span class="tag danger">${dt(r.expires_on)}</span>`
        : days(today(), r.expires_on) < 60 ? `<span class="tag warn">${dt(r.expires_on)}</span>` : dt(r.expires_on) },
      { t: 'الحجم', srt: 'size_bytes', cls: 'num', r: (r) => `${num(Math.round((r.size_bytes || 0) / 1024))} ك.ب
        <div class="muted">${num(r.pages)} صفحة</div>` },
      { t: 'حمّله', r: (r) => `${E(r.uploaded_by_name || '—')}<div class="muted">${dt(r.uploaded_at)}</div>` },
      { t: 'التحقق', srt: 'verification', r: (r) => tag(r.verification, 'verification')
        + (r.verify_note ? `<div class="muted" style="white-space:normal;max-width:230px">${E(r.verify_note)}</div>` : '') },
      ...(has('doc.verify') ? [{ t: '', r: (r) => `<button class="btn sm" onclick="event.stopPropagation();APP.verifyDoc(${r.id})">تحقّق</button>` }] : []),
    ],
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('متحقَّق منها', num(d.rows.filter((r) => r.verification === 'verified').length), 'في الصفحة')}
      ${stat('بانتظار التحقق', num(d.rows.filter((r) => r.verification === 'pending').length), 'في الصفحة',
        d.rows.filter((r) => r.verification === 'pending').length ? 'warn' : '')}
      ${stat('منتهية الصلاحية', num(d.rows.filter((r) => r.expires_on && r.expires_on < today()).length), 'في الصفحة',
        d.rows.filter((r) => r.expires_on && r.expires_on < today()).length ? 'danger' : '')}</div>`,
  }));
  return html;
});

})();
