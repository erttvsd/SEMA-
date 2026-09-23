(function(){
'use strict';
/* ===== الالتزام · المساهمات · الإقرارات · التدقيق · الجزاءات · التظلمات · النزاهة · الحوكمة ===== */
const { S, api, E, num, money, pct, dt, yr, today, days, L, lb, tag, lvlBadge, toast, modal,
        route, render, go, has, hasRole } = window.SEMA;
const { shell, dataTable, bars, meter, stat, alertBox, legal, card, kv, tabs, docLink } = window.UI;
const guard = () => { if (!S.user) { location.hash = '#/login'; return false; } return true; };
const mount = (fn) => setTimeout(fn, 0);

// ================= الالتزام السنوي =================
route('commitments', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'الالتزام السنوي',
    sub: 'المادة (4): الالتزام = الأعلى من النسبة أو الأرضية — وتسري سواء حقّقت المنشأة ربحاً أم لم تحقق',
    actions: has('report.export') ? `<a class="btn" href="/api/reports/commitment_gap/export.csv?token=${encodeURIComponent(S.token)}" target="_blank">تصدير فجوة الالتزام</a>` : '' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/commitments',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true },
      { k: 'fiscal_year', t: 'السنة المالية', type: 'select', opts: [[2026, '2026'], [2025, '2025']] },
      { k: 'status', t: 'الحالة', type: 'select', opts: [['open','مفتوح'],['fulfilled','مستوفى'],['deficient','عجز'],['breach','إخلال'],['closed','مغلق']] },
      { k: 'level', t: 'المستوى', type: 'select', opts: (S.ref?.levels || []).map((l) => [l.level, l.name_ar]) },
      { k: 'tier_code', t: 'الشريحة', type: 'select', opts: (S.ref?.tiers || []).map((t) => [t.code, t.code]) },
      { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
      { k: 'basis', t: 'أساس الاحتساب', type: 'select', opts: [['percent','النسبة'],['floor','الأرضية']] },
      { k: 'due_min', t: 'التزام من', type: 'number' },
      { k: 'due_max', t: 'التزام إلى', type: 'number' },
      { k: 'deficit_min', t: 'عجز لا يقل عن', type: 'number', hint: 'عشري: 0.2' },
    ],
    cols: [
      { t: 'المنشأة', srt: 'legal_name', r: (r) => `<a href="#/licensees/${r.licensee_id}"><b>${E(r.legal_name)}</b></a>
        <div class="muted mono">${E(r.license_no || '—')}</div>` },
      { t: 'السنة', srt: 'fiscal_year', r: (r) => yr(r.fiscal_year) },
      { t: 'المستوى', r: (r) => lvlBadge(r.level, r.level_name, r.color_hex) },
      { t: 'الشريحة', r: (r) => `<b>${E(r.tier_code)}</b>` },
      { t: 'الإيراد / الربح', cls: 'num', r: (r) => `${money(r.annual_revenue)}<div class="muted">${money(r.net_profit)}</div>` },
      { t: 'النسبة', cls: 'num', r: (r) => money(r.pct_amount) },
      { t: 'الأرضية', cls: 'num', r: (r) => money(r.floor_amount) },
      { t: 'الواجب', srt: 'commitment_due', cls: 'num', r: (r) => `<b>${money(r.commitment_due)}</b>
        <div class="muted">${E(lb('basis', r.basis))}</div>` },
      { t: 'الموثَّق', srt: 'total_paid', cls: 'num', r: (r) => `${money(r.total_paid)}
        ${meter(r.total_paid, r.commitment_due, { warnAt: 0.999, dangerAt: 999 })}` },
      { t: 'حصة النقدي', cls: 'num', r: (r) => r.cash_share == null ? '—'
        : `<span class="tag ${r.cash_share < 0.5 ? 'danger' : 'ok'}">${pct(r.cash_share)}</span>` },
      { t: 'العجز', srt: 'deficit_pct', cls: 'num', r: (r) => r.deficit_amount > 0
        ? `<b style="color:var(--danger)">${money(r.deficit_amount)}</b><div class="muted">${pct(r.deficit_pct)}</div>` : '—' },
      { t: 'الحالة', r: (r) => tag(r.status) },
    ],
    rowClick: (r) => go('licensees/' + r.licensee_id),
    summary: (d) => { const due = d.rows.reduce((s, r) => s + r.commitment_due, 0);
      const paid = d.rows.reduce((s, r) => s + r.total_paid, 0);
      return `<div class="grid g4" style="padding:12px 16px 0">
        ${stat('الملفات', num(d.total))}
        ${stat('إجمالي الواجب', money(due), 'في الصفحة')}
        ${stat('إجمالي الموثَّق', money(paid), pct(due ? paid / due : 0) + ' من الواجب', 'gold')}
        ${stat('ملفات بعجز فوق 20%', num(d.rows.filter((r) => r.deficit_pct > 0.2).length), 'موجب للتعليق (المادة 29/4)',
          d.rows.filter((r) => r.deficit_pct > 0.2).length ? 'danger' : '')}</div>`; },
  }));
  return html;
});

