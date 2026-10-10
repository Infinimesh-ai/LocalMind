import '../src/prelude';

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

import { NestFactory } from '@nestjs/core';
import { z } from 'zod';

import { AppModule } from '../src/app.module';
import { WorkspacePageTreeService } from '../src/core/doc/workspace-page-tree';
import { Models } from '../src/models';

// This runner never listens on a port. Every batch is independently committed,
// leased and fenced, so rerunning the same plan resumes its durable checkpoint.
const argument = (name: string) =>
  process.argv
    .find(value => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const workspaceId = argument('workspace'),
  actorId = argument('actor');
if (!workspaceId || !actorId)
  throw new Error('--workspace and --actor are required');
const apply = process.argv.includes('--apply'),
  cancel = process.argv.includes('--cancel');
if (apply && cancel) throw new Error('Choose either --apply or --cancel');
if ((apply || cancel) && process.env.LOCALMIND_WORKERS_PAUSED !== '1')
  throw new Error(
    'Pause the affected Workspace workers before changing migration state'
  );
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});
try {
  const service = app.get(WorkspacePageTreeService),
    models = app.get(Models);
  const actor = { workspaceId, actorId };
  await models.workspaceDirectoryGrant.assertAdministrator(
    workspaceId,
    actorId
  );
  if (cancel) {
    console.log(JSON.stringify(await service.cancelMigration(actor)));
  } else if (apply) {
    const fingerprint = argument('fingerprint');
    const backupPath = process.env.LOCALMIND_DATABASE_BACKUP,
      evidencePath = argument('restore-evidence');
    if (!fingerprint || !backupPath || !evidencePath)
      throw new Error(
        '--fingerprint, --restore-evidence and LOCALMIND_DATABASE_BACKUP are required'
      );
    if ((await stat(backupPath)).size === 0) throw new Error('Backup is empty');
    const evidence = z
      .object({
        workspaceId: z.string(),
        backupSha256: z.string().length(64),
        restoredAndVerified: z.literal(true),
        sourceFingerprint: z.string().length(64),
      })
      .parse(JSON.parse(await readFile(evidencePath, 'utf8')));
    const hash = createHash('sha256')
      .update(await readFile(backupPath))
      .digest('hex');
    if (
      evidence.workspaceId !== workspaceId ||
      evidence.backupSha256 !== hash ||
      evidence.sourceFingerprint !== fingerprint
    )
      throw new Error(
        'Verified restore evidence does not match this Workspace, backup and plan'
      );
    console.log(JSON.stringify(await service.migrate(actor, fingerprint)));
  } else {
    const state = await models.workspacePageTree.state(workspaceId);
    const plan = state?.planId
      ? await models.workspacePageTree.plan(state.planId, workspaceId)
      : null;
    const preview = plan?.plan ?? (await service.preflight(actor));
    // Plans can contain private names. Operators explicitly choose a protected
    // output file through shell redirection; normal logs never receive bodies.
    console.log(JSON.stringify({ state, plan: preview }));
  }
} finally {
  await app.close();
}
