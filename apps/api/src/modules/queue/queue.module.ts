import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Root BullMQ connection, shared by every queue registered elsewhere via
 * `BullModule.registerQueue(...)` (the stuck-transaction/gas-bumping worker, Phase 12,
 * is the first real consumer). Deliberately a separate Redis connection from
 * RedisModule's — BullMQ relies on blocking commands internally, which shouldn't
 * share a connection with ad-hoc app usage like the rate-limit guard.
 *
 * `BULLMQ_PREFIX` namespaces every queue's Redis keys — critical for e2e tests: each
 * test file that boots its own AppModule instance (against its own throwaway Anvil)
 * also boots its own ConfirmationCheckProcessor worker, and workers on the *same*
 * queue name compete for jobs regardless of which test added them. Without distinct
 * prefixes, one test's worker can pick up and process another's job against the
 * wrong chain.
 */
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
        return {
          connection: new Redis(url, { maxRetriesPerRequest: null }),
          prefix: configService.get<string>('BULLMQ_PREFIX', 'bullmq'),
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
