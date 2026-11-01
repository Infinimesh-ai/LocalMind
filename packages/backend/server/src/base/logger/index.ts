import { Global, Module } from '@nestjs/common';

import { ConfigModule } from '../config';
import { LocalMindLogDatabase } from './localmind-log-database';
import { LocalMindLogService } from './localmind-log-service';
import { AFFiNELogger } from './service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [AFFiNELogger, LocalMindLogDatabase, LocalMindLogService],
  exports: [AFFiNELogger, LocalMindLogService],
})
export class LoggerModule {}

export {
  LocalMindLogDatabase,
  localMindLogDatabaseUrl,
} from './localmind-log-database';
export {
  LOCALMIND_LOG_INGESTION_LIMITS,
  type LocalMindLogInput,
  LocalMindLogService,
  SLOW_REQUEST_THRESHOLD_MS,
} from './localmind-log-service';
export { hashActor, redact } from './redactor';
export { AFFiNELogger } from './service';
export { LocalMindLogSpool } from './spool';
