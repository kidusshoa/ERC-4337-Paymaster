# Built from the repo root (see docker-compose.yml's `build.context: .`) since this
# is a pnpm workspace package — it needs the root lockfile/workspace manifest to
# install correctly.
#
# devDependencies are kept in the final image on purpose: `prisma db seed` runs
# `ts-node prisma/seed.ts` (see prisma.config.ts), so the Prisma CLI and ts-node need
# to be present at container start, not just at build time.
FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# Pinned explicitly: a bare `corepack enable` resolves whatever pnpm release is
# currently tagged latest on npm, and pnpm 10+ requires Node >=22.13 (uses
# node:sqlite) — which breaks silently on this image's Node 20. 9.x matches this
# repo's `engines.pnpm` floor and CI's `pnpm/action-setup@v4` pin.
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

WORKDIR /workspace

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api

# Only needed to satisfy prisma.config.ts's `env('DATABASE_URL')` read at generate
# time — the real value is supplied by docker-compose.yml at container start.
RUN cd apps/api && DATABASE_URL="postgresql://build:build@localhost:5432/build" pnpm exec prisma generate
RUN cd apps/api && pnpm run build

WORKDIR /workspace/apps/api
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
EXPOSE 5010

ENTRYPOINT ["./docker-entrypoint.sh"]
