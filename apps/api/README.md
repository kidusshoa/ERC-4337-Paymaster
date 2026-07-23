# apps/api

NestJS Paymaster & Gas Relayer service.

## Setup

```shell
cp .env.example .env
pnpm --filter @paymaster/api start:dev
```

- API: http://localhost:5010
- Swagger docs: http://localhost:5010/docs

`PORT` defaults to 5010 — from the 5010-5019 range reserved for this project's own services, rather than the more common 3000, to avoid clashing with other local projects.

## Docker

`Dockerfile` builds from the **repo root** (`docker-compose.yml`'s `api` service sets `context: .`), since this is a pnpm workspace package and needs the root lockfile/manifest to install correctly. devDependencies are kept in the final image on purpose — `prisma db seed` runs `ts-node prisma/seed.ts`, so the Prisma CLI and ts-node need to be present at container start, not just at build time.

`docker-entrypoint.sh` runs on every container start, before the API process itself:

1. If `/deployment/.env.deployed` exists, source it into the environment. On Anvil, `ENTRY_POINT_ADDRESS`/`PAYMASTER_CONTRACT_ADDRESS` change on every `docker compose up` (the `contracts-deploy` one-shot service in the root `docker-compose.yml` deploys fresh contracts and writes their addresses there — see `contracts/script/docker-deploy.sh`) — this is how the API picks them up without anyone hand-editing an `.env` file.
2. `pnpm exec prisma migrate deploy` — applies any pending migrations.
3. `pnpm exec prisma db seed` — idempotent, safe to run on every start.
4. `exec node dist/src/main.js` — replaces the shell process so the API receives signals directly (`SIGTERM` on `docker compose down` triggers Nest's shutdown hooks instead of being swallowed by a wrapper shell).

`dist/src/main.js`, not `dist/main.js`: since `tsconfig.json` has no explicit `rootDir` and the TS program includes files outside `src/` (`prisma/seed.ts`, `prisma.config.ts`), TypeScript infers the package root as the common root and nests build output under `dist/src/`, `dist/prisma/`, etc. — `start:prod` matches this for the same reason.

From the repo root:

```shell
docker compose up -d --build
```

brings up Postgres, Redis, Anvil, the one-shot contract deployer, and this API together — see the root [README.md](../../README.md#quickstart-docker-compose) for the full quickstart.

## Structure

- `src/config/` — env validation (Joi schema, fails fast at boot on missing/malformed vars)
- `src/common/` — global exception filter, logging interceptor, correlation-ID middleware, `RateLimitGuard` (Redis-backed, IP + per-wallet tiers)
- `src/modules/health/` — liveness endpoint
- `src/modules/crypto/` — `SignerService` (KMS-swappable signer) + viem client factory
- `src/modules/redis/` — shared `ioredis` client, used by `RateLimitGuard`
- `src/modules/queue/` — root BullMQ connection (configurable key `prefix` via `BULLMQ_PREFIX`, so parallel e2e suites don't share queue state)
- `src/modules/prisma/` — `PrismaService` (connect/disconnect lifecycle hooks around the generated client)
- `src/modules/paymaster/` — `POST /paymaster/sponsor`: `PolicyService` (whitelist + quota) + `PaymasterSigningService` (UserOp hashing/signing) + `PaymasterService` (orchestrates both, persists the `UserOperation` row)
- `src/modules/relayer/` — `POST /relayer/submit` + `GET /userops/:hash`: `RelayerService` (submits real `handleOps` transactions) + `UserOpStateMachineService` (guards `PENDING → SUBMITTED/STUCK → CONFIRMED/FAILED` transitions) + `ConfirmationCheckProcessor` (BullMQ worker: detects stuck transactions and re-broadcasts with bumped fees)
- `src/modules/paymaster/admin/` — `GET /admin/paymaster-status`: reads the paymaster's live EntryPoint deposit/stake, gated behind `AdminApiKeyGuard`

## Database (Prisma)

Schema lives at `prisma/schema.prisma`: `UserOperation` (the relayer's state machine — `PENDING → SUBMITTED → CONFIRMED/FAILED`, with `STUCK` as a gas-bumping detour off `SUBMITTED`), `SponsorshipPolicy` (which contracts/methods this paymaster sponsors, and the daily quota), and `WalletQuotaUsage` (an atomic per-wallet/policy/day counter, kept separate from `UserOperation` since the quota check sits on the sponsor endpoint's hot path).

The Prisma Client is generated to `generated/prisma/` (not `node_modules/`) — this is gitignored and regenerated automatically by `migrate`/`generate`.

```shell
docker compose up -d postgres      # from the repo root
pnpm exec prisma migrate dev       # apply migrations
pnpm exec prisma db seed           # idempotent: one permissive default policy for local dev
```

Uses `prisma.config.ts` (not `package.json#prisma`) — Prisma's current convention as of v6.

## Sponsoring a UserOperation

`POST /paymaster/sponsor` accepts a "friendly" UserOp shape (individual gas fields, not the packed bytes32 values the v0.7 `PackedUserOperation` struct uses on-chain) plus an explicit `targetContract`/`selector` for policy matching — the API doesn't attempt to decode an arbitrary smart account's `callData` to find these itself:

```shell
curl -X POST http://localhost:5010/paymaster/sponsor \
  -H "Content-Type: application/json" \
  -d '{
    "sender": "0x1111111111111111111111111111111111111111",
    "nonce": "0",
    "callData": "0x1234abcd",
    "callGasLimit": "200000",
    "verificationGasLimit": "100000",
    "preVerificationGas": "50000",
    "maxFeePerGas": "1000000000",
    "maxPriorityFeePerGas": "2000000000",
    "targetContract": "0xdead0000dead0000dead0000dead0000dead0000",
    "selector": "0xa9059cbb"
  }'
```

Returns `paymasterAndData` (attach as-is to the UserOperation before submitting to a bundler), the canonical `userOpHash`, and the `validUntil`/`validAfter` window. Rejects with `403 PolicyViolation` if no active `SponsorshipPolicy` covers the target/method, or `429 QuotaExceeded` once the sender wallet hits its daily quota — the seeded default policy (`prisma db seed`) allows anything, 5 ops/wallet/day, so you'll see real rejections once you add a stricter policy or exhaust that quota.

## Submitting and tracking a UserOperation

Once the account owner has signed the `userOpHash` from `/paymaster/sponsor` (over the standard EIP-191-prefixed digest — exactly what `SimpleAccount._validateSignature` and equivalents check), submit it for relaying:

```shell
curl -X POST http://localhost:5010/relayer/submit \
  -H "Content-Type: application/json" \
  -d '{"userOpHash": "0xabc123...", "signature": "0xsignature..."}'
```

Only `userOpHash` and the signature are needed — every other UserOp field is already on file from the sponsor call. This backend acts as its own bundler: `RelayerService` submits `handleOps([userOp], beneficiary)` using the relayer's own EOA (`RELAYER_PRIVATE_KEY`, a distinct signer/role from the paymaster's), returns immediately once broadcast (status `SUBMITTED`), and watches for confirmation in the background. Poll `GET /userops/:hash` to see it land:

```shell
curl http://localhost:5010/userops/0xabc123...
```

`modules/relayer/relayer.e2e-spec.ts` proves this against a real chain end-to-end: it deploys a real `EntryPoint`, `VerifyingPaymaster`, and eth-infinitism's reference `SimpleAccount` (the only "account" contract in scope here — this project builds the paymaster/relayer side, not a wallet), sponsors and submits a genuine UserOp, and confirms it actually mines.

## Stuck-transaction detection & gas bumping

Every successful `RelayerService.submit()` schedules a delayed BullMQ job (`STUCK_CHECK_DELAY_SECONDS` after broadcast, default 45s) on the `userop-confirmation-check` queue. When `ConfirmationCheckProcessor` picks it up:

- If the transaction has a mined receipt: the state machine moves the op to `CONFIRMED` (or `FAILED` with `failureReason: 'Transaction reverted'` if the receipt's status is `reverted`).
- If it's still unmined: the op moves to `STUCK`, fees are bumped by `GAS_BUMP_PERCENT` (default 15%) over the last-used values, and `handleOps` is re-broadcast **at the same relayer nonce** — a standard EIP-1559 fee-replacement — so it competes with (and, once mined, replaces) the original attempt. Gas is never re-estimated for a resubmission; `RelayerService.submit()` estimates it once via `estimateContractGas` and persists it as `relayerGasLimit`, because re-estimating while the original transaction is still pending can make `eth_estimateGas` see an inconsistent account nonce and revert with `AA25 invalid account nonce`. A fresh confirmation-check job is scheduled for the new tx hash, and `bumpCount` increments.
- This repeats until confirmation or until `bumpCount` reaches `MAX_GAS_BUMP_ATTEMPTS` (default 5), at which point the op is marked `FAILED` with a descriptive `failureReason` instead of retrying forever.

`test/gas-bumping.e2e-spec.ts` proves the full recovery cycle against a real chain: it disables Anvil's automine after submission so the first transaction genuinely sits unmined, waits for the worker to detect it as `STUCK` and resubmit with bumped fees, then mines a block and asserts the op lands `CONFIRMED` under the _bumped_ transaction hash (with the original hash's receipt still null).

## Rate limiting

`RateLimitGuard` enforces an IP tier on every route it's applied to, plus an optional per-wallet tier on routes annotated with `@RateLimitWalletField('sender')` (or a dot path like `'userOp.sender'`):

```ts
@Post('sponsor')
@UseGuards(RateLimitGuard)
@RateLimitWalletField('sender')
sponsor(@Body() dto: SponsorUserOpDto) { ... }
```

Requires Redis reachable (`docker compose up -d redis`) — see `REDIS_URL` and the `RATE_LIMIT_*` vars in `.env.example`.

The wallet tier (`RATE_LIMIT_WALLET_MAX`, default 20/day) and a `SponsorshipPolicy`'s `dailyQuota` (default 5, see `prisma/seed.ts`) are two independent limits, not the same number under two names: the rate limiter is a cheap Redis-backed velocity guard against API abuse, while the quota is the actual business-level daily allowance, enforced separately in Postgres by `PolicyService`. Raising a policy's `dailyQuota` without also raising `RATE_LIMIT_WALLET_MAX` past it just moves the bottleneck to the rate limiter instead.

`RateLimitGuard` keys the IP tier on Express's `req.ip`, which only reflects the real client when Express's `trust proxy` setting matches how the app is actually deployed. This app doesn't set `trust proxy` (main.ts), so by default `req.ip` is the direct TCP peer — safe against a spoofed `X-Forwarded-For` header, but wrong (proxy IP for every client) if you put this behind a reverse proxy without configuring `trust proxy` yourself. If you do, set it to the exact number of trusted hops (e.g. `app.set('trust proxy', 1)` for one load balancer) — never `true`/`'*'`, which re-opens the same spoofing gap.

## Admin: paymaster deposit/stake monitoring

`GET /admin/paymaster-status` reads this paymaster's live `EntryPoint` deposit and stake (`IStakeManager.getDepositInfo`) — the same balance that funds every sponsored UserOp, and the same stake that determines whether the EntryPoint currently considers this paymaster reputable enough to sponsor. Useful for alerting before a paymaster's deposit runs dry and sponsorship starts reverting:

```shell
curl http://localhost:5010/admin/paymaster-status -H "x-admin-api-key: $ADMIN_API_KEY"
```

```json
{
  "entryPoint": "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  "paymaster": "0x...",
  "depositWei": "1000000000000000000",
  "lowBalance": false,
  "lowBalanceThresholdWei": "50000000000000000",
  "staked": true,
  "stakeWei": "2000000000000000000",
  "unstakeDelaySec": 86400,
  "withdrawTime": 0
}
```

Gated by `AdminApiKeyGuard`, compared with `crypto.timingSafeEqual` (a naive `===` leaks the matching prefix length through response timing). Two failure modes, deliberately different:

- **503** — `ADMIN_API_KEY` isn't set on this instance. The endpoint is opt-in, not merely unauthenticated: a forgotten env var fails closed instead of silently exposing operational balance/stake data.
- **401** — `ADMIN_API_KEY` is set, but the `x-admin-api-key` header is missing or doesn't match.

`lowBalance` flips once the deposit drops below `PAYMASTER_LOW_BALANCE_THRESHOLD_WEI` (default 0.05 ETH) — point a monitoring check at this endpoint rather than watching the contract directly.

## Observability & error handling

Every request gets a correlation ID (`CorrelationIdMiddleware`) — from the incoming `x-correlation-id` header if the caller supplied one (so a client can trace its own sponsor→submit→confirm sequence with one ID across calls), otherwise a fresh UUID. It's echoed back on the response header and included in every error response body.

`LoggingInterceptor` writes exactly one access-log line per request, success or failure — `METHOD URL STATUS +Xms [correlationId]` — including 4xx/5xx responses. This is worth calling out because it's an easy gap to introduce: an interceptor built around `tap()`'s success callback alone silently produces zero log output for every request that ends in an exception (validation errors, policy rejections, rate limits), since the exception filter runs after the interceptor and never route back through it — this one instead taps both `next` and `error`, so a request that 429s is exactly as traceable by its correlation ID as one that succeeds.

`AllExceptionsFilter` normalizes every thrown error (a recognized `HttpException` or not) into one consistent JSON body (`statusCode`/`error`/`message`/`path`/`timestamp`/`correlationId`), and separately logs unhandled (5xx) exceptions with their stack trace server-side — callers never see a stack trace, but one is always available in the logs, keyed by the same correlation ID the client got back.

## On-chain validation proof

Two e2e suites spawn a throwaway Anvil node and deploy real contracts from `contracts/`'s compiled artifacts — both require `forge build` to have been run in `contracts/` first:

- `test/paymaster-onchain.e2e-spec.ts` — deploys `EntryPoint` + `VerifyingPaymaster`, calls the real `/paymaster/sponsor` endpoint, then calls the deployed contract's `validatePaymasterUserOp` directly (impersonating the EntryPoint as caller) to prove the API's signature is genuinely accepted on-chain — and that a tampered UserOp is genuinely rejected.
- `test/relayer.e2e-spec.ts` — additionally deploys eth-infinitism's reference `SimpleAccount`, sponsors and submits a genuine UserOp through both endpoints, and confirms `handleOps()` actually mines.
- `test/gas-bumping.e2e-spec.ts` — the same stack again, but with automine disabled so the first submission is forced to sit unmined, proving the `ConfirmationCheckProcessor` worker's automatic `STUCK → SUBMITTED → CONFIRMED` recovery (see [Stuck-transaction detection & gas bumping](#stuck-transaction-detection--gas-bumping)).

All three dynamically `import()` `AppModule` inside `beforeAll`, after overriding env vars (`ENTRY_POINT_ADDRESS`/`PAYMASTER_CONTRACT_ADDRESS`/`CHAIN_RPC_URL`, and a suite-unique `BULLMQ_PREFIX` so concurrent e2e runs don't share BullMQ queue state) in `process.env` — `@Module()` decorators (and therefore `ConfigModule.forRoot()`) run at import time, so a static top-level import would snapshot the stale `.env` values before the override ever runs.

## Testing

```shell
pnpm test        # unit tests
pnpm test:e2e    # e2e tests (boots a full Nest app in-process; rate-limit needs Redis, prisma needs Postgres, paymaster-onchain/relayer/gas-bumping/admin need `forge build` + the Foundry toolchain)
```

## Demo script

`scripts/demo.ts` (`pnpm demo`) runs the full sponsor → sign → submit → confirm cycle against an **already-running** stack (`docker compose up -d --build` from the repo root, or the local dev setup above) purely over HTTP + the chain — no NestJS internals involved, exactly like a real integrator would use this API. It deploys its own throwaway `SimpleAccountFactory`/`SimpleAccount` (reusing Anvil's well-known account #3 as the owner), discovers the live `EntryPoint` address via `GET /admin/paymaster-status` (so there's no address to hand-copy out of logs), and prints every step. Requires `forge build` in `contracts/` first. See the root [README.md](../../README.md) for the full walkthrough.
