# contracts

Foundry project for the ERC-4337 `VerifyingPaymaster` contract, targeting **EntryPoint v0.7**.

## Layout

- `src/` — our contracts (`VerifyingPaymaster.sol`)
- `script/` — deployment scripts:
  - `DeployEntryPoint.s.sol` — local-only, deploys a standalone EntryPoint to Anvil
  - `DeployPaymaster.s.sol` — deploys `VerifyingPaymaster` + funds its deposit; network-conditional (fresh EntryPoint on Anvil, canonical singleton everywhere else)
- `test/` — Foundry tests
- `lib/` — vendored dependencies as git submodules: `account-abstraction` (eth-infinitism, v0.7.0), `openzeppelin-contracts` (v5.0.2), `forge-std`

Not a pnpm workspace package — managed independently via `forge`.

## Setup

```shell
foundryup                                   # install/update the Foundry toolchain
git submodule update --init --recursive     # pull vendored contract dependencies
cp .env.example .env
forge build
forge test
```

## Local deploy (Anvil)

```shell
anvil                                                            # in one terminal
forge script script/DeployEntryPoint.s.sol:DeployEntryPointScript \
  --rpc-url http://127.0.0.1:8545 --broadcast                    # in another
```

`DEPLOYER_PRIVATE_KEY` in `.env.example` is Anvil's well-known account #0 test key — never fund or reuse it on a real network.

## Deploying VerifyingPaymaster

`DeployPaymaster.s.sol` picks its EntryPoint target based on `block.chainid`:

- **Anvil (31337)**: deploys a fresh `EntryPoint`, since none exists yet.
- **Every public network** (Sepolia, mainnet, ...): targets the canonical v0.7 singleton already live at `0x0000000071727De22E5E9d8BAf0edAc6f37da032` — it is never redeployed.

Local (Anvil):

```shell
anvil                                                          # in one terminal
DEPLOYER_PRIVATE_KEY=... VERIFYING_SIGNER_ADDRESS=... \
forge script script/DeployPaymaster.s.sol:DeployPaymasterScript \
  --rpc-url http://127.0.0.1:8545 --broadcast                  # in another
```

Sepolia (requires your own funded deployer key, RPC URL, and Etherscan API key in `.env` — this is a real, public, gas-spending action, so run it deliberately rather than as part of any automated setup):

```shell
forge script script/DeployPaymaster.s.sol:DeployPaymasterScript \
  --rpc-url sepolia --broadcast --verify
```

`VERIFYING_SIGNER_ADDRESS` should be the address of the backend's `SignerService` key (`modules/crypto`, Phase 6) — the address that signs `paymasterAndData` off-chain. `PAYMASTER_INITIAL_DEPOSIT_WEI` optionally funds the EntryPoint deposit immediately after deploy; leave at `0` and call `paymaster.deposit()` later if you'd rather fund it separately.

Correctness of the network-conditional branch itself (Anvil → fresh EntryPoint, everything else → canonical address) is covered by `test/DeployPaymaster.t.sol`, which etches real EntryPoint bytecode at the canonical address to simulate a public network without needing a live RPC.

## Docker (automated local deploy)

`Dockerfile` + `script/docker-deploy.sh` package the exact same `DeployPaymasterScript` above into a one-shot container — the `contracts-deploy` service in the root `docker-compose.yml`. It waits for `anvil` to accept RPC calls, runs the deploy script against it (Anvil's well-known account #0/#1 as `DEPLOYER_PRIVATE_KEY`/`VERIFYING_SIGNER_ADDRESS`, funding a 10 ETH deposit), then greps the deployed addresses out of the script's own console output and writes them to a shared volume for the `api` service to load at startup (see `apps/api/README.md#docker`). This exists purely so `docker compose up` is reproducible from a clean clone — it isn't part of the manual `forge script` workflow documented above.
