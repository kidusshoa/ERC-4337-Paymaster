import { Address, encodeAbiParameters, Hex, keccak256, toHex } from 'viem';

/**
 * Pure helpers that replicate, byte-for-byte, the packing and hashing logic in
 * contracts/src/VerifyingPaymaster.sol and the vendored EntryPoint v0.7
 * (UserOperationLib.sol / EntryPoint.getUserOpHash). Kept dependency-free (no viem
 * client, no NestJS DI) so they're trivial to unit test and to cross-check against
 * the actual deployed contracts in Phase 10.
 */

const UINT128_MAX = (1n << 128n) - 1n;

/** Packs two uint128 values into a single bytes32, high bits first — the layout viem
 *  and Solidity both use for PackedUserOperation's `accountGasLimits` and `gasFees`. */
export function packHighLow128(high: bigint, low: bigint): Hex {
  if (high < 0n || high > UINT128_MAX)
    throw new Error(`packHighLow128: high out of uint128 range: ${high}`);
  if (low < 0n || low > UINT128_MAX)
    throw new Error(`packHighLow128: low out of uint128 range: ${low}`);
  return toHex((high << 128n) | low, { size: 32 });
}

export interface LooseUserOpFields {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
}

export function packAccountGasLimits(
  op: Pick<LooseUserOpFields, 'verificationGasLimit' | 'callGasLimit'>,
): Hex {
  return packHighLow128(op.verificationGasLimit, op.callGasLimit);
}

export function packGasFees(
  op: Pick<LooseUserOpFields, 'maxPriorityFeePerGas' | 'maxFeePerGas'>,
): Hex {
  return packHighLow128(op.maxPriorityFeePerGas, op.maxFeePerGas);
}

/** The [0:20] address + [20:36] verificationGasLimit + [36:52] postOpGasLimit header
 *  every paymasterAndData starts with — everything after byte 52 is paymaster-specific. */
export function buildPaymasterAndDataHeader(
  paymasterAddress: Address,
  paymasterVerificationGasLimit: bigint,
  paymasterPostOpGasLimit: bigint,
): Hex {
  // packHighLow128 already yields exactly [16 bytes verificationGasLimit][16 bytes
  // postOpGasLimit] = 32 bytes, i.e. precisely paymasterAndData's bytes [20:52].
  const packedGasLimits = packHighLow128(paymasterVerificationGasLimit, paymasterPostOpGasLimit);
  return (paymasterAddress.toLowerCase() + packedGasLimits.slice(2)) as Hex;
}

export interface ComputePaymasterHashParams {
  userOp: LooseUserOpFields;
  paymasterAddress: Address;
  paymasterVerificationGasLimit: bigint;
  paymasterPostOpGasLimit: bigint;
  chainId: number;
  validUntil: number;
  validAfter: number;
}

/** Mirrors VerifyingPaymaster.getHash(userOp, validUntil, validAfter) exactly. */
export function computePaymasterHash(params: ComputePaymasterHashParams): Hex {
  const {
    userOp,
    paymasterAddress,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit,
    chainId,
    validUntil,
    validAfter,
  } = params;

  const packedPaymasterGasLimits =
    (paymasterVerificationGasLimit << 128n) | paymasterPostOpGasLimit;

  return keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint48' },
        { type: 'uint48' },
      ],
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        packAccountGasLimits(userOp),
        packedPaymasterGasLimits,
        userOp.preVerificationGas,
        packGasFees(userOp),
        BigInt(chainId),
        paymasterAddress,
        validUntil,
        validAfter,
      ],
    ),
  );
}

export interface ComputeUserOpHashParams {
  userOp: LooseUserOpFields;
  paymasterAndData: Hex;
  entryPointAddress: Address;
  chainId: number;
}

/** Mirrors EntryPoint.getUserOpHash(userOp) exactly — the canonical ERC-4337 UserOp
 *  identity, used as this app's UserOperation.userOpHash primary lookup key. Depends
 *  on the *complete* paymasterAndData (signature included), so it can only be
 *  computed after signing, not before. */
export function computeUserOpHash(params: ComputeUserOpHashParams): Hex {
  const { userOp, paymasterAndData, entryPointAddress, chainId } = params;

  const opEncoded = keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        packAccountGasLimits(userOp),
        userOp.preVerificationGas,
        packGasFees(userOp),
        keccak256(paymasterAndData),
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [opEncoded, entryPointAddress, BigInt(chainId)],
    ),
  );
}
