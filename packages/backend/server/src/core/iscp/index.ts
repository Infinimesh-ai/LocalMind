import './config';

import { Module } from '@nestjs/common';

import { IscpControllerClient } from './client';
import { IscpController } from './controller';
import { IscpDeliveryJob } from './job';
import { IscpResolver } from './resolver';
import { IscpService } from './service';

@Module({
  controllers: [IscpController],
  providers: [IscpControllerClient, IscpService, IscpResolver, IscpDeliveryJob],
  exports: [IscpService],
})
export class IscpModule {}