// ================= المساهمات =================
route('contributions', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'المساهمات',
    sub: 'المادة (20) المسارات المؤهلة · المادة (21) قاعدة النصف النقدي · المادة (22) سقف التوجيه لمنظمة واحدة',
    actions: `${has('contribution.declare') ? '<button class="btn primary" onclick="APP.newContribution()">تسجيل مساهمة</button>' : ''}
      ${has('report.export') ? `<a class="btn" href="/api/reports/contribution_flow/export.csv?token=${encodeURIComponent(S.token)}" target="_blank">تصدير</a>` : ''}` });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/contributions',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'المنشأة، المنظمة، المرجع، الغرض' },
      { k: 'fiscal_year', t: 'السنة', type: 'select', opts: [[2026, '2026'], [2025, '2025']] },
      { k: 'channel', t: 'المسار', type: 'select', opts: (S.ref?.channels || []).filter((c) => c.counts).map((c) => [c.code, c.name_ar]) },
      { k: 'status', t: 'الحالة', type: 'select', opts: [['declared','معلَن'],['documented','موثَّق'],['verified','متحقَّق منه'],['rejected','مرفوض'],['excluded','مستبعَد']] },
      { k: 'region', t: 'منطقة المنظمة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
      { k: 'receipt_confirmed', t: 'إقرار الاستلام', type: 'bool' },
      { k: 'amount_min', t: 'مبلغ من', type: 'number' },
      { k: 'amount_max', t: 'مبلغ إلى', type: 'number' },
      { k: 'date_from', t: 'تحويل من', type: 'date' },
      { k: 'date_to', t: 'تحويل إلى', type: 'date' },
    ],
    cols: [
      { t: 'المرجع', r: (r) => `<span class="mono">${E(r.reference)}</span>` },
      { t: 'المساهم', r: (r) => `<a href="#/licensees/${r.licensee_id}">${E(r.licensee_name)}</a>
        <div class="muted mono">${E(r.license_no || '—')} · م${num(r.level)}</div>` },
      { t: 'المنظمة المتلقية', r: (r) => r.association_id
        ? `<a href="#/associations/${r.association_id}">${E(r.association_name)}</a>
           <div class="muted mono">${E(r.accreditation_no || '')}</div>`
        : '<span class="muted">برنامج تنموي ذاتي</span>' },
      { t: 'المسار', r: (r) => `<span class="tag ${r.channel === 'cash' ? 'ok' : ''}">${E(r.channel_name || r.channel)}</span>
        ${r.channel_max_share ? `<div class="muted">سقف ${pct(r.channel_max_share, 0)}</div>` : ''}` },
      { t: 'المبلغ', srt: 'amount', cls: 'num', r: (r) => `<b>${money(r.amount)}</b>
        ${r.volunteer_hours ? `<div class="muted">${num(r.volunteer_hours)} ساعة × ${num(r.hour_rate)}</div>` : ''}` },
      { t: 'التحويل', srt: 'transfer_date', r: (r) => `${dt(r.transfer_date)}
        ${r.bank_ref ? `<div class="muted mono">${E(r.bank_ref)}</div>` : ''}` },
      { t: 'الغرض', r: (r) => `<div class="muted" style="white-space:normal;max-width:240px">${E(r.purpose || '—')}</div>` },
      { t: 'الإثباتات', r: (r) => [
          r.transfer_doc_id ? '<span class="tag ok">إيصال</span>' : '<span class="tag warn">لا إيصال</span>',
          r.receipt_confirmed ? '<span class="tag ok">إقرار استلام</span>' : '<span class="tag warn">بلا إقرار</span>',
          r.impact_doc_id ? '<span class="tag ok">تقرير أثر</span>' : '',
        ].filter(Boolean).join(' ') },
      { t: 'الحالة', srt: 'status', r: (r) => tag(r.status) },
      ...(has('contribution.verify') || has('contribution.confirm') || has('program.preapprove') ? [{ t: '', r: (r) => `
        ${has('contribution.confirm') && r.association_id && !r.receipt_confirmed ? `<button class="btn sm primary" onclick="event.stopPropagation();APP.confirmReceipt(${r.id})">أقرّ الاستلام</button>` : ''}
        ${has('impact.submit') && r.receipt_confirmed && !r.impact_doc_id && S.user.scopes.association.includes(r.association_id) ? `<button class="btn sm gold" onclick="event.stopPropagation();APP.uploadImpact(${r.id})">تقرير الأثر</button>` : ''}
        ${has('program.preapprove') && r.channel === 'direct_program' && !r.program_preapproved && r.status !== 'rejected' ? `<button class="btn sm gold" onclick="event.stopPropagation();APP.preapproveProgram(${r.id})">موافقة مسبقة</button>` : ''}
        ${has('contribution.verify') && r.status !== 'verified' ? `<button class="btn sm" onclick="event.stopPropagation();APP.verifyContribution(${r.id})">تحقّق</button>` : ''}` }] : []),
    ],
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('إجمالي المبالغ', money(d.rows.reduce((s, r) => s + r.amount, 0)), 'في الصفحة')}
      ${stat('بلا إقرار استلام', num(d.rows.filter((r) => !r.receipt_confirmed).length), 'لا يُعتدّ بها حتى الإقرار',
        d.rows.filter((r) => !r.receipt_confirmed).length ? 'warn' : '')}
      ${stat('بلا تقرير أثر', num(d.rows.filter((r) => r.receipt_confirmed && !r.impact_doc_id).length), 'مستحقة على المنظمة')}</div>`,
  }));
  return html;
});

// ================= إقرارات الامتثال =================
route('declarations', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'إقرارات الامتثال السنوية',
    sub: 'المادة (23): يُقدَّم خلال مئة وعشرين يوماً من انتهاء السنة المالية، مسنَداً بإثبات مالي وإثبات صرف' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/declarations',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true },
      { k: 'fiscal_year', t: 'السنة', type: 'select', opts: [[2026, '2026'], [2025, '2025']] },
      { k: 'status', t: 'الحالة', type: 'select', opts: ['pending','submitted','late','desk_review','field_audit','accepted','deficient','rejected'].map((s) => [s, lb('status', s)]) },
      { k: 'outcome', t: 'المخرج', type: 'select', opts: Object.entries(L.outcome) },
      { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
      { k: 'due_before', t: 'موعد أقصى قبل', type: 'date' },
      { k: 'late', t: 'تأخر لا يقل عن (أيام)', type: 'number' },
    ],
    cols: [
      { t: 'المنشأة', r: (r) => `<a href="#/licensees/${r.licensee_id}"><b>${E(r.legal_name)}</b></a>
        <div class="muted mono">${E(r.license_no || '—')} · ${E(r.tier_code)} · م${num(r.level)}</div>` },
      { t: 'السنة', srt: 'fiscal_year', r: (r) => yr(r.fiscal_year) },
      { t: 'نهاية السنة المالية', r: (r) => dt(r.fiscal_year_end) },
      { t: 'الموعد الأقصى', srt: 'due_at', r: (r) => !r.submitted_at && r.due_at < today()
        ? `<span class="tag danger">${dt(r.due_at)}</span>` : dt(r.due_at) },
      { t: 'التقديم', srt: 'submitted_at', r: (r) => dt(r.submitted_at) },
      { t: 'التأخر', srt: 'late_days', cls: 'num', r: (r) => r.late_days
        ? `<span class="tag ${r.late_days >= 30 ? 'danger' : 'warn'}">${num(r.late_days)} يوماً</span>` : '—' },
      { t: 'أساس الإثبات', r: (r) => `<div class="muted">${E(lb('basisType', r.basis_type))}</div>` },
      { t: 'المعلن', cls: 'num', r: (r) => `${money(r.declared_total)}
        <div class="muted">إيراد ${money(r.declared_revenue)}</div>` },
      { t: 'مواعيد المعالجة', r: (r) => r.submitted_at ? `<div class="muted" style="font-size:.72rem">
        مكتبي ${dt(r.desk_review_due)} · ميداني ${dt(r.field_audit_due)}<br>
        وقائع ${dt(r.facts_report_due)} · قرار ${dt(r.decision_due)}</div>` : '—' },
      { t: 'الحالة', srt: 'status', r: (r) => tag(r.status) },
      { t: 'المخرج', r: (r) => r.outcome ? tag(r.outcome, 'outcome') : '—' },
      ...(has('commitment.declare') ? [{ t: '', r: (r) => !r.submitted_at
        ? `<button class="btn sm primary" onclick="event.stopPropagation();APP.submitDeclaration(${r.id},'${r.tier_code}')">قدّم الإقرار</button>` : '' }] : []),
      ...(has('app.assess') || has('app.decide') ? [{ t: '', r: (r) => `
        ${has('app.assess') && r.submitted_at && !r.decided_at ? `<button class="btn sm" onclick="event.stopPropagation();APP.processDeclaration(${r.id})">تسجيل الوقائع</button>` : ''}
        ${has('app.decide') && r.processed_at && !r.decided_at ? `<button class="btn sm gold" onclick="event.stopPropagation();APP.decideDeclaration(${r.id})">القرار</button>` : ''}
        ${r.facts_note ? `<div class="muted" style="white-space:normal;max-width:260px">${E(r.facts_note)}</div>` : ''}` }] : []),
    ],
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('لم تُقدَّم', num(d.rows.filter((r) => !r.submitted_at).length), 'في الصفحة')}
      ${stat('متأخرة', num(d.rows.filter((r) => r.late_days > 0).length), 'تنبيه + غرامة 10% من الرسم السنوي',
        d.rows.filter((r) => r.late_days > 0).length ? 'warn' : '')}
      ${stat('بعجز', num(d.rows.filter((r) => r.status === 'deficient').length), '', 'danger')}</div>`,
  }));
  return html;
});

