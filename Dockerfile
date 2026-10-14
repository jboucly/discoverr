# --- Front (Vue 3 + Vite) ---
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# --- API (NestJS + Fastify) ---
FROM node:22-alpine AS api
WORKDIR /api
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/tsconfig.json api/tsconfig.build.json ./
COPY api/src ./src
RUN npm run build && npm prune --omit=dev

# --- Image finale : l'API sert aussi le front ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIR=/app/web
COPY --from=api /api/node_modules ./node_modules
COPY --from=api /api/dist ./dist
COPY --from=api /api/package.json ./
COPY --from=web /web/dist ./web
RUN mkdir -p /data && chown node:node /data
# Tourne en 1000:1000 (compose "user:") : la base SQLite et la clé de session sont dans le volume /data.
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
