# Aurora (Téchne Care) — imagem de produção da API (NestJS) e dos workers (pg-boss).
#
# Uma imagem, dois processos: o HostPanel (PostgreSQL VPS) sobe a API com
# `node apps/api/dist/main.js` e os workers com `node apps/workers/dist/main.js`;
# as migrations rodam one-off com `node tools/db/run.mjs migrate`.
# Nada de tsx em runtime: o que roda é o JavaScript do `tsc -b`.

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY . .
RUN npm ci --no-audit --no-fund
RUN npx tsc -b apps/api apps/workers
RUN node tools/imagem/apontar-dist.mjs
RUN npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    AURORA_COMPILADO=1 \
    AURORA_PORT=3000 \
    AURORA_ARQUIVOS_DIR=/data/arquivos
WORKDIR /app
COPY --from=build /repo/package.json /repo/package-lock.json /repo/aurora.destinos.json ./
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages ./packages
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/workers/package.json ./apps/workers/package.json
COPY --from=build /repo/apps/workers/dist ./apps/workers/dist
COPY --from=build /repo/tools/lib ./tools/lib
COPY --from=build /repo/tools/db ./tools/db
COPY --from=build /repo/tools/admin ./tools/admin
COPY --from=build /repo/tools/homologacao ./tools/homologacao
# Volume persistente dos anexos: o dono é o usuário sem privilégio que roda os processos.
RUN mkdir -p /data/arquivos && chown node:node /data/arquivos
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