// ================= التدقيق =================
async function auditList() {
  const html = shell('<div id="t"></div>', { title: 'التدقيق والتفتيش',
    sub: 'الفصل الثامن — المادة (25) حجم التدقيق · المادة (26) الزيارات غير المعلنة · المادة (20/3) وقائع بلا توصية',
    actions: `${has('audit.plan') ? '<a class="btn primary" href="#/audit-plan">خطة العيّنة العشوائية</a>' : ''}
      ${has('report.export') ? `<a class="btn" href="/api/reports/audit_coverage/export.csv?token=${encodeURIComponent(S.token)}" target="_blank">تصدير التغطية</a>` : ''}` });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/audits',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'المرجع، الجهة، نص الوقائع' },
      { k: 'audit_type', t: 'نوع التدقيق', type: 'select', opts: Object.entries(L.auditType) },
      { k: 'trigger', t: 'سبب التدقيق', type: 'select', opts: Object.entries(L.trigger) },
      { k: 'status', t: 'الحالة', type: 'select', opts: ['planned','in_progress','facts_reported','closed','cancelled'].map((s) => [s, lb('status', s)]) },
      { k: 'subject_kind', t: 'الجهة', type: 'select', opts: [['licensee','مرخَّص له'],['association','منظمة']] },
      { k: 'level', t: 'المستوى', type: 'select', opts: (S.ref?.levels || []).map((l) => [l.level, l.name_ar]) },
      { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
      { k: 'fiscal_year', t: 'السنة', type: 'select', opts: [[2026, '2026'], [2025, '2025']] },
      { k: 'date_from', t: 'تنفيذ من', type: 'date' },
      { k: 'date_to', t: 'تنفيذ إلى', type: 'date' },
    ],
    cols: [
      { t: 'المرجع', srt: 'reference', r: (r) => `<span class="mono">${E(r.reference)}</span>` },
      { t: 'الجهة', r: (r) => `<a href="#/${r.subject_kind === 'licensee' ? 'licensees' : 'associations'}/${r.subject_id}">
        <b>${E(r.subject_name || '—')}</b></a>
        <div class="muted mono">${E(r.license_no || r.accreditation_no || '')}</div>` },
      { t: 'النوع', srt: 'audit_type', r: (r) => `<span class="tag ${r.audit_type === 'unannounced' ? 'danger' : r.audit_type === 'field' ? 'warn' : ''}">${E(lb('auditType', r.audit_type))}</span>` },
      { t: 'السبب', r: (r) => `<span class="muted">${E(lb('trigger', r.trigger))}</span>` },
      { t: 'المستوى / الشريحة', r: (r) => r.level ? `م${num(r.level)} · ${E(r.tier_code || '')}` : '—' },
      { t: 'المجدول', srt: 'scheduled_date', r: (r) => dt(r.scheduled_date) },
      { t: 'المنفَّذ', srt: 'executed_date', r: (r) => dt(r.executed_date) },
      { t: 'المقيّم', r: (r) => E(r.assessor_name || '—') },
      { t: 'الوقائع', cls: 'num', r: (r) => `${num(r.findings_count)}
        ${r.major_findings ? `<div><span class="tag danger">${num(r.major_findings)} جسيمة</span></div>` : ''}` },
      { t: 'الساعات', cls: 'num', r: (r) => r.hours_spent ? num(r.hours_spent) : '—' },
      { t: 'الحالة', srt: 'status', r: (r) => tag(r.status) },
    ],
    rowClick: (r) => go('audits/' + r.id),
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('زيارات غير معلنة', num(d.rows.filter((r) => r.audit_type === 'unannounced').length), 'لا تقل عن 10%')}
      ${stat('منفَّذة', num(d.rows.filter((r) => r.executed_date).length), 'في الصفحة')}
      ${stat('وقائع جسيمة', num(d.rows.reduce((s, r) => s + (r.major_findings || 0), 0)), 'في الصفحة',
        d.rows.reduce((s, r) => s + (r.major_findings || 0), 0) ? 'danger' : '')}</div>`,
  }));
  return html;
}

route('audits', async (r) => {
  if (!guard()) return '';
  if (!r.params[0]) return auditList();
  const d = await api('/audits/' + r.params[0]);
  return shell(`
    <div class="grid g4" style="margin-bottom:14px">
      ${stat('المرجع', `<span class="mono" style="font-size:.7em">${E(d.reference)}</span>`, E(lb('auditType', d.audit_type)))}
      ${stat('التنفيذ', dt(d.executed_date), 'مجدول ' + dt(d.scheduled_date))}
      ${stat('الوقائع', num(d.findings.length), E(lb('status', d.status)))}
      ${stat('الساعات', d.hours_spent ? num(d.hours_spent) : '—', E(lb('trigger', d.trigger)))}
    </div>
    ${d.audit_type === 'unannounced' ? alertBox('danger', 'زيارة غير معلنة (المادة 26)',
      'تُختار عشوائياً بآلية موثّقة لا يعلمها المقيّم قبل يوم الزيارة. ويُحظر إخطار المرخَّص له بموعدها بأي وسيلة ومن أي جهة — ومخالفة هذا الحظر من أي منتسب موجبة لإنهاء الخدمة.') : ''}
    ${card('تقرير الوقائع', `<p style="white-space:pre-wrap;font-family:var(--fs);font-size:.95rem">${E(d.facts_summary || 'لم يُرفع بعد')}</p>
      ${legal(E(d.note))}`, { note: d.assessor_name ? 'المقيّم: ' + E(d.assessor_name) : '',
      actions: has('audit.execute') && d.status === 'planned'
        ? `<button class="btn primary sm" onclick="APP.auditReport(${d.id})">رفع تقرير الوقائع</button>` : '' })}
    ${card('الوقائع المسجَّلة', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المجال</th><th>الواقعة</th><th>الجسامة</th><th>بند المخالفة</th><th>الجزاء المقرر</th>
        ${has('sanction.decide') ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.findings.length ? d.findings.map((f) => `<tr><td><b>${E(f.area)}</b></td>
        <td style="white-space:normal;max-width:460px">${E(f.fact)}</td>
        <td><span class="tag ${f.severity === 'critical' ? 'danger' : f.severity === 'major' ? 'warn' : ''}">${E(lb('severity', f.severity))}</span></td>
        <td>${f.violation_code ? `<span class="tag danger">المادة 29/${num(f.violation_code)}</span>
          <div class="muted" style="white-space:normal;max-width:240px">${E(f.violation_text || '')}</div>` : '—'}</td>
        <td class="muted" style="white-space:normal;max-width:240px">${E(f.measure_ar || '—')}</td>
        ${has('sanction.decide') ? `<td>${f.violation_code
          ? `<button class="btn sm danger" onclick="APP.newSanction('${d.subject_kind}',${d.subject_id},${f.violation_code},${d.id})">إصدار جزاء</button>` : ''}</td>` : ''}</tr>`).join('')
        : '<tr><td colspan="6"><div class="empty"><b>لا وقائع مسجَّلة</b></div></td></tr>'}</tbody></table></div>`)}
    ${d.documents.length ? card('مستندات التدقيق', `<ul style="margin:0;padding-inline-start:20px">
      ${d.documents.map((x) => `<li>${docLink(x)} <span class="muted">${x.confidential ? '— سرّي' : ''}</span></li>`).join('')}</ul>`) : ''}
    ${card('الجهة', kv([
      ['الاسم', `<a href="#/${d.subject_kind === 'licensee' ? 'licensees' : 'associations'}/${d.subject_id}">${E(d.subject_name)}</a>`],
      ['نوع الجهة', d.subject_kind === 'licensee' ? 'مرخَّص له' : 'منظمة معتمدة'],
      ['السنة المالية', yr(d.fiscal_year)],
      ['بصمة العيّنة', d.sample_seed ? `<span class="mono">${E(d.sample_seed)}</span>` : '—'],
    ]))}`, { title: 'التدقيق ' + d.reference, sub: E(d.subject_name || '') });
});

