import { Module } from '@nestjs/common';

import { FunctionalityModules } from '../app.module';
import { FeatureModule } from '../core/features';
import { IndexerModule } from '../plugins/indexer';
import { CreateCommand } from './commands/create';
import { ImportConfigCommand } from './commands/import';
import { RevertCommand, RunCommand } from './commands/run';

@Module({
  imports: [...FunctionalityModules, FeatureModule, IndexerModule],
  providers: [CreateCommand, RunCommand, RevertCommand, ImportConfigCommand],
})
export class CliAppModule {}
