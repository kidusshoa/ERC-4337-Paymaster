# apps/api

NestJS Paymaster & Gas Relayer service.

## Setup

```shell
cp .env.example .env
pnpm --filter @paymaster/api start:dev
```

- API: http://localhost:3300
- Swagger docs: http://localhost:3300/docs

`PORT` defaults to 3300 (not the more common 3000) to avoid clashing with other local projects.

## Structure

- `src/config/` — env validation (Joi schema, fails fast at boot on missing/malformed vars)
- `src/common/` — global exception filter, logging interceptor, correlation-ID middleware
- `src/modules/health/` — liveness endpoint
- more modules land in later build phases: `modules/crypto` (signer), `modules/paymaster` (policy + signing), `modules/relayer` (submission + state machine)

## Testing

```shell
pnpm test        # unit tests
pnpm test:e2e    # e2e tests (boots a full Nest app in-process)
```
