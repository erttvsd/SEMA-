/**
 * عميل Dokploy — يغلّف واجهة Dokploy البرمجية (tRPC-OpenAPI):
 *   الاستعلامات  GET  {DOKPLOY_URL}/api/<router>.<procedure>?<input>
 *   الأوامر      POST {DOKPLOY_URL}/api/<router>.<procedure>   (JSON)
 *   المصادقة     ترويسة x-api-key  (Dokploy ← Settings ← Profile ← API/CLI ← Generate)
 *
 * أسماء الإجراءات وحقولها مأخوذة من مصدر Dokploy (apps/dokploy/server/api/routers و packages/server/src/db/schema).
 */

import { ProxyAgent, fetch as ufetch } from 'undici';

/**
 * الوكيل: إن ضُبط HTTPS_PROXY (أو HTTP_PROXY) مرّ الطلب عبر نفق CONNECT — ولو كان الهدف http —
 * لأن كثيراً من البيئات المُدارة لا تسمح بالاتصال المباشر. ويُتجاوز الوكيل لما في NO_PROXY.
 */
function proxyFor(target) {
  const proxy = process.env.DOKPLOY_PROXY || process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy;
  if (!proxy || process.env.DOKPLOY_PROXY === 'off') return null;
  const host = new URL(target).hostname;
  const skip = String(process.env.NO_PROXY || process.env.no_proxy || '').split(',').map((x) => x.trim()).filter(Boolean)
    .some((p) => p === '*' || host === p || (p.startsWith('.') && host.endsWith(p)) || (p.startsWith('*.') && host.endsWith(p.slice(1))) || (!p.includes('/') && host.endsWith('.' + p)));
  return skip ? null : proxy;
}
const agents = new Map();
const agentFor = (proxy) => { if (!agents.has(proxy)) agents.set(proxy, new ProxyAgent({ uri: proxy, requestTls: { rejectUnauthorized: true } })); return agents.get(proxy); };

export class DokployError extends Error {
  constructor(message, { status, path, body } = {}) {
    super(message);
    this.status = status; this.path = path; this.body = body;
  }
}

