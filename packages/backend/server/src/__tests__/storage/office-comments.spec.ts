import test from 'ava';
import Sinon from 'sinon';

import type { CurrentUser } from '../../core/auth';
import { CommentRealtimeProvider } from '../../core/comment/realtime';
import { OfficeCommentService } from '../../core/office';
import type { PermissionAccess } from '../../core/permission';
import { RealtimeRegistry } from '../../core/realtime';
import type { Models } from '../../models';

function access(assert = Sinon.stub().resolves()) {
  return {
    assert,
    value: {
      user: Sinon.stub().returns({
        workspace: Sinon.stub().returns({ assert }),
      }),
    } as unknown as PermissionAccess,
  };
}

function documentContent(revisionId = 'revision-1') {
  return {
    version: 'localmind-office-comment/v1',
    text: 'Review this sentence.',
    anchor: {
      kind: 'document',
      revisionId,
      start: { blockId: 'paragraph-1', offset: 2 },
      end: { blockId: 'paragraph-1', offset: 8 },
    },
  } as const;
}

function serviceFixture(kind = 'document') {
  const create = Sinon.stub().callsFake(async input => ({
    id: 'comment-1',
    ...input,
    resolved: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  }));
  const models = {
    officeArtifact: {
      get: Sinon.stub().resolves({
        id: 'artifact-1',
        workspaceId: 'workspace-1',
        kind,
        createdBy: 'user-1',
      }),
      getRevision: Sinon.stub().resolves({
        id: 'revision-1',
        artifactId: 'artifact-1',
        workspaceId: 'workspace-1',
      }),
      listRevisions: Sinon.stub().resolves([]),
    },
    comment: {
      create,
      list: Sinon.stub().resolves([]),
      listReplies: Sinon.stub().resolves([]),
    },
    user: {
      getPublicUser: Sinon.stub().resolves({
        id: 'user-1',
        name: 'Office User',
        avatarUrl: null,
      }),
      getPublicUsersMap: Sinon.stub().resolves(new Map()),
    },
  } as unknown as Models;
  const permission = access();
  return {
    models,
    create,
    permission,
    service: new OfficeCommentService(models, permission.value),
  };
}

test('creates a strictly versioned Office comment on a matching revision anchor', async t => {
  const fixture = serviceFixture();
  const content = documentContent();

  const comment = await fixture.service.create({
    workspaceId: 'workspace-1',
    artifactId: 'artifact-1',
    actorId: 'user-1',
    content,
  });

  t.is(comment.id, 'comment-1');
  t.deepEqual(fixture.create.firstCall.args[0], {
    workspaceId: 'workspace-1',
    docId: 'artifact-1',
    userId: 'user-1',
    content,
  });
  t.true(fixture.permission.assert.calledWith('Workspace.Blobs.Read'));
  t.true(fixture.permission.assert.calledWith('Workspace.Blobs.Write'));
});

test('rejects Office comments whose anchor kind does not match the artifact', async t => {
  const fixture = serviceFixture('workbook');

  await t.throwsAsync(
    fixture.service.create({
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      actorId: 'user-1',
      content: documentContent(),
    }),
    { message: /anchor does not match artifact kind/ }
  );
  t.false(fixture.create.called);
});

test('rejects missing, reversed, and malformed Office comment anchors', async t => {
  const fixture = serviceFixture();
  (
    fixture.models.officeArtifact.getRevision as unknown as Sinon.SinonStub
  ).resolves(null);

  await t.throwsAsync(
    fixture.service.create({
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      actorId: 'user-1',
      content: documentContent('missing-revision'),
    }),
    { message: /revision not found/ }
  );

  (
    fixture.models.officeArtifact.getRevision as unknown as Sinon.SinonStub
  ).resolves({ id: 'revision-1' });
  await t.throwsAsync(
    fixture.service.create({
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      actorId: 'user-1',
      content: {
        ...documentContent(),
        anchor: {
          ...documentContent().anchor,
          start: { blockId: 'paragraph-1', offset: 9 },
          end: { blockId: 'paragraph-1', offset: 2 },
        },
      },
    }),
    { message: /text range is reversed/ }
  );

  await t.throwsAsync(
    fixture.service.create({
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      actorId: 'user-1',
      content: {
        version: 'localmind-office-comment/v1',
        text: '',
        anchor: documentContent().anchor,
      },
    })
  );
  t.false(fixture.create.called);
});

test('stops Office comment reads and writes when workspace permission is denied', async t => {
  const denied = new Error('permission denied');
  const fixture = serviceFixture();
  fixture.permission.assert.rejects(denied);

  await t.throwsAsync(
    fixture.service.list('workspace-1', 'user-1', 'artifact-1'),
    { is: denied }
  );
  await t.throwsAsync(
    fixture.service.create({
      workspaceId: 'workspace-1',
      artifactId: 'artifact-1',
      actorId: 'user-1',
      content: documentContent(),
    }),
    { is: denied }
  );
  t.false(fixture.create.called);
});

test('authorizes Office comment realtime subscriptions through artifact access', async t => {
  const registry = new RealtimeRegistry();
  const permission = access();
  const get = Sinon.stub().resolves({
    id: 'artifact-1',
    workspaceId: 'workspace-1',
    kind: 'document',
  });
  new CommentRealtimeProvider(
    { listCommentChanges: Sinon.stub().resolves([]) } as never,
    permission.value,
    registry,
    { officeArtifact: { get } } as unknown as Models
  ).onModuleInit();

  await registry
    .getTopic('comment.changed')
    .authorize({ id: 'user-1' } as CurrentUser, {
      workspaceId: 'workspace-1',
      docId: 'artifact-1',
    });

  t.true(get.calledWith('workspace-1', 'artifact-1'));
  t.true(permission.assert.calledOnceWith('Workspace.Blobs.Read'));
});
