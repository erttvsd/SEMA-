'use strict';
/**
 * المهام الآلية — كل موعد نظامي يُنفَّذ بنفسه لا بتذكّر أحد:
 *  - التعليق يتحول تلقائياً إلى سحب بعد ستة أشهر (المادة 30/2)
 *  - انتهاء الترخيص بانقضاء مدته دون تجديد (المادة 18/1)
 *  - انقضاء حق استعمال الشعار بانقضاء مهلة الإقرار (المادة 18/3) — بعد مهلة الثلاثين يوماً للتأخر (المادة 29/1)
 *  - انتهاء الاعتماد بانقضاء مدته (المادة 16)
 *  - الموافقة الضمنية على التصاميم بعد عشرة أيام عمل (المادة 19/2)
 *  - حفظ الطلب إن لم تُستكمل النواقص خلال عشرين يوم عمل (المادة 17/3)
 *  - الفواتير المتأخرة، وانقضاء مدة نشر الجزاءات (المادة 31/1)
 *  - تصعيد ملاحظات النزاهة التي انقضت مهلة الرد عليها (المادة 23/3)
 *  - التذكير بالمواعيد القريبة
 */
const { db } = require('./db');
const R = require('./rules');
const S = require('./services');

const today = () => new Date().toISOString().slice(0, 10);

