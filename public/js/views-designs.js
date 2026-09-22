(function(){
'use strict';
/* ===== الموافقة المسبقة على التصاميم (المادة 19) ===== */
const { S, api, E, num, dt, yr, today, L, lb, tag, route, go, has } = window.SEMA;
const { shell, dataTable, stat, alertBox, legal } = window.UI;
const mount = (fn) => setTimeout(fn, 0);

route('designs', async () => {
  if (!S.user) { location.hash = '#/login'; return ''; }
  const html = shell('<div id="t"></div>', { title: 'الموافقة المسبقة على التصاميم',
    sub: 'المادة (19): تُرسل النسخة الرقمية من كل عبوة أو مادة إعلانية أو صفحة تحمل العلامة قبل الإنتاج — والرد خلال عشرة أيام عمل، وعدم الرد موافقة ضمنية',
    actions: has('design.submit') ? '<button class="btn primary" onclick="APP.newDesign()">طلب موافقة على تصميم</button>' : '' });
  mount(() => dataTable(document.getElementById('t'), {
    path: '/designs',
    filters: [
      { k: 'q', t: 'بحث', type: 'text', wide: true },
      { k: 'material_type', t: 'نوع المادة', type: 'select', opts: Object.entries(L.material) },
      { k: 'status', t: 'الحالة', type: 'select', opts: [['pending','قيد النظر'],['decided','مفصول فيه'],['expired_implicit','موافقة ضمنية']] },
      { k: 'decision', t: 'القرار', type: 'select', opts: [['approved','موافقة'],['changes_required','تعديلات مطلوبة'],['rejected','رفض']] },
      { k: 'due_before', t: 'الموعد قبل', type: 'date' },
    ],
    cols: [
      { t: 'المرجع', r: (r) => `<span class="mono">${E(r.reference)}</span>` },
      { t: 'المنشأة', r: (r) => `<a href="#/licensees/${r.licensee_id}">${E(r.legal_name)}</a>
        <div class="muted mono">${E(r.license_no || '')} · م${num(r.level)}</div>` },
      { t: 'المادة', r: (r) => `<span class="tag">${E(lb('material', r.material_type))}</span>
        <div>${E(r.title)}</div>` },
      { t: 'نسخة الشعار', r: (r) => r.logo_variant === 'compact'
        ? '<span class="tag">مختصرة — تحت 40 مم</span>' : '<span class="tag">كاملة — فوق 40 مم</span>' },
      { t: 'رقم الترخيص', r: (r) => r.shows_license_no
        ? '<span class="tag ok">ظاهر</span>' : '<span class="tag danger">غائب — مخالفة (المادة 35/3)</span>' },
      { t: 'الادعاء المكتوب', r: (r) => `<div class="muted" style="white-space:normal;max-width:340px">${E(r.claim_text || '—')}</div>` },
      { t: 'التقديم', srt: 'submitted_at', r: (r) => dt(r.submitted_at) },
      { t: 'الموعد (10 أيام عمل)', srt: 'due_at', r: (r) => r.status === 'pending' && r.due_at < today()
        ? `<span class="tag info">${dt(r.due_at)} — انقضى</span>` : dt(r.due_at) },
      { t: 'القرار', r: (r) => `${r.decision ? tag(r.decision, 'decision')
        : (r.implicit_approval || r.status === 'expired_implicit' ? '<span class="tag info">موافقة ضمنية</span>' : tag('pending'))}
        ${r.decision_notes ? `<div class="muted" style="white-space:normal;max-width:340px">${E(r.decision_notes)}</div>` : ''}
        ${r.note ? `<div class="muted" style="white-space:normal;max-width:340px">${E(r.note)}</div>` : ''}` },
      ...(has('design.decide') ? [{ t: '', r: (r) => r.status === 'pending'
        ? `<button class="btn sm primary" onclick="event.stopPropagation();APP.decideDesign(${r.id})">البتّ</button>` : '' }] : []),
    ],
    summary: (d) => `<div class="grid g4" style="padding:12px 16px 0">
      ${stat('النتائج', num(d.total))}
      ${stat('قيد النظر', num(d.rows.filter((r) => r.status === 'pending').length))}
      ${stat('موافقة ضمنية', num(d.rows.filter((r) => r.implicit_approval || r.status === 'expired_implicit').length),
        'انقضت عشرة أيام عمل دون رد', 'warn')}
      ${stat('تعديلات مطلوبة', num(d.rows.filter((r) => r.decision === 'changes_required').length), '', 'danger')}</div>`,
  }));
  return html;
});

})();
