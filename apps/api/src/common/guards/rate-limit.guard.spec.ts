import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { RateLimitGuard } from './rate-limit.guard';

function fakeRedisWithCounter() {
  const counters = new Map<string, number>();
  return {
    eval: jest.fn(async (_script: string, _numKeys: number, key: string) => {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    }),
    counters,
  };
}

function contextFor(request: Partial<{ ip: string; body: unknown }>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('RateLimitGuard', () => {
  let redis: ReturnType<typeof fakeRedisWithCounter>;
  let reflector: Reflector;
  let configService: ConfigService;
  let guard: RateLimitGuard;

  const config: Record<string, number> = {
    RATE_LIMIT_IP_MAX: 3,
    RATE_LIMIT_IP_WINDOW_SECONDS: 60,
    RATE_LIMIT_WALLET_MAX: 2,
    RATE_LIMIT_WALLET_WINDOW_SECONDS: 86400,
  };

  beforeEach(() => {
    redis = fakeRedisWithCounter();
    reflector = { get: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    configService = {
      get: (key: string, def?: number) => config[key] ?? def,
    } as unknown as ConfigService;
    guard = new RateLimitGuard(redis as never, reflector, configService);
  });

  it('allows requests under the IP limit', async () => {
    const ctx = contextFor({ ip: '1.2.3.4' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 429 once the IP tier exceeds its max', async () => {
    const ctx = contextFor({ ip: '1.2.3.4' });
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);
    await guard.canActivate(ctx);

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
    try {
      await guard.canActivate(ctx);
      fail('expected HttpException');
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      expect((err as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
  });

  it('tracks separate IPs independently', async () => {
    await guard.canActivate(contextFor({ ip: '1.1.1.1' }));
    await guard.canActivate(contextFor({ ip: '1.1.1.1' }));
    await guard.canActivate(contextFor({ ip: '1.1.1.1' }));

    // A different IP starts its own fresh counter.
    await expect(guard.canActivate(contextFor({ ip: '2.2.2.2' }))).resolves.toBe(true);
  });

  it('does not apply the wallet tier when no @RateLimitWalletField metadata is set', async () => {
    (reflector.get as jest.Mock).mockReturnValue(undefined);
    const ctx = contextFor({ ip: '9.9.9.9', body: { sender: '0xabc' } });

    // 3 requests would trip the wallet tier's max of 2 if it were (wrongly) applied
    // here — staying within the IP tier's max of 3 isolates what this test checks.
    for (let i = 0; i < 3; i++) {
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    }
  });

  it('applies the wallet tier when metadata is set and the body field is present', async () => {
    (reflector.get as jest.Mock).mockReturnValue('sender');
    const ctx = contextFor({ ip: '10.10.10.10', body: { sender: '0xWallet' } });

    await guard.canActivate(ctx);
    await guard.canActivate(ctx);

    await expect(guard.canActivate(ctx)).rejects.toMatchObject({
      response: { error: 'TooManyRequests' },
    });
  });

  it('resolves a dot-path wallet field (e.g. userOp.sender)', async () => {
    (reflector.get as jest.Mock).mockReturnValue('userOp.sender');
    const ctx = contextFor({ ip: '11.11.11.11', body: { userOp: { sender: '0xNested' } } });

    await guard.canActivate(ctx);
    await guard.canActivate(ctx);

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);
  });

  it('is case-insensitive for wallet addresses', async () => {
    (reflector.get as jest.Mock).mockReturnValue('sender');

    await guard.canActivate(contextFor({ ip: '12.12.12.12', body: { sender: '0xAbCdEf' } }));
    await guard.canActivate(contextFor({ ip: '12.12.12.12', body: { sender: '0xabcdef' } }));

    await expect(
      guard.canActivate(contextFor({ ip: '12.12.12.12', body: { sender: '0xABCDEF' } })),
    ).rejects.toThrow(HttpException);
  });
});
