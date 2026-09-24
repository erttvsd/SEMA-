'use strict';
/**
 * منظومة الصلاحيات — مبنية على:
 *  - المادة (18) من النظام الداخلي: الفصل الإلزامي بين أربع وظائف (ISO/IEC 17065)
 *  - ملحق «مصفوفة الصلاحيات» في النظام الداخلي
 *  - المواد (19) إلى (25) في توزيع الاختصاصات
 */

// الوظائف الأربع التي لا يجوز الجمع بين اثنتين منها
const SOD_FUNCTIONS = [
  ['STANDARDS',        'وضع المعيار'],
  ['EVALUATION',       'التقييم والتدقيق'],
  ['LICENSING',        'قرار الترخيص'],
  ['APPEAL_INTEGRITY', 'التظلم وحماية النزاهة'],
];

const PERMISSION_GROUPS = {
  registry:   'السجل العام',
  apps:       'الطلبات',
  licensees:  'المرخَّص لهم',
  orgs:       'المنظمات',
  docs:       'الإثباتات والمستندات',
  audit:      'التدقيق والتفتيش',
  decision:   'القرارات',
  sanction:   'الجزاءات',
  appeal:     'التظلمات',
  integrity:  'النزاهة والشكاوى',
  standards:  'المعايير والرسوم',
  finance:    'المالية',
  reports:    'التقارير والمؤشرات',
  gov:        'الحوكمة',
  comm:       'المراسلات',
  admin:      'إدارة النظام',
};

