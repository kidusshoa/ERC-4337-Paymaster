import { ApiProperty } from '@nestjs/swagger';
import { UserOpStatus } from '../../../../generated/prisma/enums';

export class UserOpStatusResponseDto {
  @ApiProperty({ example: '0xabc123...' })
  userOpHash!: string;

  @ApiProperty({ enum: UserOpStatus, example: UserOpStatus.SUBMITTED })
  status!: UserOpStatus;

  @ApiProperty({ example: '0x1111111111111111111111111111111111111111' })
  sender!: string;

  @ApiProperty({ example: '0xtxhash...', required: false, nullable: true })
  submittedTxHash!: string | null;

  @ApiProperty({
    example: '123',
    required: false,
    nullable: true,
    description: 'Block number, once CONFIRMED',
  })
  blockNumber!: string | null;

  @ApiProperty({ example: '54000', required: false, nullable: true })
  gasUsed!: string | null;

  @ApiProperty({ required: false, nullable: true })
  failureReason!: string | null;

  @ApiProperty({ example: 0, description: 'Number of gas-price bumps applied (Phase 12)' })
  bumpCount!: number;
}
