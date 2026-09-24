(function(){
'use strict';
/* ===== لوحات العمل الداخلية: المؤشرات، الملفات، المسارات ===== */
const { S, api, qs, E, num, money, pct, dt, yr, today, days, L, lb, tag, tone, lvlBadge, ic,
        toast, modal, route, render, go, has, hasRole, kfmt } = window.SEMA;
const { shell, dataTable, bars, meter, spark, stat, alertBox, legal, card, kv, tabs, docLink } = window.UI;

const guard = () => { if (!S.user) { location.hash = '#/login'; return false; } return true; };
const mount = (fn) => setTimeout(fn, 0);

// ================= لوحة المؤشرات =================
route('dashboard', async () => {
  if (!guard()) return '';
  const [d, cal, msgs] = await Promise.all([api('/dashboard'),
    api('/calendar' + SEMA.qs({ from: today(), to: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10) })).catch(() => null),
    api('/threads/unread').catch(() => ({ unread: 0, awaiting: 0 }))]);
  const isPartner = d.scope === 'licensee', isOrg = d.scope === 'association';
  let body = workBar(cal, msgs);

  if (isPartner) body += partnerDash(d);
  else if (isOrg) body += orgDash(d);
  else if (d.scope === 'observer') body += observerDash(d);
  else if (d.totals) body += adminDash(d);
  else body += alertBox('info', 'لوحة مختصرة',
    'دورك يمنحك اطلاعاً على الصفحات المدرجة في القائمة الجانبية. ولا تُعرض هنا مؤشرات تشغيلية تخرج عن اختصاصك.');

  return shell(body, { title: 'لوحة المؤشرات',
    sub: `${E(d.role_view.join(' · '))} — ${dt(d.generated_at)}`,
    actions: has('report.view') ? '<a class="btn" href="#/reports">التقارير</a>' : '' });
});

/** شريط العمل: ما يستحق الانتباه الآن — المتجاوز والقريب من المواعيد، والمراسلات بانتظار ردّك */
function workBar(cal, msgs) {
  if (!cal) return '';
  const upcoming = cal.events.filter((e) => !e.overdue).slice(0, 5);
  const staff = has('thread.staff'), canMsg = staff || has('thread.own');
  if (!cal.counts.overdue && !upcoming.length && !(canMsg && (msgs.awaiting || msgs.unread))) return '';
  return `<div class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);margin-bottom:16px" id="workbar">
    ${window.UI.card('مواعيدك خلال أسبوعين', upcoming.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${upcoming.map((e) =>
      `<tr><td class="mono" style="width:110px">${E(e.date)}</td><td>${e.link ? `<a href="${E(e.link)}">${E(e.title)}</a>` : E(e.title)}
        ${e.sub ? `<div class="muted" style="font-size:.76rem">${E(e.sub)}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty"><b>لا مواعيد قريبة</b></div>',
    { actions: `${cal.counts.overdue ? `<a class="tag danger" href="#/calendar">${num(cal.counts.overdue)} متجاوز</a>` : ''}
      <a class="btn sm" href="#/calendar">التقويم</a>` })}
    ${canMsg ? window.UI.card('المراسلات', `<div class="grid g2">
      ${stat(staff ? 'بانتظار الأمانة' : 'بانتظار ردّك', num(msgs.awaiting), '', msgs.awaiting ? 'gold' : '')}
      ${stat('غير مقروءة', num(msgs.unread), '', msgs.unread ? 'danger' : '')}</div>`,
    { actions: `<a class="btn sm" href="#/messages${msgs.unread ? '?unread=1' : ''}">فتح</a>` }) : '<div></div>'}
  </div>`;
}

function observerDash(d) {
  const o = d.observer;
  return `
  ${alertBox('info', 'نطاق اطلاع المراقب', E(d.observer_rights))}
  <div class="grid g4" style="margin-bottom:16px">
    ${stat('مرخَّص لهم سارون', num(o.licensees_active))}
    ${stat('منظمات معتمدة', num(o.associations_accredited), '', 'gold')}
    ${stat('إجمالي الموجَّه للخير', money(o.directed_total))}
    ${stat('جزاءات منشورة', num(o.sanctions_published), 'مؤشر مصداقية', 'danger')}
    ${stat('اجتماعات المجلس', num(o.board_meetings), 'لك حق الحضور والمداخلة')}
    ${stat('المراقبون المقبولون', num(o.observers_admitted), 'السقف خمسة في الدورة')}
    ${stat('ملاحظات نزاهة منشورة', num(o.integrity_published))}
    ${stat('نسبة الإدارة وجمع التمويل', pct(o.overhead_ratio), 'السقف 25%',
      o.overhead_ratio > 0.25 ? 'danger' : 'ok')}
  </div>
  ${window.UI.card('ما تستطيع الاطلاع عليه', `<div class="btn-row">
    <a class="btn primary" href="#/meetings">اجتماعات المجلس ومحاضرها</a>
    <a class="btn" href="#/observers">سجل المراقبين</a>
    <a class="btn" href="#/registry">السجل العام</a>
    <a class="btn" href="#/transparency">لوحة الشفافية</a></div>
    ${window.UI.legal('المادة (34): يوقّع المراقب على إقرار سرّية وحياد، ويلتزم بأحكام تعارض المصالح. ويتحمل مصاريف مشاركته، ولا يترتب على تحمّله لها أي حق إضافي في التأثير على القرار. ولمجلس الأمناء إنهاء صفة المراقب بقرار مسبَّب عند الإخلال بالضوابط.')}`)}`;
}

function adminDash(d) {
  const t = d.totals, m = d.money;
  return `
  ${d.alerts?.length ? card('تنبيهات تشغيلية', d.alerts.map((a) =>
    `<a href="${E(a.link)}" style="text-decoration:none">${alertBox(a.severity === 'danger' ? 'danger' : 'warn',
      `${a.title} — ${num(a.count)}`, '')}</a>`).join(''), { note: 'مرتَّبة حسب الأثر النظامي' }) : ''}

  <div class="grid g4" style="margin-bottom:16px">
    ${stat('مرخَّص لهم سارون', num(t.licensees_active), `من ${num(t.licensees_all)} ملفاً`)}
    ${stat('منظمات معتمدة', num(t.associations_accredited), 'الاعتماد مجاني', 'gold')}
    ${stat('الالتزام الواجب', money(m.committed_year), 'السنة الجارية')}
    ${stat('الموثَّق والمتحقَّق', money(m.paid_year), pct(m.committed_year ? m.paid_year / m.committed_year : 0) + ' من الواجب')}
    ${stat('طلبات مفتوحة', num(t.applications_open), `${num(t.applications_overdue)} تجاوزت المدة`, t.applications_overdue ? 'danger' : '')}
    ${stat('إثباتات بانتظار التحقق', num(t.docs_pending), '', t.docs_pending > 20 ? 'warn' : '')}
    ${stat('تدقيق منفَّذ', num(t.audits_done), `${num(t.audits_planned)} مجدول`)}
    ${stat('جزاءات سارية', num(t.sanctions_active), `${num(t.appeals_open)} تظلم مفتوح`, t.sanctions_active ? 'warn' : '')}
    ${stat('رسوم محصَّلة', money(m.fees_collected), `متأخر ${money(m.fees_overdue)}`)}
    ${stat('الموجَّه لكل دينار رسوم', num(m.per_dinar_of_fees), 'مؤشر كفاءة داخلي', 'gold')}
    ${stat('بلاغات مفتوحة', num(t.complaints_open), 'تدقيق 100% فوري', t.complaints_open ? 'danger' : '')}
    ${stat('مراقبون مقبولون', num(t.observers_admitted), 'السقف خمسة في الدورة')}
  </div>

  <div class="grid g2">
    ${card('التوزيع على المستويات الخمسة', bars(d.by_level.map((l) => ({
      k: `${l.name_ar} (${num(l.n)})`, v: l.paid, color: l.color_hex })), { fmt: money })
      + `<p class="muted" style="margin-top:8px">القيمة = الالتزام الموثَّق. العدد بين قوسين = المرخَّص لهم السارون.</p>`)}
    ${card('مسار الطلبات المفتوحة', d.pipeline.length ? bars(d.pipeline.map((p) => ({
      k: `المرحلة ${p.stage} — ${(S.ref?.app_stages || []).find((s) => s.stage === p.stage)?.name?.slice(0, 26) || ''}`,
      v: p.n })) ) : '<div class="empty"><b>لا طلبات مفتوحة</b></div>')}
    ${card('التوزيع الجغرافي', bars(d.by_region.map((r) => ({ k: r.region || '—', v: r.paid })), { fmt: money })
      + `<div class="muted" style="margin-top:8px">${d.by_region.map((r) => `${E(r.region || '—')}: ${num(r.n)} ملفاً`).join(' · ')}</div>`)}
    ${card('التصنيف الإداري للمنظمات (المادة 15)', bars(d.admin_classes.map((c) => ({
      k: c.name_ar || c.code, v: c.n,
      color: c.code === 'rejected' ? 'var(--danger)' : c.code === 'acceptable' ? 'var(--warn)' : 'var(--green)' })))
      + legal('سقف 25% من إجمالي المصروفات كمتوسط ثلاث سنوات. وما فوقه: لا يُمنح الاعتماد أو يُسحب.'))}
    ${card('مركّب مسارات الالتزام (المادة 20)', bars(d.channel_mix.map((c) => ({
      k: `${c.name_ar} (${num(c.n)})`, v: c.s,
      color: c.channel === 'cash' ? 'var(--green)' : c.channel === 'inkind' ? 'var(--gold)'
        : c.channel === 'volunteer' ? 'var(--silver)' : 'var(--purple)' })), { fmt: money })
      + legal('النقدي ≥ 50% · البرامج الذاتية ≤ 40% · العيني ≤ 25% · التطوّع ≤ 10%'))}
    ${card('أعلى القطاعات', bars(d.by_sector.slice(0, 10).map((s) => ({ k: s.sector || '—', v: s.paid })), { fmt: money }))}
  </div>

  ${card('أكبر المنظمات المتلقية وسقف الاستيعاب', `<div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>المنظمة</th><th>رقم الاعتماد</th><th>النسبة الإدارية</th><th>الوارد عبر العلامة</th>
      <th>سقف الاستيعاب</th><th>الاستهلاك</th></tr></thead><tbody>
    ${d.top_associations.map((a) => `<tr><td><a href="#/associations/${a.id}"><b>${E(a.name)}</b></a></td>
      <td class="mono">${E(a.accreditation_no || '—')}</td>
      <td class="num">${pct(a.admin_expense_ratio)}</td>
      <td class="num">${money(a.received)}</td><td class="num">${money(a.absorption_cap)}</td>
      <td style="min-width:150px">${meter(a.received, a.absorption_cap)}
        <span class="muted">${pct(a.absorption_cap ? a.received / a.absorption_cap : 0, 0)}</span></td></tr>`).join('')}
    </tbody></table></div>
    ${legal('المعيار (10): ما تتلقاه المنظمة عبر العلامة في السنة لا يتجاوز 200% من أكبر ميزانية سنوية لها في السنوات الثلاث السابقة — منعاً لإغراق منظمة بما يتجاوز قدرتها التنفيذية.')}`)}

  ${d.sla ? card('أداء المواعيد المعيارية', `<div class="grid g4">
    ${stat('متوسط مدة المعالجة', num(d.sla.avg_days) + ' يوماً', 'المعياري 90 يوم عمل')}
    ${stat('أسرع ملف', num(d.sla.min_days) + ' يوماً')}
    ${stat('أطول ملف', num(d.sla.max_days) + ' يوماً', '', d.sla.max_days > 90 ? 'warn' : '')}
    ${stat('ملفات مفصولة', num(d.sla.n))}</div>
    ${legal('المادة (17): إجمالي المدة المعيارية 90 يوم عمل من اكتمال الطلب، وتُنشر مدة المعالجة الفعلية المتوسطة في التقرير السنوي.')}`) : ''}`;
}

function partnerDash(d) {
  const l = d.licensees[0] || {};
  const c = d.commitment;
  return `
  ${d.docs_missing?.length ? alertBox('warn', `إثباتات مطلوبة ناقصة (${d.docs_missing.length})`,
    d.docs_missing.map((x) => E(x.name_ar)).join(' · ') + ' — <a href="#/documents">حمّلها الآن</a>') : ''}
  ${d.pending_declaration ? alertBox(days(today(), d.pending_declaration.due_at) < 30 ? 'danger' : 'info',
    'إقرار امتثال مستحق', `السنة المالية ${yr(d.pending_declaration.fiscal_year)} — الموعد الأقصى
    <b>${dt(d.pending_declaration.due_at)}</b> (120 يوماً من انتهاء السنة المالية).
    <a href="#/commitments">قدّم الإقرار</a>`) : ''}
  ${d.open_sanctions ? alertBox('danger', `جزاءات سارية (${num(d.open_sanctions)})`,
    'راجع <a href="#/sanctions">صفحة الجزاءات</a> — ولك حق التظلم خلال ثلاثين يوماً من الإخطار (المادة 22/2).') : ''}

  <div class="grid g4" style="margin-bottom:16px">
    ${stat('رقم الترخيص', `<span class="mono" style="font-size:.7em">${E(l.license_no || '—')}</span>`, E(lb('status', l.status)))}
    ${stat('المستوى', E(l.level_name || '—'), `سارٍ إلى ${dt(l.end_date)}`, 'gold')}
    ${c ? stat('الالتزام الواجب', money(c.commitment_due), E(lb('basis', c.basis))) : ''}
    ${c ? stat('الموثَّق', money(c.total_paid), pct(c.commitment_due ? c.total_paid / c.commitment_due : 0) + ' من الواجب',
      c.deficit_pct > 0.2 ? 'danger' : c.deficit_pct > 0 ? 'warn' : '') : ''}
    ${stat('المصروف هذه السنة', money(d.contributions_ytd))}
    ${stat('تصاميم قيد الموافقة', num(d.open_designs), 'الرد خلال 10 أيام عمل')}
  </div>

  ${c ? card('حالة الالتزام السنوي', `
    <div class="grid g2">
      <div>${kv([
        ['السنة المالية', yr(c.fiscal_year)],
        ['الشريحة والمستوى', `${E(c.tier_code)} · المستوى ${num(c.level)}`],
        ['قيمة النسبة', money(c.pct_amount)],
        ['الأرضية المطلقة', money(c.floor_amount)],
        ['الالتزام الواجب (الأعلى)', `<b>${money(c.commitment_due)}</b>`],
        ['الموثَّق', money(c.total_paid)],
        ['الفارق', c.deficit_amount > 0 ? `<b style="color:var(--danger)">${money(c.deficit_amount)}</b> (${pct(c.deficit_pct)})` : '<span class="tag ok">مستوفى</span>'],
      ])}</div>
      <div>${bars([
        { k: 'نقدي', v: c.cash_paid, color: 'var(--green)' },
        { k: 'عيني', v: c.inkind_paid, color: 'var(--gold)' },
        { k: 'تطوّع', v: c.volunteer_paid, color: 'var(--silver)' },
        { k: 'برنامج ذاتي', v: c.direct_program_paid, color: 'var(--purple)' },
      ], { fmt: money })}
      <p class="muted" style="margin-top:8px">النقدي ${pct(c.cash_share || 0)} — الحد الأدنى 50% (المادة 21).</p>
      ${c.cash_share != null && c.cash_share < 0.5 ? alertBox('danger', 'مخالفة قاعدة النصف النقدي',
        'لا يقل الجزء النقدي عن 50% من إجمالي الالتزام السنوي.') : ''}</div>
    </div>`, { actions: '<a class="btn primary sm" href="#/contributions">سجّل مساهمة</a>' }) : ''}

  ${card('إجراءات سريعة', `<div class="btn-row">
    <a class="btn primary" href="#/my-licensee">ملف منشأتي كاملاً</a>
    ${l.license_no ? `<a class="btn" href="#/certificate/${E(l.license_no)}">شهادة الترخيص ورمز QR</a>` : ''}
    <button class="btn" onclick="APP.newApplication()">تجديد أو رفع المستوى</button>
    <a class="btn" href="#/documents">تحميل إثبات</a>
    <a class="btn" href="#/contributions">تسجيل مساهمة</a>
    <a class="btn" href="#/designs">طلب موافقة على تصميم</a>
    <a class="btn" href="#/commitments">إقرار الامتثال السنوي</a>
    <a class="btn" href="#/appeals">تقديم تظلم</a>
    <a class="btn" href="#/audits">تقارير التدقيق على ملفي</a></div>
    ${legal('لا يُخطَر المرخَّص له بموعد أي زيارة غير معلنة، بأي وسيلة ومن أي جهة (المادة 26/3) — لذا تظهر الزيارات غير المعلنة في ملفك بعد تنفيذها فقط.')}`)}`;
}

function orgDash(d) {
  const a = d.associations[0] || {};
  const abs = d.absorption?.[0];
  return `
  ${d.docs_missing?.length ? alertBox('warn', `إثباتات مطلوبة ناقصة (${d.docs_missing.length})`,
    d.docs_missing.map((x) => E(x.name_ar)).join(' · ') + ' — <a href="#/documents">حمّلها الآن</a>') : ''}
  ${d.pending_receipts ? alertBox('info', `مساهمات بانتظار إقرار الاستلام (${num(d.pending_receipts)})`,
    'لا يُعتدّ بأي التزام لا يُسنده مستند خارجي (المادة 3/5) — <a href="#/contributions">أقرّ الاستلام</a>') : ''}
  ${d.pending_impact ? alertBox('warn', `تقارير أثر مستحقة (${num(d.pending_impact)})`,
    'يُقدَّم تقرير أثر مختصر عن الأموال الواردة عبر العلامة تحديداً، لا عن نشاط المنظمة كله (المادة 23/3).') : ''}
  ${abs?.breached ? alertBox('danger', 'تجاوز سقف الاستيعاب', E(abs.message)) : ''}
  ${a.admin_expense_ratio > 0.25 ? alertBox('danger', 'تجاوز سقف المصروفات الإدارية',
    `النسبة ${pct(a.admin_expense_ratio)} والسقف 25%. تجاوز السقف ثلاث سنوات مالية متتالية دون ظروف استثنائية مقبولة يوجب سحب الاعتماد (المادة 32).`) : ''}
  ${a.admin_expense_ratio < 0.05 ? alertBox('warn', 'نسبة إدارية أقل من 5%',
    'تستوجب فحصاً إضافياً من وحدة التقييم — كثيراً ما تدل على تحميل تكاليف إدارية على بنود البرامج أو على منظمة لا تستثمر في قدرتها المؤسسية (المادة 15).') : ''}

  <div class="grid g4" style="margin-bottom:16px">
    ${stat('رقم الاعتماد', `<span class="mono" style="font-size:.7em">${E(a.accreditation_no || '—')}</span>`, E(lb('status', a.status)))}
    ${stat('النسبة الإدارية', pct(a.admin_expense_ratio), E(a.admin_class_name || ''),
      a.admin_class === 'rejected' ? 'danger' : a.admin_class === 'acceptable' ? 'warn' : '')}
    ${stat('الوارد عبر العلامة', money(d.received_ytd), 'السنة الجارية', 'gold')}
    ${stat('سقف الاستيعاب', money(a.absorption_cap), `متبقٍ ${money(abs?.remaining)}`)}
    ${stat('صلاحية الاعتماد', dt(a.accredited_to), 'قابل للتجديد — سنتان')}
    ${stat('الرسوم', 'صفر', 'الاعتماد مجاني في كل مرحلة (المادة 12)', 'gold')}
  </div>

  ${abs ? card('استهلاك سقف الاستيعاب (المعيار 10)', `
    ${meter(abs.used, abs.cap)}
    ${kv([['أكبر ميزانية سنوية في ثلاث سنوات', money(a.largest_budget_3y)],
      ['السقف (200%)', money(abs.cap)], ['المستخدَم', money(abs.used)],
      ['المتبقي', `<b>${money(abs.remaining)}</b>`],
      ['نسبة الاستهلاك', pct(abs.utilization)]])}
    ${legal('تُخطَر الأمانة بجهة التوجيه قبل التحويل لتتأكد من سريان اعتماد المنظمة ومن عدم تجاوز سقف الاستيعاب المقرر لها (المادة 22/3).')}`) : ''}

  ${card('إجراءات سريعة', `<div class="btn-row">
    <a class="btn primary" href="#/my-org">ملف منظمتي كاملاً</a>
    ${a.accreditation_no ? `<a class="btn" href="#/certificate/${E(a.accreditation_no)}">شهادة الاعتماد ورمز QR</a>` : ''}
    <button class="btn" onclick="APP.newApplication('accreditation_renewal')">طلب تجديد الاعتماد</button>
    <a class="btn" href="#/documents">تحميل إثبات</a>
    <a class="btn" href="#/contributions">المساهمات وتقارير الأثر</a>
    <a class="btn" href="#/audits">تقارير التدقيق على ملفي</a>
    <a class="btn" href="#/appeals">تقديم تظلم</a></div>`)}`;
}

// ================= المرخَّص لهم =================
async function licenseeList() {
  const html = shell('<div id="t"></div>', { title: 'المرخَّص لهم',
    sub: 'قطاع الأعمال والحرف والفنون والإبداع — فلترة كاملة على الحالة والمستوى والشريحة والمنطقة والقطاع والإيراد',
    actions: has('report.export') ? '<a class="btn" href="/api/reports/annual_registry/export.csv?token=' + encodeURIComponent(S.token) + '" target="_blank">تصدير CSV</a>' : '' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/licensees',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'الاسم، رقم الترخيص، السجل التجاري، المدينة' },
      { k: 'status', t: 'الحالة', type: 'select', opts: (S.ref?.statuses?.licensee || []).map((s) => [s, lb('status', s)]) },
      { k: 'level', t: 'المستوى', type: 'select', opts: (S.ref?.levels || []).map((l) => [l.level, `${l.level} — ${l.name_ar}`]) },
      { k: 'tier_code', t: 'الشريحة', type: 'select', opts: (S.ref?.tiers || []).map((t) => [t.code, t.code + ' — ' + t.name_ar.split('—')[1]]) },
      { k: 'region', t: 'المنطقة', type: 'select', opts: (S.ref?.regions || []).map((r) => [r, r]) },
      { k: 'sector', t: 'القطاع', type: 'select', opts: (S.ref?.sectors || []).map((s) => [s, s]) },
      { k: 'applicant_kind', t: 'نوع الطالب', type: 'select', opts: Object.entries(L.applicantKind) },
      { k: 'founding_partner', t: 'شريك مؤسس', type: 'bool' },
      { k: 'revenue_min', t: 'إيراد من', type: 'number' },
      { k: 'revenue_max', t: 'إيراد إلى', type: 'number' },
      { k: 'start_from', t: 'بدء من', type: 'date' },
      { k: 'start_to', t: 'بدء إلى', type: 'date' },
    ],
    cols: [
      { t: 'رقم الترخيص', srt: 'license_no', r: (r) => r.license_no ? `<span class="mono">${E(r.license_no)}</span>` : '<span class="muted">لم يُصدر</span>' },
      { t: 'المنشأة', srt: 'legal_name', r: (r) => `<b>${E(r.legal_name)}</b>
        <div class="muted">${E(r.trade_name || '')} ${r.founding_partner ? '<span class="tag gold">مؤسس</span>' : ''}</div>` },
      { t: 'النوع', r: (r) => `<span class="tag">${E(lb('applicantKind', r.applicant_kind))}</span>` },
      { t: 'المستوى', srt: 'level', r: (r) => lvlBadge(r.level, r.level_name, r.color_hex) },
      { t: 'الشريحة', r: (r) => `<b>${E(r.tier_code || '—')}</b>` },
      { t: 'الإيراد / الربح', srt: 'annual_revenue', cls: 'num', r: (r) => `${money(r.annual_revenue)}
        <div class="muted">${money(r.net_profit)}</div>` },
      { t: 'القطاع', k: 'sector' },
      { t: 'الموقع', r: (r) => `${E(r.region || '—')}<div class="muted">${E(r.city || '')}</div>` },
      { t: 'النطاق', r: (r) => `${E(lb('scopeType', r.scope_type))}` },
      { t: 'السريان', srt: 'start_date', r: (r) => r.start_date ? `${dt(r.start_date)}<div class="muted">${dt(r.end_date)}</div>` : '—' },
      { t: 'الحالة', srt: 'status', r: (r) => tag(r.status) },
    ],
    rowClick: (r) => go('licensees/' + r.id),
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('إجمالي الإيرادات', money(d.rows.reduce((s, r) => s + (r.annual_revenue || 0), 0)), 'في الصفحة الحالية')}
      ${stat('إجمالي الأرباح', money(d.rows.reduce((s, r) => s + (r.net_profit || 0), 0)), 'في الصفحة الحالية')}
      ${stat('سارون', num(d.rows.filter((r) => r.status === 'active').length), 'في الصفحة الحالية')}</div>`,
  }));
  return html;
}

route('my-licensee', async () => {
  if (!guard()) return '';
  const id = S.user.scopes.licensee[0];
  if (!id) return shell(alertBox('warn', 'لا ملف مرتبط', 'حسابك غير مرتبط بملف مرخَّص له.'), { title: 'ملف منشأتي' });
  location.hash = '#/licensees/' + id; return '';
});

// المسار الموحَّد: قائمة أو تفصيل
route('licensees', async (r) => {
  if (!guard()) return '';
  if (!r.params[0]) return licenseeList();
  const id = r.params[0];
  const d = await api('/licensees/' + id);
  const c = d.commitments[0];
  const html = shell(`
    <div class="grid g4" style="margin-bottom:14px">
      ${stat('رقم الترخيص', `<span class="mono" style="font-size:.66em">${E(d.license_no || 'لم يُصدر')}</span>`, E(lb('status', d.status)),
        d.status === 'active' ? '' : d.status === 'suspended' ? 'warn' : ['withdrawn', 'rejected'].includes(d.status) ? 'danger' : '')}
      ${stat('المستوى', E(d.level_name || '—'), E(d.claim_ar || ''), 'gold')}
      ${stat('الشريحة', E(d.tier_code || '—'), E((d.tier_name || '').split('—')[1] || ''))}
      ${c ? stat('الالتزام الواجب', money(c.commitment_due), E(lb('basis', c.basis))) : stat('الالتزام', '—')}
      ${c ? stat('الموثَّق', money(c.total_paid), pct(c.commitment_due ? c.total_paid / c.commitment_due : 0),
        c.deficit_pct > 0.2 ? 'danger' : c.deficit_pct > 0 ? 'warn' : '') : ''}
      ${stat('نسبة التدقيق الميداني', pct(d.audit_rate.rate, 0), '', d.audit_rate.rate === 1 ? 'warn' : '')}
      ${stat('الرسم السنوي', money(d.fees.annual_fee), d.fees.capped ? 'مطبَّق السقف' : '')}
      ${stat('إثباتات متحقَّق منها', num(d.documents.filter((x) => x.verification === 'verified').length) + ' / ' + num(d.documents.length))}
    </div>
    ${d.status_reason ? alertBox(['withdrawn', 'rejected'].includes(d.status) ? 'danger' : 'warn',
      'سبب الحالة', E(d.status_reason)) : ''}
    ${d.excluded ? alertBox('danger', 'مدرَج على قائمة الاستبعاد (المادة 10)', E(d.exclusion_reason || '')) : ''}
    ${d.deficit && d.deficit.status !== 'fulfilled' ? alertBox(d.deficit.status === 'breach' ? 'danger' : 'warn',
      'تكييف العجز في الالتزام', E(d.deficit.message)) : ''}
    ${d.mix && !d.mix.valid ? alertBox('danger', 'مخالفة سقوف المسارات', d.mix.errors.map(E).join('<br>')) : ''}
    ${d.concentration?.breaches?.length ? alertBox('warn', 'تركّز التوجيه (المادة 22)',
      d.concentration.breaches.map((b) => E(b.message)).join('<br>')) : ''}
    <div class="card"><div id="tb"></div></div>`, {
    title: d.legal_name, sub: `${E(d.trade_name || '')} · ${E(d.sector || '')} · ${E(d.region || '')} — ${E(d.city || '')}`,
    actions: `${d.license_no ? `<a class="btn" href="#/verify/${E(d.license_no)}">صفحة التحقق العامة</a>` : ''}
      ${d.license_no && ['active', 'suspended'].includes(d.status) ? `<a class="btn" href="#/certificate/${E(d.license_no)}">الشهادة</a>` : ''}
      ${has('audit.execute') ? `<button class="btn" onclick="APP.scheduleAudit('licensee',${d.id})">جدولة تدقيق</button>` : ''}
      ${has('app.create') && S.user.scopes.licensee.includes(d.id) ? `<button class="btn gold" onclick="APP.newApplication()">تجديد أو رفع المستوى</button>` : ''}
      ${has('licensee.edit.all') || has('licensee.edit.own') ? `<button class="btn primary" onclick="APP.editLicensee(${d.id})">تحديث البيانات</button>` : ''}` });

  mount(() => tabs(document.getElementById('tb'), [
    ['info', 'البيانات النظامية', null, () => `<div class="card-bd">
      <div class="grid g2">
        ${kv([['الاسم القانوني', E(d.legal_name)], ['الاسم التجاري', E(d.trade_name || '—')],
          ['الشكل القانوني', E(d.legal_form || '—')], ['نوع الطالب', E(lb('applicantKind', d.applicant_kind))],
          ['السجل التجاري', `<span class="mono">${E(d.commercial_reg || '—')}</span>`],
          ['الملف الضريبي', `<span class="mono">${E(d.tax_file_no || '—')}</span>`],
          ['الضمان الاجتماعي', `<span class="mono">${E(d.social_sec_no || '—')}</span>`],
          ['صفة الشراكة', E(lb('partnerClass', d.partner_class))]])}
        ${kv([['نطاق الترخيص', `${E(lb('scopeType', d.scope_type))} — ${E(d.scope_desc || '')}`],
          ['الإيراد السنوي', money(d.annual_revenue)], ['صافي الربح قبل الضريبة', money(d.net_profit)],
          ['السنة المالية المرجعية', yr(d.fiscal_year)],
          ['جهة الاتصال', `${E(d.contact_name || '—')}<div class="muted">${E(d.contact_email || '')} · ${E(d.contact_phone || '')}</div>`],
          ['العنوان', E(d.address || '—')],
          ['بدء / انتهاء الترخيص', `${dt(d.start_date)} — ${dt(d.end_date)}`]])}
      </div>
      ${d.allowed_claim ? `<h4 style="margin-top:14px">الادعاء المسموح به حصراً (المادة 19/4)</h4>
        ${legal('«' + E(d.allowed_claim) + '»')}` : ''}
      <h4 style="margin-top:14px">الرسوم المستحقة نظاماً</h4>
      ${kv([['رسم الطلب (غير مستردّ)', money(d.fees.application_fee)],
        ['الرسم السنوي', money(d.fees.annual_fee) + (d.fees.capped ? ' <span class="tag warn">مطبَّق السقف المطلق</span>' : '')],
        ['الخصومات المطبَّقة', d.fees.discounts.length ? d.fees.discounts.map(E).join('<br>') : 'لا توجد'],
        ['تنويه', E(d.fees.note)]])}
      <h4 style="margin-top:14px">أساس نسبة التدقيق</h4>
      ${alertBox('info', pct(d.audit_rate.rate, 0), E(d.audit_rate.reason))}</div>`],

    ['docs', 'الإثباتات', d.documents.length, () => `<div class="card-bd">
      <h4>قائمة الإثباتات المطلوبة</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الإثبات</th><th>إلزامي</th><th>محمَّل</th><th>متحقَّق منه</th></tr></thead>
        <tbody>${d.required_docs.map((x) => `<tr><td>${E(x.name_ar)}</td>
          <td>${x.required ? '<span class="tag danger">إلزامي</span>' : '<span class="muted">اختياري</span>'}</td>
          <td>${x.uploaded ? '<span class="tag ok">نعم</span>' : '<span class="tag warn">لا</span>'}</td>
          <td>${x.verified ? '<span class="tag ok">نعم</span>' : '<span class="muted">—</span>'}</td></tr>`).join('')}</tbody></table></div>
      <h4 style="margin-top:16px">الملفات المحمَّلة</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>الإثبات</th><th>النوع</th><th>الإصدار</th>
        <th>الانتهاء</th><th>الحجم</th><th>الحالة</th><th>ملاحظة التحقق</th>${has('doc.verify') ? '<th></th>' : ''}</tr></thead>
        <tbody>${d.documents.map((x) => `<tr>
          <td>${docLink(x)}${x.confidential ? ' <span class="tag danger">سرّي</span>' : ''}${x.is_public ? ' <span class="tag info">منشور</span>' : ''}</td>
          <td class="muted">${E(x.doc_type_name || '—')}</td><td>${dt(x.issued_on)}</td>
          <td>${x.expires_on ? (x.expires_on < today() ? `<span class="tag danger">${dt(x.expires_on)}</span>` : dt(x.expires_on)) : '—'}</td>
          <td class="num muted">${num(Math.round((x.size_bytes || 0) / 1024))} ك.ب</td>
          <td>${tag(x.verification, 'verification')}</td>
          <td class="muted" style="white-space:normal;max-width:220px">${E(x.verify_note || '')}</td>
          ${has('doc.verify') ? `<td><button class="btn sm" onclick="APP.verifyDoc(${x.id})">تحقّق</button></td>` : ''}</tr>`).join('')}
        </tbody></table></div>
      ${has('doc.upload.own') || has('doc.upload.any') ? `<div class="btn-row" style="margin-top:12px">
        <button class="btn primary" onclick="APP.uploadDoc('licensee',${d.id})">تحميل إثبات جديد</button></div>` : ''}</div>`],

    ['commit', 'الالتزام والمساهمات', d.contributions.length, () => `<div class="card-bd">
      ${d.commitments.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>السنة</th><th>المستوى</th>
        <th>النسبة</th><th>الأرضية</th><th>الواجب</th><th>الأساس</th><th>نقدي</th><th>عيني</th><th>تطوّع</th>
        <th>برنامج ذاتي</th><th>الإجمالي</th><th>حصة النقدي</th><th>العجز</th><th>الحالة</th></tr></thead><tbody>
        ${d.commitments.map((x) => `<tr><td><b>${yr(x.fiscal_year)}</b></td><td>${num(x.level)}</td>
          <td class="num">${money(x.pct_amount)}</td><td class="num">${money(x.floor_amount)}</td>
          <td class="num"><b>${money(x.commitment_due)}</b></td><td class="muted">${E(lb('basis', x.basis))}</td>
          <td class="num">${money(x.cash_paid)}</td><td class="num">${money(x.inkind_paid)}</td>
          <td class="num">${money(x.volunteer_paid)}</td><td class="num">${money(x.direct_program_paid)}</td>
          <td class="num"><b>${money(x.total_paid)}</b></td>
          <td class="num ${x.cash_share < 0.5 ? '' : ''}">${pct(x.cash_share)}</td>
          <td class="num">${x.deficit_amount > 0 ? `<b style="color:var(--danger)">${money(x.deficit_amount)}</b> (${pct(x.deficit_pct)})` : '—'}</td>
          <td>${tag(x.status)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><b>لا ملف التزام</b></div>'}
      <h4 style="margin-top:16px">المساهمات المسجَّلة</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>المرجع</th><th>المنظمة</th><th>المسار</th>
        <th>المبلغ</th><th>التاريخ</th><th>الغرض</th><th>إقرار الاستلام</th><th>تقرير الأثر</th><th>الحالة</th></tr></thead><tbody>
        ${d.contributions.map((x) => `<tr><td class="mono">${E(x.reference)}</td>
          <td>${x.association_id ? `<a href="#/associations/${x.association_id}">${E(x.association_name)}</a>` : '<span class="muted">برنامج ذاتي</span>'}</td>
          <td><span class="tag">${E(x.channel_name || x.channel)}</span></td>
          <td class="num"><b>${money(x.amount)}</b></td><td>${dt(x.transfer_date)}</td>
          <td class="muted" style="white-space:normal;max-width:240px">${E(x.purpose || '—')}</td>
          <td>${x.receipt_confirmed ? '<span class="tag ok">نعم</span>' : '<span class="tag warn">لا</span>'}</td>
          <td>${x.impact_doc_id ? '<span class="tag ok">مقدَّم</span>' : '<span class="muted">—</span>'}</td>
          <td>${tag(x.status)}</td></tr>`).join('')}</tbody></table></div>
      <h4 style="margin-top:16px">إقرارات الامتثال السنوية (المادة 23)</h4>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>السنة</th><th>نهاية السنة المالية</th>
        <th>الموعد الأقصى</th><th>تاريخ التقديم</th><th>التأخر</th><th>أساس الإثبات</th><th>المعلن</th>
        <th>الحالة</th><th>المخرج</th></tr></thead><tbody>
        ${d.declarations.map((x) => `<tr><td><b>${yr(x.fiscal_year)}</b></td><td>${dt(x.fiscal_year_end)}</td>
          <td>${dt(x.due_at)}</td><td>${dt(x.submitted_at)}</td>
          <td class="num">${x.late_days ? `<span class="tag warn">${num(x.late_days)} يوماً</span>` : '—'}</td>
          <td class="muted">${E(lb('basisType', x.basis_type))}</td><td class="num">${money(x.declared_total)}</td>
          <td>${tag(x.status)}</td><td>${x.outcome ? tag(x.outcome, 'outcome') : '—'}</td></tr>`).join('')}
        </tbody></table></div>
      ${has('commitment.declare') ? `<div class="btn-row" style="margin-top:12px">
        <a class="btn primary" href="#/commitments">إدارة الإقرار السنوي</a>
        <a class="btn" href="#/contributions">تسجيل مساهمة</a></div>` : ''}</div>`],

    ['apps', 'الطلبات', d.applications.length, () => `<div class="card-bd"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المرجع</th><th>النوع</th><th>المرحلة</th><th>الحالة</th><th>التقديم</th><th>القرار</th>
        <th>المدة</th><th>التسبيب</th></tr></thead><tbody>
      ${d.applications.map((x) => `<tr class="clk" onclick="SEMA.go('applications/${x.id}')">
        <td class="mono">${E(x.reference)}</td><td>${E(lb('appType', x.app_type))}</td>
        <td>${num(x.stage)} / 9</td><td>${tag(x.status)}</td><td>${dt(x.submitted_at)}</td>
        <td>${x.decision ? tag(x.decision, 'decision') : '—'}</td>
        <td class="num">${x.processing_days ? num(x.processing_days) + ' يوماً' : '—'}</td>
        <td class="muted" style="white-space:normal;max-width:360px">${E((x.decision_reason || '').slice(0, 160))}</td></tr>`).join('')}
      </tbody></table></div></div>`],

    ['aud', 'التدقيق', d.audits.length, () => `<div class="card-bd"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المرجع</th><th>النوع</th><th>السبب</th><th>المجدول</th><th>المنفَّذ</th><th>المقيّم</th>
        <th>الوقائع</th><th>الحالة</th></tr></thead><tbody>
      ${d.audits.map((x) => `<tr class="clk" onclick="SEMA.go('audits/${x.id}')">
        <td class="mono">${E(x.reference)}</td>
        <td><span class="tag ${x.audit_type === 'unannounced' ? 'danger' : ''}">${E(lb('auditType', x.audit_type))}</span></td>
        <td class="muted">${E(lb('trigger', x.trigger))}</td><td>${dt(x.scheduled_date)}</td>
        <td>${dt(x.executed_date)}</td><td>${E(x.assessor_name || '—')}</td>
        <td class="muted" style="white-space:normal;max-width:380px">${E((x.facts_summary || '').slice(0, 200))}</td>
        <td>${tag(x.status)}</td></tr>`).join('')}</tbody></table></div>
      ${legal('المادة (27): للمقيّم أثناء التدقيق الاطلاع على الدفاتر والمستندات المتعلقة بالالتزام، ومقابلة المسؤول المالي، والتحقق من مطابقة العلامة على العبوات ونقاط البيع، ومراسلة المنظمات المتلقية. وليس له الاطلاع على أسرار تجارية لا صلة لها بالالتزام.')}</div>`],

    ['snc', 'الجزاءات والتظلمات', d.sanctions.length + d.appeals.length, () => `<div class="card-bd">
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>القضية</th><th>المخالفة</th><th>الجزاء</th>
        <th>الغرامة</th><th>التسبيب</th><th>السريان</th><th>منشور</th><th>الحالة</th>
        ${has('appeal.file') ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.sanctions.length ? d.sanctions.map((x) => `<tr><td class="mono">${E(x.case_no)}</td>
        <td class="muted" style="white-space:normal;max-width:220px">${E(x.violation_text || '—')}</td>
        <td><span class="tag ${['withdrawal','suspension'].includes(x.measure) ? 'danger' : 'warn'}">${E(lb('measure', x.measure))}</span></td>
        <td class="num">${x.fine_amount ? money(x.fine_amount) : '—'}</td>
        <td class="muted" style="white-space:normal;max-width:380px">${E(x.reason)}</td>
        <td>${dt(x.effective_from)}${x.effective_to ? `<div class="muted">إلى ${dt(x.effective_to)}</div>` : ''}</td>
        <td>${x.published ? '<span class="tag danger">منشور</span>' : '—'}</td><td>${tag(x.status)}</td>
        ${has('appeal.file') ? `<td>${x.status === 'active' ? `<button class="btn sm" onclick="APP.fileAppeal(${x.id},'licensee',${d.id})">تظلّم</button>` : ''}</td>` : ''}</tr>`).join('')
        : `<tr><td colspan="9"><div class="empty"><b>لا جزاءات</b></div></td></tr>`}</tbody></table></div>
      ${d.appeals.length ? `<h4 style="margin-top:16px">التظلمات</h4><div class="tbl-wrap"><table class="tbl">
        <thead><tr><th>المرجع</th><th>التقديم</th><th>موعد الفصل</th><th>الأسباب</th><th>القرار</th><th>التسبيب</th></tr></thead><tbody>
        ${d.appeals.map((x) => `<tr><td class="mono">${E(x.reference)}</td><td>${dt(x.filed_at)}</td>
          <td>${dt(x.decision_due_at)}</td>
          <td class="muted" style="white-space:normal;max-width:300px">${E(x.grounds)}</td>
          <td>${x.decision ? tag(x.decision, 'decision') : tag(x.status)}</td>
          <td class="muted" style="white-space:normal;max-width:380px">${E(x.decision_reason || '')}</td></tr>`).join('')}
        </tbody></table></div>` : ''}</div>`],

    ['dsg', 'التصاميم', d.designs.length, () => `<div class="card-bd"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>المرجع</th><th>المادة</th><th>العنوان</th><th>نسخة الشعار</th><th>رقم الترخيص ظاهر</th>
        <th>الادعاء</th><th>التقديم</th><th>الموعد</th><th>القرار</th></tr></thead><tbody>
      ${d.designs.length ? d.designs.map((x) => `<tr><td class="mono">${E(x.reference)}</td>
        <td><span class="tag">${E(lb('material', x.material_type))}</span></td><td>${E(x.title)}</td>
        <td class="muted">${x.logo_variant === 'compact' ? 'مختصرة' : 'كاملة'}</td>
        <td>${x.shows_license_no ? '<span class="tag ok">نعم</span>' : '<span class="tag danger">لا</span>'}</td>
        <td class="muted" style="white-space:normal;max-width:300px">${E(x.claim_text || '—')}</td>
        <td>${dt(x.submitted_at)}</td><td>${dt(x.due_at)}</td>
        <td>${x.decision ? tag(x.decision, 'decision') : (x.status === 'expired_implicit'
          ? '<span class="tag info">موافقة ضمنية</span>' : tag('pending'))}
          ${x.decision_notes ? `<div class="muted" style="white-space:normal;max-width:320px">${E(x.decision_notes)}</div>` : ''}</td></tr>`).join('')
        : `<tr><td colspan="9"><div class="empty"><b>لا طلبات</b></div></td></tr>`}</tbody></table></div>
      ${legal('المادة (19/2): تبتّ الوحدة خلال عشرة أيام عمل، ويُعدّ عدم الرد خلالها موافقةً ضمنية.')}</div>`],

    ['fin', 'الرسوم', d.invoices.length, () => `<div class="card-bd"><div class="tbl-wrap"><table class="tbl">
      <thead><tr><th>الفاتورة</th><th>النوع</th><th>السنة</th><th>الأساس</th><th>الخصم</th><th>المستحق</th>
        <th>الإصدار</th><th>الاستحقاق</th><th>السداد</th><th>الحالة</th></tr></thead><tbody>
      ${d.invoices.map((x) => `<tr><td class="mono">${E(x.invoice_no)}</td>
        <td>${E(lb('feeType', x.fee_type))}</td><td>${yr(x.fiscal_year)}</td>
        <td class="num">${money(x.base_amount)}</td><td class="num">${x.discount_pct ? x.discount_pct + '%' : '—'}</td>
        <td class="num"><b>${money(x.amount)}</b>${x.capped ? ' <span class="tag warn">سقف</span>' : ''}</td>
        <td>${dt(x.issued_at)}</td><td>${dt(x.due_at)}</td><td>${dt(x.paid_at)}</td>
        <td>${tag(x.status)}</td></tr>`).join('')}</tbody></table></div></div>`],
  ], 'info'));
  return html;
});

})();