/** @type {[string,string,string][]} code, name_ar, group */
const PERMISSIONS = [
  // السجل العام
  ['registry.view',            'استعراض السجل العام',                      'registry'],
  ['registry.publish',         'نشر وإخفاء قيود السجل',                    'registry'],
  // الطلبات
  ['app.create',               'تقديم طلب',                                 'apps'],
  ['app.view.own',             'استعراض طلباتي',                            'apps'],
  ['app.view.all',             'استعراض كل الطلبات',                        'apps'],
  ['app.screen',               'فحص الاستيفاء الشكلي والإخطار بالنواقص',     'apps'],
  ['app.assess',            'التقييم الموضوعي والتدقيق المكتبي',             'apps'],
  ['app.facts_report',         'رفع تقرير الوقائع',                          'apps'],
  ['app.decide',               'إصدار قرار المنح أو الرفض',                  'decision'],
  ['app.set_level',            'تحديد المستوى الممنوح',                      'decision'],
  // الجهات
  ['licensee.view.own',        'استعراض ملف منشأتي',                        'licensees'],
  ['licensee.view.all',        'استعراض كل المرخَّص لهم',                    'licensees'],
  ['licensee.edit.own',        'تحديث بيانات منشأتي',                        'licensees'],
  ['licensee.edit.all',        'تحديث بيانات أي مرخَّص له',                  'licensees'],
  ['org.view.own',             'استعراض ملف منظمتي',                        'orgs'],
  ['org.view.all',             'استعراض كل المنظمات',                        'orgs'],
  ['org.edit.own',             'تحديث بيانات منظمتي',                        'orgs'],
  ['org.edit.all',             'تحديث بيانات أي منظمة',                      'orgs'],
  ['org.assess_criteria',      'تقييم معايير الاعتماد الخمسة عشر',           'orgs'],
  // الإثباتات
  ['doc.upload.own',           'تحميل إثباتات ملفي',                        'docs'],
  ['doc.upload.any',           'تحميل إثباتات لأي ملف',                      'docs'],
  ['doc.view.own',             'استعراض إثباتات ملفي',                       'docs'],
  ['doc.view.all',             'استعراض كل الإثباتات',                       'docs'],
  ['doc.verify',               'التحقق من الإثباتات واعتمادها',              'docs'],
  ['doc.view.confidential',    'الاطلاع على المستندات السرّية',              'docs'],
  // الالتزام والمساهمات
  ['commitment.declare',       'تقديم إقرار الامتثال السنوي',                'licensees'],
  ['commitment.view.all',      'استعراض كل الالتزامات',                      'licensees'],
  ['contribution.declare',     'تسجيل مساهمة',                               'licensees'],
  ['contribution.confirm',     'إقرار استلام مساهمة',                        'orgs'],
  ['contribution.verify',      'التحقق من المساهمات',                        'audit'],
  ['impact.submit',            'تقديم تقرير الأثر',                          'orgs'],
  // التدقيق
  ['audit.plan',               'تخطيط العيّنة وجدولة التدقيق',               'audit'],
  ['audit.execute',            'تنفيذ التدقيق المكتبي والميداني',            'audit'],
  ['audit.unannounced',        'تنفيذ الزيارات غير المعلنة',                 'audit'],
  ['audit.view.all',           'استعراض كل تقارير التدقيق',                  'audit'],
  ['audit.view.own',           'استعراض تقارير التدقيق على ملفي',            'audit'],
  ['market_test.manage',       'إدارة جولات اختبار السوق',                   'audit'],
  // الجزاءات والتظلمات
  ['sanction.propose',         'رفع وقائع موجبة للجزاء',                     'sanction'],
  ['sanction.decide',          'إصدار قرار التعليق أو السحب',                'sanction'],
  ['sanction.view.all',        'استعراض كل الجزاءات',                        'sanction'],
  ['appeal.file',              'تقديم تظلم',                                 'appeal'],
  ['appeal.decide',            'البتّ في التظلم',                            'appeal'],
  ['appeal.view.all',          'استعراض كل التظلمات',                        'appeal'],
  // النزاهة
  ['complaint.file',           'تقديم بلاغ أو شكوى',                         'integrity'],
  ['complaint.triage',         'فرز البلاغات وإحالتها',                      'integrity'],
  ['integrity.note',           'تسجيل ملاحظة نزاهة',                         'integrity'],
  ['integrity.publish',        'النشر العلني لملاحظات النزاهة',              'integrity'],
  // المعايير والرسوم
  ['standards.propose',        'صياغة ومراجعة المعايير والنسب',              'standards'],
  ['standards.interpret',      'إصدار التفسيرات الملزمة',                    'standards'],
  ['standards.approve',        'اعتماد المعايير وجدول الرسوم والأرضيات',     'standards'],
  ['program.preapprove',       'الموافقة المسبقة على البرامج التنموية',      'standards'],
  ['design.submit',            'تقديم تصميم للموافقة المسبقة',               'standards'],
  ['design.decide',            'البتّ في طلبات الموافقة على التصاميم',       'standards'],
  // المالية
  ['finance.invoice',          'إصدار الرسوم والفواتير',                     'finance'],
  ['finance.view.all',         'استعراض المالية كاملةً',                     'finance'],
  ['finance.budget.propose',   'اقتراح الموازنة',                            'finance'],
  ['finance.budget.approve',   'اعتماد الموازنة',                            'finance'],
  ['finance.statements.approve','اعتماد القوائم المالية',                    'finance'],
  ['funding.approve',          'قبول تمويل يتجاوز الحدود',                   'finance'],
  // التقارير
  ['report.view',              'استعراض التقارير التحليلية',                 'reports'],
  ['report.export',            'تصدير التقارير',                             'reports'],
  ['kpi.manage',               'إدارة المؤشرات والمستهدفات',                 'reports'],
  // الحوكمة
  ['gov.meetings.view',        'استعراض الاجتماعات والمحاضر',                'gov'],
  ['gov.meetings.manage',      'إدارة الاجتماعات والمحاضر',                  'gov'],
  ['gov.attend',               'حضور اجتماعات المجلس والمداخلة',             'gov'],
  ['observer.nominate',        'ترشيح مراقب',                                'gov'],
  ['observer.admit',           'قبول أو إنهاء صفة مراقب',                    'gov'],
  ['gov.appoint',              'تعيين المدير التنفيذي وأعضاء اللجان',        'gov'],
  ['gov.bylaws.amend',         'تعديل النظام الداخلي',                       'gov'],
  // إدارة النظام
  ['admin.users',              'إدارة المستخدمين والأدوار',                  'admin'],
  ['admin.log',                'استعراض سجل التتبع',                         'admin'],
  ['admin.settings',           'إدارة إعدادات النظام',                       'admin'],
  ['admin.backup',             'النسخ الاحتياطي وتنزيله',                    'admin'],
  // المراسلات — لجنة الترخيص لا تراسل الطالب (يُحظر عليها التفاوض معه)
  ['thread.own',               'مراسلة الأمانة بشأن ملفي',                  'comm'],
  ['thread.staff',             'الرد على مراسلات الجهات باسم الأمانة',       'comm'],
];

