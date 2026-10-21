# Multi-target image. Build from the repo root:
#   docker build -f docker/Dockerfile --target web    -t wise-web .
#   docker build -f docker/Dockerfile --target worker -t wise-worker .
#
# Layers are ordered so a code change rebuilds (and the VPS pulls) only the small source layers: the dependencies are
# installed from the package manifests alone (cached until the lockfile changes) and Chromium sits below the source.
# Before, every commit made a new ~5 GB worker image and the pull on the VPS kept breaking off.
FROM node:24-slim AS base
# COREPACK_HOME outside any home dir: pnpm is fetched once at build time, so the non-root runtime user never downloads it.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1 COREPACK_HOME=/corepack COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /repo

# ---- dependencies only (changes when a package.json or the lockfile changes) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/legacy-import/package.json packages/legacy-import/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @wise/web build

# ---- web: Next.js standalone server ----
FROM node:24-slim AS web
# commit the image was built from (deploy.sh passes `git rev-parse HEAD`), shown by /api/version next to the Next build id
ARG GIT_SHA=""
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 GIT_SHA=$GIT_SHA
WORKDIR /app
RUN useradd -r -u 1001 wise
COPY --from=build --chown=wise /repo/apps/web/.next/standalone ./
COPY --from=build --chown=wise /repo/apps/web/.next/static ./apps/web/.next/static
USER wise
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---- worker (also runs migrations and seed): the dependencies + Chromium (cached), then only the source ----
FROM deps AS worker
# Server-side PDF (apps/worker/src/pdf): Debian's Chromium driven by playwright-core (no browser download),
# plus DejaVu/Liberation fonts for Cyrillic. Adds ~250 MB to the worker image only; the web image is unchanged.
ENV NODE_ENV=production CHROMIUM_PATH=/usr/bin/chromium CHROMIUM_HOME=/tmp/wise-chromium
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*
RUN useradd -r -u 1001 wise && chown -R wise /corepack
# the worker runs the TypeScript sources with tsx: no Next build in this image
COPY . .
USER wise
CMD ["pnpm", "--filter", "@wise/worker", "start"]
