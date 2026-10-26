import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

import { createMinimalXlsxFixture } from '@localmind/office/testing';
import { OfficeArtifactKind, OfficeRevisionOrigin } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';

import { OFFICE_FORMATS, OfficeCommandService } from '../../core/office';
import { ProjectOfficeResolver } from '../../core/office/project-resolver';
import { OfficeResolver } from '../../core/office/resolver';
import type { PermissionAccess } from '../../core/permission';
import type { WorkspaceBlobStorage } from '../../core/storage';
import type { Models } from '../../models';
import {
  nativeAccessFixture,
  withNativeStateFixture,
  workspaceOfficeStorage,
} from './office-storage.fixture';

const bytes = createMinimalXlsxFixture();
const policy = OFFICE_FORMATS.xlsx;

function fingerprint(value: Uint8Array) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

const command = {
  version: 'localmind-office-command/v1',
  commandId: 'command-1',
  idempotencyKey: 'command-key-1',
  artifactId: 'artifact-1',
  expectedRevisionId: 'revision-1',
  source: 'ai',
  operation: 'office.workbook.cell.set',
  target: { type: 'cell', sheetId: '7', address: 'B2' },
  input: { type: 'number', value: 42 },
} as const;

const batch = {
  version: 'localmind-office-command-batch/v1',
  batchId: 'batch-1',
  idempotencyKey: 'batch-key-1',
  artifactId: command.artifactId,
  expectedRevisionId: command.expectedRevisionId,
  source: command.source,
  commands: [
    command,
    {
      ...command,
      commandId: 'command-2',
      idempotencyKey: 'command-key-2',
      target: { ...command.target, address: 'B3' },
      input: { type: 'formula', formula: 'SUM(B1:B2)' },
    },
  ],
} as const;

const userBatch = {
  ...batch,
  source: 'user' as const,
  commands: batch.commands.map(command => ({
    ...command,
    source: 'user' as const,
  })),
};

function fixture(options?: {
  currentRevisionId?: string;
  permissionError?: Error;
  appendRevision?: Sinon.SinonStub;
}) {
  const appendRevision =
    options?.appendRevision ??
    Sinon.stub().callsFake(async input => ({
      created: true,
      revision: {
        id: 'revision-2',
        artifactId: 'artifact-1',
        sequence: 2,
        packageBlobKey: input.package.key,
        stateBlobKey: input.state?.key,
      },
    }));
  const models = {
    copilotContext: {
      withWorkspaceWriteAudit: Sinon.stub().callsFake(
        async (_input, execute) => await execute()
      ),
    },
    officeArtifact: {
      get: Sinon.stub().resolves({
        id: 'artifact-1',
        kind: OfficeArtifactKind.workbook,
      }),
      getCurrentRevision: Sinon.stub().resolves({
        id: options?.currentRevisionId ?? 'revision-1',
        packageBlobKey: 'office/package/xlsx/source.xlsx',
        packageMimeType: policy.mimeType,
        packageByteSize: bytes.byteLength,
        packageFingerprint: fingerprint(bytes),
      }),
      appendRevision,
    },
  } as unknown as Models;
  const storage = {
    get: Sinon.stub().callsFake(async () => ({
      body: Readable.from(Buffer.from(bytes)),
      metadata: {
        contentType: policy.mimeType,
        contentLength: bytes.byteLength,
      },
    })),
    put: Sinon.stub().resolves(),
  } as unknown as WorkspaceBlobStorage;
  const assert = options?.permissionError
    ? Sinon.stub().rejects(options.permissionError)
    : Sinon.stub().resolves();
  const access = {
    user: Sinon.stub().returns({
      workspace: Sinon.stub().returns({ assert }),
    }),
  } as unknown as PermissionAccess;
  return {
    service: new OfficeCommandService(
      withNativeStateFixture(models),
      workspaceOfficeStorage(storage),
      access,
      nativeAccessFixture
    ),
    models,
    storage,
    appendRevision,
    assert,
  };
}

test('previews an atomic batch without persistence and commits exactly one AI revision', async t => {
  const f = fixture();

  const preview = await f.service.previewBatch({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    batch,
  });
  t.is(preview.summary.operation, 'office.command.batch');
  t.is(preview.summary.commandCount, batch.commands.length);
  t.false((f.storage.put as Sinon.SinonStub).called);
  t.false(f.appendRevision.called);

  const result = await f.service.executeBatch({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    batch,
  });
  t.true(result.created);
  t.is(result.revision.id, 'revision-2');
  t.is((f.storage.put as Sinon.SinonStub).callCount, 2);
  t.true(f.appendRevision.calledOnce);
  const revisionInput = f.appendRevision.firstCall.args[0];
  t.is(revisionInput.origin, OfficeRevisionOrigin.ai);
  t.is(revisionInput.expectedParentRevisionId, 'revision-1');
  t.is(revisionInput.operationSummary.operation, 'office.command.batch');
  t.is(revisionInput.operationSummary.commandCount, batch.commands.length);
  t.is(revisionInput.operationSummary.source, 'ai');
});

