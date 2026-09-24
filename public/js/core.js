'use strict';
/* ===== نواة التطبيق: الحالة، الاتصال، التوجيه، الأدوات ===== */
const S = {
  token: localStorage.getItem('sema_token') || null,
  user: null, ref: null, rbac: null, notif: { rows: [], unread: 0 }, msgs: { unread: 0, awaiting: 0 },
  route: { name: '', params: {}, query: {} },
};

// ---------- اتصال ----------
async function api(path, opts = {}) {
  const h = Object.assign({}, opts.headers);
  if (!(opts.body instanceof FormData)) h['Content-Type'] = 'application/json';
  if (S.token) h.Authorization = 'Bearer ' + S.token;
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET', headers: h,
    body: opts.body instanceof FormData ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && S.token) { logout(); throw new Error('انتهت الجلسة — يلزم تسجيل الدخول'); }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    // حساب داخلي أُلزم بالتحقق بخطوتين ولم يُفعّله: يُوجَّه إلى «حسابي» حتى يُفعّله
    if (res.status === 403 && data && ['MFA_ENROLL_REQUIRED', 'PASSWORD_CHANGE_REQUIRED'].includes(data.code) && S.route.name !== 'profile') location.hash = '#/profile';
    const e = new Error((data && data.error) || 'خطأ في الطلب'); e.data = data; e.status = res.status; throw e;
  }
  return data;
}
const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o || {}))
  if (v !== '' && v != null) p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };

// ---------- أدوات ----------
const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const NF = new Intl.NumberFormat('ar-LY');
const num = (n) => n == null ? '—' : NF.format(Math.round(Number(n)));
const num2 = (n) => n == null ? '—' : NF.format(Math.round(Number(n) * 100) / 100);
const money = (n) => n == null ? '—' : NF.format(Math.round(Number(n))) + ' د.ل';
const pct = (n, dp = 1) => n == null ? '—' : (Number(n) * 100).toFixed(dp) + '%';
const dt = (s) => !s ? '—' : String(s).slice(0, 10);
/** وسيط آمن لمعالجات الأحداث الداخلية: JSON يُهرَّب داخل السمة، فلا تكسر علامة اقتباس في بيانات المستخدم السمة ولا السكربت */
const A = (v) => E(JSON.stringify(v === undefined ? null : v));
const yr = (n) => n == null || n === '' ? '—' : String(n);  // السنوات بلا فاصل آلاف
const today = () => new Date().toISOString().slice(0, 10);
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);
const has = (p) => !!S.user && S.user.permissions.includes(p);
const hasRole = (r) => !!S.user && S.user.role_codes.includes(r);
const kfmt = (n) => Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(n % 1e6 ? 2 : 0) + ' م' :
  Math.abs(n) >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + ' ألف' : num(n);

