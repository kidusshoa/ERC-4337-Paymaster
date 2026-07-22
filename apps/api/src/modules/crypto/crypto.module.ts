import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { createSignerService } from './signer.factory';
import { SIGNER_SERVICE } from './signer.interface';
import { ViemClientService } from './viem-client.service';

@Module({
  imports: [ConfigModule],
  providers: [
    ViemClientService,
    {
      provide: SIGNER_SERVICE,
      inject: [ConfigService],
      useFactory: createSignerService,
    },
  ],
  exports: [SIGNER_SERVICE, ViemClientService],
})
export class CryptoModule {}
