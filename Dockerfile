# --- Build : workspace pnpm (front Vue 3 + Vite, API NestJS + Fastify) ---
FROM node:22-alpine AS build
RUN npm install -g pnpm@10.30.3
WORKDIR /repo
# Les manifestes seuls d'abord : la couche des dépendances reste en cache tant qu'ils ne changent pas.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY api/tsconfig.json api/tsconfig.build.json api/
COPY api/src api/src
COPY web/ web/
RUN pnpm -r build
# L'API seule avec ses dépendances de production, dans un node_modules autonome.
RUN pnpm --filter discoverr-api deploy --prod --legacy /out/api

# --- Image finale : l'API sert aussi le front ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    WEB_DIR=/app/web
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /out/api/package.json ./
COPY --from=build /repo/api/dist ./dist
COPY --from=build /repo/web/dist ./web
RUN mkdir -p /data && chown node:node /data
# Tourne en 1000:1000 (compose "user:") : la base SQLite et la clé de session sont dans le volume /data.
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
