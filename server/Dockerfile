# syntax=docker/dockerfile:1.7

# ─── Builder stage ──────────────────────────────────────────────────────────
# Native build deps (python, make, g++) needed to compile bcrypt.
FROM node:22-alpine AS builder
WORKDIR /app

# Pull latest security patches for the base layer, then install build deps.
RUN apk upgrade --no-cache && apk add --no-cache python3 make g++

# Skip Chromium download — puppeteer is only used by offline scraper scripts,
# not by the running server. Run the scraper in its own image if you need it.
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm ci --omit=dev

# ─── Runtime stage ──────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# tini gives us real PID 1 signal handling (clean SIGTERM, no zombies).
RUN apk upgrade --no-cache && apk add --no-cache tini

# Order matters: copy source first, then layer the builder's node_modules
# on top. .dockerignore already excludes ./node_modules from the build
# context, so the source copy below shouldn't bring one in — but if that
# ever changes (someone removes the rule, a new dev forgets to set up
# ignore), this ordering keeps the builder's compiled bcrypt authoritative
# instead of being silently clobbered by a host-built one.
COPY --chown=node:node . .
COPY --from=builder /app/node_modules ./node_modules

# Data dirs the running app writes to:
#   /app/logs       — winston error.log + combined.log
#   /app/my_prices  — scraper output (mount as a volume for persistence)
RUN mkdir -p /app/logs /app/my_prices && chown -R node:node /app/logs /app/my_prices

USER node

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8000/health > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