// خطة العيّنة
route('audit-plan', async () => {
  if (!guard()) return '';
  const html = shell('<div id="p"><div class="load">جارٍ توليد الخطة…</div></div>', {
    title: 'خطة العيّنة العشوائية للتدقيق الميداني',
    sub: 'المادة (25) نسب التدقيق · المادة (26/1) لا تقل الزيارات غير المعلنة عن 10% من إجمالي الزيارات' });
  mount(async () => {
    const el = document.getElementById('p');
    const draw = async (commit) => {
      el.innerHTML = '<div class="load">جارٍ التوليد…</div>';
      let d;
      try {
        d = await api('/audits/plan', { method: 'POST',
          body: { fiscal_year: Number(S.route.query.year) || 2026, commit } });
      } catch (err) {
        el.innerHTML = alertBox('danger', 'تعذّر توليد الخطة', E(err.message)
          + '<br>خطة العيّنة من اختصاص مدير وحدة التقييم والتحقق (المادة 20/1).');
        return;
      }
      el.innerHTML = `
        <div class="grid g4" style="margin-bottom:14px">
          ${stat('ملفات سارية', num(d.total_active))}
          ${stat('مختارة للتدقيق', num(d.selected), pct(d.coverage) + ' تغطية', 'gold')}
          ${stat('زيارات غير معلنة', num(d.unannounced_selected), 'الحد الأدنى 10%')}
          ${stat('بصمة الاختيار', `<span class="mono" style="font-size:.5em">${E(d.seed)}</span>`, 'موثّقة وقابلة للتحقق')}
        </div>
        ${alertBox('info', 'آلية الاختيار', E(d.integrity_note))}
        ${d.committed ? alertBox('ok', 'تم تثبيت الخطة', 'أُنشئت عمليات التدقيق المجدولة في النظام.') : ''}
        <div class="card"><div class="card-hd"><h3>الملفات المختارة</h3><span class="spacer" style="flex:1"></span>
          ${!d.committed ? `<button class="btn primary sm" id="cm">تثبيت الخطة وإنشاء الجدولة</button>` : ''}
          <button class="btn sm" id="rg">إعادة التوليد ببصمة جديدة</button></div>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>المنشأة</th><th>رقم الترخيص</th><th>المستوى</th>
          <th>الشريحة</th><th>النسبة المقررة</th><th>سند النسبة</th><th>قيمة السحب</th><th>غير معلنة</th></tr></thead><tbody>
          ${d.plan.map((p) => `<tr><td><a href="#/licensees/${p.licensee_id}"><b>${E(p.legal_name)}</b></a></td>
            <td class="mono">${E(p.license_no || '—')}</td><td>${num(p.level)}</td><td>${E(p.tier_code)}</td>
            <td class="num">${pct(p.rate, 0)}</td>
            <td class="muted" style="white-space:normal;max-width:300px">${E(p.reason)}</td>
            <td class="num mono">${p.draw}</td>
            <td>${p.unannounced ? '<span class="tag danger">غير معلنة</span>' : '<span class="muted">معلنة</span>'}</td></tr>`).join('')}
          </tbody></table></div></div>`;
      el.querySelector('#cm')?.addEventListener('click', () => draw(true));
      el.querySelector('#rg')?.addEventListener('click', () => draw(false));
    };
    draw(false);
  });
  return html;
});

