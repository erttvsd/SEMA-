'use strict';
/**
 * مقترحات تعديل المعايير والرسوم والمشاورة العامة.
 * المادة (19/3): تعرض لجنة المعايير كل تعديل جوهري على مشاورة عامة لا تقل عن ثلاثين يوماً
 * قبل رفعه للمجلس، وتنشر ملخص المداخلات وردودها عليها.
 * المادة (5): يُنشر تعديل الأرضيات قبل بدء السنة المالية التالية بستين يوماً على الأقل.
 * المادة (35): تعديل النظام الداخلي من اختصاص الجمعية العمومية بأغلبية الثلثين.
 */
const express = require('express');
const { db } = require('../db');
const { can, requireAuth, hasPerm, log } = require('../auth');
const { buildList } = require('../query');
const R = require('../rules');
const S = require('../services');

const r = express.Router();
const today = () => new Date().toISOString().slice(0, 10);
const get = (id) => db.prepare('SELECT * FROM standards_proposals WHERE id=?').get(Number(id));
const KINDS = ['standard', 'fees', 'floors', 'bylaws', 'interpretation'];

r.get('/proposals', requireAuth, can('standards.propose', 'standards.approve', 'report.view', 'gov.bylaws.amend'), (req, res) => {
  const out = buildList(db, {
    table: `standards_proposals p LEFT JOIN users u ON u.id=p.proposed_by`,
    columns: `p.*, u.full_name proposed_by_name,
      (SELECT COUNT(*) FROM consultation_comments c WHERE c.proposal_id=p.id) comments_count,
      (SELECT COUNT(*) FROM consultation_comments c WHERE c.proposal_id=p.id AND c.response IS NULL) unanswered`,
    filters: { status: { op: 'in', col: 'p.status' }, kind: { op: 'in', col: 'p.kind' } },
    search: ['p.title', 'p.summary', 'p.reference', 'p.article_ref'],
    allowSort: ['created_at', 'consultation_end', 'status'], defaultSort: 'p.created_at DESC', req,
  });
  res.json(out);
});

r.get('/proposals/:id', requireAuth, can('standards.propose', 'standards.approve', 'report.view', 'gov.bylaws.amend'), (req, res) => {
  const p = db.prepare(`SELECT p.*, u.full_name proposed_by_name, b.full_name board_decided_by_name
      FROM standards_proposals p LEFT JOIN users u ON u.id=p.proposed_by LEFT JOIN users b ON b.id=p.board_decided_by
      WHERE p.id=?`).get(Number(req.params.id));
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  p.comments = db.prepare(`SELECT c.*, u.full_name responded_by_name FROM consultation_comments c
      LEFT JOIN users u ON u.id=c.responded_by WHERE c.proposal_id=? ORDER BY c.submitted_at`).all(p.id);
  p.days_left = p.status === 'consultation' ? Math.max(0, R.daysBetween(today(), p.consultation_end)) : null;
  res.json(p);
});

r.post('/proposals', requireAuth, can('standards.propose'), (req, res) => {
  const { title, summary, body, article_ref, kind = 'standard', is_material = true } = req.body;
  if (!title || !summary || !body) return res.status(400).json({ error: 'العنوان والملخص والنص مطلوبة' });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'نوع المقترح غير صالح' });
  const id = db.prepare(`INSERT INTO standards_proposals (reference, title, summary, body, article_ref, kind, is_material, proposed_by)
      VALUES (?,?,?,?,?,?,?,?)`).run(S.nextRef('STD', 'standards_proposals'), title, summary, body, article_ref || null,
    kind, is_material ? 1 : 0, req.user.id).lastInsertRowid;
  log(req, 'proposal.create', 'proposal', id, title);
  res.status(201).json(get(id));
});

