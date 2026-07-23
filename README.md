# ERC-4337-Paymaster

ERC-4337 Paymaster &amp; Gas Relayer Service: concurrency, cryptographic security, rate-limiting under high load, state machine tracking, and mempool management.

## Quickstart (Docker Compose)

```shell
git submodule update --init --recursive   # pulls vendored contract deps (see contracts/README.md)
docker compose up -d --build
```

This brings up the whole stack from a clean clone with no manual steps: Postgres, Redis, a local Anvil chain, a one-shot `contracts-deploy` job that deploys `VerifyingPaymaster` (+ a fresh `EntryPoint`) to that chain and funds its deposit, and the API itself — which picks up the freshly-deployed addresses automatically. See [apps/api/README.md](apps/api/README.md#docker) for how that wiring works.

```shell
curl http://localhost:5010/health
open http://localhost:5010/docs   # Swagger UI
```

Full sponsor→submit→confirm walkthrough: [apps/api/README.md](apps/api/README.md).

## Structure

- `contracts/` — Foundry project: `VerifyingPaymaster` on ERC-4337 EntryPoint v0.7
- `apps/api/` — NestJS Paymaster & Gas Relayer service
- `apps/dashboard/` — reserved, not yet built

A full architecture write-up and repo tour lands in a later phase; each package's own README is the current source of truth in the meantime.
