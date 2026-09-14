import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../config';
import { LocalMindLogService } from './localmind-log-service';
import { AFFiNELogger } from './service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [AFFiNELogger, LocalMindLogService],
  exports: [AFFiNELogger, LocalMindLogService],
})
export class LoggerModule {}

export {
  type LocalMindLogInput,
  LocalMindLogService,
} from './localmind-log-service';
export { hashActor, redact } from './redactor';
export { AFFiNELogger } from './service';
export { LocalMindLogSpool } from './spool';
