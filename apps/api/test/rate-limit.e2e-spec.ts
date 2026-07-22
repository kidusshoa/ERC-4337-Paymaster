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
    await app.init();

    redis = app.get<Redis>(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Every route shares the IP tier, so each test gets a clean slate — otherwise
    // the previous test's requests (and any prior run within the same TTL window)
    // would carry over and make the IP tier trip before the test under test intends.
    await redis.flushdb();
  });

  it('allows requests under the IP limit, then 429s past it', async () => {
    for (let i = 0; i < IP_MAX; i++) {
      await request(app.getHttpServer()).get('/demo/ip-limited').expect(200);
    }

    const blocked = await request(app.getHttpServer()).get('/demo/ip-limited').expect(429);
    expect(blocked.body).toMatchObject({ statusCode: 429, error: 'TooManyRequests' });
  });

  it('enforces the wallet tier independently of the IP tier, keyed on the sender field', async () => {
    const walletA = '0x1111111111111111111111111111111111111111';
    const walletB = '0x2222222222222222222222222222222222222222';

    for (let i = 0; i < WALLET_MAX; i++) {
      await request(app.getHttpServer())
        .post('/demo/wallet-limited')
        .send({ sender: walletA })
        .expect(201);
    }
    await request(app.getHttpServer())
      .post('/demo/wallet-limited')
      .send({ sender: walletA })
      .expect(429);

    // A different wallet is unaffected by walletA's limit.
    await request(app.getHttpServer())
      .post('/demo/wallet-limited')
      .send({ sender: walletB })
      .expect(201);
  });
});
