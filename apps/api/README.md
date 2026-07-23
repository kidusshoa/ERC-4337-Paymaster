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

## On-chain validation proof

Two e2e suites spawn a throwaway Anvil node and deploy real contracts from `contracts/`'s compiled artifacts — both require `forge build` to have been run in `contracts/` first:

- `test/paymaster-onchain.e2e-spec.ts` — deploys `EntryPoint` + `VerifyingPaymaster`, calls the real `/paymaster/sponsor` endpoint, then calls the deployed contract's `validatePaymasterUserOp` directly (impersonating the EntryPoint as caller) to prove the API's signature is genuinely accepted on-chain — and that a tampered UserOp is genuinely rejected.
- `test/relayer.e2e-spec.ts` — additionally deploys eth-infinitism's reference `SimpleAccount`, sponsors and submits a genuine UserOp through both endpoints, and confirms `handleOps()` actually mines.
- `test/gas-bumping.e2e-spec.ts` — the same stack again, but with automine disabled so the first submission is forced to sit unmined, proving the `ConfirmationCheckProcessor` worker's automatic `STUCK → SUBMITTED → CONFIRMED` recovery (see [Stuck-transaction detection & gas bumping](#stuck-transaction-detection--gas-bumping)).

All three dynamically `import()` `AppModule` inside `beforeAll`, after overriding env vars (`ENTRY_POINT_ADDRESS`/`PAYMASTER_CONTRACT_ADDRESS`/`CHAIN_RPC_URL`, and a suite-unique `BULLMQ_PREFIX` so concurrent e2e runs don't share BullMQ queue state) in `process.env` — `@Module()` decorators (and therefore `ConfigModule.forRoot()`) run at import time, so a static top-level import would snapshot the stale `.env` values before the override ever runs.

## Testing

```shell
pnpm test        # unit tests
pnpm test:e2e    # e2e tests (boots a full Nest app in-process; rate-limit needs Redis, prisma needs Postgres, paymaster-onchain/relayer/gas-bumping need `forge build` + the Foundry toolchain)
```