// اختبار السوق
route('market-tests', async () => {
  if (!guard()) return '';
  const d = await api('/market-tests');
  return shell(card('جولات اختبار السوق', `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>الجولة</th><th>المدينة</th><th>التاريخ</th><th>نقاط البيع</th><th>الأصناف</th>
      <th>استعمال صحيح</th><th>بلا رقم ترخيص</th><th>مستوى مخالف</th><th>خارج النطاق</th><th>غير مرخَّص</th>
      <th>نسبة المطابقة</th><th>منشور</th></tr></thead><tbody>
    ${d.rows.map((m) => `<tr><td><b>${E(m.round_name)}</b></td><td>${E(m.city)}</td><td>${dt(m.conducted_on)}</td>
      <td class="num">${num(m.outlets_visited)}</td><td class="num">${num(m.items_checked)}</td>
      <td class="num">${num(m.correct_usage)}</td>
      <td class="num">${m.missing_license_no ? `<span class="tag warn">${num(m.missing_license_no)}</span>` : '0'}</td>
      <td class="num">${m.level_mismatch ? `<span class="tag danger">${num(m.level_mismatch)}</span>` : '0'}</td>
      <td class="num">${m.out_of_scope ? `<span class="tag warn">${num(m.out_of_scope)}</span>` : '0'}</td>
      <td class="num">${m.unlicensed_usage ? `<span class="tag danger">${num(m.unlicensed_usage)}</span>` : '0'}</td>
      <td class="num"><b>${pct(m.items_checked ? m.correct_usage / m.items_checked : 0)}</b></td>
      <td>${m.published ? '<span class="tag ok">منشور</span>' : '—'}</td></tr>`).join('')}
    </tbody></table></div>
    ${legal('المادة (28): تنفّذ الأمانة سنوياً جولات فحص ميداني في نقاط البيع للتحقق من صحة استعمال العلامة، ومطابقة المستوى المعلن للمستوى الممنوح، ووجود رقم الترخيص، وعدم استعمال العلامة من غير مرخَّص. وتُنشر خلاصة نتائج هذه الجولات في التقرير السنوي.')}`),
    { title: 'اختبار السوق', sub: 'فحص ميداني في نقاط البيع',
      actions: has('market_test.manage') ? '<button class="btn primary" onclick="APP.newMarketTest()">تسجيل جولة</button>' : '' });
});