/**
 * الأدوار. كل دور مرتبط — عند اللزوم — بإحدى الوظائف الأربع،
 * ولا يجوز لمستخدم واحد أن يحمل دورين ينتميان لوظيفتين مختلفتين.
 */
const ROLES = [
  {
    code: 'GENERAL_ASSEMBLY', name_ar: 'عضو الجمعية العمومية', category: 'governance',
    sod: null, sort: 10,
    description: 'انتخاب المجلس، اعتماد التقرير السنوي والقوائم المالية، تعديل النظام. لا اختصاص لها في أي ملف فردي.',
    perms: ['registry.view','report.view','gov.meetings.view','finance.view.all',
            'finance.statements.approve','gov.bylaws.amend','licensee.view.all','org.view.all'],
  },
  {
    code: 'BOARD_MEMBER', name_ar: 'عضو مجلس الأمناء', category: 'governance',
    sod: null, sort: 20,
    description: 'الجهة العليا المشرفة: اعتماد المعايير والرسوم والموازنة وتعيين اللجان. يُحظر عليه الفحص أو المنح أو التعليق (المصفوفة).',
    perms: ['registry.view','registry.publish','licensee.view.all','org.view.all','app.view.all',
            'commitment.view.all','audit.view.all','sanction.view.all','appeal.view.all',
            'standards.approve','finance.view.all','finance.budget.approve','funding.approve',
            'report.view','report.export','kpi.manage','gov.meetings.view','gov.meetings.manage',
            'observer.admit','gov.appoint','admin.log'],
  },
  {
    code: 'BOARD_CHAIR', name_ar: 'رئيس مجلس الأمناء', category: 'governance',
    sod: null, sort: 21,
    description: 'رئاسة المجلس والدعوة للجمعية العمومية. تتناوب الرئاسة بين المناطق كل دورة (المادة 12).',
    perms: ['registry.view','registry.publish','licensee.view.all','org.view.all','app.view.all',
            'commitment.view.all','audit.view.all','sanction.view.all','appeal.view.all',
            'standards.approve','finance.view.all','finance.budget.approve','funding.approve',
            'finance.statements.approve','report.view','report.export','kpi.manage',
            'gov.meetings.view','gov.meetings.manage','observer.admit','gov.appoint','admin.log'],
  },
  {
    code: 'STANDARDS_COMMITTEE', name_ar: 'عضو لجنة المعايير', category: 'governance',
    sod: 'STANDARDS', sort: 30,
    description: 'صياغة المعايير والنسب والأرضيات ومراجعتها كل ثلاث سنوات، والتفسيرات الملزمة، والموافقة على البرامج التنموية الذاتية. يُحظر عليها تقييم أي طلب أو منح أي ترخيص (المادة 19/4).',
    perms: ['registry.view','standards.propose','standards.interpret','program.preapprove',
            'design.decide','report.view','report.export','gov.meetings.view',
            'licensee.view.all','org.view.all'],
  },
  {
    code: 'EVAL_DIRECTOR', name_ar: 'مدير وحدة التقييم والتحقق', category: 'executive',
    sod: 'EVALUATION', sort: 40,
    description: 'رئاسة وحدة التقييم: خطة العيّنة، توزيع الملفات، اعتماد تقارير الوقائع. التقرير وقائع بلا توصية (المادة 20/3).',
    perms: ['registry.view','app.view.all','app.screen','app.assess','app.facts_report',
            'licensee.view.all','licensee.edit.all','org.view.all','org.edit.all','org.assess_criteria',
            'doc.view.all','doc.upload.any','doc.verify','doc.view.confidential',
            'commitment.view.all','contribution.verify',
            'audit.plan','audit.execute','audit.unannounced','audit.view.all','market_test.manage',
            'sanction.propose','sanction.view.all','report.view','report.export','complaint.triage','thread.staff'],
  },
  {
    code: 'ASSESSOR', name_ar: 'مقيّم', category: 'executive',
    sod: 'EVALUATION', sort: 41,
    description: 'استقبال الطلبات وفحص استيفائها والتدقيق المكتبي والميداني وإعداد تقرير الوقائع. يُحظر عليه تقييم جهة قدّم لها خدمة خلال سنتين أو تربطه بها قرابة للدرجة الرابعة (المادة 20/4).',
    perms: ['registry.view','app.view.all','app.screen','app.assess','app.facts_report',
            'licensee.view.all','org.view.all','org.assess_criteria',
            'doc.view.all','doc.upload.any','doc.verify',
            'commitment.view.all','contribution.verify',
            'audit.execute','audit.view.all','sanction.propose','report.view'],
  },
  {
    code: 'FIELD_AUDITOR', name_ar: 'مدقق ميداني', category: 'executive',
    sod: 'EVALUATION', sort: 42,
    description: 'تنفيذ التدقيق الميداني والزيارات غير المعلنة واختبار السوق. لا يُخطَر بموعد الزيارة غير المعلنة قبل يومها (المادة 26).',
    perms: ['registry.view','licensee.view.all','org.view.all','doc.view.all','doc.upload.any',
            'doc.verify','audit.execute','audit.unannounced','audit.view.all','market_test.manage',
            'contribution.verify','sanction.propose','commitment.view.all','report.view'],
  },
  {
    code: 'LICENSING_COMMITTEE', name_ar: 'عضو لجنة منح الترخيص', category: 'governance',
    sod: 'LICENSING', sort: 50,
    description: 'تختص وحدها بالمنح والرفض وتحديد المستوى والتجديد والتعليق والسحب وإعادة القيد. يُحظر عليها التفاوض مع الطالب أو تعديل وقائع تقرير التقييم (المادة 21/4).',
    perms: ['registry.view','registry.publish','app.view.all','app.decide','app.set_level',
            'licensee.view.all','org.view.all','doc.view.all','doc.view.confidential',
            'audit.view.all','commitment.view.all','sanction.decide','sanction.view.all',
            'report.view','report.export','gov.meetings.view'],
  },
  {
    code: 'APPEALS_COMMITTEE', name_ar: 'عضو لجنة التظلمات', category: 'governance',
    sod: 'APPEAL_INTEGRITY', sort: 60,
    description: 'ثلاثة أعضاء مستقلين من خارج المجلس واللجان. تفصل في التظلم خلال ستين يوماً وقرارها نهائي داخلياً (المادة 22).',
    perms: ['registry.view','appeal.view.all','appeal.decide','app.view.all','licensee.view.all',
            'org.view.all','doc.view.all','doc.view.confidential','audit.view.all',
            'sanction.view.all','report.view','gov.meetings.view'],
  },
  {
    code: 'INTEGRITY_COMMITTEE', name_ar: 'عضو لجنة حماية النزاهة', category: 'governance',
    sod: 'APPEAL_INTEGRITY', sort: 61,
    description: 'خمسة أعضاء بتمثيل متوازن لأصحاب المصلحة. تراقب استقلال المنظومة لا الملفات الفردية، ولها النشر العلني إن لم يُستجب خلال 90 يوماً (المادة 23).',
    perms: ['registry.view','integrity.note','integrity.publish','complaint.triage',
            'report.view','report.export','gov.meetings.view','finance.view.all',
            'sanction.view.all','appeal.view.all','admin.log'],
  },
  {
    code: 'EXEC_DIRECTOR', name_ar: 'المدير التنفيذي', category: 'executive',
    sod: null, sort: 70,
    description: 'تنفيذ قرارات المجلس واللجان وإدارة العمل اليومي واقتراح الموازنة. لا يملك أي صلاحية في منح ترخيص أو رفضه أو تعليقه أو سحبه (المادة 25).',
    perms: ['registry.view','registry.publish','app.view.all','licensee.view.all','licensee.edit.all',
            'org.view.all','org.edit.all','doc.view.all','doc.upload.any','commitment.view.all',
            'audit.view.all','sanction.view.all','appeal.view.all','finance.invoice',
            'finance.view.all','finance.budget.propose','report.view','report.export','kpi.manage',
            'gov.meetings.view','gov.meetings.manage','observer.nominate','complaint.triage',
            'admin.users','admin.log','admin.settings','design.decide','market_test.manage','admin.backup','thread.staff'],
  },
  {
    code: 'REGISTRY_OFFICER', name_ar: 'مسؤول السجل والنظم', category: 'executive',
    sod: null, sort: 71,
    description: 'وحدة السجل والنظم: القيد والنشر وإصدار الشهادات وأرقام الترخيص ورموز التحقق.',
    perms: ['registry.view','registry.publish','app.view.all','licensee.view.all','licensee.edit.all',
            'org.view.all','org.edit.all','doc.view.all','doc.upload.any','report.view','admin.log','admin.backup','thread.staff'],
  },
  {
    code: 'FINANCE_OFFICER', name_ar: 'مسؤول الوحدة المالية', category: 'executive',
    sod: null, sort: 72,
    description: 'إصدار الرسوم ومتابعة التحصيل والموازنة وتصنيف الإنفاق على الفئات الثلاث (المادة 31).',
    perms: ['registry.view','licensee.view.all','org.view.all','finance.invoice','finance.view.all',
            'finance.budget.propose','report.view','report.export','doc.view.all','doc.upload.any','thread.staff'],
  },
  {
    code: 'COMMS_OFFICER', name_ar: 'مسؤول الاتصال والتسويق', category: 'executive',
    sod: null, sort: 73,
    description: 'وحدة الاتصال والتسويق وخطة الترويج الوطني ومتابعة مؤشرات الوعي.',
    perms: ['registry.view','licensee.view.all','org.view.all','report.view','kpi.manage','design.decide'],
  },
  {
    code: 'ORG_RELATIONS', name_ar: 'مسؤول العلاقة بالمنظمات', category: 'executive',
    sod: null, sort: 74,
    description: 'وحدة العلاقة بالمنظمات: متابعة الاعتماد وسقف الاستيعاب وتقارير الأثر.',
    perms: ['registry.view','org.view.all','org.edit.all','doc.view.all','doc.upload.any',
            'report.view','report.export','licensee.view.all','commitment.view.all','thread.staff'],
  },
  {
    code: 'PARTNER_BUSINESS', name_ar: 'شريك — منشأة مرخَّص لها', category: 'external',
    sod: null, scope_kind: 'licensee', sort: 80,
    description: 'بوابة الشريك: الطلب والتجديد وتحميل الإثباتات وإقرار الامتثال وتسجيل المساهمات وطلب الموافقة على التصاميم والتظلم.',
    perms: ['registry.view','app.create','app.view.own','licensee.view.own','licensee.edit.own',
            'doc.upload.own','doc.view.own','commitment.declare','contribution.declare',
            'design.submit','appeal.file','complaint.file','audit.view.own','report.view','thread.own'],
  },
  {
    code: 'PARTNER_ASSOCIATION', name_ar: 'منظمة مجتمع مدني معتمدة', category: 'external',
    sod: null, scope_kind: 'association', sort: 81,
    description: 'بوابة الجمعية: طلب الاعتماد مجاناً، تحميل الإثباتات، إقرار استلام المساهمات، تقارير الأثر، متابعة سقف الاستيعاب والتصنيف الإداري.',
    perms: ['registry.view','app.create','app.view.own','org.view.own','org.edit.own',
            'doc.upload.own','doc.view.own','contribution.confirm','impact.submit',
            'appeal.file','complaint.file','audit.view.own','report.view','thread.own'],
  },
  {
    code: 'OBSERVER', name_ar: 'مراقب', category: 'external',
    sod: null, sort: 90,
    description: 'حق الحضور والمداخلة في اجتماعات المجلس، ولا صوت له ولا حق في الاطلاع على ملف فردي قيد التقييم (المادة 34).',
    perms: ['registry.view','gov.attend','report.view','thread.own'],
  },
  {
    code: 'EXTERNAL_AUDITOR', name_ar: 'مراجع حسابات خارجي', category: 'external',
    sod: 'APPEAL_INTEGRITY', sort: 91,
    description: 'مراجعة القوائم المالية السنوية للأمانة ومراجعة الامتثال الدورية. اطلاع للقراءة فقط.',
    perms: ['registry.view','finance.view.all','doc.view.all','doc.view.confidential',
            'commitment.view.all','audit.view.all','report.view','report.export','admin.log'],
  },
];

