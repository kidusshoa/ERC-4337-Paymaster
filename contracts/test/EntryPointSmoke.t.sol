// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";

/// @notice Smoke tests proving the vendored eth-infinitism/account-abstraction v0.7
///         EntryPoint compiles and behaves correctly before any of our own contracts
///         (VerifyingPaymaster, Phase 3) are built against it.
contract EntryPointSmokeTest is Test {
    EntryPoint entryPoint;
    address alice = makeAddr("alice");

    function setUp() public {
        entryPoint = new EntryPoint();
    }

    function test_deploysWithZeroBalance() public view {
        assertEq(entryPoint.balanceOf(alice), 0);
    }

    function test_depositToIncreasesBalance() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        entryPoint.depositTo{value: 1 ether}(alice);

        assertEq(entryPoint.balanceOf(alice), 1 ether);
    }

    function test_getNonceStartsAtZero() public view {
        assertEq(entryPoint.getNonce(alice, 0), 0);
    }
}
