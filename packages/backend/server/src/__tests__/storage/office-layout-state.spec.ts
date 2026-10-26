import { Readable } from 'node:stream';

import { createNativeFile } from '@localmind/office';
import {
  applyDocxCommand,
  DocxPdfFontError,
  openDocxPackage,
  readDocxSemanticState,
} from '@localmind/office/docx';
import { OfficeArtifactKind } from '@prisma/client';
import test from 'ava';
import type { Response } from 'express';
import Sinon from 'sinon';

import type { CurrentUser } from '../../core/auth';
import { OfficeArtifactService } from '../../core/office/artifact-service';
import { OfficeController } from '../../core/office/controller';
import { officeFingerprint } from '../../core/office/evidence';
import { ProjectOfficeController } from '../../core/office/project-controller';
import type { OfficeResourceStorage } from '../../core/office/resource-storage';
import type { PermissionAccess } from '../../core/permission';
import type { Models } from '../../models';
import type { OfficeOwner } from '../../models/office-owner';
import { nativeAccessFixture } from './office-storage.fixture';

function fixture(
  owner: OfficeOwner,
  legacy = true,
  legacyFields = false,
  legacyObjects = false
) {
  let packageBytes = Buffer.from(
    createNativeFile({ format: 'docx', paragraphs: [{ text: 'Layout view' }] })
      .bytes
  );
  if (legacyFields) {
    const pkg = openDocxPackage(packageBytes);
    const xml = Buffer.from(pkg.requirePart(pkg.documentPart))
      .toString()
      .replace(
        '<w:sectPr',
        '<w:p><w:fldSimple w:instr="MERGEFIELD Customer"><w:r><w:t>Old value</w:t></w:r></w:fldSimple></w:p><w:sectPr'
      );
    packageBytes = Buffer.from(
      pkg.write(new Map([[pkg.documentPart, Buffer.from(xml)]]))
    );
  }
  if (legacyObjects) {
    const pkg = openDocxPackage(packageBytes),
      paragraph = readDocxSemanticState(pkg).body[0];
    packageBytes = Buffer.from(
      applyDocxCommand(pkg, {
        version: 'localmind-office-command/v1',
        commandId: 'object',
        idempotencyKey: 'object',
        artifactId: 'artifact-1',
        expectedRevisionId: 'revision-1',
        source: 'user',
        operation: 'office.document.object.insert',
        target: { blockId: paragraph.id, offset: 0 },
        object: { type: 'equation', linearText: 'a+b=c' },
      }).packageBytes
    );
  }
  const state = readDocxSemanticState(openDocxPackage(packageBytes));
  if (legacy)
    for (const section of state.sections) delete section.endParagraphId;
  if (legacyFields)
    for (const field of state.references.mailMergeFields)
      delete field.mailMergeSupported;
  const stateBytes = Buffer.from(
    JSON.stringify(state, (key, value: unknown) =>
      (legacyFields && key === 'mailMergeSupported') ||
      (legacyObjects && ['editableObject', 'objectData'].includes(key))
        ? undefined
        : value
    )
  );
  const revision = {
    id: 'revision-1',
    artifactId: 'artifact-1',
    createdAt: new Date(),
    packageBlobKey: 'package.docx',
    packageByteSize: packageBytes.length,
    packageFingerprint: officeFingerprint(packageBytes),
    packageMimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    stateBlobKey: 'state.json',
    stateByteSize: stateBytes.length,
    stateFingerprint: officeFingerprint(stateBytes),
  };
  const authorize = Sinon.stub().resolves();
  const models = {
    officeArtifact: {
      get: Sinon.stub().resolves({
        id: 'artifact-1',
        kind: OfficeArtifactKind.document,
      }),
      getRevision: Sinon.stub().resolves(revision),
    },
    projectResource: {
      assertMember: authorize,
      assertOfficeResource: Sinon.stub().resolves(),
    },
  } as unknown as Models;
  const storage = {
    get: Sinon.stub().callsFake(async (actualOwner, actor, key) => {
      if (
        JSON.stringify(actualOwner) !== JSON.stringify(owner) ||
        actor !== 'actor-1'
      )
        throw new Error('wrong scope');
      return {
        body: Readable.from(key === 'state.json' ? stateBytes : packageBytes),
      };
    }),
    put: Sinon.stub().rejects(new Error('read views must not write')),
  };
  const service = new OfficeArtifactService(
    models,
    storage as unknown as OfficeResourceStorage,
    {
      user: () => ({ workspace: () => ({ assert: authorize }) }),
    } as unknown as PermissionAccess,
    nativeAccessFixture
  );
  return { service, revision, stateBytes, packageBytes, storage, authorize };
}