// ============ منطق الفصل الوظيفي ============
/** يرجع الوظائف المتعارضة إن وُجدت */
function sodConflict(roleCodes) {
  const byRole = new Map(ROLES.map((r) => [r.code, r]));
  const fns = new Map();
  for (const rc of roleCodes) {
    const r = byRole.get(rc);
    if (r && r.sod) {
      if (!fns.has(r.sod)) fns.set(r.sod, []);
      fns.get(r.sod).push(r.name_ar);
    }
  }
  if (fns.size > 1) {
    const names = SOD_FUNCTIONS.filter(([c]) => fns.has(c)).map(([, n]) => n);
    return {
      conflict: true,
      functions: names,
      message:
        'يخالف هذا التعيين قاعدة الفصل الوظيفي في المادة (18): لا يجوز الجمع بين ' +
        names.join(' و ') +
        ' في شخص واحد.',
    };
  }
  return { conflict: false };
}

function permissionsFor(roleCodes) {
  const byRole = new Map(ROLES.map((r) => [r.code, r]));
  const out = new Set();
  for (const rc of roleCodes) {
    const r = byRole.get(rc);
    if (r) r.perms.forEach((p) => out.add(p));
  }
  return [...out];
}

/**
 * قواعد التعارض الإضافية المستمدة من النظام الداخلي — فوق قاعدة الوظائف الأربع:
 *  - المدير التنفيذي لا يملك منح ترخيص أو رفضه أو تعليقه أو سحبه (المادة 25)
 *  - عضو مجلس الأمناء لا يكون موظفاً بأجر لدى الأمانة (المادة 13)
 *  - لجنة التظلمات من خارج المجلس واللجان (المادة 22/1)
 *  - الأدوار الخارجية (شريك، منظمة، مراقب، مراجع خارجي) لا تُجمع مع أدوار الحوكمة أو الأمانة
 */
