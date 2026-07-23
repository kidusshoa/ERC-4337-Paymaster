import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Every AppModule-booting e2e file needs its own BullMQ key namespace — RelayerModule's
    // ConfirmationCheckProcessor worker is always live, and workers on the same queue name
    // compete for jobs across files even when a given file never enqueues one itself.
    // AppModule is imported dynamically (after this env var is set) since @Module()
    // decorators run at import time.
    process.env.BULLMQ_PREFIX = 'test-health';
    const { AppModule } = await import('../src/app.module');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with a well-formed body', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.body).toEqual({
      status: 'ok',
      uptimeSeconds: expect.any(Number),
      timestamp: expect.any(String),
    });
  });

  it('echoes back a supplied x-correlation-id header', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-correlation-id', 'test-correlation-id')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('test-correlation-id');
  });

  it('generates a correlation id when the caller does not supply one', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);

    expect(response.headers['x-correlation-id']).toEqual(expect.any(String));
    expect(response.headers['x-correlation-id'].length).toBeGreaterThan(0);
  });
});
