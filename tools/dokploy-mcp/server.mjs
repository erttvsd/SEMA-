#!/usr/bin/env node
/**
 * Dokploy MCP — خادم MCP (stdio) لإدارة Dokploy من Claude أو أي عميل MCP.
 *   DOKPLOY_URL=http://169.58.44.17:3000  DOKPLOY_API_KEY=...  node server.mjs
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createClient, deploySema, DokployError } from './dokploy.mjs';

let client;
const api = () => (client ??= createClient());

const MAX = 25_000;
function ok(data) {
  let text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  if (text.length > MAX) text = text.slice(0, MAX) + `\n… (اقتُطع — ${text.length} حرفاً؛ استعمل مرشّحات أضيق)`;
  return { content: [{ type: 'text', text }] };
}
function fail(e) {
  const msg = e instanceof DokployError ? e.message : `خطأ غير متوقع: ${e.message}`;
  return { isError: true, content: [{ type: 'text', text: msg }] };
}
const wrap = (fn) => async (args) => { try { return ok(await fn(args)); } catch (e) { return fail(e); } };

const server = new McpServer({ name: 'dokploy-mcp', version: '1.0.0' });
const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WR = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const appId = z.string().min(1).describe('معرّف التطبيق (applicationId)');

// ---------------- اطلاع ----------------
server.registerTool('dokploy_list_projects', {
  title: 'المشاريع', description: 'يسرد مشاريع Dokploy وبيئاتها وخدماتها (project.all).', inputSchema: {}, annotations: RO,
}, wrap(async () => (await api().listProjects()).map((p) => ({
  projectId: p.projectId, name: p.name,
  environments: (p.environments || []).map((e) => ({ environmentId: e.environmentId, name: e.name,
    applications: (e.applications || []).map((a) => ({ applicationId: a.applicationId, name: a.name, status: a.applicationStatus })) })),
}))));

server.registerTool('dokploy_get_environment', {
  title: 'البيئة', description: 'تفاصيل بيئة وتطبيقاتها (environment.one). المعرّف في رابط Dokploy بعد /environment/.',
  inputSchema: { environmentId: z.string().min(1) }, annotations: RO,
}, wrap(({ environmentId }) => api().getEnvironment(environmentId)));

server.registerTool('dokploy_get_application', {
  title: 'التطبيق', description: 'تفاصيل تطبيق: المصدر والبناء والحالة والنطاقات (application.one).',
  inputSchema: { applicationId: appId }, annotations: RO,
}, wrap(({ applicationId }) => api().getApplication(applicationId)));

server.registerTool('dokploy_list_deployments', {
  title: 'عمليات النشر', description: 'عمليات نشر تطبيق بحالتها (deployment.all) — الأحدث أولاً.',
  inputSchema: { applicationId: appId, limit: z.number().int().min(1).max(50).default(10) }, annotations: RO,
}, wrap(async ({ applicationId, limit }) => (await api().listDeployments(applicationId) || []).slice(0, limit)
  .map((d) => ({ deploymentId: d.deploymentId, title: d.title, status: d.status, createdAt: d.createdAt, errorMessage: d.errorMessage }))));

server.registerTool('dokploy_deployment_logs', {
  title: 'سجل عملية نشر', description: 'سجل البناء والنشر لعملية واحدة (deployment.readLogs) — لتشخيص فشل البناء.',
  inputSchema: { deploymentId: z.string().min(1), tail: z.number().int().min(1).max(10000).default(200) }, annotations: RO,
}, wrap(({ deploymentId, tail }) => api().deploymentLogs({ deploymentId, tail })));

server.registerTool('dokploy_app_logs', {
  title: 'سجل التطبيق', description: 'سجل الحاوية العاملة (application.readLogs). since مثل 10m أو 2h أو all.',
  inputSchema: { applicationId: appId, tail: z.number().int().min(1).max(10000).default(200),
    since: z.string().regex(/^(all|\d+[smhd])$/).default('all'), search: z.string().regex(/^[a-zA-Z0-9 ._-]{0,500}$/).optional() },
  annotations: RO,
}, wrap((a) => api().appLogs(a)));

server.registerTool('dokploy_list_github_providers', {
  title: 'مزوّدو GitHub', description: 'حسابات GitHub المربوطة بـ Dokploy (github.githubProviders) — githubId يلزم للمستودعات الخاصة.',
  inputSchema: {}, annotations: RO,
}, wrap(() => api().listGithubProviders()));

// ---------------- إعداد ----------------
server.registerTool('dokploy_create_application', {
  title: 'إنشاء تطبيق', description: 'يُنشئ تطبيقاً في بيئة (application.create).',
  inputSchema: { environmentId: z.string().min(1), name: z.string().min(1), appName: z.string().regex(/^[a-z0-9-]+$/).optional(),
    description: z.string().optional() }, annotations: WR,
}, wrap((a) => api().createApplication(a)));

server.registerTool('dokploy_set_git_source', {
  title: 'مصدر Git', description: 'يربط التطبيق بمستودع: عام برابط (saveGitProvider)، أو خاص عبر مزوّد GitHub المربوط (githubId).',
  inputSchema: { applicationId: appId, url: z.string().url().describe('https://github.com/owner/repo.git'),
    branch: z.string().default('main'), buildPath: z.string().default('/'), githubId: z.string().optional() }, annotations: WR,
}, wrap(async ({ applicationId, url, branch, buildPath, githubId }) => {
  if (githubId) {
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
    if (!m) throw new DokployError('رابط GitHub غير مفهوم');
    return api().saveGithubProvider({ applicationId, githubId, owner: m[1], repository: m[2], branch, buildPath });
  }
  return api().saveGitProvider({ applicationId, url, branch, buildPath });
}));

server.registerTool('dokploy_set_build', {
  title: 'نوع البناء', description: 'نوع البناء (application.saveBuildType) — الافتراضي Dockerfile.',
  inputSchema: { applicationId: appId, buildType: z.enum(['dockerfile', 'nixpacks', 'heroku_buildpacks', 'paketo_buildpacks', 'static', 'railpack']).default('dockerfile'),
    dockerfile: z.string().default('Dockerfile'), dockerContextPath: z.string().default('') }, annotations: WR,
}, wrap((a) => api().saveBuildType(a)));

server.registerTool('dokploy_set_env', {
  title: 'المتغيرات', description: 'يستبدل متغيرات البيئة كلها (application.saveEnvironment). أرسل كائناً {KEY: value} أو نصاً KEY=value بأسطر.',
  inputSchema: { applicationId: appId, env: z.union([z.record(z.string()), z.string()]) }, annotations: { ...WR, idempotentHint: true },
}, wrap(({ applicationId, env }) => api().saveEnvironment({ applicationId,
  env: typeof env === 'string' ? env : Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') })));

server.registerTool('dokploy_add_volume', {
  title: 'تخزين دائم', description: 'يربط مجلداً دائماً بالحاوية (mounts.create) — لازم لكل تطبيق يحفظ بيانات.',
  inputSchema: { applicationId: appId, volumeName: z.string().regex(/^[a-zA-Z0-9_.-]+$/), mountPath: z.string().startsWith('/') }, annotations: WR,
}, wrap((a) => api().createMount({ ...a, type: 'volume' })));

server.registerTool('dokploy_add_domain', {
  title: 'نطاق', description: 'يضيف نطاقاً للتطبيق (domain.create) بشهادة Let\'s Encrypt افتراضاً. يلزم أن يشير سجل A إلى الخادم.',
  inputSchema: { applicationId: appId, host: z.string().min(3), port: z.number().int().min(1).max(65535).default(3000),
    https: z.boolean().default(true), path: z.string().default('/') }, annotations: WR,
}, wrap((a) => api().createDomain(a)));

server.registerTool('dokploy_deploy', {
  title: 'نشر', description: 'يبدأ نشر التطبيق (application.deploy)، أو إعادة نشر بلا بناء (redeploy=true).',
  inputSchema: { applicationId: appId, title: z.string().optional(), redeploy: z.boolean().default(false) }, annotations: WR,
}, wrap(({ applicationId, title, redeploy }) => (redeploy ? api().redeploy : api().deploy)({ applicationId, title })));

server.registerTool('dokploy_deploy_sema', {
  title: 'نشر «سِيمَا الخَيْر»',
  description: 'يُنشئ أو يحدّث تطبيق «سِيمَا الخَيْر» ويضبطه كاملاً ثم ينشره: المصدر، Dockerfile، المتغيرات، تخزين /data، النطاق وwww بشهادة HTTPS. آمن للتكرار.',
  inputSchema: {
    environmentId: z.string().optional().describe('من رابط Dokploy بعد /environment/'),
    projectId: z.string().optional().describe('بديل: أول بيئة إنتاج في المشروع'),
    domain: z.string().default('semalibya.ly'), www: z.boolean().default(true),
    mode: z.enum(['demo', 'init']).default('demo').describe('demo: بيانات تصويرية · init: قاعدة إنتاج نظيفة'),
    adminEmail: z.string().email().optional(), adminName: z.string().optional(), adminPassword: z.string().optional(),
    smtpUrl: z.string().optional(), githubId: z.string().optional().describe('للمستودع الخاص: من dokploy_list_github_providers'),
    branch: z.string().optional(), repoUrl: z.string().optional(), deploy: z.boolean().default(true),
  },
  annotations: WR,
}, wrap((a) => deploySema(api(), Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)))));

// ---------------- منفذ عام ----------------
server.registerTool('dokploy_request', {
  title: 'طلب مباشر', description: 'أي إجراء في واجهة Dokploy لم تغطّه الأدوات: procedure بصيغة router.procedure (مثل application.stop)، وGET للاستعلام وPOST للأوامر.',
  inputSchema: { method: z.enum(['GET', 'POST']), procedure: z.string().regex(/^[a-zA-Z]+\.[a-zA-Z]+$/), input: z.record(z.any()).optional() },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
}, wrap(({ method, procedure, input }) => api().request(method, procedure, input)));

await server.connect(new StdioServerTransport());
