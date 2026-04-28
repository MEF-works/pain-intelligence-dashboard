# syntax=docker/dockerfile:1
# Next.js standalone + better-sqlite3 (native build)

FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
  python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/pain.db
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

# Official node:20-bookworm-slim already provides user/group `node` (do not recreate — GID clashes).

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.js"]
