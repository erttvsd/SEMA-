# نشر «سِيمَا الخَيْر» على Dokploy — `semalibya.ly`

| | |
|---|---|
| خادم Dokploy | `http://169.58.44.17:3000` |
| المشروع | `qtBWacChYiv1DC5amIgCi` |
| البيئة | `bUJ4MImQuxAWrItAswXqn` |
| المستودع | `https://github.com/erttvsd/SEMA-.git` (عام) |
| الفرع | `claude/comprehensive-admin-system-qk7c3i` |
| النطاق | `semalibya.ly` و `www.semalibya.ly` ← سجلّا A إلى `169.58.44.17` |
| المنفذ داخل الحاوية | `3000` |
| التخزين الدائم | `/data` |

اختر طريقاً واحداً من الثلاثة.

---

## الطريق 1: من لوحة Dokploy يدوياً (10 دقائق)

1. افتح المشروع ← البيئة ← **Create Service ← Application** ← الاسم `sema-alkhayr`.
2. **General ← Provider**: *Git*
   - Repository URL: `https://github.com/erttvsd/SEMA-.git`
   - Branch: `claude/comprehensive-admin-system-qk7c3i`
   - Build Path: `/`
   - **Save**
3. **General ← Build Type**: *Dockerfile* — Docker File: `Dockerfile` ← **Save**
4. **Environment**: الصق ثم **Save**

   ```
   SEMA_AUTO_SEED=demo
   SEMA_DEMO=1
   SEMA_PUBLIC_URL=https://semalibya.ly
   SEMA_TRUST_PROXY=1
   ```

5. **Advanced ← Mounts ← Add Mount**: النوع *Volume*، الاسم `sema-alkhayr-data`، Mount Path: `/data` ← **Create**
   > بدون هذه الخطوة تضيع البيانات والمستندات مع كل إعادة نشر.
6. **Domains ← Add Domain** (مرتين):

   | Host | Path | Container Port | HTTPS | Certificate |
   |---|---|---|---|---|
   | `semalibya.ly` | `/` | `3000` | ✓ | Let's Encrypt |
   | `www.semalibya.ly` | `/` | `3000` | ✓ | Let's Encrypt |

7. **Deploy** ← تابع **Deployments ← View** حتى يظهر في السجل:
   `نظام «سِيمَا الخَيْر» يعمل على http://localhost:3000`
8. افتح **https://semalibya.ly** — الدخول بأي حساب من صفحة الدخول، وكلمة المرور `Sema@2026`.

---

## الطريق 2: بأمر واحد من جهازك

يلزم Node.js 20 أو أحدث، وجهاز يصل إلى `169.58.44.17:3000`، ومفتاح API من
Dokploy: **Settings ← Profile ← API/CLI ← Generate API Key**.

```bash
git clone -b claude/comprehensive-admin-system-qk7c3i https://github.com/erttvsd/SEMA-.git
cd SEMA-
npm --prefix tools/dokploy-mcp install

DOKPLOY_URL=http://169.58.44.17:3000 \
DOKPLOY_API_KEY=ضع_المفتاح_هنا \
npm run deploy:dokploy -- --environment bUJ4MImQuxAWrItAswXqn --domain semalibya.ly
```

ينفّذ الخطوات 1–7 من الطريق الأول كلها، ويطبع كل خطوة. وتكراره آمن: يحدّث ما وُجد ولا يكرره.

---

## الطريق 3: بطلب إلى Claude (أداة MCP)

1. في إعدادات بيئة Claude Code (قائمة البيئة ← **Edit ← Network access**) أضف إلى النطاقات المسموحة:
   - `169.58.44.17`
   - `semalibya.ly`
2. في الإعدادات نفسها أضف متغيراً سرّياً: `DOKPLOY_API_KEY` = مفتاح Dokploy.
3. افتح **جلسة جديدة** على المستودع (تغيير الشبكة يسري على الجلسات الجديدة) واكتب:

   > انشر سيما الخير على semalibya.ly

   يستعمل Claude أداة `dokploy_deploy_sema` من `.mcp.json`، ثم يتابع سجل البناء حتى يعمل الموقع.

---

## بعد النشر: تحقّق

- [ ] `https://semalibya.ly/api/health` يُرجع `{"ok":true,…}`
- [ ] القفل الأخضر (شهادة Let's Encrypt) على `semalibya.ly` و`www.semalibya.ly`
- [ ] صفحة الدخول تعرض الحسابات التصويرية، والدخول بـ `director@sema.ly` / `Sema@2026` يعمل
- [ ] **Redeploy** من Dokploy لا يمحو البيانات (دليل على أن `/data` مربوط)
- [ ] رمز QR في أي شهادة يفتح `https://semalibya.ly/…`

---

## للإنتاج الفعلي (بدلاً من بيانات العرض)

استبدل متغيرات الخطوة 4 بما يلي **قبل أول نشر** (أو امسح التخزين ثم أعد النشر):

```
SEMA_AUTO_SEED=init
SEMA_ADMIN_EMAIL=director@semalibya.ly
SEMA_ADMIN_NAME=الاسم الكامل
SEMA_ADMIN_PASSWORD=كلمة-مرور-مؤقتة-قوية-2026
SEMA_DEMO=0
SEMA_PUBLIC_URL=https://semalibya.ly
SEMA_TRUST_PROXY=1
SEMA_SMTP_URL=smtps://user:pass@mail.semalibya.ly:465
```

- `SEMA_JWT_SECRET` و`SEMA_DATA_KEY` يُولَّدان تلقائياً عند أول تشغيل ويُحفظان في `/data` — لا تمسح التخزين بعدها.
- أول دخول: غيّر كلمة المرور المؤقتة ← فعّل التحقق بخطوتين ← من «الإعدادات» اجعل `require_2fa_internal = 1`.
- بلا `SEMA_SMTP_URL` لا تصل رسائل استعادة كلمة المرور.

---

## مشكلات شائعة

| العَرَض | السبب والحل |
|---|---|
| فشل إصدار الشهادة | سجلّا A لا يشيران بعدُ إلى `169.58.44.17`، أو المنفذان 80 و443 مغلقان في جدار الخادم. انتظر انتشار DNS ثم **Domains ← Regenerate** |
| `404 page not found` من Traefik | النطاق مضاف بمنفذ غير `3000`، أو التطبيق لم يكتمل نشره |
| الموقع يعمل والبيانات تختفي بعد النشر | لا تخزين على `/data` — الخطوة 5 |
| في السجل: `قاعدة البيانات فارغة` | `SEMA_AUTO_SEED` غير مضبوط — الخطوة 4 |
| في السجل: `SEMA_AUTO_SEED=init يلزمه …` | ينقص `SEMA_ADMIN_EMAIL` أو `SEMA_ADMIN_NAME` |
| فشل البناء عند `npm ci` | إعادة النشر؛ وإن تكرر فانسخ آخر 50 سطراً من سجل البناء |
| الأمر أو الأداة: `401` | مفتاح API خاطئ أو منتهٍ — ولِّد مفتاحاً جديداً |
| الأداة: `no rule allows host` | الخطوة 1 من الطريق الثالث: السماح بـ `169.58.44.17` في شبكة البيئة |

المراجع: [`docs/05-التشغيل-والنشر.md`](docs/05-التشغيل-والنشر.md) · [`tools/dokploy-mcp/README.md`](tools/dokploy-mcp/README.md)
