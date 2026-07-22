// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {DeployPaymasterScript} from "../script/DeployPaymaster.s.sol";
import {VerifyingPaymaster} from "../src/VerifyingPaymaster.sol";

/// @notice Proves DeployPaymasterScript's network-conditional EntryPoint targeting is
///         correct, without needing a real Sepolia RPC/key — a real Sepolia deploy
///         additionally requires funded credentials and is run manually (see
///         contracts/README.md), not from the test suite.
contract DeployPaymasterScriptTest is Test {
    address constant CANONICAL_ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    uint256 constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 constant ANVIL_CHAIN_ID = 31337;

    uint256 deployerPk = 0xD10D;
    address deployer;
    address verifyingSigner = makeAddr("verifyingSigner");

    DeployPaymasterScript script;

    function setUp() public {
        deployer = vm.addr(deployerPk);
        vm.deal(deployer, 10 ether);

        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(bytes32(deployerPk)));
        vm.setEnv("VERIFYING_SIGNER_ADDRESS", vm.toString(verifyingSigner));

        script = new DeployPaymasterScript();
    }

    function test_onAnvil_deploysFreshEntryPoint() public {
        vm.setEnv("PAYMASTER_INITIAL_DEPOSIT_WEI", "0");
        vm.chainId(ANVIL_CHAIN_ID);

        (VerifyingPaymaster paymaster, IEntryPoint entryPoint) = script.run();

        assertTrue(address(entryPoint).code.length > 0, "fresh EntryPoint must have code");
        assertTrue(address(entryPoint) != CANONICAL_ENTRY_POINT_V07, "anvil must not reuse the canonical address");
        assertEq(address(paymaster.entryPoint()), address(entryPoint));
    }

    function test_onPublicNetwork_targetsCanonicalEntryPoint() public {
        // Simulate the canonical EntryPoint already being live at its deterministic
        // address, as it is on every real network, by etching real EntryPoint bytecode
        // there (constructor-time storage layout is irrelevant to the checks below).
        EntryPoint referenceImpl = new EntryPoint();
        vm.etch(CANONICAL_ENTRY_POINT_V07, address(referenceImpl).code);

        vm.setEnv("PAYMASTER_INITIAL_DEPOSIT_WEI", "1000000000000000000"); // 1 ether
        vm.chainId(SEPOLIA_CHAIN_ID);

        (VerifyingPaymaster paymaster, IEntryPoint entryPoint) = script.run();

        assertEq(address(entryPoint), CANONICAL_ENTRY_POINT_V07, "public networks must target the canonical singleton");
        assertEq(paymaster.getDeposit(), 1 ether, "initial deposit must be funded");
    }
}
