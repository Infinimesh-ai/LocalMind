// Runs in a disposable test process. It deliberately never resets the database.
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../../../app.module';
import { ConfigModule } from '../../../base/config';
import { Models } from '../../../models';
import { McpResourcesService } from '../../../plugins/copilot/mcp/resources';
import { createTestingModule } from '../../utils/testing-module';

const [mode, credentialId, key] = process.argv.slice(2);
const module = await createTestingModule(
  {
    imports: [
      ConfigModule.override({ doc: { mcpResourcesEnabled: true } }),
      AppModule,
    ],
  },
  false
);
await module.init();
const models = module.get(Models);
const credential = await module
  .get(PrismaClient)
  .mcpCredential.findUnique({ where: { id: credentialId } });
if (!credential) throw new Error('Missing fixture credential');
if (mode === 'before-commit') {
  models.mcpResourceOperation.finish = async () => {
    process.send?.({ phase: 'staged' });
    return await new Promise<never>(() => {});
  };
}
const result = await module
  .get(McpResourcesService)
  .execute(credential, 'workspace_doc_create', {
    title: 'restart',
    content: { format: 'markdown', text: 'durable body' },
    idempotencyKey: key,
  });
process.send?.({ phase: 'committed', result });
await new Promise<never>(() => {});
