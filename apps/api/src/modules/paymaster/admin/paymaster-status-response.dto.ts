import { ApiProperty } from '@nestjs/swagger';

export class PaymasterStatusResponseDto {
  @ApiProperty({ description: 'The EntryPoint this paymaster is registered with' })
  entryPoint!: string;

  @ApiProperty({ description: "This paymaster contract's address" })
  paymaster!: string;

  @ApiProperty({ description: 'Current EntryPoint deposit, in wei (funds gas sponsorship)' })
  depositWei!: string;

  @ApiProperty({
    description:
      'Whether the deposit has fallen below PAYMASTER_LOW_BALANCE_THRESHOLD_WEI — ops will start reverting once it hits zero',
  })
  lowBalance!: boolean;

  @ApiProperty({ description: 'The configured low-balance alert threshold, in wei' })
  lowBalanceThresholdWei!: string;

  @ApiProperty({ description: 'Whether this paymaster currently has an active stake' })
  staked!: boolean;

  @ApiProperty({ description: 'Current stake amount, in wei' })
  stakeWei!: string;

  @ApiProperty({ description: 'The configured unstake delay, in seconds' })
  unstakeDelaySec!: number;

  @ApiProperty({
    description:
      'Unix timestamp after which the stake can be withdrawn, once unlocked (0 if not unlocking)',
  })
  withdrawTime!: number;
}
