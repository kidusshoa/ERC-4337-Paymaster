import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CryptoModule } from '../crypto/crypto.module';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { CONFIRMATION_CHECK_QUEUE } from './queue/confirmation-check.queue';
import { ConfirmationCheckProcessor } from './queue/confirmation-check.processor';
import { RelayerController } from './relayer.controller';
import { RelayerService } from './relayer.service';
import { UserOpStateMachineService } from './user-op-state-machine.service';

@Module({
  imports: [
    CryptoModule,
    PrismaModule,
    QueueModule,
    BullModule.registerQueue({ name: CONFIRMATION_CHECK_QUEUE }),
  ],
  controllers: [RelayerController],
  providers: [RelayerService, UserOpStateMachineService, ConfirmationCheckProcessor],
})
export class RelayerModule {}
