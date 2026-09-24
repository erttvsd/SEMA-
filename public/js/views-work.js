(function(){
'use strict';
/* ===== مساحة العمل: المراسلات · تقويم المواعيد · البحث الشامل · استعادة كلمة المرور · البريد الصادر · النسخ الاحتياطي ===== */
const { S, api, qs, E, A, num, dt, today, L, lb, tag, toast, modal, route, render, go, has } = window.SEMA;
const { shell, dataTable, stat, alertBox, legal, card } = window.UI;
const mount = (fn) => setTimeout(fn, 0);
const pub = (html, active) => window.UI.pubShell(html, active);
const F = (id) => document.getElementById(id);
const needLogin = () => { if (!S.user) { location.hash = '#/login'; return true; } return false; };

const fld = (name, label, { type = 'text', req = false, val = '', ph = '', opts, hint, wide, rows = 4 } = {}) => {
  const input = opts
    ? `<select name="${name}" ${req ? 'required' : ''}>${opts.map(([v, l]) =>
        `<option value="${E(v)}" ${String(v) === String(val) ? 'selected' : ''}>${E(l)}</option>`).join('')}</select>`
    : type === 'textarea' ? `<textarea name="${name}" rows="${rows}" ${req ? 'required' : ''} placeholder="${E(ph)}">${E(val)}</textarea>`
    : `<input name="${name}" type="${type}" value="${E(val)}" placeholder="${E(ph)}" ${req ? 'required' : ''}>`;
  return `<div class="fld" ${wide ? 'style="grid-column:1/-1"' : ''}><label>${E(label)}${req ? ' *' : ''}</label>${input}
    ${hint ? `<span class="hint">${E(hint)}</span>` : ''}</div>`;
};
const formData = (f) => { const o = {}; for (const el of f.querySelectorAll('[name]'))
  o[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'file' ? el.files[0] : (el.value === '' ? null : el.value); return o; };
const when = (s) => !s ? '—' : String(s).slice(0, 16).replace('T', ' ');

const CAT = { inquiry: 'استفسار', deficiency: 'نواقص', financial: 'مالي', technical: 'فني', complaint_followup: 'متابعة بلاغ', other: 'أخرى' };
const TST = { awaiting_staff: ['بانتظار الأمانة', 'warn'], awaiting_entity: ['بانتظار الجهة', 'info'], closed: ['مغلقة', ''] };
const tstTag = (s) => `<span class="tag ${TST[s]?.[1] || ''} dot">${E(TST[s]?.[0] || s)}</span>`;
const TOPIC = { application: 'طلب', invoice: 'فاتورة', declaration: 'إقرار امتثال', contribution: 'مساهمة', design: 'تصميم', sanction: 'جزاء' };

/** يحدّث عدّادات الشريط العلوي (الإشعارات والمراسلات) */
async function refreshCounts() {
  if (!S.user) return;
  S.msgs = await api('/threads/unread').catch(() => ({ unread: 0, awaiting: 0 }));
}
window.SEMA.refreshCounts = refreshCounts;

// ================= استعادة كلمة المرور =================
route('forgot', async () => {
  const html = pub(`<div class="pub" style="max-width:560px">
    ${card('نسيت كلمة المرور', `
      <p class="muted">أدخل البريد المسجَّل به حسابك؛ تصلك رسالة فيها رابط لتعيين كلمة مرور جديدة، صالح ساعة واحدة ولمرة واحدة.</p>
      <form id="ff"><div class="form-grid">${fld('email', 'البريد الإلكتروني', { type: 'email', req: true, wide: true })}</div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary">إرسال الرابط</button>
        <a class="btn" href="#/login">العودة إلى الدخول</a></div></form>
      <div id="fr" style="margin-top:12px"></div>
      ${legal('لا تطلب الأمانة كلمة مرورك أو رمز التحقق أبداً — لا بالهاتف ولا بالبريد.')}`)}</div>`, 'login');
  mount(() => { F('ff').onsubmit = async (e) => { e.preventDefault();
    try { const r = await api('/auth/forgot', { method: 'POST', body: formData(e.target) });
      F('fr').innerHTML = alertBox('ok', 'تم', E(r.note)); e.target.reset(); }
    catch (er) { F('fr').innerHTML = alertBox('danger', 'تعذّر الإرسال', E(er.message)); } }; });
  return html;
});

route('reset', async (r) => {
  const token = r.query.token || '';
  const chk = token ? await api('/auth/reset/check' + qs({ token })).catch(() => ({ valid: false })) : { valid: false };
  if (!chk.valid) return pub(`<div class="pub" style="max-width:560px">${alertBox('danger', 'الرابط غير صالح أو انتهت مدته',
    'روابط الاستعادة تصلح ساعة واحدة ولمرة واحدة. <a href="#/forgot">اطلب رابطاً جديداً</a>.')}</div>`, 'login');
  const html = pub(`<div class="pub" style="max-width:560px">
    ${card('تعيين كلمة مرور جديدة', `<p class="muted">للحساب <b class="mono">${E(chk.email)}</b></p>
      <form id="rf"><div class="form-grid">
        ${fld('new_password', 'كلمة المرور الجديدة', { type: 'password', req: true, hint: 'ثمانية أحرف على الأقل تجمع حروفاً وأرقاماً', wide: true })}
        ${fld('confirm', 'تأكيد كلمة المرور', { type: 'password', req: true, wide: true })}</div>
        <div class="btn-row" style="margin-top:12px"><button class="btn primary">تعيين</button></div></form>
      <div id="rr" style="margin-top:12px"></div>
      ${legal('تعيين كلمة المرور يُغلق كل الجلسات المفتوحة على الحساب. والتحقق بخطوتين — إن كان مفعَّلاً — يبقى كما هو.')}`)}</div>`, 'login');
  mount(() => { F('rf').onsubmit = async (e) => { e.preventDefault();
    const b = formData(e.target);
    if (b.new_password !== b.confirm) return toast('التأكيد لا يطابق كلمة المرور', 'danger');
    try { const x = await api('/auth/reset', { method: 'POST', body: { token, new_password: b.new_password } });
      F('rr').innerHTML = alertBox('ok', 'تم', `${E(x.note)} <a href="#/login"><b>تسجيل الدخول</b></a>`); e.target.querySelector('button').disabled = true; }
    catch (er) { F('rr').innerHTML = alertBox('danger', 'تعذّر التعيين', E(er.message)); } }; });
  return html;
});

// ================= المراسلات =================
route('messages', async (r) => {
  if (needLogin()) return '';
  if (r.params[0]) return threadView(Number(r.params[0]));
  const staff = has('thread.staff');
  const html = shell(`
    ${staff ? '' : alertBox('info', 'مراسلة الأمانة', 'اكتب هنا كل استفسار أو ملاحظة بشأن ملفك أو طلبك أو فاتورتك؛ فتصل إلى الوحدة المختصة ويبقى الرد مكتوباً ومحفوظاً في ملفك.')}
    <div id="t"></div>`,
  { title: staff ? 'المراسلات الواردة' : 'مراسلة الأمانة',
    sub: staff ? 'مراسلات الجهات مع الأمانة — يُسند كل منها إلى موظف، والملاحظات الداخلية لا تراها الجهة' : 'سجل مكتوب لمراسلاتك مع الأمانة التنفيذية',
    actions: `<button class="btn primary" onclick="WORK.newThread()">مراسلة جديدة</button>` });
  mount(() => dataTable(F('t'), {
    path: '/threads',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'المرجع، العنوان، الجهة' },
      { k: 'status', t: 'الحالة', type: 'select', opts: Object.entries(TST).map(([k, v]) => [k, v[0]]) },
      { k: 'category', t: 'التصنيف', type: 'select', opts: Object.entries(CAT) },
      ...(staff ? [{ k: 'subject_kind', t: 'الجهة', type: 'select', opts: [['licensee', 'منشأة'], ['association', 'منظمة'], ['user', 'مراقب / حساب']] },
        { k: 'mine', t: 'المُسندة إليّ', type: 'select', opts: [['1', 'نعم']] }] : []),
      { k: 'unread', t: 'غير المقروءة', type: 'select', opts: [['1', 'نعم']] },
    ],
    summary: (d) => d.by_status ? `<div class="grid g3" style="margin-bottom:12px">${Object.entries(TST).map(([k, v]) =>
      stat(v[0], num(d.by_status.find((x) => x.status === k)?.n || 0), '', k === (staff ? 'awaiting_staff' : 'awaiting_entity') ? 'gold' : '')).join('')}</div>` : '',
    cols: [
      { t: 'المرجع', r: (x) => `<span class="mono">${E(x.reference)}</span>` },
      { t: 'الموضوع', r: (x) => `<b>${E(x.title)}</b>${x.unread ? ` <span class="pill on">${num(x.unread)} جديد</span>` : ''}
        ${staff ? `<div class="muted" style="font-size:.78rem">${E(x.subject_name || '')}</div>` : ''}
        ${x.topic_kind ? `<div class="muted" style="font-size:.72rem">${E(TOPIC[x.topic_kind])} مرتبط</div>` : ''}` },
      { t: 'التصنيف', r: (x) => `<span class="tag">${E(CAT[x.category] || x.category)}</span>` },
      { t: 'الحالة', r: (x) => tstTag(x.status) },
      ...(staff ? [{ t: 'المسؤول', r: (x) => x.assigned_name ? E(x.assigned_name) : '<span class="tag warn">غير مُسندة</span>' }] : []),
      { t: 'الرسائل', cls: 'num', r: (x) => num(x.messages) },
      { t: 'آخر تحديث', srt: 'updated_at', r: (x) => `<span class="mono">${E(when(x.updated_at))}</span>` },
    ],
    rowClick: (x) => go('messages/' + x.id),
    empty: 'لا مراسلات بعد',
  }));
  return html;
});

async function threadView(id) {
  const t = await api('/threads/' + id);
  const staff = t.staff_view;
  refreshCounts();
  const bubbles = t.messages.map((m) => {
    const mine = m.author_id === S.user.id;
    const side = m.author_side === 'staff' ? 'staff' : 'entity';
    return `<div class="msg ${side} ${m.internal ? 'internal' : ''} ${mine ? 'mine' : ''}">
      <div class="msg-hd"><b>${E(m.author_name || '—')}</b>
        ${m.internal ? '<span class="tag warn">ملاحظة داخلية — لا تراها الجهة</span>' : ''}
        <span class="spacer"></span><span class="mono muted">${E(when(m.created_at))}</span></div>
      <div class="msg-bd">${E(m.body).replace(/\n/g, '<br>')}</div>
      ${m.document_id ? `<div class="msg-att"><a href="/api/documents/${m.document_id}/file?token=${encodeURIComponent(S.token)}" target="_blank" rel="noopener">📎 ${E(m.doc_title || m.doc_file)}</a>
        <span class="muted">${m.doc_size ? num(m.doc_size / 1024) + ' ك.ب' : ''}</span></div>` : ''}
    </div>`;
  }).join('');
  const closed = t.status === 'closed';
  const actions = [
    staff && closed ? `<button class="btn" onclick="WORK.reopen(${A(t.id)})">إعادة الفتح</button>` : '',
    !closed ? `<button class="btn" onclick="WORK.closeThread(${A(t.id)})">إغلاق المراسلة</button>` : '',
  ].join('');
  const html = shell(`<div class="grid" style="grid-template-columns:minmax(0,1fr) 300px;align-items:start" id="thr">
    <div>
      <div class="thread">${bubbles}</div>
      ${closed && !staff ? alertBox('info', 'المراسلة مغلقة', 'لإثارة موضوع جديد افتح مراسلة جديدة.') : card(staff ? 'الرد' : 'رسالة جديدة', `
        <form id="rpf"><div class="form-grid">
          ${fld('body', 'النص', { type: 'textarea', req: true, wide: true })}
          <div class="fld"><label>مرفق (اختياري)</label><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx"></div>
          ${staff ? `<label class="pledge" style="align-self:end"><input type="checkbox" name="internal"><span>ملاحظة داخلية — لا تُرسل للجهة</span></label>` : ''}
        </div><div class="btn-row" style="margin-top:10px"><button class="btn primary">إرسال</button></div></form>`)}
    </div>
    <div>
      ${card('بيانات المراسلة', `<dl class="kv">
        <dt>المرجع</dt><dd class="mono">${E(t.reference)}</dd>
        <dt>الجهة</dt><dd>${E(t.subject_name || '—')}</dd>
        <dt>التصنيف</dt><dd>${E(CAT[t.category] || t.category)}</dd>
        <dt>الحالة</dt><dd>${tstTag(t.status)}</dd>
        ${t.topic ? `<dt>مرتبطة بـ</dt><dd>${E(TOPIC[t.topic.kind])} ${t.topic.link ? `<a href="${E(t.topic.link)}">${E(t.topic.ref || '')}</a>` : E(t.topic.ref || '')}</dd>` : ''}
        ${staff ? `<dt>المسؤول</dt><dd>${E(t.assigned_name || 'غير مُسندة')}</dd>` : ''}
        <dt>فُتحت</dt><dd class="mono">${E(when(t.created_at))}</dd>
        ${t.closed_at ? `<dt>أُغلقت</dt><dd class="mono">${E(when(t.closed_at))}</dd>` : ''}</dl>
        ${staff && !closed ? `<div class="fld" style="margin-top:10px"><label>إسناد إلى</label><select id="asg">
          <option value="">—</option>${(t.staff_users || []).map((u) => `<option value="${u.id}" ${u.id === t.assigned_to ? 'selected' : ''}>${E(u.full_name)}</option>`).join('')}
          </select></div>` : ''}
        <div class="btn-row" style="margin-top:10px">${actions}</div>`)}
      ${staff ? legal('لجنة منح الترخيص لا تشارك في المراسلات: يُحظر عليها التفاوض مع الطالب. وكل رد يُقيَّد في سجل التتبع.') : ''}
    </div></div>`,
  { title: t.title, sub: `<a href="#/messages">المراسلات</a> ← ${E(t.reference)}` });
  mount(() => {
    const th = document.querySelector('.thread'); if (th) th.lastElementChild?.scrollIntoView({ block: 'nearest' });
    const f = F('rpf');
    if (f) f.onsubmit = async (e) => { e.preventDefault();
      const b = formData(f); const fd = new FormData();
      fd.append('body', b.body || ''); if (b.internal) fd.append('internal', '1'); if (b.file) fd.append('file', b.file);
      f.querySelector('button').disabled = true;
      try { await api(`/threads/${t.id}/messages`, { method: 'POST', body: fd }); toast(b.internal ? 'قُيِّدت الملاحظة الداخلية' : 'أُرسلت الرسالة'); render(); }
      catch (er) { toast(er.message, 'danger'); f.querySelector('button').disabled = false; } };
    const asg = F('asg');
    if (asg) asg.onchange = async () => { if (!asg.value) return;
      try { await api(`/threads/${t.id}/assign`, { method: 'POST', body: { user_id: Number(asg.value) } }); toast('أُسندت المراسلة'); render(); }
      catch (er) { toast(er.message, 'danger'); } };
  });
  return html;
}

// ================= تقويم المواعيد =================
const KIND = {
  application: ['مواعيد الطلبات', 'info'], license_expiry: ['انتهاء التراخيص', 'warn'], accreditation_expiry: ['انتهاء الاعتماد', 'warn'],
  declaration: ['إقرارات الامتثال', 'warn'], invoice: ['استحقاق الفواتير', 'warn'], design: ['الموافقات الضمنية', 'warn'],
  appeal: ['البتّ في التظلمات', 'info'], suspension: ['تحوّل التعليق إلى سحب', 'danger'], integrity: ['مهل النزاهة', 'warn'],
  audit: ['التدقيق المجدول', 'info'], meeting: ['الاجتماعات', 'ok'], consultation: ['المشاورات العامة', 'ok'],
};
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const iso = (d) => d.toISOString().slice(0, 10);

route('calendar', async (r) => {
  if (needLogin()) return '';
  const m = /^\d{4}-\d{2}$/.test(r.query.m || '') ? r.query.m : today().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1)), last = new Date(Date.UTC(y, mo, 0));
  const gridStart = new Date(first); gridStart.setUTCDate(1 - first.getUTCDay());
  const gridEnd = new Date(last); gridEnd.setUTCDate(last.getUTCDate() + (6 - last.getUTCDay()));
  const d = await api('/calendar' + qs({ from: iso(gridStart), to: iso(gridEnd) }));
  const only = r.query.kind ? String(r.query.kind).split(',') : null;
  const evs = d.events.filter((e) => !only || only.includes(e.kind));
  const byDate = {}; evs.forEach((e) => (byDate[e.date] = byDate[e.date] || []).push(e));
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7), next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  const cells = [];
  for (let c = new Date(gridStart); c <= gridEnd; c.setUTCDate(c.getUTCDate() + 1)) {
    const k = iso(c), list = byDate[k] || [], out = k.slice(0, 7) !== m;
    const wk = [5, 6].includes(c.getUTCDay());   // الجمعة والسبت عطلة — المدد بأيام العمل
    cells.push(`<div class="cal-d ${out ? 'out' : ''} ${k === d.today ? 'today' : ''} ${wk ? 'wk' : ''}">
      <div class="cal-n">${c.getUTCDate()}</div>
      ${list.slice(0, 3).map((e) => `<a class="cal-e ${KIND[e.kind]?.[1] || ''} ${e.overdue ? 'late' : ''}" href="${E(e.link || '#/calendar')}" title="${E(e.title + (e.sub ? ' — ' + e.sub : ''))}">${E(e.title)}</a>`).join('')}
      ${list.length > 3 ? `<span class="muted" style="font-size:.7rem">+${list.length - 3} أخرى</span>` : ''}</div>`);
  }
  const overdue = d.events.filter((e) => e.overdue && (!only || only.includes(e.kind)));
  const upcoming = evs.filter((e) => e.date >= d.today).slice(0, 25);
  const row = (e) => `<tr><td class="mono">${E(e.date)}</td><td><span class="tag ${KIND[e.kind]?.[1] || ''}">${E(KIND[e.kind]?.[0] || e.kind)}</span></td>
    <td>${e.link ? `<a href="${E(e.link)}">${E(e.title)}</a>` : E(e.title)}${e.sub ? `<div class="muted" style="font-size:.76rem">${E(e.sub)}</div>` : ''}</td></tr>`;
  const kinds = [...new Set(d.events.map((e) => e.kind))];
  return shell(`
    <div class="grid g3" style="margin-bottom:14px">
      ${stat('خلال سبعة أيام', num(d.counts.next7), 'مواعيد قريبة', 'gold')}
      ${stat('متجاوزة', num(d.counts.overdue), 'انقضى موعدها ولم تُغلق', d.counts.overdue ? 'danger' : '')}
      ${stat('في المدى المعروض', num(d.counts.total), `${E(d.from)} ← ${E(d.to)}`)}
    </div>
    <div class="chips" style="margin-bottom:10px"><span>الأنواع:</span>
      <a class="chip ${!only ? 'on' : ''}" href="#/calendar${qs({ m })}">الكل</a>
      ${kinds.map((k) => `<a class="chip ${only && only.includes(k) ? 'on' : ''}" href="#/calendar${qs({ m, kind: k })}">${E(KIND[k]?.[0] || k)}</a>`).join('')}</div>
    ${card(`${MONTHS[mo - 1]} ${y}`, `<div class="cal">${DAYS.map((x) => `<div class="cal-h">${x}</div>`).join('')}${cells.join('')}</div>`,
      { actions: `<a class="btn sm" href="#/calendar${qs({ m: prev, kind: r.query.kind })}">‹ السابق</a>
        <a class="btn sm" href="#/calendar${qs({ kind: r.query.kind })}">اليوم</a>
        <a class="btn sm" href="#/calendar${qs({ m: next, kind: r.query.kind })}">التالي ›</a>` })}
    <div class="grid g2">
      ${card(`متجاوزة (${num(overdue.length)})`, overdue.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${overdue.slice(0, 30).map(row).join('')}</tbody></table></div>`
        : '<div class="empty"><b>لا مواعيد متجاوزة</b></div>')}
      ${card('القادمة', upcoming.length ? `<div class="tbl-wrap"><table class="tbl"><tbody>${upcoming.map(row).join('')}</tbody></table></div>`
        : '<div class="empty"><b>لا مواعيد قادمة في هذا المدى</b></div>')}
    </div>
    ${legal('المواعيد تُحسب بأيام العمل (الجمعة والسبت عطلة) كما تنص المادة (17)، والمهام الآلية تُنفِّذ ما يترتب على انقضائها دون انتظار أحد.')}`,
  { title: 'تقويم المواعيد النظامية', sub: 'كل موعد يخصك في مكان واحد — بحسب صلاحياتك ونطاق ملفك' });
});

// ================= البحث الشامل =================
route('search', async (r) => {
  if (needLogin()) return '';
  const q = String(r.query.q || '').trim();
  const d = q.length >= 2 ? await api('/search' + qs({ q })) : { groups: [], total: 0 };
  const html = shell(`
    <form id="sf" class="filters"><div class="fld" style="grid-column:1/-1"><label>ابحث في كل ما تملك صلاحية الاطلاع عليه</label>
      <input name="q" value="${E(q)}" placeholder="اسم منشأة أو منظمة، رقم ترخيص، مرجع طلب أو فاتورة أو جزاء…" autofocus></div></form>
    ${q.length < 2 ? alertBox('info', 'اكتب حرفين على الأقل', '') : !d.total ? alertBox('warn', 'لا نتائج', `لم يُعثر على «${E(q)}» فيما تملك الاطلاع عليه.`)
    : `<div class="grid g2">${d.groups.map((g) => card(`${g.title} (${num(g.rows.length)})`, `<div class="tbl-wrap"><table class="tbl"><tbody>
        ${g.rows.map((x) => `<tr class="clk" onclick="location.hash=${A(x.link)}"><td><b>${E(x.title)}</b>${x.sub ? `<div class="muted" style="font-size:.78rem">${E(x.sub)}</div>` : ''}</td>
          <td style="text-align:left">${x.status ? tag(x.status) : ''}</td></tr>`).join('')}</tbody></table></div>`)).join('')}</div>`}
    ${legal('النتائج مقيَّدة بصلاحياتك: صاحب الملف يرى ما يخص ملفه، والسجل العام متاح للجميع، والزيارات غير المعلنة لا تظهر لغير المخوَّل.')}`,
  { title: 'البحث الشامل', sub: q ? `نتائج «${E(q)}» — ${num(d.total)}` : '' });
  mount(() => { F('sf').onsubmit = (e) => { e.preventDefault(); go('search' + qs({ q: e.target.q.value.trim() })); }; });
  return html;
});

// ================= البريد الصادر =================
route('outbox', async () => {
  if (needLogin()) return '';
  const html = shell('<div id="t"></div>', { title: 'البريد الصادر',
    sub: 'كل رسالة بريدية تُقيَّد قبل إرسالها، ويُعاد المتعثر منها آلياً — والرسائل الحاملة لرموز الاستعادة لا يُعرض متنها' });
  mount(() => dataTable(F('t'), {
    path: '/outbox',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true, ph: 'المستلم أو العنوان' },
      { k: 'status', t: 'الحالة', type: 'select', opts: [['queued', 'بالانتظار'], ['sent', 'مُرسَلة'], ['held', 'محتجَزة'], ['failed', 'متعثرة']] },
      { k: 'kind', t: 'النوع', type: 'select', opts: [['notification', 'إشعار'], ['security', 'أمان الحساب'], ['password_reset', 'استعادة كلمة المرور'], ['thread', 'مراسلة'], ['system', 'نظام']] },
    ],
    summary: (d) => `${d.transport ? alertBox('ok', 'الخادم البريدي مضبوط', d.transport === 'json' ? 'وضع الإرسال الصوري (SEMA_MAIL_TRANSPORT=json) — للتجربة.' : 'تُرسل الرسائل عبر SEMA_SMTP_URL.')
      : alertBox('warn', 'لم يُضبط خادم بريد', 'الرسائل «محتجَزة» في الصندوق حتى يُضبط المتغير SEMA_SMTP_URL؛ ثم تُرسَل تلقائياً بالمهمة الآلية أو بإعادة المحاولة.')}
      <div class="grid g4" style="margin-bottom:12px">${[['sent', 'مُرسَلة', 'ok'], ['held', 'محتجَزة', 'gold'], ['queued', 'بالانتظار', ''], ['failed', 'متعثرة', 'danger']].map(([k, t, c]) =>
        stat(t, num(d.summary.find((x) => x.status === k)?.n || 0), '', c)).join('')}</div>`,
    cols: [
      { t: 'الوقت', srt: 'created_at', r: (x) => `<span class="mono">${E(when(x.created_at))}</span>` },
      { t: 'المستلم', r: (x) => `<b>${E(x.to_name || '—')}</b><div class="muted mono">${E(x.to_email)}</div>` },
      { t: 'العنوان', r: (x) => `<span style="white-space:normal">${E(x.subject)}</span>` },
      { t: 'النوع', r: (x) => `<span class="tag">${E({ notification: 'إشعار', security: 'أمان', password_reset: 'استعادة', thread: 'مراسلة', system: 'نظام' }[x.kind] || x.kind)}</span>` },
      { t: 'الحالة', r: (x) => `<span class="tag ${{ sent: 'ok', held: 'warn', failed: 'danger' }[x.status] || ''} dot">${E({ sent: 'مُرسَلة', held: 'محتجَزة', queued: 'بالانتظار', failed: 'متعثرة' }[x.status])}</span>
        ${x.last_error ? `<div class="muted" style="font-size:.7rem;white-space:normal;max-width:240px">${E(x.last_error)}</div>` : ''}` },
      { t: '', r: (x) => `<button class="btn sm" onclick="event.stopPropagation();WORK.showMail(${A(x)})">عرض</button>
        ${x.status !== 'sent' && has('admin.settings') ? `<button class="btn sm" onclick="event.stopPropagation();WORK.retryMail(${A(x.id)})">إعادة</button>` : ''}` },
    ],
  }));
  return html;
});

// ================= النسخ الاحتياطي =================
route('backups', async () => {
  if (needLogin()) return '';
  const d = await api('/backups');
  return shell(`
    ${alertBox('info', 'كيف تعمل النسخ الاحتياطية؟', `نسخة يومية تلقائية لقاعدة البيانات بلقطة متّسقة والخادم يعمل، مع فحص سلامتها وبصمتها،
      ويُحتفظ بآخر <b>${num(d.keep)}</b> نسخة (الإعداد <span class="mono">backup_keep</span>). الملفات المحمَّلة تُنسخ بمزامنة مجلد
      <span class="mono">uploads</span> — والاستعادة من سطر الأوامر والخادم متوقف: <span class="mono">npm run restore -- &lt;الملف&gt;</span>.`)}
    ${card(`النسخ (${num(d.rows.filter((b) => b.available).length)} متاحة)`, `<div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>الوقت</th><th>الملف</th><th>الحجم</th><th>السلامة</th><th>البصمة</th><th>بواسطة</th><th></th></tr></thead><tbody>
      ${d.rows.map((b) => `<tr><td class="mono">${E(when(b.created_at))}</td><td class="mono">${E(b.file_name)}</td>
        <td class="num">${num((b.size_bytes || 0) / 1024)} ك.ب</td>
        <td>${b.integrity === 'ok' ? '<span class="tag ok dot">سليمة</span>' : `<span class="tag danger">${E(b.integrity)}</span>`}</td>
        <td class="mono muted" title="${E(b.sha256)}">${E(String(b.sha256 || '').slice(0, 12))}…</td><td>${E(b.triggered_by || '—')}</td>
        <td>${b.available ? `<a class="btn sm" href="/api/backups/${b.id}/download?token=${encodeURIComponent(S.token)}">تنزيل</a>` : '<span class="muted">حُذفت</span>'}</td></tr>`).join('')
        || '<tr><td colspan="7"><div class="empty"><b>لا نسخ بعد</b>أنشئ النسخة الأولى الآن.</div></td></tr>'}</tbody></table></div>`,
    { actions: `<button class="btn primary sm" onclick="WORK.backupNow(this)">نسخة احتياطية الآن</button>` })}
    ${legal('النسخة تحوي بيانات شخصية ومستندات سرّية: التنزيل مقيَّد بصلاحية النسخ الاحتياطي ومقيَّد في سجل التتبع، ويُحفظ الملف مشفَّراً خارج الخادم.')}`,
  { title: 'النسخ الاحتياطي', sub: E(d.dir) });
});

// ================= إجراءات =================
async function pickSubject(el) {
  const kind = el.querySelector('[name=subject_kind]').value, q = el.querySelector('[name=subject_q]').value.trim();
  const box = el.querySelector('#subj-res');
  if (q.length < 2) { box.innerHTML = '<span class="muted">اكتب حرفين على الأقل</span>'; return; }
  const path = kind === 'licensee' ? '/licensees' : kind === 'association' ? '/associations' : '/users';
  try {
    const d = await api(path + qs({ q, per_page: 8 }));
    box.innerHTML = d.rows.map((x) => `<label class="pledge"><input type="radio" name="subject_id" value="${x.id}">
      <span>${E(x.legal_name || x.name || x.full_name)} <span class="muted mono">${E(x.license_no || x.accreditation_no || x.email || '')}</span></span></label>`).join('') || '<span class="muted">لا نتائج</span>';
  } catch (er) { box.innerHTML = `<span class="muted">${E(er.message)}</span>`; }
}

window.WORK = {
  async newThread(preset = {}) {
    const staff = has('thread.staff');
    // الجهة: موضوع اختياري من طلباتها — والأمانة تختار الجهة أولاً
    let apps = [];
    if (!staff) apps = (await api('/applications' + qs({ per_page: 50 })).catch(() => ({ rows: [] }))).rows;
    const m = modal({ title: 'مراسلة جديدة', wide: true, body: `<form id="ntf"><div class="form-grid">
      ${staff ? `${fld('subject_kind', 'الجهة', { opts: [['licensee', 'منشأة مرخَّص لها'], ['association', 'منظمة'], ...(has('admin.users') ? [['user', 'حساب (مراقب)']] : [])], val: preset.subject_kind })}
        <div class="fld"><label>بحث عن الجهة *</label><div style="display:flex;gap:6px"><input name="subject_q" placeholder="الاسم أو الرقم">
          <button type="button" class="btn sm" id="sq">بحث</button></div></div>
        <div id="subj-res" style="grid-column:1/-1">${preset.subject_id ? `<input type="hidden" name="subject_id" value="${E(preset.subject_id)}"><span class="tag info">${E(preset.subject_name || 'الجهة المحددة')}</span>` : ''}</div>` : ''}
      ${fld('title', 'العنوان', { req: true, wide: true, val: preset.title || '' })}
      ${fld('category', 'التصنيف', { opts: Object.entries(CAT), val: preset.category || 'inquiry' })}
      ${!staff && apps.length ? fld('topic', 'مرتبطة بطلب (اختياري)', { opts: [['', '—'], ...apps.map((a) => [`application:${a.id}`, `${a.reference} — ${lb('appType', a.app_type)}`])], val: preset.topic || '' })
        : preset.topic ? `<input type="hidden" name="topic" value="${E(preset.topic)}">` : ''}
      ${fld('body', 'النص', { type: 'textarea', req: true, wide: true, rows: 6 })}
      <div class="fld" style="grid-column:1/-1"><label>مرفق (اختياري)</label><input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.doc,.docx,.xls,.xlsx">
        <span class="hint">PDF أو صورة أو Word أو Excel — حتى 20 ميجابايت</span></div></div></form>`,
    actions: [{ label: 'إرسال', cls: 'primary', run: async (el, close) => {
      const b = formData(el.querySelector('#ntf'));
      const sid = el.querySelector('[name=subject_id]:checked') || el.querySelector('input[type=hidden][name=subject_id]');
      if (staff && !sid) return toast('اختر الجهة من نتائج البحث', 'danger');
      const fd = new FormData();
      if (staff) { fd.append('subject_kind', b.subject_kind); fd.append('subject_id', sid.value); }
      fd.append('title', b.title || ''); fd.append('category', b.category || 'inquiry'); fd.append('body', b.body || '');
      if (b.topic) { const [k, v] = String(b.topic).split(':'); fd.append('topic_kind', k); fd.append('topic_id', v); }
      if (b.file) fd.append('file', b.file);
      try { const t = await api('/threads', { method: 'POST', body: fd }); close(); toast(`أُرسلت المراسلة ${t.reference}`); go('messages/' + t.id); }
      catch (er) { toast(er.message, 'danger'); } } }] });
    const sq = m.el.querySelector('#sq');
    if (sq) { sq.onclick = () => pickSubject(m.el);
      m.el.querySelector('[name=subject_q]').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); pickSubject(m.el); } }; }
  },
  async closeThread(id) {
    try { await api(`/threads/${id}/close`, { method: 'POST', body: {} }); toast('أُغلقت المراسلة'); render(); } catch (er) { toast(er.message, 'danger'); }
  },
  async reopen(id) {
    try { await api(`/threads/${id}/reopen`, { method: 'POST', body: {} }); toast('أُعيد فتح المراسلة'); render(); } catch (er) { toast(er.message, 'danger'); }
  },
  showMail(x) {
    modal({ title: x.subject, wide: true, body: `<dl class="kv"><dt>إلى</dt><dd class="mono">${E(x.to_email)}</dd><dt>الحالة</dt><dd>${E(x.status)}</dd>
      <dt>المحاولات</dt><dd>${num(x.attempts)}</dd>${x.last_error ? `<dt>آخر خطأ</dt><dd>${E(x.last_error)}</dd>` : ''}</dl>
      <pre style="white-space:pre-wrap;font-family:var(--f);background:var(--surface-3);padding:12px;border-radius:8px;margin-top:10px">${E(x.body_text)}</pre>` });
  },
  async retryMail(id) {
    try { const r = await api(`/outbox/${id}/retry`, { method: 'POST', body: {} }); toast(r.status === 'sent' ? 'أُرسلت الرسالة' : `الحالة: ${r.status}`); render(); }
    catch (er) { toast(er.message, 'danger'); }
  },
  async backupNow(btn) {
    btn.disabled = true;
    try { const b = await api('/backups', { method: 'POST', body: {} }); toast(`أُنشئت النسخة ${b.file_name} — ${b.integrity === 'ok' ? 'سليمة' : b.integrity}`); render(); }
    catch (er) { toast(er.message, 'danger'); btn.disabled = false; }
  },
  // ---------- التحقق بخطوتين ----------
  async setup2fa() {
    modal({ title: 'تفعيل التحقق بخطوتين', body: `<p class="muted">أكِّد كلمة المرور للمتابعة.</p>
      <form id="p2f">${fld('password', 'كلمة المرور', { type: 'password', req: true, wide: true })}</form>`,
    actions: [{ label: 'متابعة', cls: 'primary', run: async (el, close) => {
      try { const s = await api('/auth/2fa/setup', { method: 'POST', body: formData(el.querySelector('#p2f')) }); close(); WORK.confirm2fa(s); }
      catch (er) { toast(er.message, 'danger'); } } }] });
  },
  confirm2fa(s) {
    modal({ title: 'امسح الرمز بتطبيق المصادقة', wide: true, body: `<div class="grid g2" style="align-items:center">
      <div class="qr2fa">${s.qr_svg}</div>
      <div><ol style="padding-inline-start:18px;margin:0 0 10px">
        <li>ثبّت تطبيق مصادقة (Google Authenticator أو Microsoft Authenticator أو FreeOTP).</li>
        <li>امسح الرمز، أو أدخل المفتاح يدوياً:<div class="mono" style="word-break:break-all;background:var(--surface-3);padding:6px 8px;border-radius:6px;margin-top:4px">${E(s.secret.replace(/(.{4})/g, '$1 ').trim())}</div></li>
        <li>أدخل الرمز المكوَّن من ستة أرقام الذي يظهر في التطبيق.</li></ol>
        <form id="c2f">${fld('code', 'رمز التحقق', { req: true, ph: '123456' })}</form></div></div>`,
    actions: [{ label: 'تفعيل', cls: 'primary', run: async (el, close) => {
      try { const r = await api('/auth/2fa/enable', { method: 'POST', body: formData(el.querySelector('#c2f')) });
        S.user = r.user; close(); WORK.showRecovery(r.recovery_codes); }
      catch (er) { toast(er.message, 'danger'); } } }] });
  },
  showRecovery(codes) {
    modal({ title: 'رموز الاسترداد — احفظها الآن', body: `${alertBox('warn', 'لن تُعرض مرة أخرى', 'كل رمز يصلح مرة واحدة للدخول إن فقدت هاتفك. احفظها مطبوعةً أو في مدير كلمات مرور.')}
      <div class="recov">${codes.map((c) => `<span class="mono">${E(c)}</span>`).join('')}</div>`,
    actions: [{ label: 'نسخ', run: async () => { try { await navigator.clipboard.writeText(codes.join('\n')); toast('نُسخت الرموز'); } catch { toast('انسخها يدوياً', 'danger'); } } },
      { label: 'حفظتها', cls: 'primary', run: (_el, close) => { close(); render(); } }] });
  },
  disable2fa() {
    modal({ title: 'تعطيل التحقق بخطوتين', body: `<form id="d2f"><div class="form-grid">${fld('password', 'كلمة المرور', { type: 'password', req: true })}
      ${fld('code', 'رمز التطبيق الحالي', { req: true })}</div></form>`,
    actions: [{ label: 'تعطيل', cls: 'danger', run: async (el, close) => {
      try { const r = await api('/auth/2fa/disable', { method: 'POST', body: formData(el.querySelector('#d2f')) }); S.user = r.user; close(); toast('عُطِّل التحقق بخطوتين'); render(); }
      catch (er) { toast(er.message, 'danger'); } } }] });
  },
  newRecovery() {
    modal({ title: 'رموز استرداد جديدة', body: `<p class="muted">تُبطل الرموز الجديدة كل الرموز السابقة.</p><form id="n2f"><div class="form-grid">
      ${fld('password', 'كلمة المرور', { type: 'password', req: true })}${fld('code', 'رمز التطبيق الحالي', { req: true })}</div></form>`,
    actions: [{ label: 'توليد', cls: 'primary', run: async (el, close) => {
      try { const r = await api('/auth/2fa/recovery', { method: 'POST', body: formData(el.querySelector('#n2f')) }); close(); WORK.showRecovery(r.recovery_codes); }
      catch (er) { toast(er.message, 'danger'); } } }] });
  },
  // ---------- إدارة المستخدمين ----------
  async sendReset(id, name) {
    if (!confirm(`إرسال رابط تعيين كلمة المرور إلى ${name}؟ لن ترى أنت الرابط؛ يصل إلى بريده مباشرة.`)) return;
    try { const r = await api(`/users/${id}/reset-link`, { method: 'POST', body: {} }); toast(r.note); } catch (er) { toast(er.message, 'danger'); }
  },
  reset2fa(id, name) {
    modal({ title: `إسقاط التحقق بخطوتين — ${name}`, body: `${alertBox('warn', 'إجراء أمني', 'لمن فقد هاتفه ورموز الاسترداد معاً، بعد التثبت من هويته. تُغلق كل جلساته، ويُبلَّغ بالبريد.')}
      <form id="r2f">${fld('reason', 'السبب وطريقة التثبت من الهوية', { type: 'textarea', req: true, wide: true })}</form>`,
    actions: [{ label: 'إسقاط', cls: 'danger', run: async (el, close) => {
      try { await api(`/users/${id}/2fa/reset`, { method: 'POST', body: formData(el.querySelector('#r2f')) }); close(); toast('أُسقط التحقق بخطوتين'); render(); }
      catch (er) { toast(er.message, 'danger'); } } }] });
  },
};
void today; void L; void dt;
})();
