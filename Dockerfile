# syntax=docker/dockerfile:1.7
# CachePanel — multi-stage build.

# ---- deps ----
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json ./
COPY prisma ./prisma
RUN npm install --no-audit --no-fund

# ---- builder ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# A dedicated, limited user that owns the app. The terminal feature can drop
# privileges further to TERMINAL_USER if you set that env var.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    coreutils \
    openssl \
    tini \
    sudo \
    gosu \
    procps \
    less \
    nano \
    vim-tiny \
    openssh-client \
 && rm -rf /var/lib/apt/lists/*

# Create the "cache" user used for the terminal shell by default.
RUN groupadd --system --gid 1001 cache \
 && useradd --system --uid 1001 --gid cache --create-home --home-dir /home/cache --shell /bin/bash cache \
 && mkdir -p /srv /var/www \
 && chown -R cache:cache /srv /var/www /home/cache

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/package.json ./package.json
# Copy the full node_modules tree so symlinks in .bin/ and the Prisma WASM
# files line up exactly the way npm installed them.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/next.config.mjs ./next.config.mjs
# Per-user provisioning script — streamed to the host over SSH at runtime.
COPY --from=builder /app/scripts ./scripts
COPY docker/entrypoint.sh /usr/local/bin/cachepanel-entrypoint
RUN chmod +x /usr/local/bin/cachepanel-entrypoint

# /app needs to be writable by the cache user; the entrypoint ensures /app/data
# (the SQLite volume mount) is also chowned at runtime.
RUN mkdir -p /app/data && chown -R cache:cache /app

EXPOSE 8992
ENV APP_PORT=8992
ENV HOSTNAME=0.0.0.0

# IMPORTANT: container starts as root so the entrypoint can detect the host's
# docker-group GID from the socket and add it to the cache user. It then
# drops to UID 1001 via gosu before exec'ing node. No process beyond the
# entrypoint runs as root.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/cachepanel-entrypoint"]
CMD ["node", "server.js"]