test('interactive user batch previews without writes and commits one user revision', async t => {
  const f = fixture();
  const input = {
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    command: userBatch,
  };
  const preview = await f.service.previewInteractive(input);
  t.is(preview.summary.commandCount, 2);
  t.false((f.storage.put as Sinon.SinonStub).called);
  await f.service.executeInteractive(input);
  t.true(f.appendRevision.calledOnce);
  t.is(f.appendRevision.firstCall.args[0].origin, OfficeRevisionOrigin.user);
  t.is(
    f.appendRevision.firstCall.args[0].expectedParentRevisionId,
    'revision-1'
  );
});

test('interactive commands reject AI/system sources and mixed batch ownership before reading storage', async t => {
  const f = fixture();
  for (const invalid of [
    command,
    batch,
    {
      ...userBatch,
      source: 'system',
      commands: userBatch.commands.map(command => ({
        ...command,
        source: 'system',
      })),
    },
    { ...userBatch, commands: [{ ...userBatch.commands[0], source: 'ai' }] },
    {
      ...userBatch,
      commands: [{ ...userBatch.commands[0], artifactId: 'other-artifact' }],
    },
    {
      ...userBatch,
      commands: [
        { ...userBatch.commands[0], expectedRevisionId: 'other-revision' },
      ],
    },
  ]) {
    await t.throwsAsync(
      f.service.executeInteractive({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        command: invalid,
      })
    );
    await t.throwsAsync(
      f.service.previewInteractive({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        command: invalid,
      })
    );
  }
  t.false((f.storage.get as Sinon.SinonStub).called);
  t.false((f.storage.put as Sinon.SinonStub).called);
  t.false(f.appendRevision.called);
});

test('interactive paste remains atomic after a later invalid cell, ACL refusal or revision conflict', async t => {
  for (const [options, command] of [
    [
      {},
      {
        ...userBatch,
        commands: [
          userBatch.commands[0],
          {
            ...userBatch.commands[1],
            target: {
              ...userBatch.commands[1].target,
              sheetId: 'missing-sheet',
            },
          },
        ],
      },
    ],
    [{ permissionError: new Error('permission denied') }, userBatch],
    [{ currentRevisionId: 'newer-revision' }, userBatch],
  ] as const) {
    const f = fixture(options);
    await t.throwsAsync(
      f.service.executeInteractive({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        command,
      })
    );
    t.false((f.storage.put as Sinon.SinonStub).called);
    t.false(f.appendRevision.called);
  }
});

test('interactive Project batch forwards its owner and edit lease to the shared executor', async t => {
  const f = fixture();
  const execute = Sinon.stub(f.service, 'executeBatch').resolves({
    created: true,
  } as never);
  const lease = { kind: 'user' as const, tabId: 'tab-1', leaseId: 'lease-1' };
  await f.service.executeInteractive({
    projectId: 'project-1',
    actorId: 'user-1',
    editLease: lease,
    command: userBatch,
  });
  t.like(execute.firstCall.args[0], {
    projectId: 'project-1',
    actorId: 'user-1',
    editLease: lease,
    batch: userBatch,
  });
});

for (const project of [false, true]) {
  test(`${project ? 'Project' : 'Workspace'} GraphQL endpoint uses the interactive batch guard for preview and execute`, async t => {
    const ownership = project
      ? { workspaceId: null, projectId: 'project-1' }
      : { workspaceId: 'workspace-1', projectId: null };
    const artifact = { id: 'artifact-1', ...ownership };
    const revision = {
      id: 'revision-2',
      artifactId: artifact.id,
      ...ownership,
    };
    const commands = {
      previewInteractive: Sinon.stub().resolves({
        artifact,
        revision,
        summary: { commandCount: 2 },
      }),
      executeInteractive: Sinon.stub().resolves({
        created: true,
        revision,
        summary: { commandCount: 2 },
      }),
    };
    const artifacts = { get: Sinon.stub().resolves({ artifact, revision }) };
    const url = { link: (path: string) => path };
    const actor = { id: 'user-1' } as never;
    if (project) {
      const resolver = new ProjectOfficeResolver(
        artifacts as never,
        {} as never,
        commands as never,
        url as never,
        {} as never
      );
      const input = {
        projectId: 'project-1',
        command: userBatch,
        editLease: { tabId: 'tab-1', leaseId: 'lease-1' },
      };
      await resolver.previewProjectOfficeCommand(actor, input);
      await resolver.executeProjectOfficeCommand(actor, input);
      t.like(commands.executeInteractive.firstCall.args[0], {
        projectId: 'project-1',
        actorId: 'user-1',
        editLease: { kind: 'user', ...input.editLease },
      });
    } else {
      const resolver = new OfficeResolver(
        artifacts as never,
        {} as never,
        commands as never,
        url as never
      );
      const input = { workspaceId: 'workspace-1', command: userBatch };
      await resolver.previewOfficeCommand(actor, input);
      await resolver.executeOfficeCommand(actor, input);
      t.like(commands.executeInteractive.firstCall.args[0], {
        workspaceId: 'workspace-1',
        actorId: 'user-1',
      });
    }
    t.deepEqual(
      commands.previewInteractive.firstCall.args[0].command,
      userBatch
    );
    t.deepEqual(
      commands.executeInteractive.firstCall.args[0].command,
      userBatch
    );
  });
}

