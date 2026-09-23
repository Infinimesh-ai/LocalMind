import { TransactionHost } from '@nestjs-cls/transactional';
import test from 'ava';
import Sinon from 'sinon';

import type { CurrentUser } from '../../core/auth';
import { CommentRealtimeProvider } from '../../core/comment/realtime';
import { OfficeCommentService } from '../../core/office';
import { OfficeCommentRealtimeProvider } from '../../core/office/comment-realtime';
import { resolveOfficeCommentOwner } from '../../core/office/comment-types';
import type { PermissionAccess } from '../../core/permission';
import { RealtimeRegistry } from '../../core/realtime';
import type { Models } from '../../models';

test.before(() => {
  Sinon.stub(TransactionHost, 'getInstance').returns({
    withTransaction: (...args: unknown[]) => {
      const callback = args.at(-1);
      if (typeof callback !== 'function')
        throw new Error('Missing transaction callback');
      return callback();
    },
  } as never);
});
test.after.always(() => Sinon.restore());

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
    workspaceId: typeof input.owner === 'string' ? input.owner : null,
    projectId: typeof input.owner === 'string' ? null : input.owner.projectId,
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
    officeComment: {
      create,
      list: Sinon.stub().resolves([]),
      listReplies: Sinon.stub().resolves([]),
    },
    projectResource: { assertOfficeResource: Sinon.stub().resolves({}) },
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
    owner: 'workspace-1',
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

test('Project comments use Project membership and never invoke Workspace ACL', async t => {
  const fixture = serviceFixture();
  await fixture.service.create({
    projectId: 'project-1',
    artifactId: 'artifact-1',
    actorId: 'user-1',
    content: documentContent(),
  });
  t.deepEqual(fixture.create.firstCall.args[0].owner, {
    projectId: 'project-1',
  });
  t.false(fixture.permission.assert.called);
  const member = fixture.models.projectResource
    .assertOfficeResource as unknown as Sinon.SinonStub;
  t.true(
    member.calledWith({
      projectId: 'project-1',
      actorId: 'user-1',
      artifactId: 'artifact-1',
    })
  );
  member.rejects(new Error('Project membership is required'));
  await t.throwsAsync(
    fixture.service.list({ projectId: 'project-1' }, 'outsider', 'artifact-1'),
    { message: /membership/ }
  );
  await t.throwsAsync(
    fixture.service.create({
      projectId: 'project-1',
      artifactId: 'artifact-1',
      actorId: 'outsider',
      content: documentContent(),
    }),
    { message: /membership/ }
  );
  t.is(fixture.create.callCount, 1);
});

test('rejects mixed, empty and ambiguous Office comment owners', t => {
  t.deepEqual(resolveOfficeCommentOwner(undefined, { projectId: 'p' }), {
    projectId: 'p',
  });
  t.is(resolveOfficeCommentOwner('w'), 'w');
  for (const scope of [
    {},
    { workspaceId: 'w', projectId: 'p' },
    { projectId: ' ' },
  ])
    t.throws(() => resolveOfficeCommentOwner(undefined, scope));
  t.throws(() => resolveOfficeCommentOwner('w', { projectId: 'p' }));
});

test('Project comment subscriptions recheck artifact membership and reject mixed scope', async t => {
  const fixture = serviceFixture();
  const registry = new RealtimeRegistry();
  new OfficeCommentRealtimeProvider(fixture.service, registry).onModuleInit();
  const topic = registry.getTopic('office.comment.changed');
  t.false(
    topic.input.safeParse({ workspaceId: 'w', projectId: 'p', artifactId: 'a' })
      .success
  );
  await topic.authorize({ id: 'user-1' } as CurrentUser, {
    projectId: 'project-1',
    artifactId: 'artifact-1',
  });
  t.false(fixture.permission.assert.called);
  (
    fixture.models.projectResource
      .assertOfficeResource as unknown as Sinon.SinonStub
  ).rejects(new Error('Membership revoked'));
  await t.throwsAsync(
    topic.authorize({ id: 'user-1' } as CurrentUser, {
      projectId: 'project-1',
      artifactId: 'artifact-1',
    }),
    { message: /revoked/ }
  );
});