const JOBS = {
  suspension_escalation: {
    title: 'تحويل التعليق إلى سحب بعد ستة أشهر',
    article: 'المادة 30/2',
    run() {
      // التظلم لا يوقف التصعيد إلا إذا قررت لجنة التظلمات وقف التنفيذ صراحةً (المادة 22/4)
      const rows = db.prepare(`SELECT * FROM sanctions s WHERE measure='suspension' AND status IN ('active','appealed')
          AND auto_escalate_to='withdrawal' AND effective_to < date('now')
          AND NOT EXISTS (SELECT 1 FROM appeals a WHERE a.sanction_id=s.id AND a.stay_of_execution=1 AND a.status!='decided')`).all();
      for (const s of rows) {
        const w = S.createSanction(null, { subject_kind: s.subject_kind, subject_id: s.subject_id, subject_name: s.subject_name,
          violation_code: s.violation_code, measure: 'withdrawal',
          reason: `تحوّل تلقائي من التعليق (${s.case_no}) إلى السحب: انقضت ستة أشهر دون زوال أسبابه (المادة 30/2).` });
        db.prepare("UPDATE sanctions SET status='escalated' WHERE id=?").run(s.id);
        void w;
      }
      return rows.length;
    },
  },
  license_expiry: {
    title: 'انتهاء التراخيص المنقضية مدتها',
    article: 'المادة 18/1',
    run() {
      const rows = db.prepare(`SELECT id FROM licensees WHERE status='active' AND end_date < date('now')
          AND id NOT IN (SELECT subject_id FROM applications WHERE subject_kind='licensee' AND app_type='license_renewal'
            AND status NOT IN ('approved','rejected','shelved','withdrawn'))`).all();
      const st = db.prepare("UPDATE licensees SET status='expired', status_reason=? WHERE id=?");
      for (const r of rows) {
        st.run('انقضت مدة الترخيص دون تجديد — المصنَّف «عدم طلب التجديد» (المادة 37/3)', r.id);
        const u = S.ownerOf('licensee', r.id);
        if (u) S.notify({ user_id: u, severity: 'danger', title: 'انتهى ترخيصكم', body: 'يلزم وقف كل استعمال للعلامة خلال ثلاثين يوماً (المادة 8/2)', link: '#/my-licensee' });
      }
      return rows.length;
    },
  },
  declaration_lapse: {
    title: 'انقضاء حق الاستعمال لعدم تقديم الإقرار',
    article: 'المادة 18/3 مع 29/1',
    run() {
      // المادة 29/1 تعالج التأخر دون ثلاثين يوماً بالتنبيه والغرامة؛ فما جاوزها دون تقديم يُسقط الحق تلقائياً
      const late = db.prepare(`UPDATE compliance_declarations SET status='late'
          WHERE submitted_at IS NULL AND status='pending' AND due_at < date('now')`).run().changes;
      const rows = db.prepare(`SELECT cd.licensee_id FROM compliance_declarations cd JOIN licensees l ON l.id=cd.licensee_id
          WHERE cd.submitted_at IS NULL AND date(cd.due_at, '+30 day') < date('now') AND l.status='active'`).all();
      for (const r of rows) {
        db.prepare("UPDATE licensees SET status='expired', status_reason=? WHERE id=?")
          .run('انقضى حق استعمال الشعار تلقائياً لعدم تقديم إقرار الامتثال (المادة 18/3)', r.licensee_id);
        const u = S.ownerOf('licensee', r.licensee_id);
        if (u) S.notify({ user_id: u, severity: 'danger', title: 'انقضى حق استعمال الشعار',
          body: 'لم يُقدَّم إقرار الامتثال خلال المهلة — ينقضي الحق دون حاجة إلى قرار تأديبي (المادة 18/3)', link: '#/commitments' });
      }
      return late + rows.length;
    },
  },
  accreditation_expiry: {
    title: 'انتهاء الاعتمادات المنقضية مدتها',
    article: 'المادة 16',
    run() {
      const rows = db.prepare(`SELECT id FROM associations WHERE status='accredited' AND accredited_to < date('now')
          AND id NOT IN (SELECT subject_id FROM applications WHERE subject_kind='association' AND app_type='accreditation_renewal'
            AND status NOT IN ('approved','rejected','shelved','withdrawn'))`).all();
      for (const r of rows) db.prepare("UPDATE associations SET status='expired', status_reason=? WHERE id=?")
        .run('انتهى الاعتماد تلقائياً بانقضاء مدته دون تقديم طلب تجديد (المادة 16)', r.id);
      return rows.length;
    },
  },
  design_implicit_approval: {
    title: 'الموافقة الضمنية على التصاميم',
    article: 'المادة 19/2',
    run() {
      return db.prepare(`UPDATE design_approvals SET status='expired_implicit', decision='implicit_approval',
          decided_at=datetime('now'), decision_notes='انقضت عشرة أيام عمل دون رد — موافقة ضمنية (المادة 19/2)'
          WHERE status='pending' AND due_at < date('now')`).run().changes;
    },
  },
  application_shelving: {
    title: 'حفظ الطلبات التي لم تُستكمل نواقصها',
    article: 'المادة 17/3',
    run() {
      const rows = db.prepare("SELECT id, completeness_done_at, applicant_user_id, reference FROM applications WHERE status='deficiencies'").all();
      let n = 0;
      for (const a of rows) {
        if (!a.completeness_done_at || R.addWorkDays(String(a.completeness_done_at).slice(0, 10), 20) >= today()) continue;
        db.prepare("UPDATE applications SET status='shelved' WHERE id=?").run(a.id);
        S.notify({ user_id: a.applicant_user_id, severity: 'danger', title: 'حُفظ طلبك',
          body: `${a.reference}: انقضت عشرون يوم عمل دون استكمال النواقص (المادة 17/3)`, link: `#/applications/${a.id}` });
        n++;
      }
      return n;
    },
  },
  invoices_overdue: {
    title: 'رصد الرسوم المتأخرة',
    article: 'المادة 34',
    run() {
      return db.prepare("UPDATE invoices SET status='overdue' WHERE status='issued' AND due_at < date('now')").run().changes;
    },
  },
  publication_expiry: {
    title: 'انقضاء مدة نشر الجزاءات',
    article: 'المادة 31/1',
    run() {
      return db.prepare(`UPDATE sanctions SET published=0 WHERE published=1 AND publish_until IS NOT NULL
          AND publish_until < date('now')`).run().changes;
    },
  },
  integrity_escalation: {
    title: 'تصعيد ملاحظات النزاهة المنقضية مهلتها',
    article: 'المادة 23/3',
    run() {
      const rows = db.prepare("SELECT id, reference FROM integrity_notes WHERE status='open' AND response_due_at < date('now')").all();
      for (const n of rows) {
        db.prepare("UPDATE integrity_notes SET status='escalated' WHERE id=?").run(n.id);
        S.notify({ role_code: 'INTEGRITY_COMMITTEE', severity: 'danger', title: 'انقضت مهلة رد المجلس على ملاحظة نزاهة',
          body: `${n.reference} — للجنة النشر العلني الآن (المادة 23/3)`, link: '#/integrity' });
      }
      return rows.length;
    },
  },
  deadline_reminders: {
    title: 'التذكير بالمواعيد القريبة',
    article: 'المواد 18 و23 و16',
    run() {
      let n = 0;
      const once = (user_id, title, body, link) => {
        const dup = db.prepare(`SELECT 1 FROM notifications WHERE user_id=? AND title=? AND created_at > datetime('now','-7 day')`).get(user_id, title);
        if (!dup && user_id) { S.notify({ user_id, severity: 'warning', title, body, link }); n++; }
      };
      for (const d of db.prepare(`SELECT licensee_id, fiscal_year, due_at FROM compliance_declarations
          WHERE submitted_at IS NULL AND due_at BETWEEN date('now') AND date('now','+30 day')`).all())
        once(S.ownerOf('licensee', d.licensee_id), `اقترب موعد إقرار الامتثال ${d.fiscal_year}`, `الموعد الأقصى ${d.due_at} (المادة 23)`, '#/commitments');
      for (const l of db.prepare(`SELECT id, end_date FROM licensees WHERE status='active' AND end_date BETWEEN date('now') AND date('now','+60 day')`).all())
        once(S.ownerOf('licensee', l.id), 'اقترب انتهاء الترخيص', `ينتهي في ${l.end_date} — قدّم طلب التجديد مع إقرار الامتثال (المادة 18/2)`, '#/applications');
      for (const a of db.prepare(`SELECT id, accredited_to FROM associations WHERE status='accredited' AND accredited_to BETWEEN date('now') AND date('now','+90 day')`).all())
        once(S.ownerOf('association', a.id), 'اقترب انتهاء الاعتماد', `ينتهي في ${a.accredited_to} — قدّم طلب التجديد (المادة 16)`, '#/applications');
      return n;
    },
  },
};

function runJobs(triggeredBy = 'scheduler', only) {
  const results = [];
  for (const [key, job] of Object.entries(JOBS)) {
    if (only && only !== key) continue;
    const id = db.prepare('INSERT INTO job_runs (job, triggered_by) VALUES (?,?)').run(key, triggeredBy).lastInsertRowid;
    let affected = 0, details = null;
    try { affected = db.transaction(() => job.run())(); }
    catch (e) { details = 'خطأ: ' + e.message; console.error('[jobs]', key, e); }
    db.prepare("UPDATE job_runs SET finished_at=datetime('now'), affected=?, details=? WHERE id=?").run(affected, details, id);
    results.push({ job: key, title: job.title, article: job.article, affected, error: details });
  }
  return results;
}

let timer = null;
function startScheduler(hours = 6) {
  runJobs('startup');
  timer = setInterval(() => runJobs('scheduler'), hours * 3600e3);
  timer.unref();
}

module.exports = { JOBS, runJobs, startScheduler };
