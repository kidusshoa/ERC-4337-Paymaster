import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SubmitUserOpDto } from './dto/submit-userop.dto';
import { UserOpStatusResponseDto } from './dto/userop-status-response.dto';
import { RelayerService } from './relayer.service';

@ApiTags('relayer')
@Controller()
export class RelayerController {
  constructor(private readonly relayerService: RelayerService) {}

  @Post('relayer/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Submit a fully-signed UserOperation to the EntryPoint',
    description:
      'Submits handleOps([userOp], beneficiary) using the previously-sponsored UserOp on file — only ' +
      'userOpHash and the account signature are needed. Returns immediately once broadcast; poll ' +
      'GET /userops/:hash for confirmation.',
  })
  @ApiResponse({
    status: 200,
    description: 'Broadcast — status SUBMITTED',
    type: UserOpStatusResponseDto,
  })
  @ApiResponse({ status: 404, description: 'No UserOperation on file for that userOpHash' })
  @ApiResponse({
    status: 409,
    description: 'UserOperation is not PENDING (already submitted or resolved)',
  })
  async submit(@Body() dto: SubmitUserOpDto): Promise<UserOpStatusResponseDto> {
    return this.relayerService.submit(dto.userOpHash, dto.signature);
  }

  @Get('userops/:hash')
  @ApiOperation({ summary: 'Get the current state-machine status of a UserOperation' })
  @ApiParam({ name: 'hash', example: '0xabc123...' })
  @ApiResponse({ status: 200, type: UserOpStatusResponseDto })
  @ApiResponse({ status: 404, description: 'No UserOperation on file for that userOpHash' })
  async getStatus(@Param('hash') hash: string): Promise<UserOpStatusResponseDto> {
    return this.relayerService.getStatus(hash);
  }
}
