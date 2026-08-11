FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libchromaprint-tools \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false \
    && npm cache clean --force

COPY account-store.js env-config.js media-scanner.js media-store.js media-utils.js metadata-manager.js ./
COPY server.js streaming.js tmdb-service.js job-manager.js stream-manager.js system-monitor.js hls-manager.js intro-detector.js ./
COPY web ./web
COPY myflix-electric/assets/generated-3d/*-web.webp ./myflix-electric/assets/generated-3d/
COPY myflix-electric/assets/generated-3d/cinema-room-v3.png ./myflix-electric/assets/generated-3d/

RUN mkdir -p /data/cache/subtitles /data/cache/hls /data/backups /data/custom-posters \
    && chown -R node:node /data

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
