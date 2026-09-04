import { randomUUID } from 'node:crypto';

import {
  OfficeArtifactKind,
  OfficeRevisionOrigin,
  PrismaClient,
} from '@prisma/client';
import test from 'ava';

import { createModule } from '../../__tests__/create-module';
import { Mockers } from '../../__tests__/mocks';
import {
  Models,
  OFFICE_COMMAND_BLOB_MIME,
  OFFICE_COMMAND_MAX_BYTES,
} from '../index';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const module = await createModule();
const models = module.get(Models);
const db = module.get(PrismaClient);

test.after.always(async () => {
  await module.close();
});

function fingerprint() {
  return `sha256:${randomUUID().replaceAll('-', '').padEnd(64, '0')}`;
}

async function putBlob(
  workspaceId: string,
  key: string,
  mime: string,
  size: number
) {
  return await models.blob.upsert({ workspaceId, key, mime, size });
}

async function createArtifact() {
  const owner = await module.create(Mockers.User);
  const workspace = await module.create(Mockers.Workspace, { owner });
  const sourceKey = `office/${randomUUID()}.docx`;
  await putBlob(workspace.id, sourceKey, DOCX_MIME, 1024);
  const imported = await models.officeArtifact.createOrReuseImported({
    workspaceId: workspace.id,
    actorId: owner.id,
    kind: OfficeArtifactKind.document,
    title: 'Command request fixture',
    sourceFileName: 'request.docx',
    source: {
      key: sourceKey,
      mimeType: DOCX_MIME,
      byteSize: 1024,
      fingerprint: fingerprint(),
    },
    importIdempotencyKey: `import:${randomUUID()}`,
    importFingerprint: fingerprint(),
  });
  return { owner, workspace, imported };
}

async function createRequestInput(commandByteSize = 256) {
  const context = await createArtifact();
  const commandBlobKey = `office/command/${randomUUID()}.json`;
  await putBlob(
    context.workspace.id,
    commandBlobKey,
    OFFICE_COMMAND_BLOB_MIME,
    commandByteSize
  );
  return {
    context,
    input: {
      workspaceId: context.workspace.id,
      artifactId: context.imported.artifact.id,
      expectedRevisionId: context.imported.revision.id,
      actorId: context.owner.id,
      idempotencyKey: `command:${randomUUID()}`,
      commandBlobKey,
      commandByteSize,
      commandFingerprint: fingerprint(),
      previewPackageFingerprint: fingerprint(),
      previewStateFingerprint: fingerprint(),
      previewSummary: {
        version: 'localmind-office-command-preview-evidence/v1',
        operation: 'office.document.text.format',
      },
    },
  };
}

test('creates and idempotently reuses immutable Office command requests', async t => {
  const { input } = await createRequestInput();

  const created = await models.officeCommandRequest.createOrReuse(input);
  const reused = await models.officeCommandRequest.createOrReuse(input);

  t.true(created.created);
  t.false(reused.created);
  t.is(reused.request.id, created.request.id);
  t.deepEqual(reused.request.previewSummary, input.previewSummary);

  await t.throwsAsync(
    db.officeCommandRequest.update({
      where: { id: created.request.id },
      data: { commandFingerprint: fingerprint() },
    }),
    { message: /office_command_request_immutable_restrict_check/ }
  );
});

test('rejects idempotency reuse with different command evidence', async t => {
  const { input } = await createRequestInput();
  await models.officeCommandRequest.createOrReuse(input);

  await t.throwsAsync(
    models.officeCommandRequest.createOrReuse({
      ...input,
      commandFingerprint: fingerprint(),
    }),
    { message: /command request idempotency conflict/ }
  );
});

test('rejects a request pinned to a stale Office revision', async t => {
  const { context, input } = await createRequestInput();
  const packageKey = `office/${randomUUID()}-revision.docx`;
  await putBlob(context.workspace.id, packageKey, DOCX_MIME, 1100);
  await models.officeArtifact.appendRevision({
    workspaceId: context.workspace.id,
    artifactId: context.imported.artifact.id,
    actorId: context.owner.id,
    origin: OfficeRevisionOrigin.user,
    expectedParentRevisionId: context.imported.revision.id,
    idempotencyKey: `revision:${randomUUID()}`,
    idempotencyFingerprint: fingerprint(),
    package: {
      key: packageKey,
      mimeType: DOCX_MIME,
      byteSize: 1100,
      fingerprint: fingerprint(),
    },
  });

  await t.throwsAsync(models.officeCommandRequest.createOrReuse(input), {
    message: /revision conflict/,
  });
});

test('protects command blobs while an Office request references them', async t => {
  const { context, input } = await createRequestInput();
  const created = await models.officeCommandRequest.createOrReuse(input);

  await t.throwsAsync(
    models.blob.delete(context.workspace.id, input.commandBlobKey, true),
    { message: /Office blob is still referenced/ }
  );
  await t.throwsAsync(
    db.blob.update({
      where: {
        workspaceId_key: {
          workspaceId: context.workspace.id,
          key: input.commandBlobKey,
        },
      },
      data: { mime: 'application/octet-stream' },
    }),
    { message: /office_blob_reference_restrict_check/ }
  );

  await db.officeCommandRequest.delete({ where: { id: created.request.id } });
  await models.blob.delete(context.workspace.id, input.commandBlobKey, true);
  t.is(await models.blob.get(context.workspace.id, input.commandBlobKey), null);
});

test('rejects mismatched command blob metadata', async t => {
  const { input } = await createRequestInput();

  await t.throwsAsync(
    models.officeCommandRequest.createOrReuse({
      ...input,
      commandByteSize: input.commandByteSize + 1,
    }),
    { message: /blob size does not match/ }
  );
});

test('accepts the full 32 MiB Office command evidence budget', async t => {
  const { input } = await createRequestInput(OFFICE_COMMAND_MAX_BYTES);

  const created = await models.officeCommandRequest.createOrReuse(input);

  t.true(created.created);
  t.is(created.request.commandByteSize, OFFICE_COMMAND_MAX_BYTES);
  await t.throwsAsync(
    models.officeCommandRequest.createOrReuse({
      ...input,
      idempotencyKey: `command:${randomUUID()}`,
      commandByteSize: OFFICE_COMMAND_MAX_BYTES + 1,
    }),
    { message: /command byte size must be an integer/ }
  );
});
