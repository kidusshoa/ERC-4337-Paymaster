import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RateLimitWalletField } from '../../common/decorators/rate-limit-wallet-field.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { SponsorUserOpResponseDto } from './dto/sponsor-userop-response.dto';
import { SponsorUserOpDto } from './dto/sponsor-userop.dto';
import { PaymasterService } from './paymaster.service';

@ApiTags('paymaster')
@Controller('paymaster')
export class PaymasterController {
  constructor(private readonly paymasterService: PaymasterService) {}

  @Post('sponsor')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimitWalletField('sender')
  @ApiOperation({
    summary: 'Sponsor gas for a UserOperation',
    description:
      "Checks the request against active sponsorship policies and the sender wallet's daily quota, then " +
      'signs and returns paymasterAndData to attach to the UserOperation before submitting it to a bundler.',
  })
  @ApiBody({ type: SponsorUserOpDto })
  @ApiResponse({ status: 200, description: 'Sponsorship approved', type: SponsorUserOpResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Target contract/method not covered by any active policy',
  })
  @ApiResponse({ status: 429, description: 'Rate limit or daily wallet quota exceeded' })
  async sponsor(@Body() dto: SponsorUserOpDto): Promise<SponsorUserOpResponseDto> {
    return this.paymasterService.sponsor(dto);
  }
}
