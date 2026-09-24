#!/usr/bin/env node
/**
 * نشر «سِيمَا الخَيْر» على Dokploy بأمر واحد (بلا MCP):
 *   DOKPLOY_URL=http://169.58.44.17:3000 DOKPLOY_API_KEY=... \
 *     node deploy-sema.mjs --environment bUJ4MImQuxAWrItAswXqn --domain semalibya.ly [--mode demo|init] [--github-id ...]
 */
import { createClient, deploySema } from './dokploy.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes('--' + k);

try {
  const out = await deploySema(createClient(), {
    environmentId: arg('environment'), projectId: arg('project'), domain: arg('domain', 'semalibya.ly'), www: !flag('no-www'),
    mode: arg('mode', 'demo'), githubId: arg('github-id'), branch: arg('branch'), repoUrl: arg('repo'),
    adminEmail: arg('admin-email'), adminName: arg('admin-name'), adminPassword: process.env.SEMA_ADMIN_PASSWORD,
    smtpUrl: process.env.SEMA_SMTP_URL, deploy: !flag('no-deploy'), log: (s) => console.log(s),
  });
  console.log(`\n✓ ${out.url}  (applicationId ${out.applicationId})`);
} catch (e) {
  console.error('✗ ' + e.message);
  process.exit(1);
}
