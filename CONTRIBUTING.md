# Contributing

## Setup

```shell
git clone <this repo>
cd ERC-4337-Paymaster
git submodule update --init --recursive   # vendored contract deps (contracts/lib/)
pnpm install
```

Foundry (`forge`/`anvil`/`cast`) is required for the `contracts/` package and for the API's on-chain e2e suites:

```shell
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

## Repo layout

pnpm workspace: `contracts/` (Foundry, not a workspace package — see `contracts/README.md`), `apps/api/` (NestJS), `apps/dashboard/` (reserved, empty). Each package's own README covers its structure in detail.

## Running things locally

```shell
docker compose up -d postgres redis      # infra only, no image build needed
cd contracts && forge build && cd ..
cp apps/api/.env.example apps/api/.env   # then deploy contracts and paste addresses in, see below
pnpm --filter @paymaster/api start:dev
```

Deploying fresh contracts to a local Anvil for the addresses `.env` needs:

```shell
anvil                                                             # separate terminal
cd contracts
DEPLOYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
VERIFYING_SIGNER_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8 \
forge script script/DeployPaymaster.s.sol:DeployPaymasterScript --rpc-url http://127.0.0.1:8545 --broadcast
```

Or skip all of this and use `docker compose up -d --build`, which automates it — see the root README.

## Tests

```shell
cd contracts && forge test                              # 18 tests, no external deps
pnpm --filter @paymaster/api test                        # unit tests, no external deps
pnpm --filter @paymaster/api test:e2e                    # needs Postgres + Redis running; on-chain
                                                          # suites also need `forge build` + Foundry
```

Run `pnpm --filter @paymaster/api test:e2e` a second time if you see a rate-limit-related failure right after running it repeatedly in under a minute — the IP-tier counter is real and shared across runs against the same local Redis; this is expected, not a bug (see `apps/api/README.md#rate-limiting`).

## Before opening a PR

```shell
pnpm format:check
pnpm lint
cd contracts && forge test
pnpm --filter @paymaster/api test
pnpm --filter @paymaster/api test:e2e
```

CI (`.github/workflows/ci.yml`) runs all of the above as three independent jobs (`lint`, `contracts`, `api`) — matching them locally first saves a round trip.

Husky + lint-staged run `eslint --fix`/`prettier --write` on staged files at commit time; they don't replace the full `pnpm lint`/`format:check` pass above (staged-file-only linting can miss cross-file issues).

## Conventions

- No comments explaining _what_ code does — only _why_, when it's non-obvious (a workaround, a subtle invariant, a hidden constraint). Well-named code and small functions cover the "what".
- Prefer extending an existing module's pattern over inventing a new one — e.g. new admin/monitoring endpoints follow `modules/paymaster/admin/`'s guard + service + controller split, not something new.
- New chain-touching behavior needs an e2e test against a real (throwaway, Anvil) chain, not a mocked `PublicClient`/`WalletClient` — this project treats "does it work against a real EntryPoint" as the actual bar, not "does viem get called with the right arguments".
- Env vars: declare every one a module actually depends on in `src/config/env.validation.ts` (even ones with sensible defaults) so a missing/malformed value fails fast at boot, not at first use — and mirror it into `.env.example` with a comment explaining what it's for.