export function createClient({ url = process.env.DOKPLOY_URL, apiKey = process.env.DOKPLOY_API_KEY, timeoutMs = 60_000 } = {}) {
  if (!url) throw new DokployError('DOKPLOY_URL غير مضبوط — مثال: http://169.58.44.17:3000');
  if (!apiKey) throw new DokployError('DOKPLOY_API_KEY غير مضبوط — أنشئه من Dokploy: Settings ← Profile ← API/CLI');
  const base = String(url).replace(/\/+$/, '').replace(/\/api$/, '');

  async function request(method, procedure, input) {
    const m = String(method || 'GET').toUpperCase();
    const proc = String(procedure).replace(/^\/?(api\/)?/, '');
    if (!/^[a-zA-Z]+\.[a-zA-Z]+$/.test(proc)) throw new DokployError(`اسم إجراء غير صالح: «${procedure}» — الصيغة router.procedure مثل project.all`);
    let target = `${base}/api/${proc}`;
    const init = { method: m, headers: { 'x-api-key': apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) };
    if (m === 'GET') {
      if (input && Object.keys(input).length) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null) qs.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        target += '?' + qs.toString();
      }
    } else {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(input ?? {});
    }
    let res;
    const proxy = proxyFor(target);
    try { res = proxy ? await ufetch(target, { ...init, dispatcher: agentFor(proxy) }) : await fetch(target, init); }
    catch (e) {
      const c = e.cause?.code || e.cause?.message || e.message;
      const hint = /403|407/.test(String(c)) ? ' — الوكيل رفض الاتصال: أضف الخادم إلى النطاقات المسموحة في إعدادات الشبكة' : '';
      throw new DokployError(`تعذّر الاتصال بـ ${base}${proxy ? ' (عبر الوكيل)' : ''}: ${c}${hint}`, { path: proc });
    }
    const text = await res.text();
    let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const msg = (body && (body.message || body.error?.message)) || text.slice(0, 300) || res.statusText;
      const hint = res.status === 401 ? ' — مفتاح API غير صالح أو منتهٍ'
        : res.status === 404 ? ' — الإجراء أو المعرّف غير موجود (قد يختلف الاسم في إصدار Dokploy لديك)'
        : res.status === 400 ? ' — مدخلات غير صالحة؛ راجع الحقول' : '';
      throw new DokployError(`${m} ${proc} ← ${res.status}: ${msg}${hint}`, { status: res.status, path: proc, body });
    }
    return body;
  }

  const get = (p, i) => request('GET', p, i);
  const post = (p, i) => request('POST', p, i);

  return {
    base, request, get, post,
    // ---------- المشاريع والبيئات ----------
    listProjects: () => get('project.all'),
    getProject: (projectId) => get('project.one', { projectId }),
    listEnvironments: (projectId) => get('environment.byProjectId', { projectId }),
    getEnvironment: (environmentId) => get('environment.one', { environmentId }),
    // ---------- التطبيقات ----------
    getApplication: (applicationId) => get('application.one', { applicationId }),
    createApplication: ({ environmentId, name, appName, description, serverId }) =>
      post('application.create', { environmentId, name, appName, description, serverId }),
    saveGitProvider: ({ applicationId, url, branch = 'main', buildPath = '/', watchPaths = [], enableSubmodules = false, sshKeyId }) =>
      post('application.saveGitProvider', { applicationId, customGitUrl: url, customGitBranch: branch, customGitBuildPath: buildPath,
        watchPaths, enableSubmodules, ...(sshKeyId ? { customGitSSHKeyId: sshKeyId } : {}) }),
    saveGithubProvider: ({ applicationId, githubId, owner, repository, branch = 'main', buildPath = '/', watchPaths = [], enableSubmodules = false }) =>
      post('application.saveGithubProvider', { applicationId, githubId, owner, repository, branch, buildPath, triggerType: 'push', watchPaths, enableSubmodules }),
    listGithubProviders: () => get('github.githubProviders'),
    saveBuildType: ({ applicationId, buildType = 'dockerfile', dockerfile = 'Dockerfile', dockerContextPath = '', dockerBuildStage = '' }) =>
      post('application.saveBuildType', { applicationId, buildType, dockerfile, dockerContextPath, dockerBuildStage, herokuVersion: '', railpackVersion: '' }),
    saveEnvironment: ({ applicationId, env, buildArgs = '', buildSecrets = '', createEnvFile = false }) =>
      post('application.saveEnvironment', { applicationId, env, buildArgs, buildSecrets, createEnvFile }),
    deploy: ({ applicationId, title, description }) => post('application.deploy', { applicationId, title, description }),
    redeploy: ({ applicationId, title, description }) => post('application.redeploy', { applicationId, title, description }),
    stop: (applicationId) => post('application.stop', { applicationId }),
    start: (applicationId) => post('application.start', { applicationId }),
    appLogs: ({ applicationId, tail = 200, since = 'all', search }) => get('application.readLogs', { applicationId, tail, since, search }),
    // ---------- التخزين ----------
    createMount: ({ applicationId, type = 'volume', volumeName, hostPath, mountPath, content, filePath }) =>
      post('mounts.create', { serviceId: applicationId, serviceType: 'application', type, volumeName, hostPath, mountPath, content, filePath }),
    listMounts: (applicationId) => get('mounts.listByServiceId', { serviceId: applicationId, serviceType: 'application' }),
    // ---------- النطاقات ----------
    createDomain: ({ applicationId, host, path = '/', port = 3000, https = true, certificateType = 'letsencrypt' }) =>
      post('domain.create', { applicationId, host, path, port, https, certificateType: https ? certificateType : 'none', domainType: 'application' }),
    listDomains: (applicationId) => get('domain.byApplicationId', { applicationId }),
    // ---------- عمليات النشر ----------
    listDeployments: (applicationId) => get('deployment.all', { applicationId }),
    deploymentLogs: ({ deploymentId, tail = 200 }) => get('deployment.readLogs', { deploymentId, tail }),
  };
}

// ======================================================================
//  نشر «سِيمَا الخَيْر» — متكرر بأمان: يُنشئ ما ينقص ويحدّث ما وُجد
// ======================================================================
const SEMA_REPO = 'https://github.com/erttvsd/SEMA-.git';
const SEMA_BRANCH = 'claude/comprehensive-admin-system-qk7c3i';

/** قائمة التطبيقات في بيئة — Dokploy يُرجعها ضمن environment.one */
const appsOf = (env) => env?.applications || env?.project?.applications || [];

