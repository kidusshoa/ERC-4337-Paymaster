import { ApiProperty } from '@nestjs/swagger';

export class HealthResponseDto {
  @ApiProperty({ example: 'ok' })
  status!: 'ok';

  @ApiProperty({ example: 42, description: 'Seconds since this process started' })
  uptimeSeconds!: number;

  @ApiProperty({ example: '2026-07-21T12:00:00.000Z' })
  timestamp!: string;
}
