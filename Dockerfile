# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- 构建前后端
FROM node:22-alpine AS builder
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter @ptpocket/web build && pnpm --filter @ptpocket/server build

# ------------------------------------------------------------ 仅生产依赖
# node-linker=hoisted 让 node_modules 是真实目录而不是 pnpm 的符号链接树，
# 这样才能干净地 COPY 到运行阶段
FROM node:22-alpine AS prod-deps
RUN corepack enable
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile --prod --filter @ptpocket/server --config.node-linker=hoisted

# ---------------------------------------------------------------- 运行镜像
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    HOST=0.0.0.0 \
    WEB_DIST=/app/web-dist

RUN apk add --no-cache tini wget

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/server/dist ./dist
COPY --from=builder /app/web/dist ./web-dist
COPY server/package.json ./package.json

USER node
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
