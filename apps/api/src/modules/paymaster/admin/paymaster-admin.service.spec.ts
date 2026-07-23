import { ConfigService } from '@nestjs/config';
import { ViemClientService } from '../../crypto/viem-client.service';
import { PaymasterAdminService } from './paymaster-admin.service';

describe('PaymasterAdminService', () => {
  const ENTRY_POINT = '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
  const PAYMASTER = '0xdead0000dead0000dead0000dead0000dead0000';

  const config: Record<string, string> = {
    ENTRY_POINT_ADDRESS: ENTRY_POINT,
    PAYMASTER_CONTRACT_ADDRESS: PAYMASTER,
    PAYMASTER_LOW_BALANCE_THRESHOLD_WEI: '50000000000000000',
  };

  function configService(): ConfigService {
    return {
      get: (key: string, fallback?: unknown) => config[key] ?? fallback,
    } as unknown as ConfigService;
  }

  function viemClientServiceReturning(info: {
    deposit: bigint;
    staked: boolean;
    stake: bigint;
    unstakeDelaySec: number;
    withdrawTime: number;
  }): ViemClientService {
    const readContract = jest.fn().mockResolvedValue(info);
    return { getPublicClient: () => ({ readContract }) } as unknown as ViemClientService;
  }

  it('flags lowBalance when the deposit is below the configured threshold', async () => {
    const service = new PaymasterAdminService(
      viemClientServiceReturning({
        deposit: 10_000_000_000_000_000n, // 0.01 ETH < 0.05 ETH threshold
        staked: false,
        stake: 0n,
        unstakeDelaySec: 0,
        withdrawTime: 0,
      }),
      configService(),
    );

    const status = await service.getStatus();

    expect(status.entryPoint).toBe(ENTRY_POINT);
    expect(status.paymaster).toBe(PAYMASTER);
    expect(status.depositWei).toBe('10000000000000000');
    expect(status.lowBalance).toBe(true);
    expect(status.lowBalanceThresholdWei).toBe('50000000000000000');
  });

  it('does not flag lowBalance when the deposit meets the threshold', async () => {
    const service = new PaymasterAdminService(
      viemClientServiceReturning({
        deposit: 100_000_000_000_000_000n, // 0.1 ETH >= 0.05 ETH threshold
        staked: true,
        stake: 1_000_000_000_000_000_000n,
        unstakeDelaySec: 86_400,
        withdrawTime: 0,
      }),
      configService(),
    );

    const status = await service.getStatus();

    expect(status.lowBalance).toBe(false);
    expect(status.staked).toBe(true);
    expect(status.stakeWei).toBe('1000000000000000000');
    expect(status.unstakeDelaySec).toBe(86_400);
  });
});
