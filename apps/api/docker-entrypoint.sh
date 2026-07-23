#!/bin/sh
# On Anvil, the EntryPoint/VerifyingPaymaster addresses are freshly deployed on every
# `docker compose up` by the `contracts-deploy` one-shot service (see
# ../../contracts/script/docker-deploy.sh), which writes them to a shared volume.
# Load them into the environment (if present) before Nest's ConfigModule validates
# process.env, then apply migrations/seed and start the API.
set -eu

DEPLOYMENT_ENV_FILE="${DEPLOYMENT_ENV_FILE:-/deployment/.env.deployed}"
if [ -f "${DEPLOYMENT_ENV_FILE}" ]; then
  echo "docker-entrypoint: loading deployed contract addresses from ${DEPLOYMENT_ENV_FILE}"
  set -a
  # shellcheck disable=SC1090
  . "${DEPLOYMENT_ENV_FILE}"
  set +a
fi

echo "docker-entrypoint: applying database migrations ..."
pnpm exec prisma migrate deploy

echo "docker-entrypoint: seeding database (idempotent) ..."
pnpm exec prisma db seed

echo "docker-entrypoint: starting API ..."
exec node dist/src/main.js
