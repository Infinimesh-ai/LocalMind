import './config';

import { Module } from '@nestjs/common';

import { PermissionModule } from '../permission';
import { DocumentOcrController } from './controller';
import { DocumentOcrService } from './service';

@Module({
  imports: [PermissionModule],
  controllers: [DocumentOcrController],
  providers: [DocumentOcrService],
  exports: [DocumentOcrService],
})
export class DocumentOcrModule {}

export { DocumentOcrError } from './error';
export { DocumentOcrService } from './service';
