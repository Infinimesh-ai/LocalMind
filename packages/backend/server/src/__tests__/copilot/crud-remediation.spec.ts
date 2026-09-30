import { PrismaClient } from '@prisma/client';
import test from 'ava';
import Sinon from 'sinon';
import * as Y from 'yjs';
import { z } from 'zod';

import { DocReader, DocWriter } from '../../core/doc';
import { PermissionAccess } from '../../core/permission';
import { ProjectResourceService } from '../../core/project';
import { WorkspaceMemberStatus, WorkspaceRole } from '../../models';
import { CopilotContextMemoryResolver } from '../../plugins/copilot/context-memory-resolver';
import { IntelligenceWorkbenchResolver } from '../../plugins/copilot/intelligence-workbench-resolver';
import {
  matchesToolCapability,
  toolCapability,
} from '../../plugins/copilot/runtime/tool-capability-snapshot';
import { buildDocContentGetter } from '../../plugins/copilot/tools/doc-read';
import {
  buildDocUpdateHandler,
  createDocUpdateTool,
} from '../../plugins/copilot/tools/doc-write';
import { defineTool } from '../../plugins/copilot/tools/tool';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
const deployment = env.DEPLOYMENT_TYPE;
test.before(async () => {
  Object.assign(env, { DEPLOYMENT_TYPE: 'selfhosted' });
  app = await createTestingApp();
});
test.beforeEach(async () => app.initTestingDB());
test.after.always(async () => {
  Sinon.restore();
  Object.assign(env, { DEPLOYMENT_TYPE: deployment });
  await app?.close();
});

async function documentFixture() {
  const actor = await app.createUser();
  const workspace = await app.models.workspace.create(actor.id);
  const root = new Y.Doc();
  root.getMap('meta').set('pages', new Y.Array());
  await app.models.doc.createUpdates([
    {
      spaceId: workspace.id,
      docId: workspace.id,
      blob: Buffer.from(Y.encodeStateAsUpdate(root)),
      timestamp: Date.now(),
      editorId: actor.id,
    },
  ]);
  root.destroy();
  const writer = app.get(DocWriter);
  const reader = app.get(DocReader);
  const { docId } = await writer.createDoc(
    workspace.id,
    'Concurrent document',
    'Original paragraph.',
    actor.id
  );
  await app.models.doc.upsertMeta(workspace.id, docId, {
    title: 'Concurrent document',
  });
  await app.models.docUser.setOwner(workspace.id, docId, actor.id);
  await reader.getDoc(workspace.id, docId);
  const options = { user: actor.id, workspace: workspace.id };
  const update = buildDocUpdateHandler(
    app.get(PermissionAccess),
    writer,
    app.models
  );
  const read = () => reader.getVersionedDocMarkdown(workspace.id, docId);
  return { actor, workspace, writer, reader, docId, options, update, read };
}

test.serial(
  'old frozen tool schemas do not gain the versioned update contract',
  t => {
    const old = defineTool({
      description: 'Legacy full replacement',
      inputSchema: z.object({ doc_id: z.string(), content: z.string() }),
      execute: async () => ({}),
    });
    const current = createDocUpdateTool(async () => ({}));
    t.false(
      matchesToolCapability(
        'workspace_doc_update',
        current,
        toolCapability('workspace_doc_update', old)
      )
    );
    t.true(
      matchesToolCapability(
        'workspace_doc_update',
        current,
        toolCapability('workspace_doc_update', current)
      )
    );
    t.is(
      toolCapability('workspace_doc_update', current).sideEffectType,
      'workspace_write'
    );
  }
);

test.serial(
  'AI read returns the version of its text; stale updates preserve intervening content',
  async t => {
    const f = await documentFixture();
    const get = buildDocContentGetter(
      app.get(PermissionAccess),
      f.reader,
      app.models
    );
    const before = await get(f.options, f.docId);
    t.false('type' in before, JSON.stringify(before));
    if (!('version' in before)) return;
    t.regex(before.version, /^[a-f0-9]{64}$/);
    await f.writer.updateDoc(
      f.workspace.id,
      f.docId,
      'Original paragraph.\n\nHuman addition.',
      f.actor.id
    );
    const current = (await f.read())!;
    const tool = createDocUpdateTool(f.update.bind(null, f.options));
    const result = await tool.execute!(
      {
        doc_id: f.docId,
        content: 'AI replacement.',
        expected_version: before.version,
      },
      {}
    );
    t.like(result, { type: 'error' });
    t.regex(
      String((result as { message: string }).message),
      /version_conflict/
    );
    t.deepEqual(await f.read(), current);
    const saved = await f.update(
      f.options,
      f.docId,
      'AI replacement.\n\nHuman addition.',
      current.version
    );
    t.like(saved, { success: true, docId: f.docId });
    t.true((await f.read())!.markdown.includes('Human addition.'));
    t.is(
      await app.get(PrismaClient).workspaceDoc.count({
        where: { workspaceId: f.workspace.id, docId: f.docId },
      }),
      1
    );
  }
);

