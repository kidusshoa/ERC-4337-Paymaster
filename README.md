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

## Security checklist (before running anywhere but your own machine)

- **Every private key committed to this repo is a publicly-known Anvil test key** (`DEPLOYER_PRIVATE_KEY`, `SIGNER_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY` in `.env.example`/`docker-compose.yml`/CI) — deterministic from Anvil's default test mnemonic, the same ones every Foundry project uses locally. Never fund or reuse any of them on a network with real value.
- **Rotate `SIGNER_PRIVATE_KEY`/`RELAYER_PRIVATE_KEY` for anything real.** Both are placeholders behind the `SIGNER_SERVICE`/`RELAYER_SIGNER_SERVICE` abstraction (`modules/crypto`) specifically so a KMS-backed signer is a drop-in swap later — see `signer.factory.ts`.
- **Set a real `ADMIN_API_KEY`** (`openssl rand -hex 32`) before exposing `GET /admin/paymaster-status` beyond local Docker Compose — see [apps/api/README.md#admin-paymaster-depositstake-monitoring](apps/api/README.md#admin-paymaster-depositstake-monitoring). Leaving it unset disables the endpoint (503) rather than leaving it open.
- **Configure `trust proxy` correctly if you put the API behind a reverse proxy** — see [apps/api/README.md#rate-limiting](apps/api/README.md#rate-limiting). The default (unset) is safe but wrong behind a proxy; `true`/`'*'` is unsafe everywhere.
- **`.env` files are gitignored** (`.env.example` files are the only tracked variants) — double-check `git status` before committing if you've been editing local env files.
