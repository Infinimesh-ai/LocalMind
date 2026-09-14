import { Module } from '@nestjs/common';

import { PermissionModule } from '../permission';
import { ObservabilityController } from './controller';
import {
  ObservabilityResolver,
  ScopedAuditObservabilityResolver,
} from './resolver';

@Module({
  imports: [PermissionModule],
  providers: [ObservabilityResolver, ScopedAuditObservabilityResolver],
  controllers: [ObservabilityController],
})
export class ObservabilityModule {}

export * from './resolver';
