import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { PaymasterController } from './paymaster.controller';
import { PaymasterService } from './paymaster.service';
import { PolicyService } from './policy/policy.service';
import { PaymasterSigningService } from './signing/paymaster-signing.service';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

@Module({
  imports: [CryptoModule, PrismaModule, RedisModule],
  controllers: [PaymasterController],
  providers: [PaymasterService, PolicyService, PaymasterSigningService, RateLimitGuard],
})
export class PaymasterModule {}