// ---------- مصطلحات ----------
const L = {
  status: { draft:'مسوّدة', submitted:'مقدَّم', under_review:'قيد المراجعة', approved:'معتمد', active:'ساري',
    suspended:'معلَّق', withdrawn:'مسحوب', expired:'منتهٍ', rejected:'مرفوض', accredited:'معتمد', revoked:'مسحوب الاعتماد',
    deficiencies:'نواقص', completing:'قيد الاستكمال', assessment:'قيد التقييم', field_visit:'زيارة ميدانية',
    facts_report:'تقرير وقائع', decision_pending:'بانتظار القرار', shelved:'محفوظ', open:'مفتوح',
    fulfilled:'مستوفى', deficient:'عجز', breach:'إخلال', closed:'مغلق', planned:'مجدول', in_progress:'جارٍ',
    facts_reported:'رُفع التقرير', cancelled:'ملغى', declared:'معلَن', documented:'موثَّق', verified:'متحقَّق منه',
    excluded:'مستبعَد', issued:'مستحق', paid:'مسدَّد', waived:'معفى', void:'ملغى', overdue:'متأخر',
    late:'متأخر', desk_review:'تدقيق مكتبي', field_audit:'تدقيق ميداني', accepted:'مقبول', pending:'معلَّق',
    filed:'مقدَّم', decided:'مفصول فيه', inadmissible:'غير مقبول', nominated:'مرشَّح', admitted:'مقبول',
    ended:'منتهٍ', received:'مستلَم', triage:'قيد الفرز', investigating:'قيد التحقيق',
    substantiated:'ثابت', unsubstantiated:'غير ثابت', answered:'مُجاب', escalated:'مصعَّد', published:'منشور',
    lifted:'مرفوع', appealed:'متظلَّم منه', overturned:'ملغى', expired_implicit:'موافقة ضمنية', withdrawn_app:'مسحوب' },
  tone: { active:'ok', accredited:'ok', approved:'ok', fulfilled:'ok', verified:'ok', paid:'ok', accepted:'ok',
    admitted:'ok', ok:'ok', met:'ok',
    suspended:'warn', deficiencies:'warn', deficient:'warn', late:'warn', overdue:'warn', pending:'warn',
    declared:'warn', nominated:'warn', triage:'warn', investigating:'warn', partial:'warn', open:'warn',
    withdrawn:'danger', revoked:'danger', rejected:'danger', breach:'danger', excluded:'danger',
    substantiated:'danger', not_met:'danger', inadmissible:'danger', ended:'danger' },
  appType: { license:'ترخيص', license_renewal:'تجديد ترخيص', accreditation:'اعتماد منظمة',
    accreditation_renewal:'تجديد اعتماد', observer:'قيد مراقب', level_upgrade:'ترقية مستوى' },
  auditType: { desk:'تدقيق مكتبي', field:'تدقيق ميداني', unannounced:'زيارة غير معلنة',
    market_test:'اختبار سوق', compliance_review:'مراجعة امتثال' },
  trigger: { sample:'عيّنة', mandatory:'إلزامي', complaint:'بلاغ', pilot_year:'المرحلة التجريبية',
    renewal:'تجديد', random:'عشوائي' },
  measure: { written_warning:'تنبيه كتابي', formal_notice:'إنذار رسمي', late_fine:'غرامة تأخير',
    grace_period:'إمهال', level_downgrade:'خفض المستوى', suspension:'تعليق', withdrawal:'سحب',
    cease_and_desist:'كفٌّ وامتناع', fine:'غرامة', legal_action:'دعوى قضائية' },
  severity: { info:'إفادة', minor:'بسيطة', major:'جسيمة', critical:'جوهرية' },
  feeType: { application:'رسم طلب', annual:'رسم سنوي', annual_prorated:'رسم سنوي بالتناسب',
    late_fine:'غرامة تأخير', unlicensed_fine:'غرامة استعمال غير مرخَّص', level_diff:'فرق مستوى' },
  material: { packaging:'عبوة', ad:'إعلان', website:'صفحة إلكترونية', social:'منشور تواصل',
    signage:'لوحة', vehicle:'مركبة', other:'أخرى' },
  decision: { grant:'منح', reject:'رفض', grant_lower_level:'منح بمستوى أدنى', approved:'موافقة',
    rejected:'رفض', changes_required:'تعديلات مطلوبة', implicit_approval:'موافقة ضمنية',
    upheld:'تأييد القرار', overturned:'إلغاء القرار', partially_upheld:'قبول جزئي' },
  basis: { percent:'النسبة هي الأعلى', floor:'الأرضية هي الأعلى' },
  basisType: { tax_return:'الإقرار الضريبي', audited_statements:'قوائم مالية مدققة',
    bank_statement_accountant:'كشف مصرفي + إقرار محاسب' },
  verification: { pending:'بانتظار التحقق', verified:'متحقَّق منه', rejected:'مرفوض', superseded:'مستبدَل' },
  criteria: { met:'مستوفى', not_met:'غير مستوفى', partial:'جزئي', na:'لا يسري' },
  entityKind: { public:'القطاع العام', private:'القطاع الخاص', civil:'المجتمع المدني',
    academic:'أكاديمي', media:'إعلام' },
  body: { board:'مجلس الأمناء', general_assembly:'الجمعية العمومية', standards:'لجنة المعايير',
    licensing:'لجنة منح الترخيص', appeals:'لجنة التظلمات', integrity:'لجنة حماية النزاهة' },
  channelKind: { cash:'نقدي', inkind:'عيني', volunteer:'تطوّع', direct_program:'برنامج ذاتي' },
  applicantKind: { business:'منشأة أعمال', craftsman:'حرفي', artist:'فنان', creative:'مبدع' },
  scopeType: { enterprise:'المنشأة كاملةً', brand:'علامة تجارية', product_line:'خط منتج' },
  outcome: { renew:'تجديد', suspend:'تعليق', withdraw:'سحب', downgrade:'خفض المستوى' },
  partnerClass: { none:'—', founding:'شريك مؤسس', working:'شريك عامل', honorary:'شريك فخري' },
};
const lb = (map, v) => (L[map] && L[map][v]) || v || '—';
const tone = (v) => L.tone[v] || '';
const tag = (v, map = 'status') => v == null ? '<span class="muted">—</span>'
  : `<span class="tag ${tone(v)} dot">${E(lb(map, v))}</span>`;
