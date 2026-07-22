import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const SELECTOR_PATTERN = /^0x[0-9a-fA-F]{8}$/;
const HEX_DATA_PATTERN = /^0x[0-9a-fA-F]*$/;
/** Decimal or 0x-hex — BigInt() parses either natively. */
const UINT_PATTERN = /^(0x[0-9a-fA-F]+|[0-9]+)$/;

/**
 * The "friendly" UserOperation shape this API accepts: individual gas fields rather
 * than the packed bytes32 values (accountGasLimits, gasFees) the actual v0.7
 * PackedUserOperation struct uses on-chain — PaymasterSigningService does that
 * packing. targetContract/selector are supplied explicitly rather than parsed out of
 * callData, since decoding an arbitrary smart account's execute() calldata format
 * generically (SimpleAccount vs Safe vs Kernel, etc.) is out of scope here.
 */
export class SponsorUserOpDto {
  @ApiProperty({
    example: '0x1111111111111111111111111111111111111111',
    description: 'Smart account address',
  })
  @Matches(ADDRESS_PATTERN, { message: 'sender must be a 20-byte 0x-prefixed address' })
  sender!: string;

  @ApiProperty({ example: '0', description: 'Account nonce (decimal or 0x-hex)' })
  @Matches(UINT_PATTERN, { message: 'nonce must be a decimal or 0x-hex integer' })
  nonce!: string;

  @ApiProperty({
    example: '0x',
    required: false,
    description: 'Account init code, if this op deploys the account',
  })
  @Matches(HEX_DATA_PATTERN, { message: 'initCode must be 0x-prefixed hex' })
  initCode: string = '0x';

  @ApiProperty({
    example: '0xb61d27f6...',
    description: 'Encoded call the smart account will execute',
  })
  @Matches(HEX_DATA_PATTERN, { message: 'callData must be 0x-prefixed hex' })
  callData!: string;

  @ApiProperty({ example: '200000', description: 'Gas limit for the account’s call execution' })
  @Matches(UINT_PATTERN, { message: 'callGasLimit must be a decimal or 0x-hex integer' })
  callGasLimit!: string;

  @ApiProperty({ example: '100000', description: 'Gas limit for the account’s own validateUserOp' })
  @Matches(UINT_PATTERN, { message: 'verificationGasLimit must be a decimal or 0x-hex integer' })
  verificationGasLimit!: string;

  @ApiProperty({
    example: '50000',
    description: 'Gas overhead not tracked by callGasLimit/verificationGasLimit',
  })
  @Matches(UINT_PATTERN, { message: 'preVerificationGas must be a decimal or 0x-hex integer' })
  preVerificationGas!: string;

  @ApiProperty({ example: '2000000000', description: 'EIP-1559 max fee per gas, in wei' })
  @Matches(UINT_PATTERN, { message: 'maxFeePerGas must be a decimal or 0x-hex integer' })
  maxFeePerGas!: string;

  @ApiProperty({ example: '1000000000', description: 'EIP-1559 max priority fee per gas, in wei' })
  @Matches(UINT_PATTERN, { message: 'maxPriorityFeePerGas must be a decimal or 0x-hex integer' })
  maxPriorityFeePerGas!: string;

  @ApiProperty({
    example: '0x0000000000000000000000000000000000dEaD',
    description:
      'Contract callData ultimately calls into — checked against the active SponsorshipPolicy allowlist',
  })
  @Matches(ADDRESS_PATTERN, { message: 'targetContract must be a 20-byte 0x-prefixed address' })
  targetContract!: string;

  @ApiProperty({
    example: '0xa9059cbb',
    description: '4-byte method selector being invoked on targetContract',
  })
  @Matches(SELECTOR_PATTERN, { message: 'selector must be a 4-byte 0x-prefixed selector' })
  selector!: string;
}
