'use strict';
/**
 * بنّاء استعلامات مع فلترة وترتيب وترقيم صفحات — يخدم كل الجداول في الواجهة.
 * الفلاتر تُمرَّر كمعاملات استعلام: ?status=active&level=3&q=نص&from=2026-01-01&sort=-created_at&page=2
 */
function buildList(db, { table, columns, filters = {}, search = [], allowSort = [], defaultSort, req, extraWhere = [], params = [] }) {
  const where = [...extraWhere];
  const p = [...params];

  for (const [key, spec] of Object.entries(filters)) {
    const raw = req.query[key];
    if (raw === undefined || raw === '' || raw === null) continue;
    const col = spec.col || key;
    if (spec.op === 'in') {
      const vals = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
      if (!vals.length) continue;
      where.push(`${col} IN (${vals.map(() => '?').join(',')})`);
      p.push(...vals);
    } else if (spec.op === 'gte') { where.push(`${col} >= ?`); p.push(spec.num ? Number(raw) : raw); }
    else if (spec.op === 'lte') { where.push(`${col} <= ?`); p.push(spec.num ? Number(raw) : raw); }
    else if (spec.op === 'like') { where.push(`${col} LIKE ?`); p.push('%' + raw + '%'); }
    else if (spec.op === 'bool') { where.push(`${col} = ?`); p.push(raw === 'true' || raw === '1' ? 1 : 0); }
    else { where.push(`${col} = ?`); p.push(spec.num ? Number(raw) : raw); }
  }

  const q = (req.query.q || '').trim();
  if (q && search.length) {
    where.push('(' + search.map((c) => `${c} LIKE ?`).join(' OR ') + ')');
    search.forEach(() => p.push('%' + q + '%'));
  }

  let sort = defaultSort || '';
  const reqSort = req.query.sort;
  if (reqSort) {
    const desc = reqSort.startsWith('-');
    const col = desc ? reqSort.slice(1) : reqSort;
    if (allowSort.includes(col)) sort = `${col} ${desc ? 'DESC' : 'ASC'}`;
  }

  const perPage = Math.min(200, Math.max(1, Number(req.query.per_page) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM ${table} ${whereSql}`).get(...p).n;
  const rows = db.prepare(
    `SELECT ${columns} FROM ${table} ${whereSql} ${sort ? 'ORDER BY ' + sort : ''} LIMIT ? OFFSET ?`
  ).all(...p, perPage, (page - 1) * perPage);

  return { rows, total, page, per_page: perPage, pages: Math.max(1, Math.ceil(total / perPage)),
           applied_filters: Object.fromEntries(Object.entries(req.query).filter(([k, v]) => v !== '' && !['page','per_page','sort','token'].includes(k))) };
}
module.exports = { buildList };
