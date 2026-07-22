import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import Redis from 'ioredis';
import { RATE_LIMIT_WALLET_FIELD } from '../decorators/rate-limit-wallet-field.decorator';
import { REDIS_CLIENT } from '../../modules/redis/redis.constants';

// Atomically increments a fixed-window counter, setting its expiry only on the first
// hit of the window — a burst of requests within the window shares one TTL countdown,
// which is simpler to reason about (and test deterministically) than a sliding window
// or true token bucket while giving the same practical abuse protection.
const INCR_WITH_EXPIRY_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if tonumber(current) == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return current
`;

interface TierResult {
  limited: boolean;
  count: number;
  max: number;
}

type Tier = 'ip' | 'wallet';

/**
 * Two-tier Redis-backed rate limiter: always enforces an IP tier, and additionally
 * enforces a per-wallet tier on routes annotated with @RateLimitWalletField(path) —
 * the sponsor endpoint (Phase 9) is the first real consumer of the wallet tier.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    await this.enforce(
      'ip',
      `ratelimit:ip:${request.ip}`,
      this.configService.get<number>('RATE_LIMIT_IP_MAX', 50),
      this.configService.get<number>('RATE_LIMIT_IP_WINDOW_SECONDS', 60),
    );

    const walletFieldPath = this.reflector.get<string | undefined>(
      RATE_LIMIT_WALLET_FIELD,
      context.getHandler(),
    );
    const wallet = walletFieldPath ? this.extractWallet(request, walletFieldPath) : undefined;
    if (wallet) {
      await this.enforce(
        'wallet',
        `ratelimit:wallet:${wallet.toLowerCase()}`,
        this.configService.get<number>('RATE_LIMIT_WALLET_MAX', 5),
        this.configService.get<number>('RATE_LIMIT_WALLET_WINDOW_SECONDS', 86400),
      );
    }

    return true;
  }

  private async enforce(
    tier: Tier,
    key: string,
    max: number,
    windowSeconds: number,
  ): Promise<void> {
    const result = await this.hit(key, max, windowSeconds);
    if (result.limited) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'TooManyRequests',
          message: `Rate limit exceeded for ${tier} tier (max ${result.max} requests per ${windowSeconds}s)`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async hit(key: string, max: number, windowSeconds: number): Promise<TierResult> {
    const count = (await this.redis.eval(INCR_WITH_EXPIRY_SCRIPT, 1, key, windowSeconds)) as number;
    return { limited: count > max, count, max };
  }

  private extractWallet(request: Request, path: string): string | undefined {
    const value = path
      .split('.')
      .reduce<unknown>(
        (obj, key) =>
          obj && typeof obj === 'object' ? (obj as Record<string, unknown>)[key] : undefined,
        request.body,
      );

    return typeof value === 'string' ? value : undefined;
  }
}
