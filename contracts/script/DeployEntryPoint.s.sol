// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Script, console} from "forge-std/Script.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";

/// @notice Local-only deployment of the canonical ERC-4337 EntryPoint (v0.7).
/// @dev On public networks the canonical singleton at
///      0x0000000071727De22E5E9d8BAf0edAc6f37da032 already exists and must be
///      targeted directly instead of redeploying — see DeployPaymaster.s.sol (Phase 4).
contract DeployEntryPointScript is Script {
    function run() external returns (EntryPoint entryPoint) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);
        entryPoint = new EntryPoint();
        vm.stopBroadcast();

        console.log("EntryPoint deployed at:", address(entryPoint));
    }
}