r.post('/proposals/:id/open-consultation', requireAuth, can('standards.propose'), (req, res) => {
  const p = get(req.params.id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  if (p.status !== 'draft') return res.status(409).json({ error: 'المشاورة تُفتح للمسوّدة فقط' });
  const days = Number(req.body.days || 30);
  if (p.is_material && days < 30) return res.status(422).json({ error: 'التعديل الجوهري يلزمه مشاورة عامة لا تقل عن ثلاثين يوماً (المادة 19/3)' });
  if (days < 7 || days > 120) return res.status(422).json({ error: 'مدة المشاورة بين 7 و120 يوماً' });
  db.prepare(`UPDATE standards_proposals SET status='consultation', consultation_start=date('now'), consultation_end=? WHERE id=?`)
    .run(R.addDays(today(), days), p.id);
  log(req, 'proposal.consult', 'proposal', p.id, `فتح مشاورة ${days} يوماً`);
  res.json(get(p.id));
});

r.post('/proposals/:id/comments/:cid/respond', requireAuth, can('standards.propose'), (req, res) => {
  const c = db.prepare('SELECT * FROM consultation_comments WHERE id=? AND proposal_id=?').get(Number(req.params.cid), Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'غير موجود' });
  if (!req.body.response || req.body.response.trim().length < 5) return res.status(422).json({ error: 'نص الرد مطلوب' });
  db.prepare(`UPDATE consultation_comments SET response=?, responded_by=?, responded_at=datetime('now') WHERE id=?`)
    .run(req.body.response, req.user.id, c.id);
  log(req, 'proposal.respond', 'proposal', c.proposal_id, 'رد على مداخلة');
  res.json(db.prepare('SELECT * FROM consultation_comments WHERE id=?').get(c.id));
});

