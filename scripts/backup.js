'use strict';
/** نسخة احتياطية من سطر الأوامر (للجدولة بـ cron خارج الخادم) — npm run backup */
const B = require('../server/backup');
const b = B.makeBackup('سطر الأوامر');
console.log(`${b.integrity === 'ok' ? '✓' : '✗'} ${B.BACKUP_DIR}/${b.file_name}`);
console.log(`  الحجم ${b.size_bytes} بايت · السلامة: ${b.integrity} · SHA-256 ${b.sha256}`);
if (b.integrity !== 'ok') process.exit(1);
