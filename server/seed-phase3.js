'use strict';
/**
 * بيانات تصويرية للمرحلة الثالثة: المراسلات بين الجهات والأمانة، والبريد الصادر، والاجتماعات القادمة.
 * التواريخ نسبية إلى يوم البناء فتبقى المراسلات «حديثة» والتقويم فيه مواعيد قادمة دائماً.
 */
const { db } = require('./db');
const O = require('./seed-ops');

const uid = (email) => db.prepare('SELECT id FROM users WHERE email=?').get(email)?.id;
const ago = (d, h = 10) => db.prepare(`SELECT datetime('now', ?, ?) t`).get(`-${d} days`, `-${24 - h} hours`).t;
const ahead = (d) => db.prepare("SELECT date('now', ?) t").get(`+${d} days`).t;

function seedPhase3() {
  const staff = {
    finance: uid('finance@sema.ly'), orgrel: uid('orgrel@sema.ly'), registry: uid('registry@sema.ly'),
    evaldir: uid('evaldir@sema.ly'), director: uid('director@sema.ly'), comms: uid('comms@sema.ly'),
  };
  let n = 0;
  const T = db.prepare(`INSERT INTO threads (reference, subject_kind, subject_id, topic_kind, topic_id, title, category, status,
      assigned_to, created_by, created_at, updated_at, closed_at, closed_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const M = db.prepare(`INSERT INTO thread_messages (thread_id, author_id, author_side, internal, body, document_id, created_at)
      VALUES (?,?,?,?,?,?,?)`);
  const READ = db.prepare('INSERT OR REPLACE INTO thread_reads (thread_id, user_id, last_read_id) VALUES (?,?,?)');
  /** مراسلة كاملة: الرسائل بترتيبها، والمقروء حتى آخر رسالة لكل من كتب فيها */
  function thread({ kind, id, topic, title, category, status, assigned, by, msgs, closedBy }) {
    const ref = `MSG-${String(++n).padStart(5, '0')}`;
    const first = msgs[0].at, last = msgs[msgs.length - 1].at;
    const tid = T.run(ref, kind, id, topic?.[0] || null, topic?.[1] || null, title, category, status, assigned || null, by,
      first, last, status === 'closed' ? last : null, status === 'closed' ? closedBy || assigned : null).lastInsertRowid;
    const lastRead = {};
    for (const m of msgs) {
      const mid = M.run(tid, m.by, m.side, m.internal ? 1 : 0, m.body, m.doc || null, m.at).lastInsertRowid;
      lastRead[m.by] = mid;
    }
    for (const [u, mid] of Object.entries(lastRead)) READ.run(tid, Number(u), mid);
    return tid;
  }
  const lic = (i) => db.prepare('SELECT * FROM licensees WHERE id=?').get(i);
  const owner = (kind, id) => db.prepare('SELECT user_id FROM user_roles WHERE scope_kind=? AND scope_id=? LIMIT 1').get(kind, id)?.user_id;

  // 1) شريك يستفسر عن احتساب الرسم السنوي — أجابت المالية وأُغلقت
  const l1 = lic(1), p1 = owner('licensee', 1);
  const inv1 = db.prepare("SELECT id, invoice_no FROM invoices WHERE subject_kind='licensee' AND subject_id=1 ORDER BY id DESC").get();
  thread({ kind: 'licensee', id: 1, topic: inv1 ? ['invoice', inv1.id] : null, category: 'financial', status: 'closed',
    title: 'استفسار عن احتساب الرسم السنوي', assigned: staff.finance, by: p1, msgs: [
      { by: p1, side: 'entity', at: ago(21), body: `نرجو توضيح أساس احتساب الفاتورة ${inv1?.invoice_no || ''}؛ فقد كنا نتوقع خصم المستويات العليا.` },
      { by: staff.finance, side: 'staff', at: ago(20), body: `الخصم (20%) يسري على المستويات من الثالث إلى الخامس، ومستوى ${l1.legal_name} الحالي هو ${l1.level}. ` +
        'والرسم محتسب بالتناسب مع ما تبقى من السنة الميلادية (المادة 34). وتجدون جدول الرسوم كاملاً في صفحة «المستويات والمعايير».' },
      { by: p1, side: 'entity', at: ago(20, 14), body: 'اتضح الأمر، شكراً لكم.' },
    ] });

  // 2) الأمانة تُخطر صاحب طلب بنواقص — بانتظار الجهة، ومعها مرفق قائمة النواقص
  const def = db.prepare("SELECT * FROM applications WHERE status='deficiencies' AND subject_kind='licensee' ORDER BY id LIMIT 1").get();
  if (def) {
    const pu = owner('licensee', def.subject_id);
    const docId = O.doc({ owner_kind: 'licensee', owner_id: def.subject_id, doc_type: 'correspondence',
      title: `مرفق مراسلة — قائمة النواقص ${def.reference}`, issuer: 'وحدة التقييم والتحقق', refNo: def.reference,
      rows: [['الطلب', def.reference], ['المهلة', 'عشرون يوم عمل من تاريخ الإخطار (المادة 17/3)']],
      body: `<p>${String(def.deficiencies || '').split(' · ').map((x) => '• ' + x).join('<br>')}</p>`, uploaded_by: staff.evaldir, verification: 'verified', verified_by: staff.evaldir });
    thread({ kind: 'licensee', id: def.subject_id, topic: ['application', def.id], category: 'deficiency', status: 'awaiting_entity',
      title: `نواقص الطلب ${def.reference}`, assigned: staff.evaldir, by: staff.evaldir, msgs: [
        { by: staff.evaldir, side: 'staff', at: ago(6), doc: docId, body: 'أظهر فحص الاستيفاء نواقص في ملف الطلب، مفصَّلة في المرفق. ' +
          'نرجو تحميل المستندات المحدَّثة من صفحة الطلب ثم الضغط على «إعادة التقديم» خلال عشرين يوم عمل، وإلا حُفظ الطلب (المادة 17/3).' },
        { by: staff.evaldir, side: 'staff', internal: true, at: ago(6, 11), body: 'ملاحظة داخلية: شهادة عدم المديونية المرفقة سابقاً منتهية منذ شهرين؛ نتحقق من المصدر عند الاستلام.' },
        { by: pu, side: 'entity', at: ago(4), body: 'استلمنا الإخطار. نعمل على استخراج شهادة محدَّثة من مصلحة الضرائب، ونتوقعها خلال أسبوع.' },
        { by: staff.evaldir, side: 'staff', at: ago(3), body: 'حسناً. المهلة سارية كما هي؛ وسيذكّركم النظام قبل انقضائها.' },
      ] });
  }

  // 3) منظمة تسأل عن سقف الاستيعاب — أجابت وحدة العلاقة بالمنظمات، بانتظار المنظمة
  const org1 = db.prepare('SELECT * FROM associations WHERE id=1').get(), o1 = owner('association', 1);
  thread({ kind: 'association', id: 1, category: 'inquiry', status: 'awaiting_entity', title: 'كيف يُحسب سقف الاستيعاب لمنظمتنا؟',
    assigned: staff.orgrel, by: o1, msgs: [
      { by: o1, side: 'entity', at: ago(9), body: 'رفض النظام تحويلاً من أحد الشركاء بحجة تجاوز سقف الاستيعاب. كيف يُحسب السقف؟ وهل يمكن رفعه؟' },
      { by: staff.orgrel, side: 'staff', at: ago(8), body: `السقف 200% من أكبر ميزانية سنوية في السنوات الثلاث الأخيرة (المعيار 10)؛ ` +
        `وهو لـ${org1.name} ${Math.round(org1.absorption_cap || 0).toLocaleString('ar-LY')} د.ل. ` +
        'يُرفع السقف بتحديث القوائم المالية المدققة للسنة الأخيرة متى زادت الميزانية؛ حمّلوها من «إثباتاتي» وسنعيد الاحتساب بعد التحقق.' },
    ] });

  // 4) شريك يسأل عن تصميم معلَّق — بانتظار الأمانة (غير مُسند) لتظهر في صندوق الوارد
  const des = db.prepare("SELECT * FROM design_approvals WHERE status='pending' ORDER BY id LIMIT 1").get();
  if (des) {
    const pu = owner('licensee', des.licensee_id);
    thread({ kind: 'licensee', id: des.licensee_id, topic: ['design', des.id], category: 'technical', status: 'awaiting_staff',
      title: `متابعة طلب الموافقة على التصميم ${des.reference}`, by: pu, msgs: [
        { by: pu, side: 'entity', at: ago(2), body: 'نحتاج إلى القرار قبل طباعة العبوات الأسبوع القادم. هل من ملاحظات أولية على وضع الشعار ورقم الترخيص؟' },
      ] });
  }

  // 5) مراقب يستفسر عن حضور اجتماع المجلس القادم — أجابت الأمانة وأُغلقت
  const obsU = uid('observer1@sema.ly');
  if (obsU) thread({ kind: 'user', id: obsU, category: 'inquiry', status: 'closed', title: 'حضور اجتماع مجلس الأمناء القادم',
    assigned: staff.director, by: obsU, msgs: [
      { by: obsU, side: 'entity', at: ago(12), body: 'متى يُعقد اجتماع المجلس القادم؟ وهل تصلني المواد قبل الاجتماع؟' },
      { by: staff.director, side: 'staff', at: ago(11), body: 'يُعقد الاجتماع القادم بعد نحو أربعة أسابيع، وتظهر مواعيده في «تقويم المواعيد». ' +
        'وتصلكم المواد العامة قبل سبعة أيام؛ أما الملفات الفردية قيد التقييم فلا تُتاح للمراقب (المادة 34).' },
    ] });

  // 6) شريك قدّم إقراره ويسأل عن موعد القرار — مع ملاحظة داخلية
  const decl = db.prepare(`SELECT cd.* FROM compliance_declarations cd WHERE cd.status='submitted' ORDER BY cd.id LIMIT 1`).get();
  if (decl) {
    const pu = owner('licensee', decl.licensee_id);
    thread({ kind: 'licensee', id: decl.licensee_id, topic: ['declaration', decl.id], category: 'inquiry', status: 'awaiting_staff',
      title: `موعد القرار في إقرار ${decl.fiscal_year}`, assigned: staff.registry, by: pu, msgs: [
        { by: pu, side: 'entity', at: ago(5), body: 'قدّمنا إقرار الامتثال في موعده. متى يصدر القرار؟ نحتاجه لتجديد عقد توريد.' },
        { by: staff.registry, side: 'staff', internal: true, at: ago(4), body: 'الإقرار بانتظار تقرير الوقائع من الوحدة. أحلت الاستفسار لمدير الوحدة للتقدير.' },
      ] });
  }

  // 7) الأمانة تذكّر منظمة بإقرار استلام مساهمة
  const pend = db.prepare(`SELECT c.* FROM contributions c WHERE c.association_id IS NOT NULL AND c.receipt_confirmed=0
      AND c.status IN ('declared','documented') ORDER BY c.id LIMIT 1`).get();
  if (pend) {
    const ou = owner('association', pend.association_id);
    thread({ kind: 'association', id: pend.association_id, topic: ['contribution', pend.id], category: 'other', status: 'awaiting_entity',
      title: `إقرار استلام المساهمة ${pend.reference}`, assigned: staff.orgrel, by: staff.orgrel, msgs: [
        { by: staff.orgrel, side: 'staff', at: ago(7), body: 'سجّل الشريك تحويل هذه المساهمة لكم. نرجو إقرار الاستلام (نموذج 5) من صفحة المساهمات؛ فلا تُحتسب في التزامه قبل إقراركم.' },
        ...(ou ? [{ by: ou, side: 'entity', at: ago(6), body: 'نراجع كشف الحساب مع المصرف ونؤكد خلال يومين.' }] : []),
      ] });
  }

  // 8) شريك ينتظر رداً منذ أيام — مراسلة متأخرة تظهر في صندوق الأمانة
  const l5 = db.prepare("SELECT id FROM licensees WHERE status='active' ORDER BY id LIMIT 1 OFFSET 7").get();
  if (l5) {
    const pu = owner('licensee', l5.id);
    thread({ kind: 'licensee', id: l5.id, category: 'technical', status: 'awaiting_staff', title: 'تعذّر تحميل ملف القوائم المالية',
      by: pu, msgs: [{ by: pu, side: 'entity', at: ago(5), body: 'يظهر خطأ «نوع الملف غير مسموح» عند تحميل القوائم المالية. الملف بصيغة ZIP فيه عدة ملفات PDF.' }] });
  }

  // البريد الصادر: رسائل محتجَزة لعدم ضبط خادم بريد في بيئة العرض
  const OUT = db.prepare(`INSERT INTO email_outbox (to_email, to_user_id, subject, body_text, kind, sensitive, status, attempts, last_error, created_at, sent_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const em = (id) => db.prepare('SELECT email FROM users WHERE id=?').get(id)?.email;
  const held = 'لم يُضبط خادم بريد (SEMA_SMTP_URL)';
  if (def) OUT.run(em(owner('licensee', def.subject_id)), owner('licensee', def.subject_id), 'سِيمَا الخَيْر — مراسلة من الأمانة: نواقص الطلب',
    `مراسلة من الأمانة: نواقص الطلب ${def.reference}\n\nأظهر فحص الاستيفاء نواقص في ملف الطلب…`, 'notification', 0, 'held', 0, held, ago(6), null);
  OUT.run(em(o1), o1, 'سِيمَا الخَيْر — رد الأمانة: كيف يُحسب سقف الاستيعاب لمنظمتنا؟', 'رد الأمانة على مراسلتكم…', 'notification', 0, 'sent', 1, null, ago(8), ago(8));
  OUT.run(em(p1), p1, 'سِيمَا الخَيْر — تغيّرت كلمة المرور', 'تغيّرت كلمة مرور حسابك الآن…', 'security', 0, 'sent', 1, null, ago(15), ago(15));
  OUT.run(em(obsU), obsU, 'سِيمَا الخَيْر — استعادة كلمة المرور', '[محتوى أمني — مُحي بعد الإرسال]', 'password_reset', 1, 'sent', 1, null, ago(13), ago(13));
  OUT.run('old-contact@example.ly', null, 'سِيمَا الخَيْر — تذكير بموعد الإقرار', 'تذكير بموعد تقديم إقرار الامتثال…', 'notification', 0, 'failed', 5,
    '550 5.1.1 Recipient address rejected: mailbox unavailable', ago(10), null);

  // اجتماعات قادمة — تظهر في التقويم ولوحة المراقب
  const MT = db.prepare(`INSERT INTO meetings (body, title, meeting_no, held_on, quorum_required, attendees_count, observers_count, decisions, is_public)
      VALUES (?,?,?,?,?,0,0,NULL,?)`);
  const PFX = { licensing: 'ل ت', board: 'م أ', standards: 'ل م' };
  const nextNo = (b) => `${PFX[b]}/${String(db.prepare('SELECT COUNT(*) n FROM meetings WHERE body=?').get(b).n + 1).padStart(2, '0')}`;
  MT.run('licensing', 'الاجتماع الدوري للجنة منح الترخيص', nextNo('licensing'), ahead(12), 2, 0);
  MT.run('board', 'الاجتماع الربعي لمجلس الأمناء', nextNo('board'), ahead(28), 6, 1);
  MT.run('standards', 'مراجعة مداخلات المشاورة العامة', nextNo('standards'), ahead(19), 3, 0);

  return { threads: n };
}

module.exports = { seedPhase3 };