test('live ACL rejection prevents both Office blobs and revisions on every attempt', async t => {
  const f = fixture({ permissionError: new Error('Workspace.Sync denied') });
  for (let attempt = 0; attempt < 2; attempt++)
    await t.throwsAsync(
      f.service.executeBatch({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        sourceSessionId: 'session-1',
        batch,
      }),
      { message: 'Workspace.Sync denied' }
    );
  t.false((f.storage.put as Sinon.SinonStub).called);
  t.false(f.appendRevision.called);
});

test('does not persist partial package or state bytes when a middle batch command fails', async t => {
  const f = fixture();
  const invalidBatch = {
    ...batch,
    commands: [
      command,
      {
        ...batch.commands[1],
        target: { ...batch.commands[1].target, sheetId: 'missing-sheet' },
      },
    ],
  };

  await t.throwsAsync(
    f.service.executeBatch({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      batch: invalidBatch,
    }),
    { message: /sheet not found/i }
  );
  t.false((f.storage.put as Sinon.SinonStub).called);
  t.false(f.appendRevision.called);
});

test('reuses the same immutable revision for an identical batch idempotency replay', async t => {
  let firstFingerprint: string | undefined;
  const appendRevision = Sinon.stub().callsFake(async input => {
    if (!firstFingerprint) firstFingerprint = input.idempotencyFingerprint;
    t.is(input.idempotencyFingerprint, firstFingerprint);
    return {
      created: appendRevision.callCount === 1,
      revision: {
        id: 'revision-2',
        artifactId: 'artifact-1',
        sequence: 2,
      },
    };
  });
  const f = fixture({ appendRevision });

  const first = await f.service.executeBatch({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    batch,
  });
  const replay = await f.service.executeBatch({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    batch,
  });

  t.true(first.created);
  t.false(replay.created);
  t.is(first.revision.id, replay.revision.id);
  t.is(appendRevision.callCount, 2);
  t.is(
    appendRevision.firstCall.args[0].package.fingerprint,
    appendRevision.secondCall.args[0].package.fingerprint
  );
  t.is(
    appendRevision.firstCall.args[0].state.fingerprint,
    appendRevision.secondCall.args[0].state.fingerprint
  );
});

test('rejects an idempotency key reused for different batch evidence', async t => {
  let acceptedFingerprint: string | undefined;
  const appendRevision = Sinon.stub().callsFake(async input => {
    if (!acceptedFingerprint) {
      acceptedFingerprint = input.idempotencyFingerprint;
      return {
        created: true,
        revision: {
          id: 'revision-2',
          artifactId: 'artifact-1',
          sequence: 2,
        },
      };
    }
    if (input.idempotencyFingerprint !== acceptedFingerprint) {
      throw new Error('Office revision idempotency conflict');
    }
    throw new Error('expected different batch evidence');
  });
  const f = fixture({ appendRevision });
  await f.service.executeBatch({
    workspaceId: 'workspace-1',
    actorId: 'user-1',
    batch,
  });

  await t.throwsAsync(
    f.service.executeBatch({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      batch: {
        ...batch,
        commands: [
          { ...command, input: { type: 'number', value: 43 } },
          batch.commands[1],
        ],
      },
    }),
    { message: /idempotency conflict/ }
  );
  t.is(appendRevision.callCount, 2);
});

test('rejects stale revisions and permission loss before reading or writing bytes', async t => {
  const stale = fixture({ currentRevisionId: 'revision-newer' });
  await t.throwsAsync(
    stale.service.executeBatch({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      batch,
    }),
    { message: /revision conflict/ }
  );
  t.false((stale.storage.get as Sinon.SinonStub).called);
  t.false((stale.storage.put as Sinon.SinonStub).called);
  t.false(stale.appendRevision.called);

  const denied = fixture({ permissionError: new Error('permission denied') });
  await t.throwsAsync(
    denied.service.executeBatch({
      workspaceId: 'workspace-1',
      actorId: 'user-1',
      batch,
    }),
    { message: 'permission denied' }
  );
  t.false(
    (denied.models.officeArtifact.get as unknown as Sinon.SinonStub).called
  );
  t.false((denied.storage.get as Sinon.SinonStub).called);
  t.false((denied.storage.put as Sinon.SinonStub).called);
  t.false(denied.appendRevision.called);
});
