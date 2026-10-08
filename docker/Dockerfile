# Multi-target image. Build from the repo root:
#   docker build -f docker/Dockerfile --target web    -t wise-web .
#   docker build -f docker/Dockerfile --target worker -t wise-worker .
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @wise/web build

# ---- web: Next.js standalone server ----
FROM node:24-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN useradd -r -u 1001 wise
COPY --from=build --chown=wise /repo/apps/web/.next/standalone ./
COPY --from=build --chown=wise /repo/apps/web/.next/static ./apps/web/.next/static
USER wise
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---- worker (also runs migrations and seed) ----
FROM build AS worker
# Server-side PDF (apps/worker/src/pdf): Debian's Chromium driven by playwright-core (no browser download),
# plus DejaVu/Liberation fonts for Cyrillic. Adds ~250 MB to the worker image only; the web image is unchanged.
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 1001 wise && chown -R wise /repo
USER wise
CMD ["pnpm", "--filter", "@wise/worker", "start"]