// ================= الجزاءات =================
route('sanctions', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'الجزاءات',
    sub: 'الفصل التاسع — المادة (29) التدرّج الجزائي · المادة (30) التعليق · المادة (31) السحب',
    actions: `${has('sanction.decide') ? '<button class="btn danger" onclick="APP.newSanction()">إصدار جزاء</button>' : ''}
      ${has('report.export') ? `<a class="btn" href="/api/reports/sanctions_ledger/export.csv?token=${encodeURIComponent(S.token)}" target="_blank">تصدير السجل</a>` : ''}` });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/sanctions',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true },
      { k: 'measure', t: 'الجزاء', type: 'select', opts: Object.entries(L.measure) },
      { k: 'violation_code', t: 'بند المخالفة', type: 'select', opts: (S.ref?.violations || []).map((v) => [v.code, `${v.code} — ${v.case_ar.slice(0, 40)}`]) },
      { k: 'status', t: 'الحالة', type: 'select', opts: ['active','lifted','escalated','appealed','overturned','closed'].map((s) => [s, lb('status', s)]) },
      { k: 'subject_kind', t: 'الجهة', type: 'select', opts: [['licensee','مرخَّص له'],['association','منظمة'],['unlicensed','غير مرخَّص']] },
      { k: 'published', t: 'منشور', type: 'bool' },
      { k: 'date_from', t: 'من', type: 'date' }, { k: 'date_to', t: 'إلى', type: 'date' },
    ],
    cols: [
      { t: 'القضية', srt: 'case_no', r: (r) => `<span class="mono">${E(r.case_no)}</span>` },
      { t: 'الجهة', r: (r) => r.subject_id
        ? `<a href="#/${r.subject_kind === 'licensee' ? 'licensees' : 'associations'}/${r.subject_id}"><b>${E(r.resolved_name)}</b></a>
           <div class="muted mono">${E(r.license_no || r.accreditation_no || '')}</div>`
        : `<b>${E(r.resolved_name || '—')}</b><div class="muted">غير مرخَّص</div>` },
      { t: 'المخالفة', r: (r) => r.violation_code
        ? `<span class="tag danger">29/${num(r.violation_code)}</span>
           <div class="muted" style="white-space:normal;max-width:240px">${E(r.violation_text || '')}</div>` : '—' },
      { t: 'الجزاء', srt: 'measure', r: (r) => `<span class="tag ${['withdrawal','suspension'].includes(r.measure) ? 'danger' : 'warn'}">${E(lb('measure', r.measure))}</span>
        ${r.fine_amount ? `<div class="num">${money(r.fine_amount)}</div>` : ''}
        ${r.grace_days ? `<div class="muted">إمهال ${num(r.grace_days)} يوماً</div>` : ''}` },
      { t: 'التسبيب', r: (r) => `<div class="muted" style="white-space:normal;max-width:420px">${E(r.reason)}</div>` },
      { t: 'السريان', r: (r) => `${dt(r.effective_from)}${r.effective_to ? `<div class="muted">إلى ${dt(r.effective_to)}</div>` : ''}
        ${r.auto_escalate_to ? `<div class="muted">تصعيد تلقائي: ${E(lb('measure', r.auto_escalate_to))}</div>` : ''}` },
      { t: 'النشر', r: (r) => r.published
        ? `<span class="tag danger">منشور</span>${r.publish_until ? `<div class="muted">حتى ${dt(r.publish_until)}</div>` : ''}` : '<span class="muted">—</span>' },
      { t: 'إعادة التقديم', r: (r) => r.reapply_allowed_from ? dt(r.reapply_allowed_from) : '—' },
      { t: 'صدر عن', r: (r) => `<div class="muted">${E(r.decided_by_name || '—')}<br>${dt(r.decided_at)}</div>` },
      { t: 'الحالة', r: (r) => tag(r.status) + (r.appeals_count ? ` <span class="tag info">${num(r.appeals_count)} تظلم</span>` : '') },
    ],
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('تعليق', num(d.rows.filter((r) => r.measure === 'suspension').length), 'أقصاها ستة أشهر ثم سحب تلقائي', 'warn')}
      ${stat('سحب', num(d.rows.filter((r) => r.measure === 'withdrawal').length), 'منشور 12 شهراً', 'danger')}
      ${stat('غرامات', money(d.rows.reduce((s, r) => s + (r.fine_amount || 0), 0)), 'في الصفحة')}</div>`,
  }));
  return html;
});

// ================= التظلمات =================
route('appeals', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'التظلمات',
    sub: 'المادة (22): التظلم خلال ثلاثين يوماً من الإخطار، والفصل خلال ستين يوماً، والقرار نهائي داخلياً دون إخلال بحق اللجوء إلى القضاء' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/appeals',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true },
      { k: 'status', t: 'الحالة', type: 'select', opts: ['filed','under_review','decided','withdrawn','inadmissible'].map((s) => [s, lb('status', s)]) },
      { k: 'decision', t: 'القرار', type: 'select', opts: [['upheld','تأييد'],['overturned','إلغاء'],['partially_upheld','قبول جزئي'],['inadmissible','غير مقبول']] },
      { k: 'appellant_kind', t: 'المتظلم', type: 'select', opts: [['licensee','مرخَّص له'],['association','منظمة']] },
      { k: 'due_before', t: 'موعد الفصل قبل', type: 'date' },
    ],
    cols: [
      { t: 'المرجع', r: (r) => `<span class="mono">${E(r.reference)}</span>` },
      { t: 'المتظلم', r: (r) => `<a href="#/${r.appellant_kind === 'licensee' ? 'licensees' : 'associations'}/${r.appellant_id}">
        <b>${E(r.resolved_name)}</b></a>` },
      { t: 'القرار المتظلَّم منه', r: (r) => r.case_no
        ? `<span class="mono">${E(r.case_no)}</span> <span class="tag danger">${E(lb('measure', r.measure))}</span>
           <div class="muted" style="white-space:normal;max-width:300px">${E((r.sanction_reason || '').slice(0, 140))}</div>`
        : (r.application_id ? `<a href="#/applications/${r.application_id}">قرار على طلب</a>` : '—') },
      { t: 'التقديم', srt: 'filed_at', r: (r) => `${dt(r.filed_at)}
        ${r.filing_deadline ? `<div class="muted">المهلة ${dt(r.filing_deadline)}</div>` : ''}` },
      { t: 'موعد الفصل', srt: 'decision_due_at', r: (r) => r.overdue
        ? `<span class="tag danger">${dt(r.decision_due_at)}</span>` : dt(r.decision_due_at) },
      { t: 'أسباب التظلم', r: (r) => `<div class="muted" style="white-space:normal;max-width:380px">${E(r.grounds)}</div>` },
      { t: 'وقف التنفيذ', r: (r) => r.stay_of_execution ? '<span class="tag warn">موقوف</span>' : '<span class="muted">غير موقوف</span>' },
      { t: 'القرار', r: (r) => r.decision
        ? `${tag(r.decision, 'decision')}<div class="muted" style="white-space:normal;max-width:420px">${E(r.decision_reason || '')}</div>
           <div class="muted">${E(r.decided_by_name || '')} · ${dt(r.decided_at)}</div>` : tag(r.status) },
      ...(has('appeal.decide') ? [{ t: '', r: (r) => r.status !== 'decided'
        ? `<button class="btn sm primary" onclick="event.stopPropagation();APP.decideAppeal(${r.id})">البتّ في التظلم</button>` : '' }] : []),
    ],
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('قيد النظر', num(d.rows.filter((r) => r.status !== 'decided').length))}
      ${stat('تجاوزت الستين يوماً', num(d.rows.filter((r) => r.overdue).length), '', d.rows.filter((r) => r.overdue).length ? 'danger' : '')}
      ${stat('أُلغيت قرارات', num(d.rows.filter((r) => r.decision === 'overturned').length), 'مؤشر استقلال اللجنة', 'gold')}</div>`,
  }));
  return html;
});