for (const owner of [
  'workspace-1',
  { projectId: 'project-1' },
] satisfies OfficeOwner[]) {
  const label = typeof owner === 'string' ? 'Workspace' : 'Project';
  test(`${label} derives legacy object previews without rewriting immutable state`, async t => {
    const value = fixture(owner, false, false, true);
    const view = await value.service.readRevisionLayoutState(
      owner,
      'actor-1',
      'artifact-1',
      'revision-1'
    );
    const state = readDocxSemanticState(openDocxPackage(value.packageBytes));
    t.deepEqual(
      JSON.parse(view.bytes.toString()),
      JSON.parse(JSON.stringify(state))
    );
    t.false(value.stateBytes.toString().includes('editableObject'));
    t.true(view.bytes.toString().includes('a+b=c'));
    t.false(value.storage.put.called);
    t.is(value.storage.get.callCount, 2);
  });
  test(`${label} derives legacy merge field support without overwriting its state`, async t => {
    const value = fixture(owner, false, true);
    const view = await value.service.readRevisionLayoutState(
      owner,
      'actor-1',
      'artifact-1',
      'revision-1'
    );
    t.deepEqual(
      JSON.parse(view.bytes.toString()).references.mailMergeFields.map(
        (field: { mailMergeSupported: boolean }) => field.mailMergeSupported
      ),
      [true]
    );
    t.false(value.stateBytes.toString().includes('mailMergeSupported'));
    t.false(value.storage.put.called);
    t.is(value.storage.get.callCount, 2);
    t.true(value.authorize.callCount >= 5);
  });
  test(`${label} layout view derives anchors without changing immutable assets`, async t => {
    const value = fixture(owner);
    const before = { ...value.revision };
    const view = await value.service.readRevisionLayoutState(
      owner,
      'actor-1',
      'artifact-1',
      'revision-1'
    );
    const parsed = JSON.parse(view.bytes.toString());
    t.is(parsed.sections[0].endParagraphId, null);
    t.not(officeFingerprint(view.bytes), value.revision.stateFingerprint);
    const raw = await value.service.readRevisionAsset(
      owner,
      'actor-1',
      'artifact-1',
      'revision-1',
      'state'
    );
    t.deepEqual(raw.bytes, value.stateBytes);
    t.deepEqual(value.revision, before);
    t.false(value.storage.put.called);
    t.true(value.authorize.callCount >= 7);
  });
  test(`${label} layout view rechecks authorization and validates package evidence`, async t => {
    const denied = fixture(owner);
    denied.authorize.onCall(3).rejects(new Error('permission revoked'));
    await t.throwsAsync(
      denied.service.readRevisionLayoutState(
        owner,
        'actor-1',
        'artifact-1',
        'revision-1'
      ),
      { message: 'permission revoked' }
    );
    t.is(denied.storage.get.callCount, 1);
    const corrupt = fixture(owner);
    corrupt.revision.packageFingerprint = 'sha256:invalid';
    await t.throwsAsync(
      corrupt.service.readRevisionLayoutState(
        owner,
        'actor-1',
        'artifact-1',
        'revision-1'
      ),
      { message: /fingerprint does not match/ }
    );
    t.false(corrupt.storage.put.called);
  });
}

test('current layout state returns verified bytes without reading the package again', async t => {
  const value = fixture('workspace-1', false);
  const result = await value.service.readRevisionLayoutState(
    'workspace-1',
    'actor-1',
    'artifact-1',
    'revision-1'
  );
  t.deepEqual(result.bytes, value.stateBytes);
  t.is(value.storage.get.callCount, 1);
});

test('versioned layout endpoints use derived evidence and reject unknown views', async t => {
  const value = fixture('workspace-1');
  const response = { setHeader: Sinon.stub(), send: Sinon.stub() };
  const controller = new OfficeController(value.service);
  const user = { id: 'actor-1' } as CurrentUser;
  await controller.state(
    user,
    'workspace-1',
    'artifact-1',
    'revision-1',
    response as unknown as Response,
    'layout-v2'
  );
  t.true(response.setHeader.calledWith('cache-control', 'private, no-store'));
  t.true(
    response.setHeader.calledWith(
      'etag',
      `"${officeFingerprint(response.send.firstCall.args[0])}"`
    )
  );
  await t.throwsAsync(
    controller.state(
      user,
      'workspace-1',
      'artifact-1',
      'revision-1',
      response as unknown as Response,
      'unknown'
    )
  );
  const project = fixture({ projectId: 'project-1' });
  const projectController = new ProjectOfficeController(project.service);
  await projectController.asset(
    user,
    'project-1',
    'artifact-1',
    'revision-1',
    'state',
    '',
    response as unknown as Response,
    'layout-v2'
  );
  await t.throwsAsync(
    projectController.asset(
      user,
      'project-1',
      'artifact-1',
      'revision-1',
      'package',
      '',
      response as unknown as Response,
      'layout-v2'
    )
  );
});

test('both PDF endpoints return a bounded capability error for missing glyphs', async t => {
  const service = fixture('workspace-1').service;
  Sinon.stub(service, 'exportDocumentRevisionPdf').rejects(
    new DocxPdfFontError()
  );
  const response = {
    setHeader: Sinon.stub(),
    status: Sinon.stub().returnsThis(),
    json: Sinon.stub(),
  };
  const user = { id: 'actor-1' } as CurrentUser;
  await new OfficeController(service).exportPdf(
    user,
    'workspace-1',
    'artifact-1',
    'revision-1',
    response as unknown as Response
  );
  await new ProjectOfficeController(service).exportPdf(
    user,
    'project-1',
    'artifact-1',
    'revision-1',
    response as unknown as Response
  );
  t.is(response.status.callCount, 2);
  t.true(response.status.alwaysCalledWith(422));
  t.true(
    response.setHeader.calledWith(
      'x-localmind-office-error',
      'pdf-font-unavailable'
    )
  );
  t.deepEqual(response.json.firstCall.args, [{ code: 'pdf-font-unavailable' }]);
});

test('PDF capability handling does not swallow authorization or storage errors', async t => {
  const service = fixture('workspace-1').service;
  const denied = new Error('permission denied');
  Sinon.stub(service, 'exportDocumentRevisionPdf').rejects(denied);
  await t.throwsAsync(
    new OfficeController(service).exportPdf(
      { id: 'actor-1' } as CurrentUser,
      'workspace-1',
      'artifact-1',
      'revision-1',
      {} as Response
    ),
    { is: denied }
  );
});
