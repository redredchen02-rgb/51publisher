FROM node:20-slim AS builder
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/backend/package.json packages/backend/

RUN npm install -g pnpm@9 && pnpm install --frozen-lockfile --ignore-scripts && pnpm rebuild better-sqlite3

COPY packages/shared/ packages/shared/
COPY packages/backend/ packages/backend/

RUN pnpm --filter @51publisher/shared build
RUN pnpm --filter publisher-backend build

FROM node:20-slim
WORKDIR /app

COPY --from=builder /app/packages/backend/dist ./dist
COPY --from=builder /app/packages/backend/package.json ./
COPY --from=builder /app/packages/shared/dist ../packages/shared/dist

RUN npm install --omit=dev

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/v1/healthz || exit 1

CMD ["node", "dist/index.js"]