// ================= الشكاوى =================
route('complaints', async () => {
  if (!guard()) return '';
  const html = shell('<div id="t"></div>', { title: 'البلاغات والشكاوى',
    sub: 'نموذج (9) — قناة سرّية وحماية للمبلّغين. وأي ملف يرد بشأنه بلاغ يخضع لتدقيق ميداني 100% وفوري (المادة 25)',
    actions: '<a class="btn" href="#/report-abuse">تقديم بلاغ</a>' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/complaints',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true },
      { k: 'status', t: 'الحالة', type: 'select', opts: ['received','triage','investigating','substantiated','unsubstantiated','closed'].map((s) => [s, lb('status', s)]) },
      { k: 'subject_kind', t: 'الجهة', type: 'select', opts: [['licensee','مرخَّص له'],['association','منظمة'],['unlicensed','غير مرخَّص'],['secretariat','الأمانة']] },
      { k: 'channel', t: 'القناة', type: 'select', opts: [['portal','البوابة'],['email','بريد'],['phone','هاتف'],['letter','خطاب'],['field','ميداني']] },
      { k: 'date_from', t: 'من', type: 'date' },
    ],
    cols: [
      { t: 'المرجع', r: (r) => `<span class="mono">${E(r.reference)}</span>` },
      { t: 'الجهة', r: (r) => r.subject_id
        ? `<a href="#/${r.subject_kind === 'licensee' ? 'licensees' : 'associations'}/${r.subject_id}">${E(r.resolved_name)}</a>`
        : `${E(r.resolved_name || '—')}` },
      { t: 'نص البلاغ', r: (r) => `<div style="white-space:normal;max-width:460px">${E(r.body)}</div>` },
      { t: 'المبلّغ', r: (r) => r.is_anonymous
        ? '<span class="tag info">مجهول — محمي</span>' : E(r.reporter_name || '—') },
      { t: 'القناة', r: (r) => `<span class="muted">${E(r.channel)}</span>` },
      { t: 'التقديم', srt: 'filed_at', r: (r) => dt(r.filed_at) },
      { t: 'المحال إليه', r: (r) => E(r.assigned_to_name || '—') },
      { t: 'تدقيق مفتوح', r: (r) => r.triggered_audit_id
        ? `<a href="#/audits/${r.triggered_audit_id}" class="tag danger">تدقيق ${num(r.triggered_audit_id)}</a>` : '—' },
      { t: 'النتيجة', r: (r) => `${tag(r.status)}
        ${r.resolution ? `<div class="muted" style="white-space:normal;max-width:340px">${E(r.resolution)}</div>` : ''}` },
      ...(has('complaint.triage') ? [{ t: '', r: (r) => !['closed', 'unsubstantiated'].includes(r.status)
        ? `<button class="btn sm" onclick="event.stopPropagation();APP.triageComplaint(${r.id})">فرز وإحالة</button>` : '' }] : []),
    ],
  }));
  return html;
});

