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
- `src/modules/queue/` — root BullMQ connection (first real queue lands in the stuck-tx/gas-bumping worker)
- `src/modules/prisma/` — `PrismaService` (connect/disconnect lifecycle hooks around the generated client)
- more modules land in later build phases: `modules/paymaster` (policy + signing), `modules/relayer` (submission + state machine)

Note: `CryptoModule`, `RedisModule`, `QueueModule`, and `PrismaModule` are built and unit/integration-tested standalone but not yet imported into `AppModule` — each gets wired in once a real consumer needs it (`modules/paymaster`, Phase 9, is the first).

## Database (Prisma)

Schema lives at `prisma/schema.prisma`: `UserOperation` (the relayer's state machine — `PENDING → SUBMITTED → CONFIRMED/FAILED`, with `STUCK` as a gas-bumping detour off `SUBMITTED`), `SponsorshipPolicy` (which contracts/methods this paymaster sponsors, and the daily quota), and `WalletQuotaUsage` (an atomic per-wallet/policy/day counter, kept separate from `UserOperation` since the quota check sits on the sponsor endpoint's hot path).

The Prisma Client is generated to `generated/prisma/` (not `node_modules/`) — this is gitignored and regenerated automatically by `migrate`/`generate`.

```shell
docker compose up -d postgres      # from the repo root
pnpm exec prisma migrate dev       # apply migrations
pnpm exec prisma db seed           # idempotent: one permissive default policy for local dev
```

Uses `prisma.config.ts` (not `package.json#prisma`) — Prisma's current convention as of v6.

## Rate limiting

`RateLimitGuard` enforces an IP tier on every route it's applied to, plus an optional per-wallet tier on routes annotated with `@RateLimitWalletField('sender')` (or a dot path like `'userOp.sender'`):

```ts
@Post('sponsor')
@UseGuards(RateLimitGuard)
@RateLimitWalletField('sender')
sponsor(@Body() dto: SponsorUserOpDto) { ... }
```

Requires Redis reachable (`docker compose up -d redis`) — see `REDIS_URL` and the `RATE_LIMIT_*` vars in `.env.example`.

## Testing

```shell
pnpm test        # unit tests
pnpm test:e2e    # e2e tests (boots a full Nest app in-process; rate-limit needs Redis, prisma needs Postgres)
```
