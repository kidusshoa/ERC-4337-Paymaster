import { Address, Hex } from 'viem';
import { UserOperation } from '../../../generated/prisma/client';
import { packAccountGasLimits, packGasFees } from '../paymaster/signing/packed-user-op.util';

export interface PackedUserOperationStruct {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Hex;
  preVerificationGas: bigint;
  gasFees: Hex;
  paymasterAndData: Hex;
  signature: Hex;
}

/**
 * Reconstructs the exact on-chain PackedUserOperation struct from a persisted
 * UserOperation row — used both for the initial submission and for Phase 12's
 * gas-bumped resubmission (same op, just a fresh `signature` isn't needed since
 * only the *relayer's outer transaction* fee changes, not anything the account or
 * paymaster signed over).
 */
export function buildPackedUserOp(row: UserOperation, signature: Hex): PackedUserOperationStruct {
  return {
    sender: row.sender as Address,
    nonce: BigInt(row.nonce),
    initCode: row.initCode as Hex,
    callData: row.callData as Hex,
    accountGasLimits: packAccountGasLimits({
      verificationGasLimit: BigInt(row.verificationGasLimit),
      callGasLimit: BigInt(row.callGasLimit),
    }),
    preVerificationGas: BigInt(row.preVerificationGas),
    gasFees: packGasFees({
      maxPriorityFeePerGas: BigInt(row.opMaxPriorityFeePerGas),
      maxFeePerGas: BigInt(row.opMaxFeePerGas),
    }),
    paymasterAndData: row.paymasterAndData as Hex,
    signature,
  };
}