export async function deploySema(client, {
  environmentId, projectId, domain = 'semalibya.ly', www = true, name = 'sema-alkhayr',
  repoUrl = SEMA_REPO, branch = SEMA_BRANCH, githubId, mode = 'demo',
  adminEmail, adminName, adminPassword, smtpUrl, extraEnv = {}, deploy = true, log = () => {},
} = {}) {
  const steps = [];
  const step = (s, detail) => { steps.push({ step: s, ...(detail ? { detail } : {}) }); log(`• ${s}${detail ? ' — ' + detail : ''}`); };

  // 1) البيئة
  if (!environmentId) {
    if (!projectId) throw new DokployError('حدّد environmentId (من رابط Dokploy: /project/<projectId>/environment/<environmentId>) أو projectId');
    const envs = await client.listEnvironments(projectId);
    const pick = (envs || []).find((e) => /prod/i.test(e.name)) || (envs || [])[0];
    if (!pick) throw new DokployError('لا بيئات في المشروع');
    environmentId = pick.environmentId;
  }
  const env = await client.getEnvironment(environmentId);
  step('البيئة', `${env?.name || environmentId}${env?.project?.name ? ' في مشروع ' + env.project.name : ''}`);

  // 2) التطبيق: موجود بالاسم أو يُنشأ
  let app = appsOf(env).find((a) => a.name === name || a.appName?.startsWith(name));
  if (app) step('التطبيق موجود', app.applicationId);
  else {
    app = await client.createApplication({ environmentId, name, appName: name, description: 'نظام إدارة علامة «سِيمَا الخَيْر»' });
    step('أُنشئ التطبيق', app.applicationId);
  }
  const applicationId = app.applicationId;

  // 3) المصدر
  if (githubId) {
    const m = String(repoUrl).match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/);
    if (!m) throw new DokployError(`رابط GitHub غير مفهوم: ${repoUrl}`);
    await client.saveGithubProvider({ applicationId, githubId, owner: m[1], repository: m[2], branch });
    step('المصدر: GitHub', `${m[1]}/${m[2]} @ ${branch}`);
  } else {
    await client.saveGitProvider({ applicationId, url: repoUrl, branch });
    step('المصدر: Git', `${repoUrl} @ ${branch}`);
  }

  // 4) البناء
  await client.saveBuildType({ applicationId, buildType: 'dockerfile', dockerfile: 'Dockerfile' });
  step('البناء', 'Dockerfile');

  // 5) المتغيرات
  const vars = { SEMA_PUBLIC_URL: `https://${domain}`, SEMA_TRUST_PROXY: '1' };
  if (mode === 'init') {
    if (!adminEmail || !adminName) throw new DokployError('وضع init يلزمه adminEmail و adminName');
    Object.assign(vars, { SEMA_AUTO_SEED: 'init', SEMA_DEMO: '0', SEMA_ADMIN_EMAIL: adminEmail, SEMA_ADMIN_NAME: adminName });
    if (adminPassword) vars.SEMA_ADMIN_PASSWORD = adminPassword;
  } else Object.assign(vars, { SEMA_AUTO_SEED: 'demo', SEMA_DEMO: '1' });
  if (smtpUrl) vars.SEMA_SMTP_URL = smtpUrl;
  Object.assign(vars, extraEnv);
  await client.saveEnvironment({ applicationId, env: Object.entries(vars).map(([k, v]) => `${k}=${v}`).join('\n') });
  step('المتغيرات', Object.keys(vars).join(' · '));

  // 6) التخزين الدائم على /data — بدونه تضيع البيانات مع كل نشر
  const mounts = await client.listMounts(applicationId).catch(() => []);
  if ((mounts || []).some((m) => m.mountPath === '/data')) step('التخزين موجود', '/data');
  else { await client.createMount({ applicationId, type: 'volume', volumeName: `${name}-data`, mountPath: '/data' }); step('أُنشئ التخزين', `${name}-data ← /data`); }

  // 7) النطاقات بشهادة Let's Encrypt
  const existing = new Set(((await client.listDomains(applicationId).catch(() => [])) || []).map((d) => d.host));
  for (const host of [domain, ...(www ? [`www.${domain}`] : [])]) {
    if (existing.has(host)) { step('النطاق موجود', host); continue; }
    await client.createDomain({ applicationId, host, port: 3000, https: true, certificateType: 'letsencrypt' });
    step('أُضيف النطاق', `https://${host} ← المنفذ 3000`);
  }

  // 8) النشر
  if (deploy) { await client.deploy({ applicationId, title: 'نشر «سِيمَا الخَيْر»' }); step('بدأ النشر', 'البناء يستغرق دقائق — تابعه بقائمة عمليات النشر وسجلاتها'); }
  return { applicationId, environmentId, url: `https://${domain}`, steps };
}