const lvlBadge = (level, name, color) => !level ? '—'
  : `<span class="lvl"><i style="background:${E(color || '#0B4533')}"></i>${E(name || 'المستوى ' + level)}</span>`;

// ---------- أيقونات ----------
const IC = {
  dash:'M3 13h8V3H3v10Zm10 8h8V11h-8v10ZM3 21h8v-6H3v6Zm10-12h8V3h-8v6Z',
  biz:'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
  org:'M12 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10ZM2 22a10 10 0 0 1 20 0',
  app:'M9 2h6l1 3h3v17H5V5h3l1-3Zm-1 9h8M8 15h8',
  doc:'M6 2h8l4 4v16H6V2Zm8 0v4h4M9 12h6M9 16h6',
  money:'M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  audit:'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm10 18-5.5-5.5',
  gavel:'M14 3l7 7-3 3-7-7 3-3ZM3 21h10M8 12l-5 5 3 3 5-5',
  scale:'M12 3v18M5 7h14M7 7l-4 7h8L7 7Zm10 0-4 7h8l-4-7Z',
  shield:'M12 2 4 5v7c0 5 3.5 8.5 8 10 4.5-1.5 8-5 8-10V5l-8-3Zm-2 10 2 2 4-4',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  chart:'M3 21h18M6 17V9M11 17V5M16 17v-6M21 17v-9',
  users:'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0m3-9a3 3 0 1 0 0-6m3 9a5 5 0 0 0-3-4.6',
  gear:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 4-2 .4-.6 1.5 1.2 1.7-1.4 1.4-1.7-1.2-1.5.6L14.7 20h-2l-.4-2-1.5-.6-1.7 1.2-1.4-1.4L8.9 15l-.6-1.5L6.3 13v-2l2-.4.6-1.5L7.7 7.4l1.4-1.4 1.7 1.2 1.5-.6L12.7 4h2l.4 2 1.5.6 1.7-1.2 1.4 1.4-1.2 1.7.6 1.5 2 .4v1.2Z',
  bell:'M12 3a6 6 0 0 0-6 6c0 5-2 6-2 6h16s-2-1-2-6a6 6 0 0 0-6-6ZM10 21a2 2 0 0 0 4 0',
  badge:'M12 2 9 5H5v4L2 12l3 3v4h4l3 3 3-3h4v-4l3-3-3-3V5h-4l-3-3Zm-2 10 2 2 4-4',
  flag:'M4 21V3h10l-1 3h7l-2 6 2 6H8v3H4Z',
  list:'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  paint:'M19 3H5a2 2 0 0 0-2 2v6a8 8 0 0 0 8 8h1v2h2v-2a4 4 0 0 0 4-4V5a2 2 0 0 0-2-2Z',
  out:'M15 3h4v18h-4M11 8l-4 4 4 4M7 12h9',
  search:'M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm10 18-5.5-5.5',
  mail:'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  cal:'M4 5h16v16H4V5Zm0 5h16M8 3v4M16 3v4',
  db:'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm-8 3v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  key:'M15 7a4 4 0 1 1-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0 1 15 7Z',
};
const ic = (n, cls = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
  stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[n] || IC.list}"/></svg>`;

