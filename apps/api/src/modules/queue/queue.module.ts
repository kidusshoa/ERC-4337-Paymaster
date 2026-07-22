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
 */
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = configService.get<string>('REDIS_URL', 'redis://127.0.0.1:6379');
        return { connection: new Redis(url, { maxRetriesPerRequest: null }) };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
