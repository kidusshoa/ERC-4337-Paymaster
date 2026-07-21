# contracts

Foundry project for the ERC-4337 `VerifyingPaymaster` contract, targeting **EntryPoint v0.7**.

## Layout

- `src/` — our contracts (`VerifyingPaymaster.sol`, Phase 3)
- `script/` — deployment scripts (`DeployEntryPoint.s.sol` for local Anvil, `DeployPaymaster.s.sol` for Phase 4)
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

On public networks, EntryPoint is **not** redeployed — see `DeployPaymaster.s.sol` (Phase 4), which targets the canonical singleton at `0x0000000071727De22E5E9d8BAf0edAc6f37da032`.
