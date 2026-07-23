import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

const HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{128,130}$/;

/**
 * Only userOpHash + the account's own signature — every other UserOp field is
 * already on file from the /paymaster/sponsor call that produced this hash, so
 * there's no risk of the client submitting fields that don't match what was signed.
 */
export class SubmitUserOpDto {
  @ApiProperty({
    example: '0xabc123...',
    description: 'userOpHash returned by POST /paymaster/sponsor',
  })
  @Matches(HASH_PATTERN, { message: 'userOpHash must be a 32-byte 0x-prefixed hash' })
  userOpHash!: string;

  @ApiProperty({
    example: '0xsignature...',
    description: "The smart account owner's ECDSA signature over userOpHash (64 or 65 bytes)",
  })
  @Matches(SIGNATURE_PATTERN, {
    message: 'signature must be a 64 or 65-byte 0x-prefixed signature',
  })
  signature!: string;
}