r.post('/proposals/:id/close-consultation', requireAuth, can('standards.propose'), (req, res) => {
  const p = get(req.params.id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  if (p.status !== 'consultation') return res.status(409).json({ error: 'المقترح ليس في مشاورة' });
  if (today() < p.consultation_end) return res.status(422).json({ error: `لا تُغلق المشاورة قبل ${p.consultation_end}` });
  if (!req.body.response_summary || req.body.response_summary.trim().length < 10)
    return res.status(422).json({ error: 'ملخص المداخلات وردود اللجنة عليها مطلوب ويُنشر (المادة 19/3)' });
  db.prepare(`UPDATE standards_proposals SET status='consultation_closed', response_summary=? WHERE id=?`).run(req.body.response_summary, p.id);
  log(req, 'proposal.close', 'proposal', p.id, 'إغلاق المشاورة');
  res.json(get(p.id));
});

r.post('/proposals/:id/submit', requireAuth, can('standards.propose'), (req, res) => {
  const p = get(req.params.id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  const ok = p.is_material ? p.status === 'consultation_closed' : ['draft', 'consultation_closed'].includes(p.status);
  if (!ok) return res.status(422).json({ error: p.is_material ? 'التعديل الجوهري لا يُرفع للمجلس قبل إتمام المشاورة العامة وإغلاقها (المادة 19/3)' : 'حالة المقترح لا تسمح بالرفع' });
  const un = db.prepare('SELECT COUNT(*) n FROM consultation_comments WHERE proposal_id=? AND response IS NULL').get(p.id).n;
  if (un) return res.status(422).json({ error: `${un} مداخلة بلا رد — تنشر اللجنة ردودها على المداخلات (المادة 19/3)` });
  db.prepare("UPDATE standards_proposals SET status='submitted_to_board' WHERE id=?").run(p.id);
  S.notify({ role_code: p.kind === 'bylaws' ? 'GENERAL_ASSEMBLY' : 'BOARD_CHAIR', title: 'مقترح تعديل بانتظار القرار',
    body: `${p.reference} — ${p.title}`, link: `#/proposals/${p.id}` });
  log(req, 'proposal.submit', 'proposal', p.id, 'رفع للمجلس');
  res.json(get(p.id));
});

r.post('/proposals/:id/decide', requireAuth, (req, res) => {
  const p = get(req.params.id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  // تعديل النظام الداخلي للجمعية العمومية، وما عداه لمجلس الأمناء (المادة 14 و35 ومصفوفة الصلاحيات)
  const perm = p.kind === 'bylaws' ? 'gov.bylaws.amend' : 'standards.approve';
  if (!hasPerm(req.user, perm)) return res.status(403).json({ error: p.kind === 'bylaws'
    ? 'تعديل النظام الداخلي من اختصاص الجمعية العمومية (المادة 35)' : 'الاعتماد من اختصاص مجلس الأمناء (المادة 14)' });
  if (p.status !== 'submitted_to_board') return res.status(409).json({ error: 'المقترح لم يُرفع للقرار' });
  const { decision, reason, effective_from } = req.body;
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'قرار غير صالح' });
  if (!reason || reason.trim().length < 10) return res.status(422).json({ error: 'التسبيب مطلوب' });
  if (decision === 'approved') {
    if (!effective_from) return res.status(422).json({ error: 'تاريخ النفاذ مطلوب' });
    if (['fees', 'floors'].includes(p.kind) && R.daysBetween(today(), effective_from) < 60)
      return res.status(422).json({ error: 'تعديل الرسوم والأرضيات يُنشر قبل بدء السنة المالية التالية بستين يوماً على الأقل (المادة 5)' });
  }
  db.prepare(`UPDATE standards_proposals SET status=?, board_decision=?, board_decision_reason=?, board_decided_by=?,
      board_decided_at=datetime('now'), effective_from=? WHERE id=?`)
    .run(decision, decision, reason, req.user.id, decision === 'approved' ? effective_from : null, p.id);
  log(req, 'proposal.decide', 'proposal', p.id, `${decision}: ${reason.slice(0, 100)}`);
  res.json(get(p.id));
});

// ---------- المشاورة العامة — بلا تسجيل دخول ----------
r.get('/public/consultations', (_req, res) => {
  const rows = db.prepare(`SELECT id, reference, title, summary, body, article_ref, kind, status, consultation_start,
      consultation_end, response_summary, board_decision, effective_from,
      (SELECT COUNT(*) FROM consultation_comments c WHERE c.proposal_id=p.id AND c.is_published=1) comments_count
      FROM standards_proposals p WHERE status != 'draft' AND status != 'withdrawn' ORDER BY consultation_start DESC`).all();
  for (const x of rows) {
    x.open = x.status === 'consultation' && today() <= x.consultation_end;
    x.days_left = x.open ? R.daysBetween(today(), x.consultation_end) : null;
    x.comments = db.prepare(`SELECT author_name, author_kind, organization, body, submitted_at, response, responded_at
        FROM consultation_comments WHERE proposal_id=? AND is_published=1 ORDER BY submitted_at`).all(x.id);
  }
  res.json({ rows, note: 'تعرض لجنة المعايير كل تعديل جوهري على مشاورة عامة لا تقل عن ثلاثين يوماً، وتنشر ملخص المداخلات وردودها عليها (المادة 19/3).' });
});

r.post('/public/consultations/:id/comments', (req, res) => {
  const p = get(req.params.id);
  if (!p) return res.status(404).json({ error: 'غير موجود' });
  if (p.status !== 'consultation' || today() > p.consultation_end)
    return res.status(422).json({ error: 'المشاورة على هذا المقترح غير مفتوحة' });
  const { author_name, author_kind, organization, body } = req.body;
  if (!author_name || !body || String(body).trim().length < 15) return res.status(400).json({ error: 'الاسم ونص المداخلة (15 حرفاً على الأقل) مطلوبان' });
  if (String(body).length > 4000) return res.status(400).json({ error: 'نص المداخلة طويل جداً' });
  const kinds = ['licensee', 'association', 'public', 'expert', 'government'];
  const id = db.prepare(`INSERT INTO consultation_comments (proposal_id, author_name, author_kind, organization, body)
      VALUES (?,?,?,?,?)`).run(p.id, String(author_name).slice(0, 120), kinds.includes(author_kind) ? author_kind : 'public',
    organization ? String(organization).slice(0, 160) : null, body).lastInsertRowid;
  S.notify({ role_code: 'STANDARDS_COMMITTEE', title: 'مداخلة جديدة في المشاورة العامة', body: `${p.reference} — ${author_name}`, link: `#/proposals/${p.id}` });
  res.status(201).json({ id, note: 'سُجّلت مداخلتكم وستُنشر مع رد اللجنة عليها.' });
});

module.exports = r;
