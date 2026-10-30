# Образ GameDeck: один Node-процесс отдаёт клиент, API и Socket.IO на порту 3000.
# Сборка: docker build -t gamedeck .

# --- 1. Сборка: ставим все зависимости, собираем shared, server и client ---
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /src

# Сначала только манифесты: пока зависимости не менялись, этот слой берётся из кэша.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages packages
RUN pnpm build

# Сервер с одними prod-зависимостями (shared кладётся внутрь как обычный пакет).
RUN pnpm --filter @gamedeck/server deploy --prod --legacy /out/server \
 && mkdir -p /out/client && cp -r packages/client/dist /out/client/dist

# --- 2. Запуск: только то, что нужно в рантайме ---
FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/packages/server
# Раскладка как в репозитории: сервер ищет клиент в ../client/dist, миграции в ./drizzle.
COPY --from=build /out/server ./
COPY --from=build /out/client /app/packages/client
RUN mkdir -p data && chown -R node:node data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
