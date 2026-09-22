const fs = require('fs');
const { ROLES, PERMISSIONS, PERMISSION_GROUPS, SOD_FUNCTIONS } = require('../server/rbac');
const sod = Object.fromEntries(SOD_FUNCTIONS);
const cat = { governance: 'حوكمة', executive: 'تنفيذي', external: 'خارجي' };
const scope = { global: 'عام', licensee: 'ملف مرخَّص له', association: 'ملف منظمة' };

let out = `# مصفوفة الأدوار والصلاحيات

> هذا الملف **مُولَّد آلياً** من \`server/rbac.js\` — وهو مصدر الحقيقة الوحيد للصلاحيات في النظام.
> لتحديثه بعد أي تعديل: \`npm run docs\`

## قاعدة الفصل الوظيفي (المادة 18 من النظام الداخلي)

تقوم إدارة العلامة على فصلٍ إلزاميٍّ بين أربع وظائف، **لا يجوز أن يجمع شخصٌ واحدٌ بين اثنتين منها**.
والنظام يرفض آلياً أي تعيين يخالف ذلك (\`sodConflict\` في \`server/rbac.js\`)، ويُفحص الرفض في
اختبارات القبول. والأصل في هذا الفصل هو المواصفة ISO/IEC 17065 التي توجب أن يتخذ قرار منح الشهادة
شخصٌ مستقل عمّن نفّذ التقييم.

| الوظيفة | الأدوار المنتمية إليها |
|---|---|
${SOD_FUNCTIONS.map(([c, n]) =>
  `| **${n}** | ${ROLES.filter((r) => r.sod === c).map((r) => r.name_ar).join(' · ') || '—'} |`).join('\n')}

الأدوار التي لا تنتمي لأي وظيفة محجوزة (مجلس الأمناء، المدير التنفيذي، وحدات الأمانة، الشركاء،
المنظمات، المراقبون) يجوز الجمع بينها وبين غيرها، لأنها لا تملك قراراً في أي من الوظائف الأربع.

## الأدوار (${ROLES.length})

| الدور | الفئة | الوظيفة المحجوزة | النطاق | الصلاحيات | الأساس النظامي |
|---|---|---|---|---|---|
${ROLES.map((r) => `| **${r.name_ar}**<br>\`${r.code}\` | ${cat[r.category]} | ${r.sod ? sod[r.sod] : '—'} | ${scope[r.scope_kind || 'global']} | ${r.perms.length} | ${r.description.replace(/\|/g, '/')} |`).join('\n')}

## الصلاحيات (${PERMISSIONS.length}) والأدوار المانحة لها

`;
const byGrp = {};
for (const [code, name, grp] of PERMISSIONS) { (byGrp[grp] = byGrp[grp] || []).push([code, name]); }
for (const [grp, items] of Object.entries(byGrp)) {
  out += `### ${PERMISSION_GROUPS[grp] || grp}\n\n| الصلاحية | الرمز | الأدوار المانحة |\n|---|---|---|\n`;
  for (const [code, name] of items)
    out += `| ${name} | \`${code}\` | ${ROLES.filter((r) => r.perms.includes(code)).map((r) => r.name_ar).join(' · ') || '—'} |\n`;
  out += '\n';
}

out += `## مصفوفة القرارات (ملحق النظام الداخلي)

\`م\` يملك القرار · \`ت\` ينفّذ · \`ي\` يُستشار · \`خ\` يُخطَر · \`✕\` محظور عليه · \`—\` لا علاقة

`;
const { DECISION_MATRIX } = require('../server/seed');
out += `| القرار | ${DECISION_MATRIX.bodies.join(' | ')} |\n|${'---|'.repeat(DECISION_MATRIX.bodies.length + 1)}\n`;
for (const r of DECISION_MATRIX.rows) out += `| ${r[0]} | ${r.slice(1).join(' | ')} |\n`;

out += `
هذه المصفوفة مُخزَّنة في إعداد \`decision_matrix\` وتُعرض في الواجهة على المسار \`#/rbac\`.
وهي مرجع تفسيري: الإنفاذ الفعلي يجري عبر الصلاحيات المُعدَّدة أعلاه وعبر فحوص القواعد في
\`server/routes/*.js\` (مثل رفض قرار الترخيص قبل ورود تقرير الوقائع، ورفض التقرير الذي يحتوي توصية).
`;
fs.writeFileSync(require('path').join(__dirname, '..', 'docs', '02-مصفوفة-الصلاحيات.md'), out);
console.log('docs/02 written:', out.split('\n').length, 'lines');
