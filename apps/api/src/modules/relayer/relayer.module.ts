import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RelayerController } from './relayer.controller';
import { RelayerService } from './relayer.service';
import { UserOpStateMachineService } from './user-op-state-machine.service';

@Module({
  imports: [CryptoModule, PrismaModule],
  controllers: [RelayerController],
  providers: [RelayerService, UserOpStateMachineService],
})
export class RelayerModule {}