test.serial(
  'two concurrent full replacements at one version commit only once',
  async t => {
    const f = await documentFixture();
    const before = (await f.read())!;
    const results = await Promise.allSettled([
      f.update(f.options, f.docId, 'First edit.', before.version),
      f.update(f.options, f.docId, 'Second edit.', before.version),
    ]);
    t.is(results.filter(result => result.status === 'fulfilled').length, 1);
    const failed = results.find(result => result.status === 'rejected');
    t.regex(
      String(failed?.status === 'rejected' ? failed.reason : ''),
      /version_conflict/
    );
    const saved = (await f.read())!;
    t.not(saved.version, before.version);
    await t.throwsAsync(
      f.update(f.options, f.docId, saved.markdown, before.version),
      { message: /version_conflict/ }
    );
    t.is((await f.read())!.version, saved.version);
  }
);

test.serial('a version never replaces live write permission', async t => {
  const f = await documentFixture();
  const member = await app.createUser();
  await app.models.workspaceUser.set(
    f.workspace.id,
    member.id,
    WorkspaceRole.Collaborator,
    { status: WorkspaceMemberStatus.Accepted }
  );
  const before = (await f.read())!;
  await app.models.workspaceUser.delete(f.workspace.id, member.id);
  const result = await f.update(
    { ...f.options, user: member.id },
    f.docId,
    'Forbidden edit.',
    before.version
  );
  t.like(result, { type: 'error' });
  t.deepEqual(await f.read(), before);
});

test.serial('failed audit rolls back versioned content and outbox', async t => {
  const f = await documentFixture();
  const before = (await f.read())!;
  const db = app.get(PrismaClient);
  const outbox = await db.workspaceDocOutbox.count();
  const audit = Sinon.stub(
    app.models.copilotContext,
    'recordWorkspaceWriteAudit'
  ).rejects(new Error('Audit unavailable'));
  try {
    await t.throwsAsync(
      f.update(f.options, f.docId, 'Rollback edit.', before.version),
      { message: 'Audit unavailable' }
    );
  } finally {
    audit.restore();
  }
  t.deepEqual(await f.read(), before);
  t.is(await db.workspaceDocOutbox.count(), outbox);
});

test.serial(
  'archived projects restore with the same identity and withdraw pending work only on transition',
  async t => {
    const owner = await app.createUser();
    const outsider = await app.createUser();
    const model = app.models.copilotContextMemory;
    const project = await model.createProject({
      createdByUserId: owner.id,
      name: 'Archive test',
    });
    const withdraw = Sinon.spy(
      app.models.intelligenceWorkbenchAuthorization,
      'withdrawPendingProjectWorkForArchive'
    );
    try {
      t.is(
        (
          await model.updateProject(project.id, owner.id, {
            status: 'archived',
          })
        )?.status,
        'archived'
      );
      await model.updateProject(project.id, owner.id, {
        status: 'archived',
        name: 'Archived title',
      });
      t.is(withdraw.callCount, 1);
      t.is(
        await model.updateProject(project.id, outsider.id, {
          status: 'active',
        }),
        null
      );
      const restored = await model.updateProject(project.id, owner.id, {
        status: 'active',
      });
      t.is(restored?.id, project.id);
      t.is(restored?.status, 'active');
      t.is(restored?.name, 'Archived title');
      t.is(withdraw.callCount, 1);
    } finally {
      withdraw.restore();
    }
  }
);

test.serial(
  'project deletion reports retained resources instead of inventing user memories',
  async t => {
    const owner = await app.createUser();
    const model = app.models.copilotContextMemory;
    const project = await model.createProject({
      createdByUserId: owner.id,
      name: 'Retained resources',
    });
    await app.get(ProjectResourceService).createFolder({
      projectId: project.id,
      actorId: owner.id,
      title: 'Folder',
      requestKey: 'folder',
    });
    t.deepEqual(await model.deleteProject(project.id, owner.id), {
      deleted: false,
      reason: 'references',
    });
    await t.throwsAsync(
      app
        .get(CopilotContextMemoryResolver)
        .deleteCopilotContextProject(
          { ...owner, hasPassword: false, emailVerified: false },
          project.id
        ),
      { message: /linked resources or retained history/ }
    );
    t.truthy(await model.getProject(project.id));
    const empty = await model.createProject({
      createdByUserId: owner.id,
      name: 'Empty',
    });
    t.deepEqual(await model.deleteProject(empty.id, owner.id), {
      deleted: true,
    });
    t.is(await model.getProject(empty.id), null);
  }
);

test.serial(
  'the legacy policy mutation still rejects changes to fixed Project AI permissions',
  async t => {
    const owner = await app.createUser();
    const project = await app.models.copilotContextMemory.createProject({
      createdByUserId: owner.id,
      name: 'Fixed policy',
    });
    for (const policy of ['read_only', 'read_write'] as const) {
      await t.throwsAsync(
        app
          .get(IntelligenceWorkbenchResolver)
          .setCopilotContextProjectAiPolicy(
            { ...owner, hasPassword: false, emailVerified: false },
            { projectId: project.id, policy }
          ),
        { message: 'Project AI permissions are fixed to read and write' }
      );
    }
    t.is(
      (await app.models.copilotContextMemory.getProject(project.id))?.aiPolicy,
      'read_write'
    );
  }
);