// ================= النزاهة =================
route('integrity', async () => {
  if (!guard()) return '';
  const d = await api('/integrity-notes');
  return shell(`
    ${alertBox('info', 'اختصاص لجنة حماية النزاهة (المادة 23)',
      'مراقبة استقلال المنظومة ونزاهتها ككل — لا مراجعة الملفات الفردية — ورصد أي ضغط أو تدخل أو تعارض مصالح، ومراجعة التزام الأمانة بأحكام الشفافية. ترفع تقريرها إلى مجلس الأمناء مرتين سنوياً.')}
    ${legal(E(d.power))}
    ${d.rows.map((n) => `<div class="card"><div class="card-hd">
      <h3>${E(n.title)}</h3>
      <span class="tag ${n.status === 'published' ? 'danger' : n.status === 'answered' ? 'ok' : 'warn'}">${E(lb('status', n.status))}</span>
      <span class="muted">${E(n.reference)}</span>
      <span class="spacer" style="flex:1"></span>
      ${has('integrity.publish') && n.publishable && !n.public_disclosure
        ? `<button class="btn danger sm" onclick="APP.publishIntegrity(${n.id})">نشر علني (انقضت المهلة)</button>` : ''}
      ${has('gov.meetings.manage') && !n.responded
        ? `<button class="btn primary sm" onclick="APP.respondIntegrity(${n.id})">رد المجلس</button>` : ''}</div>
      <div class="card-bd">
      <p style="font-family:var(--fs);font-size:.95rem">${E(n.body)}</p>
      ${kv([['التصنيف', E({ independence:'استقلال', pressure:'ضغط أو تدخل', conflict_of_interest:'تعارض مصالح',
          transparency:'شفافية', other:'أخرى' }[n.category] || n.category)],
        ['رُفعت بواسطة', `${E(n.raised_by_name || '—')} في ${dt(n.raised_at)}`],
        ['أُخطر المجلس', dt(n.board_notified_at)],
        ['موعد الرد الأقصى (90 يوماً)', n.publishable
          ? `<span class="tag danger">${dt(n.response_due_at)} — انقضت</span>` : dt(n.response_due_at)],
        n.board_response ? ['رد المجلس', `${E(n.board_response)}<div class="muted">${dt(n.responded_at)}</div>`] : null,
        n.public_disclosure ? ['النشر العلني', `<span class="tag danger">منشور في السجل — ${dt(n.published_at)}</span>`] : null,
      ])}
      ${n.publishable && !n.public_disclosure ? alertBox('danger', 'انقضت مهلة التسعين يوماً دون استجابة',
        'للجنة نشر ملاحظاتها علناً في السجل — وهذه الصلاحية جوهرية ولا يجوز تعطيلها أو تقييدها بأي قرار (المادة 23/3).') : ''}
      </div></div>`).join('') || '<div class="empty"><b>لا ملاحظات مسجَّلة</b></div>`'}
    ${has('integrity.note') ? `<div class="btn-row"><button class="btn primary" onclick="APP.newIntegrityNote()">تسجيل ملاحظة نزاهة</button></div>` : ''}`,
    { title: 'حماية النزاهة', sub: 'ملاحظات لجنة حماية النزاهة ومساراتها' });
});

// ================= المراقبون =================
route('observers', async () => {
  if (!guard()) return '';
  const d = await api('/observers');
  const bySector = d.limits.by_sector || [];
  return shell(`
    <div class="grid g4" style="margin-bottom:14px">
      ${stat('مقبولون في الدورة', `${num(d.limits.admitted_total)} / ${num(d.limits.max_per_cycle)}`, 'السقف خمسة (المادة 34/3)',
        d.limits.admitted_total >= d.limits.max_per_cycle ? 'warn' : '')}
      ${stat('الحد لكل قطاع', num(d.limits.max_per_sector), 'لا يمثّل قطاعٌ واحدٌ أكثر من مراقبَين')}
      ${stat('حق التصويت', 'لا يوجد', 'حضور ومداخلة فقط', 'gold')}
      ${stat('الاطلاع على الملفات', 'محظور', 'لا حق في ملف فردي قيد التقييم', 'danger')}
    </div>
    ${bySector.length ? card('التمثيل القطاعي', bars(bySector.map((s) => ({
      k: lb('entityKind', s.entity_kind), v: s.n,
      color: s.n >= 2 ? 'var(--warn)' : 'var(--green)' }))) ) : ''}
    ${card('سجل المراقبين', `<div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المرجع</th><th>المراقب</th><th>الجهة المرشِّحة</th><th>القطاع</th><th>الدورة</th>
        <th>المدة</th><th>إقرار السرّية</th><th>الحالة</th><th>سبب الإنهاء</th>
        ${has('observer.admit') ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.rows.map((o) => `<tr><td class="mono">${E(o.reference)}</td>
        <td><b>${E(o.person_name)}</b>${o.email ? `<div class="muted mono">${E(o.email)}</div>` : ''}</td>
        <td>${E(o.nominating_entity)}</td>
        <td><span class="tag">${E(lb('entityKind', o.entity_kind))}</span><div class="muted">${E(o.sector || '')}</div></td>
        <td>${E(o.cycle || '—')}</td>
        <td>${o.term_start ? `${dt(o.term_start)}<div class="muted">${dt(o.term_end)}</div>` : '—'}</td>
        <td>${o.pledge_doc_id ? '<span class="tag ok">موقَّع</span>' : '<span class="tag warn">مطلوب</span>'}</td>
        <td>${tag(o.status)}</td>
        <td class="muted" style="white-space:normal;max-width:280px">${E(o.end_reason || '')}</td>
        ${has('observer.admit') ? `<td>${o.status === 'nominated'
          ? `<button class="btn sm primary" onclick="APP.decideObserver(${o.id})">البتّ</button>`
          : o.status === 'admitted' ? `<button class="btn sm" onclick="APP.decideObserver(${o.id})">إنهاء الصفة</button>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>
      ${legal(E(d.limits.rights) + '<br>ويتحمل المراقب مصاريف مشاركته، ولا يترتب على تحمّله لها أي حق إضافي في التأثير على القرار. ولمجلس الأمناء إنهاء صفة المراقب بقرار مسبَّب عند الإخلال بالضوابط.')}`,
      { actions: has('observer.nominate') ? '<button class="btn primary sm" onclick="APP.nominateObserver()">ترشيح مراقب</button>' : '' })}`,
    { title: 'المراقبون', sub: 'المادة (34): مبدأ مقيَّد بسقف عددي وقطاعي وبانعدام حق التصويت' });
});

// ================= الاجتماعات =================
route('meetings', async () => {
  if (!guard()) return '';
  const d = await api('/meetings' + (S.route.query.body ? '?body=' + S.route.query.body : ''));
  return shell(`
    <div class="btn-row" style="margin-bottom:12px">
      <a class="btn sm ${!S.route.query.body ? 'primary' : ''}" href="#/meetings">الكل</a>
      ${Object.entries(L.body).map(([k, v]) =>
        `<a class="btn sm ${S.route.query.body === k ? 'primary' : ''}" href="#/meetings?body=${k}">${E(v)}</a>`).join('')}
    </div>
    ${d.rows.map((m) => `<div class="card"><div class="card-hd">
      <span class="tag gold">${E(lb('body', m.body))}</span>
      <h3>${E(m.title)}</h3>
      <span class="muted mono">${E(m.meeting_no || '')}</span>
      <span class="spacer" style="flex:1"></span>
      <span class="muted">${dt(m.held_on)}</span>
      ${m.is_public ? '<span class="tag info">محضر منشور</span>' : ''}</div>
      <div class="card-bd">
      <p style="font-family:var(--fs);font-size:.94rem">${E(m.decisions || '')}</p>
      ${kv([['النصاب المطلوب', num(m.quorum_required)],
        ['الحاضرون', num(m.attendees_count)],
        ['المراقبون', `${num(m.observers_count)} <span class="muted">— حضور ومداخلة بلا صوت</span>`]])}
      ${m.attendance?.length ? `<h4 style="margin-top:12px">الحضور</h4>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${m.attendance.map((a) =>
          `<span class="tag ${a.voting ? 'ok' : 'info'}">${E(a.full_name || a.observer_name || '')}
            ${a.voting ? '' : ' — مراقب'}</span>`).join('')}</div>` : ''}
      </div></div>`).join('') || '<div class="empty"><b>لا اجتماعات</b></div>'}`,
    { title: 'الاجتماعات والمحاضر', sub: 'المادة (6): الأصل هو النشر — ولا يجوز حجب معلومة إلا بنصٍّ صريح',
      actions: has('gov.meetings.manage') ? '<button class="btn primary" onclick="APP.newMeeting()">تسجيل اجتماع</button>' : '' });
});

})();
