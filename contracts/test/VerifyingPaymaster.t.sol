// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {Test} from "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {UserOperationLib} from "account-abstraction/core/UserOperationLib.sol";
import {_parseValidationData, ValidationData} from "account-abstraction/core/Helpers.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {VerifyingPaymaster} from "../src/VerifyingPaymaster.sol";

contract VerifyingPaymasterTest is Test {
    EntryPoint entryPoint;
    VerifyingPaymaster paymaster;

    address owner = makeAddr("owner");
    address sender = makeAddr("smartAccount");

    uint256 constant SIGNER_PK = 0xA11CE;
    address signer;

    uint256 constant WRONG_SIGNER_PK = 0xBEEF;

    // 16 bytes verification gas limit || 16 bytes postOp gas limit, packed into the
    // paymasterAndData header EntryPoint itself reads (bytes [20:52]).
    bytes16 constant VERIFICATION_GAS_LIMIT = bytes16(uint128(100_000));
    bytes16 constant POSTOP_GAS_LIMIT = bytes16(uint128(50_000));

    function setUp() public {
        // Avoid block.timestamp starting at Foundry's default of 1 — `validUntil == 0` is a
        // special "no expiry" sentinel in `_parseValidationData`, and timestamp arithmetic
        // near zero can accidentally collide with it.
        vm.warp(1_700_000_000);

        signer = vm.addr(SIGNER_PK);
        entryPoint = new EntryPoint();

        vm.prank(owner);
        paymaster = new VerifyingPaymaster(entryPoint, signer);
    }

    // ---------------------------------------------------------------------
    // Signature validation
    // ---------------------------------------------------------------------

    function test_validSignature_isAccepted() public {
        PackedUserOperation memory userOp = _buildUserOp();
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);

        userOp.paymasterAndData = _sign(userOp, validUntil, validAfter, SIGNER_PK);

        uint256 validationData = _validate(userOp);
        ValidationData memory parsed = _parseValidationData(validationData);

        assertEq(parsed.aggregator, address(0), "signature should be accepted");
        assertEq(parsed.validUntil, validUntil);
        assertEq(parsed.validAfter, validAfter);
    }

    function test_wrongSigner_isRejected() public {
        PackedUserOperation memory userOp = _buildUserOp();
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);

        // Signed by a key that isn't the paymaster's configured verifyingSigner.
        userOp.paymasterAndData = _sign(userOp, validUntil, validAfter, WRONG_SIGNER_PK);

        uint256 validationData = _validate(userOp);
        ValidationData memory parsed = _parseValidationData(validationData);

        assertEq(parsed.aggregator, address(1), "signature should fail (SIG_VALIDATION_FAILED)");
    }

    function test_tamperedUserOp_isRejected() public {
        PackedUserOperation memory userOp = _buildUserOp();
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);

        userOp.paymasterAndData = _sign(userOp, validUntil, validAfter, SIGNER_PK);

        // Mutate callData *after* signing — the signature no longer covers this UserOp.
        userOp.callData = abi.encodeWithSignature("attack()");

        uint256 validationData = _validate(userOp);
        ValidationData memory parsed = _parseValidationData(validationData);

        assertEq(parsed.aggregator, address(1), "tampered UserOp must fail signature check");
    }

    function test_signerRotation_oldSignerRejectedNewSignerAccepted() public {
        uint256 newSignerPk = 0xC0FFEE;
        address newSigner = vm.addr(newSignerPk);

        vm.prank(owner);
        paymaster.setVerifyingSigner(newSigner);
        assertEq(paymaster.verifyingSigner(), newSigner);

        PackedUserOperation memory userOp = _buildUserOp();
        uint48 validUntil = uint48(block.timestamp + 1 hours);
        uint48 validAfter = uint48(block.timestamp);

        // Old signer's signature must now be rejected.
        userOp.paymasterAndData = _sign(userOp, validUntil, validAfter, SIGNER_PK);
        assertEq(_parseValidationData(_validate(userOp)).aggregator, address(1));

        // New signer's signature is accepted.
        userOp.paymasterAndData = _sign(userOp, validUntil, validAfter, newSignerPk);
        assertEq(_parseValidationData(_validate(userOp)).aggregator, address(0));
    }

    // ---------------------------------------------------------------------
    // Validity window encoding
    // ---------------------------------------------------------------------
    // The paymaster itself does not enforce validUntil/validAfter — it faithfully
    // encodes the signed window into validationData, and the EntryPoint enforces the
    // window during handleOps (proven end-to-end in the relayer submission phase).
    // These tests confirm the paymaster round-trips an already-expired / not-yet-valid
    // window correctly rather than silently normalizing or ignoring it.

    function test_expiredWindow_encodedFaithfullyNotSilentlyAccepted() public {
        PackedUserOperation memory userOp = _buildUserOp();
        uint48 validUntil = uint48(block.timestamp - 1); // already expired
        uint48 validAfter = uint48(0);

        userOp.paymasterAndData = _sign(userOp, validUntil, validAfter, SIGNER_PK);

        ValidationData memory parsed = _parseValidationData(_validate(userOp));
        assertEq(parsed.aggregator, address(0), "signature itself is still valid");
        assertEq(parsed.validUntil, validUntil, "expired window must be encoded, not dropped");
        assertLt(parsed.validUntil, block.timestamp, "sanity: window is indeed in the past");
    }

    function test_notYetValidWindow_encodedFaithfully() public {
        PackedUserOperation memory userOp = _buildUserOp();
        uint48 validAfter = uint48(block.timestamp + 1 days); // not valid yet
        uint48 validUntil = uint48(block.timestamp + 2 days);

        userOp.paymasterAndData = _sign(userOp, validUntil, validAfter, SIGNER_PK);

        ValidationData memory parsed = _parseValidationData(_validate(userOp));
        assertEq(parsed.aggregator, address(0), "signature itself is still valid");
        assertEq(parsed.validAfter, validAfter);
        assertGt(parsed.validAfter, block.timestamp, "sanity: window has not started yet");
    }

    // ---------------------------------------------------------------------
    // Access control
    // ---------------------------------------------------------------------

    function test_onlyOwner_canSetVerifyingSigner() public {
        address notOwner = makeAddr("notOwner");
        vm.prank(notOwner);
        vm.expectRevert();
        paymaster.setVerifyingSigner(makeAddr("newSigner"));
    }

    function test_onlyOwner_canWithdrawTo() public {
        vm.deal(address(this), 1 ether);
        paymaster.deposit{value: 1 ether}();

        address notOwner = makeAddr("notOwner");
        vm.prank(notOwner);
        vm.expectRevert();
        paymaster.withdrawTo(payable(notOwner), 1 ether);
    }

    function test_onlyOwner_canAddStake() public {
        address notOwner = makeAddr("notOwner");
        vm.deal(notOwner, 1 ether);
        vm.prank(notOwner);
        vm.expectRevert();
        paymaster.addStake{value: 1 ether}(1 days);
    }

    function test_onlyOwner_canUnlockAndWithdrawStake() public {
        address notOwner = makeAddr("notOwner");

        vm.prank(notOwner);
        vm.expectRevert();
        paymaster.unlockStake();

        vm.prank(notOwner);
        vm.expectRevert();
        paymaster.withdrawStake(payable(notOwner));
    }

    // ---------------------------------------------------------------------
    // Deposit / stake accounting
    // ---------------------------------------------------------------------

    function test_deposit_increasesEntryPointBalance() public {
        vm.deal(address(this), 5 ether);
        paymaster.deposit{value: 5 ether}();

        assertEq(paymaster.getDeposit(), 5 ether);
        assertEq(entryPoint.balanceOf(address(paymaster)), 5 ether);
    }

    function test_withdrawTo_decreasesEntryPointBalanceAndPaysRecipient() public {
        vm.deal(address(this), 5 ether);
        paymaster.deposit{value: 5 ether}();

        address recipient = makeAddr("recipient");
        vm.prank(owner);
        paymaster.withdrawTo(payable(recipient), 2 ether);

        assertEq(paymaster.getDeposit(), 3 ether);
        assertEq(recipient.balance, 2 ether);
    }

    function test_addStakeAndWithdrawStake_roundTrip() public {
        vm.deal(owner, 3 ether);
        vm.prank(owner);
        paymaster.addStake{value: 3 ether}(1 days);

        vm.prank(owner);
        paymaster.unlockStake();

        vm.warp(block.timestamp + 1 days + 1);

        address recipient = makeAddr("stakeRecipient");
        vm.prank(owner);
        paymaster.withdrawStake(payable(recipient));

        assertEq(recipient.balance, 3 ether);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _buildUserOp() internal view returns (PackedUserOperation memory userOp) {
        userOp = PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: bytes(""),
            callData: abi.encodeWithSignature("execute()"),
            accountGasLimits: bytes32(abi.encodePacked(uint128(200_000), uint128(200_000))),
            preVerificationGas: 50_000,
            gasFees: bytes32(abi.encodePacked(uint128(2 gwei), uint128(1 gwei))),
            paymasterAndData: abi.encodePacked(address(paymaster), VERIFICATION_GAS_LIMIT, POSTOP_GAS_LIMIT),
            signature: bytes("")
        });
    }

    /// @dev Builds the full paymasterAndData (header + encoded window + signature) for a
    ///      given signing key, mirroring exactly what the NestJS PaymasterSigningService
    ///      (Phase 9) will assemble.
    function _sign(PackedUserOperation memory userOp, uint48 validUntil, uint48 validAfter, uint256 signerPk)
        internal
        view
        returns (bytes memory)
    {
        bytes memory header = abi.encodePacked(address(paymaster), VERIFICATION_GAS_LIMIT, POSTOP_GAS_LIMIT);
        userOp.paymasterAndData = header;

        // `getHash` is external and expects calldata; passing a memory struct across an
        // external call boundary like this is ABI-encoded automatically.
        bytes32 hash = paymaster.getHash(userOp, validUntil, validAfter);
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(hash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethHash);

        return abi.encodePacked(header, abi.encode(validUntil, validAfter), r, s, v);
    }

    function _validate(PackedUserOperation memory userOp) internal returns (uint256 validationData) {
        vm.prank(address(entryPoint));
        (, validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1 ether);
    }
}
