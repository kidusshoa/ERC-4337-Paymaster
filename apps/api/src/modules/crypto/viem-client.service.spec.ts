import { ConfigService } from '@nestjs/config';
import { ViemClientService } from './viem-client.service';

function configServiceWith(env: Record<string, unknown>): ConfigService {
  return {
    get: (key: string, defaultValue?: unknown) => env[key] ?? defaultValue,
  } as unknown as ConfigService;
}

describe('ViemClientService', () => {
  it('resolves the well-known "foundry" chain for chainId 31337 (default)', () => {
    const service = new ViemClientService(configServiceWith({}));
    expect(service.getChain().id).toBe(31337);
    expect(service.getChain().name.toLowerCase()).toContain('foundry');
  });

  it('resolves the well-known sepolia chain when configured', () => {
    const service = new ViemClientService(
      configServiceWith({ CHAIN_ID: 11155111, CHAIN_RPC_URL: 'https://example-sepolia-rpc.test' }),
    );
    expect(service.getChain().id).toBe(11155111);
    expect(service.getChain().name.toLowerCase()).toContain('sepolia');
  });

  it('falls back to a generic chain definition for an unrecognized chainId', () => {
    const service = new ViemClientService(
      configServiceWith({ CHAIN_ID: 999999, CHAIN_RPC_URL: 'https://example-custom-rpc.test' }),
    );
    expect(service.getChain().id).toBe(999999);
    expect(service.getChain().rpcUrls.default.http[0]).toBe('https://example-custom-rpc.test');
  });

  it('exposes a public client wired to the resolved chain', () => {
    const service = new ViemClientService(configServiceWith({}));
    const client = service.getPublicClient();
    expect(client.chain?.id).toBe(31337);
  });
});