const LOGO = `<svg viewBox="0 0 48 48" fill="none"><path d="M24 5 8 12v12c0 10 7 17 16 19 9-2 16-9 16-19V12L24 5Z"
  fill="#0B4533" stroke="#C38E29" stroke-width="2"/><path d="M15 24l6 6 12-13" stroke="#C38E29"
  stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ---------- إشعار عائم ----------
function toast(msg, kind = '') {
  let box = document.querySelector('.toast');
  if (!box) { box = document.createElement('div'); box.className = 'toast'; document.body.appendChild(box); }
  const d = document.createElement('div');
  d.className = kind; d.innerHTML = E(msg);
  box.appendChild(d);
  setTimeout(() => d.remove(), 6500);
}

// ---------- نافذة ----------
function modal({ title, body, actions = [], wide }) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" ${wide ? 'style="max-width:1000px"' : ''}>
    <div class="modal-hd"><h3>${E(title)}</h3><button class="btn sm" data-x>إغلاق</button></div>
    <div class="modal-bd">${body}</div>
    ${actions.length ? `<div class="modal-ft">${actions.map((a, i) =>
      `<button class="btn ${a.cls || ''}" data-a="${i}">${E(a.label)}</button>`).join('')}</div>` : ''}</div>`;
  document.body.appendChild(bg);
  const close = () => bg.remove();
  bg.querySelector('[data-x]').onclick = close;
  bg.onclick = (e) => { if (e.target === bg) close(); };
  actions.forEach((a, i) => { bg.querySelector(`[data-a="${i}"]`).onclick = () => a.run(bg, close); });
  return { el: bg, close };
}

// ---------- توجيه ----------
const ROUTES = {};
function route(name, render) { ROUTES[name] = render; }

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const seg = pathPart.split('/').filter(Boolean);
  const query = Object.fromEntries(new URLSearchParams(queryPart || ''));
  return { name: seg[0] || '', params: seg.slice(1), query };
}

let rendering = false;
async function render() {
  if (rendering) return; rendering = true;
  const r = parseHash();
  S.route = r;
  const fn = ROUTES[r.name] || ROUTES[''] || (() => '<div class="empty"><b>صفحة غير موجودة</b></div>');
  const app = document.getElementById('app');
  try {
    const html = await fn(r);
    if (typeof html === 'string') app.innerHTML = html;
  } catch (e) {
    console.error(e);
    const box = e.status === 403
      ? `<div class="alert warn"><div><b>لا تملك صلاحية الاطلاع على هذه الصفحة</b>${E(e.message)}
         <div style="margin-top:6px"><a href="#/dashboard">العودة إلى لوحة العمل</a></div></div></div>`
      : e.status === 404 ? `<div class="alert warn"><div><b>غير موجود</b>${E(e.message)}</div></div>`
      : `<div class="alert danger"><div><b>تعذّر العرض</b>${E(e.message)}</div></div>`;
    app.innerHTML = S.user && window.UI ? window.UI.shell(box, { title: '' }) : `<div class="main">${box}</div>`;
  }
  window.scrollTo(0, 0);
  rendering = false;
}
const go = (h) => { if (location.hash === '#/' + h) render(); else location.hash = '#/' + h; };
window.addEventListener('hashchange', render);

// ---------- جلسة ----------
function logout() {
  S.token = null; S.user = null; localStorage.removeItem('sema_token');
  location.hash = '#/login'; render();
}
async function boot() {
  S.ref = await api('/public/reference').catch(() => null);
  if (S.token) {
    try {
      S.user = await api('/auth/me');
      S.rbac = await api('/rbac').catch(() => null);
      S.notif = await api('/notifications').catch(() => ({ rows: [], unread: 0 }));
      S.msgs = await api('/threads/unread').catch(() => ({ unread: 0, awaiting: 0 }));
    } catch { S.token = null; localStorage.removeItem('sema_token'); }
  }
  if (!location.hash) location.hash = S.user ? '#/dashboard' : '#/';
  if (S.user && (S.user.mfa_enroll_required || S.user.must_reset)) location.hash = '#/profile';
  render();
}
window.SEMA = { S, api, qs, E, A, num, num2, money, pct, dt, yr, today, days, has, hasRole, kfmt, L, lb, tone, tag,
  lvlBadge, ic, IC, LOGO, toast, modal, route, render, go, logout, boot };