const EXEC_ROLES = ['EXEC_DIRECTOR', 'EVAL_DIRECTOR', 'ASSESSOR', 'FIELD_AUDITOR', 'REGISTRY_OFFICER',
  'FINANCE_OFFICER', 'COMMS_OFFICER', 'ORG_RELATIONS'];
const BOARD_ROLES = ['BOARD_MEMBER', 'BOARD_CHAIR'];
const INTERNAL = new Set([...EXEC_ROLES, ...BOARD_ROLES, 'STANDARDS_COMMITTEE', 'LICENSING_COMMITTEE',
  'APPEALS_COMMITTEE', 'INTEGRITY_COMMITTEE']);
const EXTERNAL = new Set(['PARTNER_BUSINESS', 'PARTNER_ASSOCIATION', 'OBSERVER', 'EXTERNAL_AUDITOR']);

function assignmentProblems(roleCodes) {
  const set = new Set(roleCodes);
  const has = (c) => set.has(c);
  const problems = [];
  const sod = sodConflict(roleCodes);
  if (sod.conflict) problems.push(sod.message);
  if (has('EXEC_DIRECTOR') && (has('LICENSING_COMMITTEE') || has('APPEALS_COMMITTEE')))
    problems.push('المدير التنفيذي لا يملك أي صلاحية في منح ترخيص أو رفضه أو تعليقه أو سحبه، ولا في البتّ في التظلم (المادة 25).');
  if (BOARD_ROLES.some(has) && EXEC_ROLES.some(has))
    problems.push('لا يكون عضو مجلس الأمناء موظفاً بأجر لدى الأمانة (المادة 13).');
  if (has('APPEALS_COMMITTEE') && [...BOARD_ROLES, 'STANDARDS_COMMITTEE', 'LICENSING_COMMITTEE', 'INTEGRITY_COMMITTEE', ...EXEC_ROLES].some(has))
    problems.push('أعضاء لجنة التظلمات مستقلون من خارج المجلس واللجان والأمانة (المادة 22/1).');
  const ext = [...set].filter((c) => EXTERNAL.has(c)), int = [...set].filter((c) => INTERNAL.has(c));
  if (ext.length && int.length)
    problems.push('الأدوار الخارجية (الشريك، المنظمة، المراقب، المراجع الخارجي) لا تُجمع مع أدوار الحوكمة أو الأمانة — لكل صفة حساب مستقل.');
  if (ext.length > 1)
    problems.push('لا يُجمع بين دورين خارجيين في حساب واحد.');
  if (has('BOARD_CHAIR') && has('BOARD_MEMBER')) problems.push('رئيس المجلس عضو فيه أصلاً — يكفي دور الرئيس.');
  return problems;
}

module.exports = { SOD_FUNCTIONS, PERMISSIONS, PERMISSION_GROUPS, ROLES, sodConflict, permissionsFor, assignmentProblems };
