# Dokploy MCP

خادم MCP لإدارة [Dokploy](https://dokploy.com) من Claude (أو أي عميل MCP): المشاريع والبيئات والتطبيقات، ومصدر
Git، ونوع البناء، والمتغيرات، والتخزين الدائم، والنطاقات بشهادات HTTPS، والنشر، وسجلات البناء والتشغيل — ومعها أداة
تنشر «سِيمَا الخَيْر» كاملاً بطلب واحد.

## التثبيت

```bash
npm --prefix tools/dokploy-mcp install
```

مفتاح API من Dokploy: **Settings ← Profile ← API/CLI ← Generate API Key**.

## الاستعمال مع Claude Code

المستودع يحمل `.mcp.json` يسجّل الخادم باسم `dokploy`؛ يكفي ضبط المتغيرين قبل تشغيل Claude Code:

```bash
export DOKPLOY_URL=http://169.58.44.17:3000
export DOKPLOY_API_KEY=...
claude          # ثم: «انشر سيما الخير على semalibya.ly»
```

أو إضافته يدوياً:

```bash
claude mcp add dokploy -e DOKPLOY_URL=http://169.58.44.17:3000 -e DOKPLOY_API_KEY=... -- node tools/dokploy-mcp/server.mjs
```

ولـ Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "dokploy": { "command": "node", "args": ["/مسار/SEMA-/tools/dokploy-mcp/server.mjs"],
  "env": { "DOKPLOY_URL": "http://169.58.44.17:3000", "DOKPLOY_API_KEY": "..." } } } }
```

## الأدوات

| الأداة | ما تفعله |
|---|---|
| `dokploy_list_projects` | المشاريع وبيئاتها وتطبيقاتها |
| `dokploy_get_environment` · `dokploy_get_application` | التفاصيل |
| `dokploy_create_application` | إنشاء تطبيق في بيئة |
| `dokploy_set_git_source` | مستودع عام برابطه، أو خاص عبر مزوّد GitHub المربوط (`githubId`) |
| `dokploy_list_github_providers` | حسابات GitHub المربوطة بـ Dokploy |
| `dokploy_set_build` | نوع البناء (Dockerfile افتراضاً) |
| `dokploy_set_env` | متغيرات البيئة (كائن أو نص) |
| `dokploy_add_volume` | تخزين دائم |
| `dokploy_add_domain` | نطاق بشهادة Let's Encrypt |
| `dokploy_deploy` | نشر أو إعادة نشر |
| `dokploy_list_deployments` · `dokploy_deployment_logs` · `dokploy_app_logs` | المتابعة والتشخيص |
| `dokploy_deploy_sema` | **نشر «سِيمَا الخَيْر» كاملاً** — آمن للتكرار |
| `dokploy_request` | أي إجراء آخر في واجهة Dokploy (`router.procedure`) |

## النشر بأمر واحد (بلا MCP)

```bash
DOKPLOY_URL=http://169.58.44.17:3000 DOKPLOY_API_KEY=... \
  node tools/dokploy-mcp/deploy-sema.mjs --environment bUJ4MImQuxAWrItAswXqn --domain semalibya.ly
```

خيارات: `--mode init --admin-email … --admin-name …` لقاعدة إنتاج نظيفة · `--github-id …` لمستودع خاص ·
`--branch …` · `--no-www` · `--no-deploy`.

ما يفعله `dokploy_deploy_sema` بالترتيب — ويُنشئ ما ينقص ويحدّث ما وُجد فيصلح تكراره:
1. يجد تطبيق `sema-alkhayr` في البيئة أو يُنشئه.
2. يربطه بالمستودع والفرع.
3. البناء بـ `Dockerfile`.
4. المتغيرات: `SEMA_AUTO_SEED` و`SEMA_DEMO` و`SEMA_PUBLIC_URL` و`SEMA_TRUST_PROXY` (والمدير والبريد في وضع init).
5. تخزين دائم `sema-alkhayr-data` على `/data`.
6. النطاق و`www` على المنفذ 3000 بشهادة Let's Encrypt.
7. يبدأ النشر.

> المستودع الخاص: رابط HTTPS المباشر لا يعمل بلا صلاحية؛ اربط GitHub في Dokploy (Settings ← Git ← GitHub)
> ثم مرّر `githubId` من `dokploy_list_github_providers`.

## الاختبار

```bash
npm --prefix tools/dokploy-mcp test     # يشغّل Dokploy وهمياً ويختبر الأدوات عبر عميل MCP حقيقي
```
