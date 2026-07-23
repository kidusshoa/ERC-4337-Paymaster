import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { AdminApiKeyGuard, ADMIN_API_KEY_HEADER } from '../../../common/guards/admin-api-key.guard';
import { PaymasterAdminService } from './paymaster-admin.service';
import { PaymasterStatusResponseDto } from './paymaster-status-response.dto';

@ApiTags('admin')
@ApiSecurity(ADMIN_API_KEY_HEADER)
@Controller('admin')
@UseGuards(AdminApiKeyGuard)
export class PaymasterAdminController {
  constructor(private readonly paymasterAdminService: PaymasterAdminService) {}

  @Get('paymaster-status')
  @ApiOperation({
    summary: "Read this paymaster's live EntryPoint deposit and stake",
    description:
      'Requires the x-admin-api-key header to match ADMIN_API_KEY. Returns 503 if ADMIN_API_KEY ' +
      'is not configured on this instance — the endpoint is opt-in, not merely unauthenticated.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current deposit/stake status',
    type: PaymasterStatusResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Missing or incorrect x-admin-api-key' })
  @ApiResponse({ status: 503, description: 'ADMIN_API_KEY is not configured on this instance' })
  async getStatus(): Promise<PaymasterStatusResponseDto> {
    return this.paymasterAdminService.getStatus();
  }
}
