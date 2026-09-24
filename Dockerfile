# نظام «سِيمَا الخَيْر» — صورة إنتاج
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    SEMA_DATA_DIR=/data \
    SEMA_DEMO=0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY server ./server
COPY public ./public
COPY scripts ./scripts

# البيانات (قاعدة البيانات والمستندات المحمَّلة والنسخ الاحتياطية) في مجلد مستقل يبقى بعد تحديث الصورة
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
