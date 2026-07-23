import { ApiProperty } from '@nestjs/swagger';
import { UserOpStatus } from '../../../../generated/prisma/enums';

export class UserOpStatusResponseDto {
  @ApiProperty({ example: '0xabc123...' })
  userOpHash!: string;

  @ApiProperty({ enum: UserOpStatus, example: UserOpStatus.SUBMITTED })
  status!: UserOpStatus;

  @ApiProperty({ example: '0x1111111111111111111111111111111111111111' })
  sender!: string;

  @ApiProperty({
    example: '0xtxhash...',
    required: false,
    nullable: true,
    description: 'The handleOps transaction hash currently backing this op, once SUBMITTED',
  })
  submittedTxHash!: string | null;

  @ApiProperty({
    example: '123',
    required: false,
    nullable: true,
    description: 'Block number, once CONFIRMED',
  })
  blockNumber!: string | null;

  @ApiProperty({
    example: '54000',
    required: false,
    nullable: true,
    description: 'Actual gas used by the handleOps transaction, once CONFIRMED',
  })
  gasUsed!: string | null;

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Why this op ended FAILED — a revert reason or "exceeded max gas-bump attempts"',
  })
  failureReason!: string | null;

  @ApiProperty({
    example: 0,
    description:
      'How many times this op has been re-broadcast with bumped fees after sitting unmined (see STUCK in the status enum)',
  })
  bumpCount!: number;
}
