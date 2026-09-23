import { randomUUID } from 'node:crypto';

import type { NativeFileContent } from '@localmind/office';
import { PrismaClient } from '@prisma/client';
import test from 'ava';

import { OfficeArtifactService } from '../../core/office/artifact-service';
import { NativeFileCreateService } from '../../core/office/create-service';
import { ProjectResourceService } from '../../core/project';
import { WorkspaceBlobStorage } from '../../core/storage';
import { createToolExecutionCallback } from '../../plugins/copilot/runtime/tool/bridge';
import { createProjectResourceTools } from '../../plugins/copilot/tools/project-doc';
import { createTestingApp, type TestingApp } from '../utils';

let app: TestingApp;
test.before(async () => {
  app = await createTestingApp();
});
test.beforeEach(async () => {
  await app.initTestingDB();
});
test.after.always(async () => {
  await app.close();
});

async function fixture(project = false) {
  const actor = await app.createUser();
  await app
    .POST('/api/auth/sign-in')
    .set('x-affine-version', '0.26.7')
    .send({ email: actor.email, password: actor.password })
    .expect(200);
  const db = app.get(PrismaClient);
  const workspace = await app.models.workspace.create(actor.id);
  const owner = await db.aiContextProject.create({
    data: {
      name: 'Files',
      members: { create: { userId: actor.id, role: 'owner' } },
    },
  });
  await db.aiPrompt.create({
    data: { name: 'file-create-test', model: 'test' },
  });
  const session = await db.aiSession.create({
    data: {
      id: randomUUID(),
      userId: actor.id,
      promptName: 'file-create-test',
      promptAction: '',
      workspaceId: project ? null : workspace.id,
      selectedContextProjectId: project ? owner.id : null,
    },
  });
  return {
    actorId: actor.id,
    sessionId: session.id,
    workspaceId: workspace.id,
    projectId: owner.id,
    db,
  };
}

const contents: NativeFileContent[] = [
  { format: 'docx', paragraphs: [{ text: '测试报告', heading: 1 }] },
  { format: 'xlsx', sheets: [{ name: '预算', rows: [['收入', 12]] }] },
  { format: 'pptx', slides: [{ title: '计划', paragraphs: ['下一步'] }] },
  { format: 'txt', text: 'same text' },
  { format: 'md', text: 'same text' },
  { format: 'json', text: '{"ok":true}' },
  { format: 'csv', rows: [['项目', 42]] },
];

test.serial(
  'workspace creates, replays and downloads real files; conflicting retries and unauthorized sessions fail',
  async t => {
    const { actorId, sessionId, workspaceId, db } = await fixture();
    const service = app.get(NativeFileCreateService);
    for (const content of contents) {
      const input = {
        actorId,
        sessionId,
        workspaceId,
        requestKey: content.format,
        file: { title: '测试', content },
      };
      const saved = await service.create(input);
      const replay = await service.create(input);
      t.is(saved.resourceId, replay.resourceId);
      t.is(saved.status, 'saved');
      if (saved.artifactId && saved.revisionId) {
        const asset = await app
          .get(OfficeArtifactService)
          .readRevisionAsset(
            workspaceId,
            actorId,
            saved.artifactId,
            saved.revisionId,
            'package'
          );
        t.is(asset.bytes.length, saved.byteSize);
        t.is(asset.revision.origin, 'import');
        t.like(asset.revision.operationSummary, { type: 'ai_create' });
      } else {
        const download = await app.GET(saved.url).expect(200);
        t.true(download.headers['content-disposition'].includes('attachment'));
        const list = await app
          .GET(`/api/workspaces/${workspaceId}/files`)
          .expect(200);
        t.true(
          list.body.items.some(
            (file: { id: string }) => file.id === saved.resourceId
          )
        );
      }
      await t.throwsAsync(
        service.create({ ...input, file: { ...input.file, title: 'changed' } })
      );
    }
    t.is(await db.officeArtifact.count(), 3);
    t.is(await db.workspaceFile.count(), 4);
    const other = await app.createUser();
    await t.throwsAsync(
      service.create({
        actorId: other.id,
        sessionId,
        workspaceId,
        requestKey: 'forged',
        file: { title: 'bad', content: contents[0] },
      })
    );
    const file = await db.workspaceFile.findFirstOrThrow();
    await t.throwsAsync(
      app.get(WorkspaceBlobStorage).delete(workspaceId, file.blobKey, true)
    );
    await t.throwsAsync(
      app
        .get(WorkspaceBlobStorage)
        .put(workspaceId, file.blobKey, Buffer.from('changed'))
    );
  }
);

test.serial(
  'project file creation is a durable internal task and replays without duplicates',
  async t => {
    const { actorId, sessionId, projectId, db } = await fixture(true);
    const previous = env.DEPLOYMENT_TYPE;
    Object.assign(env, { DEPLOYMENT_TYPE: 'selfhosted' });
    try {
      const tools = createProjectResourceTools(
        app.models,
        app.get(ProjectResourceService),
        { user: actorId, session: sessionId, tools: ['docCreate'] },
        projectId,
        undefined,
        app.get(NativeFileCreateService)
      );
      const callback = createToolExecutionCallback(tools);
      for (const content of contents) {
        const args = { title: '项目文件', content };
        const response = await callback({
          callId: content.format,
          name: 'project_file_create',
          args: { ...args, content: JSON.stringify(content) },
        });
        t.falsy(response.isError);
        const execute = { toolCallId: content.format };
        const result = await tools.project_file_create.execute!(args, execute);
        const replay = await tools.project_file_create.execute!(args, execute);
        t.deepEqual(replay, result);
      }
      t.is(await db.projectResource.count(), 7);
      t.is(await db.workspaceFile.count(), 0);
      t.is(
        await db.officeArtifact.count({
          where: { workspaceId: { not: null } },
        }),
        0
      );
      const replacement = await app.createUser();
      await db.aiContextProjectMember.create({
        data: { projectId, userId: replacement.id, role: 'owner' },
      });
      await db.aiContextProjectMember.deleteMany({
        where: { projectId, userId: actorId },
      });
      await t.throwsAsync(async () =>
        tools.project_file_create.execute!(
          { title: 'No access', content: contents[0] },
          { toolCallId: 'revoked' }
        )
      );
    } finally {
      Object.assign(env, { DEPLOYMENT_TYPE: previous });
    }
  }
);
