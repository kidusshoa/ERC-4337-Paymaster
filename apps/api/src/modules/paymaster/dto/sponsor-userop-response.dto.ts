import { ApiProperty } from '@nestjs/swagger';

export class SponsorUserOpResponseDto {
  @ApiProperty({
    example: '0x2e234dae...181bytes',
    description:
      'Attach this as-is to the UserOperation.paymasterAndData field before submitting to a bundler/EntryPoint',
  })
  paymasterAndData!: string;

  @ApiProperty({
    example: '0xabc123...',
    description: 'Canonical ERC-4337 UserOp hash (EntryPoint.getUserOpHash)',
  })
  userOpHash!: string;

  @ApiProperty({
    example: 1784712719,
    description: 'Unix timestamp after which this sponsorship is no longer valid',
  })
  validUntil!: number;

  @ApiProperty({
    example: 0,
    description: 'Unix timestamp before which this sponsorship is not yet valid',
  })
  validAfter!: number;
}
