import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { PaymasterAdminController } from './admin/paymaster-admin.controller';
import { PaymasterAdminService } from './admin/paymaster-admin.service';
import { PaymasterController } from './paymaster.controller';
import { PaymasterService } from './paymaster.service';
import { PolicyService } from './policy/policy.service';
import { PaymasterSigningService } from './signing/paymaster-signing.service';
import { AdminApiKeyGuard } from '../../common/guards/admin-api-key.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';

@Module({
  imports: [CryptoModule, PrismaModule, RedisModule],
  controllers: [PaymasterController, PaymasterAdminController],
  providers: [
    PaymasterService,
    PolicyService,
    PaymasterSigningService,
    RateLimitGuard,
    PaymasterAdminService,
    AdminApiKeyGuard,
  ],
})
export class PaymasterModule {}
