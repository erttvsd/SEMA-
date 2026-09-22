'use strict';
/** يولّد ملفات الإثباتات التصويرية (HTML قابلة للعرض والطباعة) */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const G = '#0B4533', GOLD = '#C38E29';

function page({ title, subtitle, issuer, refNo, date, rows = [], body = '', stamp = 'نسخة تصويرية للعرض' }) {
  const tbl = rows.length ? `<table>${rows.map(([k, v]) =>
    `<tr><th>${esc(k)}</th><td>${v == null ? '—' : esc(String(v))}</td></tr>`).join('')}</table>` : '';
  return `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
 @page{size:A4;margin:18mm}
 body{font-family:"Noto Naskh Arabic","Amiri","Times New Roman",serif;color:#1A1A1A;line-height:1.9;
      max-width:800px;margin:24px auto;padding:0 20px;background:#fff}
 .hd{border-bottom:3px double ${G};padding-bottom:14px;margin-bottom:22px;display:flex;
     justify-content:space-between;align-items:flex-start;gap:16px}
 .brand{font-size:13px;color:${G};font-weight:700;letter-spacing:.3px}
 .brand small{display:block;font-weight:400;color:#5A6472;font-size:11px;margin-top:3px}
 h1{font-size:21px;margin:0 0 4px;color:${G}}
 .sub{color:#5A6472;font-size:13px;margin:0}
 .meta{font-size:11.5px;color:#5A6472;text-align:left;white-space:nowrap}
 .meta b{color:${G}}
 table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13.5px}
 th,td{border:1px solid #D9E4DE;padding:8px 11px;text-align:right;vertical-align:top}
 th{background:#EDF3EF;width:38%;font-weight:700;color:${G}}
 .body{font-size:14px;margin:18px 0}
 .body ol,.body ul{padding-right:22px}
 .sig{margin-top:38px;display:flex;justify-content:space-between;gap:30px;font-size:12.5px}
 .sig div{flex:1;border-top:1px solid #9AA8A0;padding-top:8px;text-align:center;color:#5A6472}
 .stamp{margin-top:26px;border:2px dashed ${GOLD};color:${GOLD};padding:9px 14px;font-size:12px;
        border-radius:6px;display:inline-block}
 .ft{margin-top:26px;border-top:1px solid #D9E4DE;padding-top:10px;font-size:10.5px;color:#7A8880}
</style>
<div class="hd">
  <div>
    <div class="brand">علامة «سِيمَا الخَيْر»<small>العلامة الوطنية الليبية للمساهمة في الأعمال الخيرية والإنسانية والتنموية</small></div>
    <h1>${esc(title)}</h1>${subtitle ? `<p class="sub">${esc(subtitle)}</p>` : ''}
  </div>
  <div class="meta"><b>المرجع</b> ${esc(refNo || '—')}<br><b>التاريخ</b> ${esc(date || '—')}<br><b>الجهة</b> ${esc(issuer || 'الأمانة')}</div>
</div>
${tbl}
${body ? `<div class="body">${body}</div>` : ''}
<div class="sig"><div>توقيع مقدّم المستند</div><div>ختم الجهة</div><div>تصديق وحدة التقييم والتحقق</div></div>
<div class="stamp">${esc(stamp)}</div>
<div class="ft">تَعْرِفُهُم بِسِيمَاهُم · هذا المستند مُقيَّد في نظام إدارة العلامة ومرتبط ببصمة SHA-256 يتحقق منها النظام آلياً.</div>
</html>`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function write(dir, html) {
  const name = Date.now().toString(36) + '-' + crypto.randomBytes(5).toString('hex') + '.html';
  const p = path.join(dir, name);
  fs.writeFileSync(p, html, 'utf8');
  const buf = Buffer.from(html, 'utf8');
  return { stored_name: name, size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex'),
           mime: 'text/html; charset=utf-8', pages: Math.max(1, Math.ceil(buf.length / 3200)) };
}

module.exports = { page, write };
