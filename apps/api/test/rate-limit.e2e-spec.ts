import { Controller, Get, INestApplication, Module, Post, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import Redis from 'ioredis';
import request from 'supertest';
import { RateLimitWalletField } from '../src/common/decorators/rate-limit-wallet-field.decorator';
import { RateLimitGuard } from '../src/common/guards/rate-limit.guard';
import { RedisModule } from '../src/modules/redis/redis.module';
import { REDIS_CLIENT } from '../src/modules/redis/redis.constants';

// Low, deterministic limits for this test only — kept far below the real defaults
// (.env.example) so the suite runs in milliseconds instead of needing 50+ requests.
// IP_MAX is comfortably above WALLET_MAX's test request count: every route shares the
// IP tier, so the wallet-tier test's handful of requests must not also trip the IP tier.
const IP_MAX = 10;
const WALLET_MAX = 2;

// The IP tier keys on req.ip alone, with no per-suite namespace — and every other
// e2e file that hits a RateLimitGuard-protected route (POST /paymaster/sponsor) from
// this same machine shares the same real loopback IP against the same real Redis.
// Spoofing a fixed, suite-unique X-Forwarded-For (via Express's trust-proxy setting,
// enabled only on this test's own throwaway app instance) fully decouples this
// suite's IP-tier counter from whatever other suites are doing concurrently.
const FAKE_IP = '10.66.77.88';

@Controller('demo')
class DemoController {
  @Get('ip-limited')
  @UseGuards(RateLimitGuard)
  ipLimited() {
    return { ok: true };
  }

  @Post('wallet-limited')
  @UseGuards(RateLimitGuard)
  @RateLimitWalletField('sender')
  walletLimited() {
    return { ok: true };
  }
}

@Module({
  imports: [ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }), RedisModule],
  controllers: [DemoController],
})
class DemoModule {}

describe('RateLimitGuard (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    process.env.RATE_LIMIT_IP_MAX = String(IP_MAX);
    process.env.RATE_LIMIT_IP_WINDOW_SECONDS = '60';
    process.env.RATE_LIMIT_WALLET_MAX = String(WALLET_MAX);
    process.env.RATE_LIMIT_WALLET_WINDOW_SECONDS = '60';
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6381';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DemoModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.getHttpAdapter().getInstance().set('trust proxy', true);
    await app.init();

    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  function getReq(path: string) {
    return request(app.getHttpServer()).get(path).set('X-Forwarded-For', FAKE_IP);
  }

  function postReq(path: string) {
    return request(app.getHttpServer()).post(path).set('X-Forwarded-For', FAKE_IP);
  }

  beforeEach(async () => {
    // Scoped to this suite's own keys only — a full flushdb() here would wipe out
    // whatever other concurrently-running e2e suites are keeping in the same real
    // Redis instance (their BullMQ jobs, their own rate-limit counters, etc.). Also
    // clears the test wallet addresses' counters so repeated local runs within the
    // same window don't carry over.
    const keys = await redis.keys(`ratelimit:*${FAKE_IP}*`);
    keys.push(
      'ratelimit:wallet:0x1111111111111111111111111111111111111111',
      'ratelimit:wallet:0x2222222222222222222222222222222222222222',
    );
    await redis.del(...keys);
  });

  it('allows requests under the IP limit, then 429s past it', async () => {
    for (let i = 0; i < IP_MAX; i++) {
      await getReq('/demo/ip-limited').expect(200);
    }

    const blocked = await getReq('/demo/ip-limited').expect(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, error: 'TooManyRequests' });
  });

  it('enforces the wallet tier independently of the IP tier, keyed on the sender field', async () => {
    const walletA = '0x1111111111111111111111111111111111111111';
    const walletB = '0x2222222222222222222222222222222222222222';

    for (let i = 0; i < WALLET_MAX; i++) {
      await postReq('/demo/wallet-limited').send({ sender: walletA }).expect(201);
    }
    await postReq('/demo/wallet-limited').send({ sender: walletA }).expect(429);

    // A different wallet is unaffected by walletA's limit.
    await postReq('/demo/wallet-limited').send({ sender: walletB }).expect(201);
  });
});
