// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.23;

import {BasePaymaster} from "account-abstraction/core/BasePaymaster.sol";
import {UserOperationLib} from "account-abstraction/core/UserOperationLib.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {_packValidationData} from "account-abstraction/core/Helpers.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @notice ERC-4337 verifying paymaster: sponsors gas for UserOperations pre-approved
///         off-chain by a trusted signer (the NestJS backend's SignerService).
/// @dev Adapted from eth-infinitism/account-abstraction's VerifyingPaymaster sample
///      (contracts/samples/VerifyingPaymaster.sol), with the signer made owner-rotatable
///      instead of immutable so a compromised or rotated backend key doesn't require
///      redeploying this contract.
///      Note: this contract does not itself revert on an expired/not-yet-valid window —
///      it faithfully encodes validUntil/validAfter into the returned validationData, and
///      the EntryPoint enforces that window during handleOps. This split (paymaster signs
///      off on cost + policy, EntryPoint enforces timing) is intentional and matches how
///      every ERC-4337 v0.7 paymaster is expected to behave.
contract VerifyingPaymaster is BasePaymaster {
    using UserOperationLib for PackedUserOperation;

    /// @dev offsets are relative to paymasterAndData: [0:20] paymaster address (set by
    ///      EntryPoint/caller, not stored here), [20:52] packed paymaster gas limits,
    ///      [52:116] abi.encode(validUntil, validAfter), [116:] ECDSA signature.
    uint256 private constant VALID_TIMESTAMP_OFFSET = UserOperationLib.PAYMASTER_DATA_OFFSET;
    uint256 private constant SIGNATURE_OFFSET = VALID_TIMESTAMP_OFFSET + 64;

    address public verifyingSigner;

    event VerifyingSignerUpdated(address indexed oldSigner, address indexed newSigner);

    constructor(IEntryPoint _entryPoint, address _verifyingSigner) BasePaymaster(_entryPoint) {
        require(_verifyingSigner != address(0), "VerifyingPaymaster: zero signer");
        verifyingSigner = _verifyingSigner;
    }

    /// @notice Rotate the trusted off-chain signer without redeploying the contract.
    function setVerifyingSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "VerifyingPaymaster: zero signer");
        emit VerifyingSignerUpdated(verifyingSigner, newSigner);
        verifyingSigner = newSigner;
    }

    /// @notice The digest the off-chain signer must sign (and this contract re-derives
    ///         on-chain) to authorize sponsoring a UserOperation.
    /// @dev Mirrors every field of the UserOp except `paymasterAndData` itself, since that
    ///      field is where the resulting signature is carried.
    function getHash(PackedUserOperation calldata userOp, uint48 validUntil, uint48 validAfter)
        public
        view
        returns (bytes32)
    {
        address sender = userOp.getSender();
        return keccak256(
            abi.encode(
                sender,
                userOp.nonce,
                keccak256(userOp.initCode),
                keccak256(userOp.callData),
                userOp.accountGasLimits,
                uint256(
                    bytes32(
                        userOp.paymasterAndData[UserOperationLib.PAYMASTER_VALIDATION_GAS_OFFSET:UserOperationLib.PAYMASTER_DATA_OFFSET

                        ]
                    )
                ),
                userOp.preVerificationGas,
                userOp.gasFees,
                block.chainid,
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    /// @dev paymasterAndData layout (beyond the address/gas-limit header EntryPoint reads):
    ///      [52:116]  abi.encode(validUntil, validAfter)
    ///      [116:]    ECDSA signature over getHash(...) via toEthSignedMessageHash
    function _validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32, /*userOpHash*/
        uint256 /*requiredPreFund*/
    )
        internal
        view
        override
        returns (bytes memory context, uint256 validationData)
    {
        (uint48 validUntil, uint48 validAfter, bytes calldata signature) =
            parsePaymasterAndData(userOp.paymasterAndData);
        require(
            signature.length == 64 || signature.length == 65,
            "VerifyingPaymaster: invalid signature length in paymasterAndData"
        );

        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(getHash(userOp, validUntil, validAfter));

        if (verifyingSigner != ECDSA.recover(hash, signature)) {
            return ("", _packValidationData(true, validUntil, validAfter));
        }

        return ("", _packValidationData(false, validUntil, validAfter));
    }

    function parsePaymasterAndData(bytes calldata paymasterAndData)
        public
        pure
        returns (uint48 validUntil, uint48 validAfter, bytes calldata signature)
    {
        (validUntil, validAfter) = abi.decode(paymasterAndData[VALID_TIMESTAMP_OFFSET:], (uint48, uint48));
        signature = paymasterAndData[SIGNATURE_OFFSET:];
    }
}
