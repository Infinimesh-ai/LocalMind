import {
  exportXlsxCompatibilityCopy,
  openXlsxPackage,
  readXlsxSemanticState,
  XlsxCompatibilityError,
} from '@localmind/office/xlsx';
import { PrismaClient } from '@prisma/client';
import test from 'ava';
import type { Response as ExpressResponse } from 'express';
import type { Response } from 'superagent';

import { OfficeArtifactService } from '../../core/office/artifact-service';
import { officeFingerprint } from '../../core/office/evidence';
import { officeXlsxExportResponse } from '../../core/office/xlsx-export-response';
import { legacyXlsxRevisions } from '../storage/office-xlsx-compatibility.fixture';
import { createTestingApp, type TestingApp } from '../utils';

function binary(
  response: Response,
  done: (error: Error | null, body?: Buffer) => void
) {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => done(null, Buffer.concat(chunks)));
  response.on('error', done);
}
let app: TestingApp;
test.before(async () => {
  app = await createTestingApp();
  await app.initTestingDB();
});
test.after.always(async () => {
  await app.close();
});

for (const kind of ['workspace', 'project'] as const) {
  test.serial(
    `${kind} exports current and historical repair copies with unchanged source revisions and blobs`,
    async t => {
      const user = await app.createUser();
      const db = app.get(PrismaClient);
      const workspace = await app.models.workspace.create(user.id);
      const project = await db.aiContextProject.create({
        data: {
          name: 'QA122',
          members: { create: { userId: user.id, role: 'owner' } },
        },
      });
      const owner =
        kind === 'workspace' ? workspace.id : { projectId: project.id };
      const fixture = await legacyXlsxRevisions(app, owner, user.id);
      const before = await db.officeRevision.findMany({
        where: { artifactId: fixture.artifact.id },
        orderBy: { sequence: 'asc' },
      });
      const beforeBlobs = await db.blob.count();
      await app
        .POST('/api/auth/sign-in')
        .send({ email: user.email, password: user.password })
        .expect(200);
      for (const [i, revision] of fixture.revisions.entries()) {
        const root = `/api/${kind === 'workspace' ? 'workspaces' : 'projects'}/${kind === 'workspace' ? workspace.id : project.id}/office/artifacts/${fixture.artifact.id}/revisions/${revision.id}`;
        const response = await app
          .GET(`${root}/export/xlsx`)
          .buffer(true)
          .parse(binary)
          .expect(200);
        const bytes = response.body as Buffer;
        t.deepEqual(
          bytes,
          Buffer.from(exportXlsxCompatibilityCopy(fixture.packages[i]).bytes)
        );
        t.is(
          response.headers['x-localmind-office-source-fingerprint'],
          revision.packageFingerprint
        );
        t.is(response.headers.etag, `"${officeFingerprint(bytes)}"`);
        t.is(response.headers['cache-control'], 'private, no-store');
        t.true(
          response.headers['content-disposition'].includes(
            `-v${i + 1}-compatible.xlsx`
          )
        );
        t.is(readXlsxSemanticState(openXlsxPackage(bytes)).sheets.length, 2);
        t.deepEqual(
          (
            await app
              .GET(`${root}/package`)
              .buffer(true)
              .parse(binary)
              .expect(200)
          ).body,
          fixture.packages[i]
        );
        t.deepEqual(
          (
            await app
              .GET(`${root}/export/xlsx`)
              .buffer(true)
              .parse(binary)
              .expect(200)
          ).body,
          bytes
        );
      }
      t.deepEqual(
        await db.officeRevision.findMany({
          where: { artifactId: fixture.artifact.id },
          orderBy: { sequence: 'asc' },
        }),
        before
      );
      t.is(await db.blob.count(), beforeBlobs);
      t.is(
        (await app.models.officeArtifact.get(owner, fixture.artifact.id))
          ?.revisionCounter,
        2
      );
      const other = await app.createUser();
      await t.throwsAsync(
        app
          .get(OfficeArtifactService)
          .exportWorkbookRevisionCopy(
            owner,
            other.id,
            fixture.artifact.id,
            fixture.revisions[0].id
          )
      );
      const unrelated = await app.models.workspace.create(user.id);
      await t.throwsAsync(
        app
          .get(OfficeArtifactService)
          .exportWorkbookRevisionCopy(
            unrelated.id,
            user.id,
            fixture.artifact.id,
            fixture.revisions[0].id
          )
      );
      if (kind === 'project') {
        await db.aiContextProjectMember.create({
          data: { projectId: project.id, userId: other.id, role: 'owner' },
        });
        await db.aiContextProjectMember.deleteMany({
          where: { projectId: project.id, userId: user.id },
        });
        await t.throwsAsync(
          app
            .get(OfficeArtifactService)
            .exportWorkbookRevisionCopy(
              owner,
              user.id,
              fixture.artifact.id,
              fixture.revisions[0].id
            )
        );
      }
    }
  );
}

test('unsafe repair returns an actionable bounded failure without source details', async t => {
  const headers = new Map<string, unknown>();
  let status = 0;
  let body: unknown;
  const response = {
    setHeader(name: string, value: unknown) {
      headers.set(name, value);
    },
    status(value: number) {
      status = value;
      return response;
    },
    json(value: unknown) {
      body = value;
    },
  };
  await officeXlsxExportResponse(
    async () => {
      throw new XlsxCompatibilityError('private source diagnostics');
    },
    response as unknown as ExpressResponse
  );
  t.is(status, 422);
  t.is(headers.get('cache-control'), 'private, no-store');
  t.is(
    headers.get('x-localmind-office-error'),
    'xlsx-compatibility-unavailable'
  );
  t.deepEqual(body, { code: 'xlsx-compatibility-unavailable' });
});
