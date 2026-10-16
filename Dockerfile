# --- Build: pnpm workspace (Vue 3 + Vite front end, NestJS + Fastify API) ---
FROM node:22-alpine AS build
RUN npm install -g pnpm@10.30.3
WORKDIR /repo
# Manifests alone first: the dependency layer stays cached as long as they do not change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY api/tsconfig.json api/tsconfig.build.json api/
COPY api/src api/src
COPY web/ web/
RUN pnpm -r build
# The API alone with its production dependencies, in a self-contained node_modules.
RUN pnpm --filter discoverr-api deploy --prod --legacy /out/api

# --- Final image: the API also serves the front end ---
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
# Runs as 1000:1000 (compose "user:"): the SQLite database and the session key are in the /data volume.
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
