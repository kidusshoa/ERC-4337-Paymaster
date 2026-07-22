// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {VerifyingPaymaster} from "../src/VerifyingPaymaster.sol";

/// @notice Deploys VerifyingPaymaster, funds its EntryPoint deposit, and (on public
///         networks) verifies it on Etherscan.
/// @dev Network-conditional EntryPoint target:
///      - Anvil (chainid 31337): deploys a fresh EntryPoint, since none exists yet.
///      - Everywhere else (Sepolia, mainnet, ...): targets the canonical v0.7 singleton
///        already live at the same address on every network — it is never redeployed.
contract DeployPaymasterScript is Script {
    address constant CANONICAL_ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint256 constant ANVIL_CHAIN_ID = 31337;

    function run() external returns (VerifyingPaymaster paymaster, IEntryPoint entryPoint) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address verifyingSigner = vm.envAddress("VERIFYING_SIGNER_ADDRESS");
        uint256 initialDepositWei = vm.envOr("PAYMASTER_INITIAL_DEPOSIT_WEI", uint256(0));

        vm.startBroadcast(deployerPrivateKey);

        if (block.chainid == ANVIL_CHAIN_ID) {
            entryPoint = IEntryPoint(address(new EntryPoint()));
            console.log("[anvil] deployed fresh EntryPoint at:", address(entryPoint));
        } else {
            entryPoint = IEntryPoint(CANONICAL_ENTRY_POINT_V07);
            console.log("targeting canonical EntryPoint at:", address(entryPoint));
        }

        paymaster = new VerifyingPaymaster(entryPoint, verifyingSigner);
        console.log("VerifyingPaymaster deployed at:", address(paymaster));
        console.log("verifyingSigner set to:", verifyingSigner);

        if (initialDepositWei > 0) {
            paymaster.deposit{value: initialDepositWei}();
            console.log("funded paymaster EntryPoint deposit, wei:", initialDepositWei);
        }

        vm.stopBroadcast();
    }
}
