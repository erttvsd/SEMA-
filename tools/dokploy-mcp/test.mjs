/**
 * اختبار خادم MCP مقابل Dokploy وهمي محلي يتحقق من المسارات والحقول ومفتاح API،
 * عبر عميل MCP حقيقي على stdio.   node test.mjs
 */
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

let pass = 0, fail = 0;
const T = (n, c, x) => { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (x !== undefined ? '  → ' + JSON.stringify(x).slice(0, 300) : '')); } };

// ---------------- Dokploy وهمي ----------------
const KEY = 'test-key';
const calls = [];
const state = { apps: [], mounts: [], domains: [], env: null, deployed: 0 };
const need = (b, fields) => fields.filter((f) => !(f in b));
const routes = {
  'GET project.all': () => [{ projectId: 'P1', name: 'SEMA', environments: [{ environmentId: 'E1', name: 'production', applications: state.apps }] }],
  'GET environment.one': (q) => q.environmentId === 'E1' ? { environmentId: 'E1', name: 'production', project: { name: 'SEMA' }, applications: state.apps } : [404, { message: 'Environment not found' }],
  'POST application.create': (b) => { const m = need(b, ['environmentId', 'name']); if (m.length) return [400, { message: 'missing ' + m }];
    const a = { applicationId: 'A' + (state.apps.length + 1), name: b.name, appName: b.appName, applicationStatus: 'idle' }; state.apps.push(a); return a; },
  'POST application.saveGitProvider': (b) => { const m = need(b, ['applicationId', 'customGitUrl', 'customGitBranch', 'customGitBuildPath', 'watchPaths', 'enableSubmodules']); return m.length ? [400, { message: 'missing ' + m }] : true; },
  'POST application.saveGithubProvider': (b) => { const m = need(b, ['applicationId', 'githubId', 'owner', 'repository', 'branch', 'buildPath', 'triggerType']); return m.length ? [400, { message: 'missing ' + m }] : true; },
  'POST application.saveBuildType': (b) => { const m = need(b, ['applicationId', 'buildType', 'dockerfile', 'dockerContextPath', 'dockerBuildStage', 'herokuVersion', 'railpackVersion']); return m.length ? [400, { message: 'missing ' + m }] : true; },
  'POST application.saveEnvironment': (b) => { const m = need(b, ['applicationId', 'env', 'buildArgs', 'buildSecrets', 'createEnvFile']); if (m.length) return [400, { message: 'missing ' + m }]; state.env = b.env; return true; },
  'GET mounts.listByServiceId': () => state.mounts,
  'POST mounts.create': (b) => { const m = need(b, ['serviceId', 'serviceType', 'type', 'mountPath']); if (m.length) return [400, { message: 'missing ' + m }]; state.mounts.push(b); return true; },
  'GET domain.byApplicationId': () => state.domains,
  'POST domain.create': (b) => { const m = need(b, ['applicationId', 'host', 'port', 'https', 'certificateType']); if (m.length) return [400, { message: 'missing ' + m }]; state.domains.push(b); return b; },
  'POST application.deploy': () => { state.deployed++; return true; },
  'GET deployment.all': () => [{ deploymentId: 'D1', title: 'نشر', status: 'done', createdAt: '2026-09-24' }],
  'GET application.readLogs': (q) => `logs tail=${q.tail} since=${q.since}`,
};
const mock = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (req.headers['x-api-key'] !== KEY) return send(401, { message: 'Unauthorized' });
    const proc = u.pathname.replace(/^\/api\//, '');
    const h = routes[`${req.method} ${proc}`];
    const input = req.method === 'GET' ? Object.fromEntries(u.searchParams) : JSON.parse(body || '{}');
    calls.push({ m: req.method, proc, input });
    if (!h) return send(404, { message: `No procedure ${proc}` });
    const out = h(input);
    Array.isArray(out) && typeof out[0] === 'number' ? send(out[0], out[1]) : send(200, out);
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${mock.address().port}`;

async function connect(key = KEY) {
  const c = new Client({ name: 'test', version: '1' });
  await c.connect(new StdioClientTransport({ command: process.execPath, args: ['server.mjs'], cwd: new URL('.', import.meta.url).pathname,
    env: { ...process.env, DOKPLOY_URL: url, DOKPLOY_API_KEY: key, NO_PROXY: '127.0.0.1', no_proxy: '127.0.0.1' } }));
  return c;
}
const call = async (c, name, args = {}) => { const r = await c.callTool({ name, arguments: args }); const t = r.content[0].text; let d; try { d = JSON.parse(t); } catch { d = t; } return { err: !!r.isError, d, t }; };

const c = await connect();
const tools = (await c.listTools()).tools.map((t) => t.name);
T('الأدوات مسجّلة', ['dokploy_list_projects', 'dokploy_deploy_sema', 'dokploy_add_domain', 'dokploy_request', 'dokploy_deployment_logs'].every((n) => tools.includes(n)), tools);

let r = await call(c, 'dokploy_list_projects');
T('سرد المشاريع', !r.err && r.d[0].projectId === 'P1' && r.d[0].environments[0].environmentId === 'E1', r.t);

r = await call(c, 'dokploy_deploy_sema', { environmentId: 'E1', domain: 'semalibya.ly' });
T('نشر «سِيمَا الخَيْر» ينجح', !r.err && r.d.applicationId === 'A1' && r.d.url === 'https://semalibya.ly', r.t);
T('المصدر: الفرع الصحيح', calls.some((x) => x.proc === 'application.saveGitProvider' && x.input.customGitBranch === 'claude/comprehensive-admin-system-qk7c3i' && /SEMA-\.git$/.test(x.input.customGitUrl)));
T('البناء: Dockerfile', calls.some((x) => x.proc === 'application.saveBuildType' && x.input.buildType === 'dockerfile' && x.input.dockerfile === 'Dockerfile'));
T('المتغيرات: وضع العرض والعنوان العام', /SEMA_AUTO_SEED=demo/.test(state.env) && /SEMA_PUBLIC_URL=https:\/\/semalibya\.ly/.test(state.env) && /SEMA_TRUST_PROXY=1/.test(state.env), state.env);
T('تخزين دائم على /data', state.mounts.length === 1 && state.mounts[0].mountPath === '/data' && state.mounts[0].type === 'volume' && state.mounts[0].serviceType === 'application');
T('النطاقان بشهادة Let\'s Encrypt على المنفذ 3000', state.domains.map((d) => d.host).join() === 'semalibya.ly,www.semalibya.ly' &&
  state.domains.every((d) => d.https === true && d.certificateType === 'letsencrypt' && d.port === 3000));
T('بدأ النشر', state.deployed === 1);

r = await call(c, 'dokploy_deploy_sema', { environmentId: 'E1', domain: 'semalibya.ly' });
T('التكرار آمن: لا تطبيق ثانٍ ولا تخزين ولا نطاق مكرر', !r.err && state.apps.length === 1 && state.mounts.length === 1 && state.domains.length === 2 && state.deployed === 2, r.d.steps);

r = await call(c, 'dokploy_deploy_sema', { environmentId: 'E1', mode: 'init' });
T('وضع الإنتاج بلا بيانات المدير ← خطأ واضح', r.err && /adminEmail/.test(r.t), r.t);
r = await call(c, 'dokploy_deploy_sema', { environmentId: 'E1', mode: 'init', adminEmail: 'director@semalibya.ly', adminName: 'المدير التنفيذي' });
T('وضع الإنتاج يضبط init ويخفي الحسابات التصويرية', !r.err && /SEMA_AUTO_SEED=init/.test(state.env) && /SEMA_DEMO=0/.test(state.env) && /SEMA_ADMIN_EMAIL=director@semalibya\.ly/.test(state.env), state.env);

r = await call(c, 'dokploy_set_git_source', { applicationId: 'A1', url: 'https://github.com/erttvsd/SEMA-.git', branch: 'main', githubId: 'G1' });
T('مستودع خاص عبر مزوّد GitHub', !r.err && calls.some((x) => x.proc === 'application.saveGithubProvider' && x.input.owner === 'erttvsd' && x.input.repository === 'SEMA-'), r.t);

r = await call(c, 'dokploy_set_env', { applicationId: 'A1', env: { A: '1', B: 'x=y' } });
T('المتغيرات من كائن', !r.err && state.env === 'A=1\nB=x=y', state.env);
r = await call(c, 'dokploy_app_logs', { applicationId: 'A1', tail: 50, since: '10m' });
T('سجل التطبيق بمعاملات الاستعلام', !r.err && r.d === 'logs tail=50 since=10m', r.t);
r = await call(c, 'dokploy_list_deployments', { applicationId: 'A1' });
T('عمليات النشر', !r.err && r.d[0].deploymentId === 'D1');
r = await call(c, 'dokploy_request', { method: 'GET', procedure: 'nothing.here' });
T('إجراء غير موجود ← رسالة 404 مفهومة', r.err && /404/.test(r.t) && /غير موجود/.test(r.t), r.t);
r = await call(c, 'dokploy_get_environment', { environmentId: 'NOPE' });
T('معرّف غير موجود ← خطأ لا انهيار', r.err && /404/.test(r.t), r.t);
await c.close();

const bad = await connect('wrong-key');
r = await call(bad, 'dokploy_list_projects');
T('مفتاح خاطئ ← رسالة 401 واضحة', r.err && /401/.test(r.t) && /مفتاح API/.test(r.t), r.t);
await bad.close();

mock.close();
console.log(`\n======== النتيجة: ${pass} ناجح · ${fail} فاشل ========`);
process.exit(fail ? 1 : 0);
