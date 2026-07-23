import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Address } from 'viem';
import { ViemClientService } from '../../crypto/viem-client.service';
import { ENTRY_POINT_DEPOSIT_INFO_ABI } from './entry-point-deposit.abi';
import { PaymasterStatusResponseDto } from './paymaster-status-response.dto';

@Injectable()
export class PaymasterAdminService {
  constructor(
    private readonly viemClientService: ViemClientService,
    private readonly configService: ConfigService,
  ) {}

  async getStatus(): Promise<PaymasterStatusResponseDto> {
    const entryPoint = this.configService.get<string>('ENTRY_POINT_ADDRESS') as Address;
    const paymaster = this.configService.get<string>('PAYMASTER_CONTRACT_ADDRESS') as Address;
    const lowBalanceThresholdWei = BigInt(
      this.configService.get<string>('PAYMASTER_LOW_BALANCE_THRESHOLD_WEI', '50000000000000000'),
    );

    const info = await this.viemClientService.getPublicClient().readContract({
      address: entryPoint,
      abi: ENTRY_POINT_DEPOSIT_INFO_ABI,
      functionName: 'getDepositInfo',
      args: [paymaster],
    });

    return {
      entryPoint,
      paymaster,
      depositWei: info.deposit.toString(),
      lowBalance: info.deposit < lowBalanceThresholdWei,
      lowBalanceThresholdWei: lowBalanceThresholdWei.toString(),
      staked: info.staked,
      stakeWei: info.stake.toString(),
      unstakeDelaySec: info.unstakeDelaySec,
      withdrawTime: info.withdrawTime,
    };
  }
}
