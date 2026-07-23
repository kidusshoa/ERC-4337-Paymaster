// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

// Not part of this project's own contracts — re-imported purely so `forge build`
// produces artifacts for them. apps/api's Phase 11 on-chain relayer e2e test deploys
// a real SimpleAccount to submit a genuine handleOps() call against (a paymaster
// alone has nothing valid to sponsor gas for), and reads the compiled ABI/bytecode
// directly from contracts/out/, the same way it already does for EntryPoint and
// VerifyingPaymaster.
import "account-abstraction/samples/SimpleAccount.sol";
import "account-abstraction/samples/SimpleAccountFactory.sol";
