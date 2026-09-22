(function(){
'use strict';
/* ===== مكوّنات الواجهة المشتركة ===== */
const { S, api, qs, E, num, money, pct, dt, has, hasRole, L, lb, tag, tone, lvlBadge, ic, LOGO,
        toast, go, logout, render, kfmt } = window.SEMA;

// ---------- القائمة الجانبية حسب الصلاحيات ----------
function navGroups() {
  const g = [];
  g.push({ title: 'نظرة عامة', items: [
    ['dashboard', 'لوحة المؤشرات', 'dash'],
    ['registry', 'السجل العام', 'search'],
  ] });

  const own = [];
  if (has('licensee.view.own') && !has('licensee.view.all')) own.push(['my-licensee', 'ملف منشأتي', 'biz']);
  if (has('org.view.own') && !has('org.view.all')) own.push(['my-org', 'ملف منظمتي', 'org']);
  if (has('app.create')) own.push(['applications', 'طلباتي', 'app']);
  if (has('doc.upload.own') && !has('doc.view.all')) own.push(['documents', 'إثباتاتي', 'doc']);
  if (has('commitment.declare')) own.push(['commitments', 'الالتزام والإقرار السنوي', 'money']);
  if (has('contribution.declare') || has('contribution.confirm')) own.push(['contributions', 'المساهمات', 'money']);
  if (has('design.submit')) own.push(['designs', 'الموافقة على التصاميم', 'paint']);
  if (has('impact.submit')) own.push(['contributions', 'تقارير الأثر', 'chart']);
  if (own.length) g.push({ title: 'بوابتي', items: dedupe(own) });

  const reg = [];
  if (has('licensee.view.all')) reg.push(['licensees', 'المرخَّص لهم', 'biz']);
  if (has('org.view.all')) reg.push(['associations', 'المنظمات المعتمدة', 'org']);
  if (has('app.view.all')) reg.push(['applications', 'الطلبات ومساراتها', 'app']);
  if (has('doc.view.all')) reg.push(['documents', 'الإثباتات', 'doc']);
  if (reg.length) g.push({ title: 'الملفات', items: reg });

  const ops = [];
  if (has('commitment.view.all')) ops.push(['commitments', 'الالتزام السنوي', 'money']);
  if (has('commitment.view.all') || has('contribution.verify')) ops.push(['contributions', 'المساهمات', 'money']);
  if (has('commitment.view.all')) ops.push(['declarations', 'إقرارات الامتثال', 'list']);
  if (has('audit.view.all')) ops.push(['audits', 'التدقيق والتفتيش', 'audit']);
  if (has('audit.plan')) ops.push(['audit-plan', 'خطة العيّنة العشوائية', 'flag']);
  if (has('market_test.manage') || has('report.view')) ops.push(['market-tests', 'اختبار السوق', 'flag']);
  if (has('design.decide')) ops.push(['designs', 'طلبات التصاميم', 'paint']);
  if (ops.length) g.push({ title: 'التشغيل والرقابة', items: dedupe(ops) });

  const jus = [];
  if (has('sanction.view.all') || has('sanction.decide')) jus.push(['sanctions', 'الجزاءات', 'gavel']);
  if (has('appeal.view.all') || has('appeal.file')) jus.push(['appeals', 'التظلمات', 'scale']);
  if (has('complaint.triage') || has('complaint.file')) jus.push(['complaints', 'البلاغات والشكاوى', 'bell']);
  if (has('integrity.note') || has('integrity.publish') || has('report.view')) jus.push(['integrity', 'حماية النزاهة', 'shield']);
  if (jus.length) g.push({ title: 'الجزاء والنزاهة', items: dedupe(jus) });

  const gov = [];
  if (has('gov.meetings.view') || has('gov.attend')) gov.push(['meetings', 'الاجتماعات والمحاضر', 'list']);
  if (has('observer.nominate') || has('observer.admit') || hasRole('OBSERVER')) gov.push(['observers', 'المراقبون', 'eye']);
  if (has('standards.propose') || has('standards.approve')) gov.push(['standards', 'المعايير والرسوم', 'badge']);
  if (gov.length) g.push({ title: 'الحوكمة', items: gov });

  const rep = [];
  if (has('report.view')) rep.push(['reports', 'التقارير الجاهزة', 'chart']);
  if (has('report.view')) rep.push(['kpis', 'المؤشرات والمستهدفات', 'chart']);
  if (has('finance.view.all')) rep.push(['finance', 'الرسوم والمالية', 'money']);
  if (has('report.view')) rep.push(['risks', 'سجل المخاطر', 'flag']);
  if (rep.length) g.push({ title: 'التقارير', items: rep });

  const adm = [];
  adm.push(['rbac', 'الأدوار والصلاحيات', 'shield']);
  if (has('admin.users')) adm.push(['users', 'المستخدمون', 'users']);
  if (has('admin.log')) adm.push(['audit-log', 'سجل التتبع', 'list']);
  if (has('admin.settings')) adm.push(['settings', 'الإعدادات', 'gear']);
  g.push({ title: 'النظام', items: adm });
  return g;
}
const dedupe = (arr) => { const s = new Set(); return arr.filter(([a, b]) => { const k = a + b; if (s.has(k)) return false; s.add(k); return true; }); };

function shell(content, { title, sub, actions = '' } = {}) {
  const cur = S.route.name;
  const nav = navGroups().map((g) => `<div class="side-grp"><h5>${E(g.title)}</h5>${
    g.items.map(([h, t, i]) => `<a href="#/${h}" class="${cur === h ? 'on' : ''}">${ic(i)}<span>${E(t)}</span></a>`).join('')
  }</div>`).join('');
  return `<div class="app">
    ${topbar()}
    <div class="shell">
      <nav class="side" id="side">${nav}</nav>
      <main class="main">
        ${title ? `<div class="page-hd"><div><h1>${E(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
          <div class="spacer"></div><div class="btn-row">${actions}</div></div>` : ''}
        ${content}
      </main>
    </div></div>`;
}

function topbar() {
  const u = S.user;
  return `<header class="topbar"><div class="topbar-in">
    <button class="btn sm" onclick="document.getElementById('side').classList.toggle('open')"
      style="display:none" id="burger">☰</button>
    <a href="#/dashboard" class="logo"><span class="logo-mark">${LOGO}</span>
      <span class="logo-txt"><b>سِيمَا الخَيْر</b><span>تَعْرِفُهُم بِسِيمَاهُم</span></span></a>
    <div class="spacer"></div>
    <a href="#/" class="btn sm">${ic('search')} السجل العام</a>
    <button class="btn sm" onclick="UI.notifPanel()">${ic('bell')} ${S.notif.unread
      ? `<span class="pill on">${S.notif.unread}</span>` : ''}</button>
    ${u ? `<button class="btn sm" onclick="UI.mePanel()" title="${E(u.roles.map((r) => r.name_ar).join(' · '))}">
      <b>${E(u.full_name.split(' ').slice(0, 2).join(' '))}</b></button>
      <button class="btn sm" onclick="SEMA.logout()">${ic('out')}</button>`
    : `<a class="btn primary sm" href="#/login">تسجيل الدخول</a>`}
  </div></header>`;
}

function mePanel() {
  const u = S.user;
  window.SEMA.modal({ title: 'حسابي وصلاحياتي', wide: true, body: `
    <dl class="kv"><dt>الاسم</dt><dd>${E(u.full_name)}</dd>
    <dt>البريد</dt><dd class="mono">${E(u.email)}</dd>
    <dt>الوظيفة</dt><dd>${E(u.job_title || '—')}</dd>
    <dt>المنطقة</dt><dd>${E(u.region || '—')}</dd></dl>
    <h4 style="margin-top:16px">الأدوار الممنوحة</h4>
    ${u.roles.map((r) => `<div class="card" style="margin-bottom:8px"><div class="card-bd" style="padding:11px 14px">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b>${E(r.name_ar)}</b>
        ${r.sod_function ? `<span class="tag gold">وظيفة: ${E(sodName(r.sod_function))}</span>` : ''}
        ${r.scope_kind !== 'global' ? `<span class="tag info">نطاق محدد</span>` : ''}
      </div>
      <p class="muted" style="font-size:.8rem;margin:6px 0 0">${E(r.description || '')}</p></div></div>`).join('')}
    <div class="legal">المادة (18): لا يجوز أن يجمع شخصٌ واحدٌ بين وظيفتين من الوظائف الأربع — وضع المعيار،
      والتقييم والتدقيق، وقرار الترخيص، والتظلم وحماية النزاهة. والنظام يمنع ذلك آلياً عند التعيين.</div>
    <h4>الصلاحيات الفعلية (${u.permissions.length})</h4>
    <div style="display:flex;gap:5px;flex-wrap:wrap">${u.permissions.map((p) =>
      `<span class="tag">${E(permName(p))}</span>`).join('')}</div>` });
}
const sodName = (c) => ({ STANDARDS:'وضع المعيار', EVALUATION:'التقييم والتدقيق',
  LICENSING:'قرار الترخيص', APPEAL_INTEGRITY:'التظلم وحماية النزاهة' }[c] || c);
const permName = (p) => (S.rbac?.permissions || []).find((x) => x.code === p)?.name_ar || p;

async function notifPanel() {
  const n = await api('/notifications');
  S.notif = n;
  window.SEMA.modal({ title: `الإشعارات (${n.rows.length})`, body: n.rows.length
    ? n.rows.slice(0, 40).map((r) => `<div class="alert ${r.severity === 'info' ? 'info' : r.severity}">
        <div><b>${E(r.title)}</b>${E(r.body || '')}
        <div class="muted" style="font-size:.74rem;margin-top:3px">${dt(r.created_at)}
        ${r.link ? ` · <a href="${E(r.link)}">فتح</a>` : ''}</div></div></div>`).join('')
    : '<div class="empty"><b>لا إشعارات</b></div>',
    actions: [{ label: 'تعليم الكل مقروءاً', cls: 'primary', run: async (_e, close) => {
      await api('/notifications/read', { method: 'POST' }); S.notif.unread = 0; close(); render(); } }] });
}

// ---------- جدول بيانات مع فلترة ----------
/**
 * cols: [{k, t, r?(row), cls?, srt?}]
 * filters: [{k, t, type:'text|select|number|date|bool', opts:[[v,label]]}]
 */
async function dataTable(el, { path, cols, filters = [], extra = {}, rowClick, empty, summary, sortDefault }) {
  const q = Object.assign({}, S.route.query, extra);
  el.innerHTML = '<div class="load">جارٍ التحميل…</div>';
  let data;
  try { data = await api(path + qs(q)); }
  catch (e) { el.innerHTML = `<div class="alert danger"><b>تعذّر التحميل</b>${E(e.message)}</div>`; return; }
  const rows = data.rows || [];
  const setQ = (patch) => {
    const nq = Object.assign({}, S.route.query, patch);
    for (const k of Object.keys(nq)) if (nq[k] === '' || nq[k] == null) delete nq[k];
    go(S.route.name + (S.route.params.length ? '/' + S.route.params.join('/') : '') + qs(nq));
  };
  const applied = Object.entries(S.route.query).filter(([k]) => !['page', 'per_page', 'sort'].includes(k));

  el.innerHTML = `
  ${filters.length ? `<div class="filters">
    ${filters.map((f) => fldHtml(f, q[f.k])).join('')}
    <div class="fld"><label>&nbsp;</label><button class="btn primary" data-go>تطبيق</button></div>
    <div class="fld"><label>&nbsp;</label><button class="btn" data-clr>تصفير</button></div>
  </div>` : ''}
  ${applied.length ? `<div class="chips"><span>الفلاتر المطبَّقة:</span>${applied.map(([k, v]) =>
    `<span class="chip"><b>${E(fLabel(filters, k))}</b> ${E(fValLabel(filters, k, v))}
      <button data-rm="${E(k)}">×</button></span>`).join('')}
    <span class="spacer"></span><b>${num(data.total)}</b> نتيجة</div>` : ''}
  ${summary ? summary(data) : ''}
  <div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) =>
    `<th class="${c.srt ? 'srt' : ''}" ${c.srt ? `data-srt="${E(c.srt)}"` : ''}>${E(c.t)}${
      c.srt && (q.sort === c.srt || q.sort === '-' + c.srt) ? (q.sort[0] === '-' ? ' ▾' : ' ▴') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.length ? rows.map((r, i) => `<tr ${rowClick ? `class="clk" data-i="${i}"` : ''}>${
      cols.map((c) => `<td class="${c.cls || ''}">${c.r ? c.r(r) : E(r[c.k] ?? '—')}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${cols.length}"><div class="empty"><b>لا نتائج</b>${E(empty || 'جرّب تعديل الفلاتر')}</div></td></tr>`}
    </tbody></table></div>
  <div class="pager">
    <button class="btn sm" data-pg="${Math.max(1, (data.page || 1) - 1)}" ${data.page <= 1 ? 'disabled' : ''}>السابق</button>
    <span>صفحة <b>${num(data.page)}</b> من <b>${num(data.pages)}</b></span>
    <button class="btn sm" data-pg="${Math.min(data.pages, (data.page || 1) + 1)}" ${data.page >= data.pages ? 'disabled' : ''}>التالي</button>
    <span class="spacer" style="flex:1"></span>
    <span>الإجمالي <b>${num(data.total)}</b></span>
    <select data-pp style="padding:3px 7px;border:1px solid var(--line);border-radius:6px">
      ${[10, 25, 50, 100, 200].map((n) => `<option value="${n}" ${Number(q.per_page || 25) === n ? 'selected' : ''}>${n} / صفحة</option>`).join('')}
    </select></div>`;

  const read = () => { const o = {}; el.querySelectorAll('[data-f]').forEach((i) => { o[i.dataset.f] = i.value; }); return o; };
  el.querySelector('[data-go]')?.addEventListener('click', () => setQ(Object.assign(read(), { page: 1 })));
  el.querySelector('[data-clr]')?.addEventListener('click', () => go(S.route.name));
  el.querySelectorAll('[data-f]').forEach((i) => i.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') setQ(Object.assign(read(), { page: 1 })); }));
  el.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => setQ({ [b.dataset.rm]: '' })));
  el.querySelectorAll('[data-pg]').forEach((b) => b.addEventListener('click', () => setQ({ page: b.dataset.pg })));
  el.querySelector('[data-pp]')?.addEventListener('change', (e) => setQ({ per_page: e.target.value, page: 1 }));
  el.querySelectorAll('[data-srt]').forEach((th) => th.addEventListener('click', () => {
    const c = th.dataset.srt; setQ({ sort: q.sort === c ? '-' + c : c, page: 1 }); }));
  if (rowClick) el.querySelectorAll('tr.clk').forEach((tr) =>
    tr.addEventListener('click', () => rowClick(rows[Number(tr.dataset.i)])));
  return data;
}

function fldHtml(f, v) {
  v = v ?? '';
  const id = `data-f="${E(f.k)}"`;
  let inner;
  if (f.type === 'select')
    inner = `<select ${id}><option value="">الكل</option>${(f.opts || []).map(([val, lbl]) =>
      `<option value="${E(val)}" ${String(v) === String(val) ? 'selected' : ''}>${E(lbl)}</option>`).join('')}</select>`;
  else if (f.type === 'bool')
    inner = `<select ${id}><option value="">الكل</option>
      <option value="true" ${v === 'true' ? 'selected' : ''}>نعم</option>
      <option value="false" ${v === 'false' ? 'selected' : ''}>لا</option></select>`;
  else inner = `<input ${id} type="${f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'search'}"
      value="${E(v)}" placeholder="${E(f.ph || '')}">`;
  return `<div class="fld ${f.wide ? 'wide' : ''}"><label>${E(f.t)}</label>${inner}
    ${f.hint ? `<span class="hint">${E(f.hint)}</span>` : ''}</div>`;
}
const fLabel = (fs, k) => (fs.find((f) => f.k === k) || {}).t || k;
const fValLabel = (fs, k, v) => {
  const f = fs.find((x) => x.k === k);
  if (f && f.opts) return String(v).split(',').map((x) =>
    (f.opts.find((o) => String(o[0]) === x) || [x, x])[1]).join(' / ');
  if (f && f.type === 'bool') return v === 'true' ? 'نعم' : 'لا';
  return v;
};

// ---------- رسوم بسيطة ----------
const bars = (items, { fmt = num, color } = {}) => {
  const mx = Math.max(1, ...items.map((i) => Math.abs(i.v || 0)));
  return `<div class="bars">${items.map((i) => `<div class="bar-row">
    <span class="lb" title="${E(i.k)}">${E(i.k)}</span>
    <span class="bar"><i style="width:${Math.max(1.5, (Math.abs(i.v || 0) / mx) * 100)}%;background:${
      E(i.color || color || 'var(--green)')}"></i></span>
    <span class="vl">${fmt(i.v)}</span></div>`).join('')}</div>`;
};
const meter = (v, cap, { warnAt = 0.8, dangerAt = 1 } = {}) => {
  const r = cap > 0 ? v / cap : 0;
  const cls = r >= dangerAt ? 'danger' : r >= warnAt ? 'warn' : '';
  return `<div class="meter"><i class="${cls}" style="width:${Math.min(100, r * 100)}%"></i></div>`;
};
const spark = (arr) => `<div class="spark">${arr.map((v, i) => {
  const mx = Math.max(1, ...arr.map((x) => x || 0));
  return `<i class="${i === arr.length - 1 ? 'last' : ''}" style="height:${Math.max(4, ((v || 0) / mx) * 100)}%"
    title="${num(v)}"></i>`; }).join('')}</div>`;
const stat = (k, v, d, cls = '') => `<div class="stat ${cls}"><div class="k">${E(k)}</div>
  <div class="v">${v}</div>${d ? `<div class="d">${d}</div>` : ''}</div>`;
const alertBox = (kind, title, body) => `<div class="alert ${kind}"><div><b>${E(title)}</b>${body || ''}</div></div>`;
const legal = (t) => `<div class="legal">${t}</div>`;
const card = (title, body, { note, actions, tight } = {}) => `<div class="card">
  ${title ? `<div class="card-hd"><h3>${E(title)}</h3>${note ? `<span class="note">${note}</span>` : ''}
    <span class="spacer" style="flex:1"></span>${actions || ''}</div>` : ''}
  <div class="card-bd ${tight ? 'tight' : ''}">${body}</div></div>`;
const kv = (pairs) => `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) =>
  `<dt>${E(k)}</dt><dd>${v == null || v === '' ? '<span class="muted">—</span>' : v}</dd>`).join('')}</dl>`;

function tabs(el, items, initial) {
  let cur = initial || items[0][0];
  const draw = () => {
    el.innerHTML = `<div class="tabs">${items.map(([k, t, n]) =>
      `<button class="${k === cur ? 'on' : ''}" data-t="${E(k)}">${E(t)}${
        n != null ? `<span class="pill">${num(n)}</span>` : ''}</button>`).join('')}</div>
      <div id="tabbody"></div>`;
    el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { cur = b.dataset.t; draw(); });
    const body = el.querySelector('#tabbody');
    const fn = items.find((i) => i[0] === cur)[3];
    const out = fn(body);
    if (typeof out === 'string') body.innerHTML = out;
  };
  draw();
}

const docLink = (d) => `<a href="/api/documents/${d.id}/file?token=${encodeURIComponent(S.token || '')}"
  target="_blank" rel="noopener">${E(d.title)}</a>`;

window.UI = { shell, topbar, dataTable, bars, meter, spark, stat, alertBox, legal, card, kv, tabs,
  mePanel, notifPanel, docLink, sodName, permName, navGroups };

})();
