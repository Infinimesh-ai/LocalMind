import '../src/prelude';

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { openDocxPackage, readDocxSemanticState } from '@localmind/office/docx';
import {
  createMinimalPdfFixture,
  createMinimalPptxFixture,
  createMinimalXlsxFixture,
} from '@localmind/office/testing';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';

import { AppModule } from '../src/app.module';
import {
  OFFICE_FORMATS,
  OfficeCommandService,
  OfficeImportService,
} from '../src/core/office';
import { ProjectBlobStorage } from '../src/core/project';
import { WorkspaceBlobStorage } from '../src/core/storage';
import { Models } from '../src/models';

const email = 'office-validation@local.test';
const workspaceName = 'Office Surface Validation';
const projectName = 'Office Surface Validation';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: false,
});

try {
  const db = app.get(PrismaClient);
  const models = app.get(Models);
  const imports = app.get(OfficeImportService);
  const commands = app.get(OfficeCommandService);
  const workspaceBlobs = app.get(WorkspaceBlobStorage);
  const projectBlobs = app.get(ProjectBlobStorage);
  const user = await db.user.findUniqueOrThrow({ where: { email } });
  const workspace = await db.workspace.findFirstOrThrow({
    where: { name: workspaceName, members: { some: { userId: user.id } } },
    orderBy: { createdAt: 'desc' },
  });
  let project = await db.aiContextProject.findFirst({
    where: { name: projectName, members: { some: { userId: user.id } } },
    orderBy: { createdAt: 'desc' },
  });
  project ??= await db.aiContextProject.create({
    data: {
      name: projectName,
      createdByUserId: user.id,
      members: { create: { userId: user.id, role: 'owner' } },
    },
  });

  const docx = await readFile(
    new URL('../../../common/native/fixtures/demo.docx', import.meta.url)
  );
  const docxState = readDocxSemanticState(openDocxPackage(docx));
  const paragraph = docxState.body.find(block => block.type === 'paragraph');
  if (!paragraph) throw new Error('DOCX validation fixture needs a paragraph');
  const samples = [
    {
      format: 'docx' as const,
      bytes: docx,
      edit: {
        operation: 'office.document.text.replace',
        target: {
          type: 'text_range',
          start: { blockId: paragraph.id, offset: 0 },
          end: { blockId: paragraph.id, offset: 0 },
        },
        text: 'Surface validation ',
      },
    },
    {
      format: 'xlsx' as const,
      bytes: Buffer.from(createMinimalXlsxFixture()),
      edit: {
        operation: 'office.workbook.cell.set',
        target: { type: 'cell', sheetId: '7', address: 'D2' },
        input: { type: 'string', value: 'Surface validation' },
      },
    },
    {
      format: 'pptx' as const,
      bytes: Buffer.from(createMinimalPptxFixture()),
      edit: {
        operation: 'office.presentation.shape.text.set',
        target: { type: 'shape', slideId: 'slide-rel', shapeId: '2' },
        text: 'Surface validation',
      },
    },
    {
      format: 'pdf' as const,
      bytes: Buffer.from(await createMinimalPdfFixture()),
      edit: {
        operation: 'office.pdf.page.rotate',
        target: { type: 'page', pageIndex: 0 },
        rotationDeg: 90,
      },
    },
  ];
  const evidence: Array<Record<string, unknown>> = [];
  for (const sample of samples) {
    const policy = OFFICE_FORMATS[sample.format];
    const sourceFileName = `surface-validation.${sample.format}`;
    const title = `Surface Validation ${sample.format.toUpperCase()}`;
    const workspaceKey = `office-surface-validation-${createHash('sha256').update(sample.bytes).digest('hex')}${policy.extension}`;
    await workspaceBlobs.put(workspace.id, workspaceKey, sample.bytes, {
      contentType: policy.mimeType,
      contentLength: sample.bytes.length,
    });
    const workspaceImport = await imports.import({
      workspaceId: workspace.id,
      actorId: user.id,
      sourceBlobKey: workspaceKey,
      title,
      sourceFileName,
      importIdempotencyKey: `surface-validation-workspace-${sample.format}`,
    });
    let workspaceRevision = workspaceImport.revision;
    if (workspaceImport.artifact.revisionCounter === 1) {
      workspaceRevision = (
        await commands.execute({
          workspaceId: workspace.id,
          actorId: user.id,
          command: {
            version: 'localmind-office-command/v1',
            commandId: `surface-validation-workspace-edit-${sample.format}`,
            idempotencyKey: `surface-validation-workspace-edit-${sample.format}`,
            artifactId: workspaceImport.artifact.id,
            expectedRevisionId: workspaceImport.revision.id,
            source: 'user',
            ...sample.edit,
          },
        })
      ).revision;
    }

    const projectBlob = await projectBlobs.put({
      projectId: project.id,
      actorId: user.id,
      bytes: sample.bytes,
      mimeType: policy.mimeType,
    });
    const projectImport = await imports.import({
      projectId: project.id,
      actorId: user.id,
      sourceBlobKey: projectBlob.key,
      title,
      sourceFileName,
      importIdempotencyKey: `surface-validation-project-${sample.format}`,
    });
    let projectRevision = projectImport.revision;
    if (projectImport.artifact.revisionCounter === 1) {
      const lease = (
        await models.projectResourceEditLease.acquire({
          projectId: project.id,
          actorId: user.id,
          resourceId: projectImport.artifact.id,
          kind: 'user',
          tabId: `surface-validation-${sample.format}`,
        })
      ).lease;
      if (!lease) throw new Error('Project validation edit lease unavailable');
      const editLease = {
        kind: 'user' as const,
        tabId: lease.tabId,
        leaseId: lease.leaseId,
      };
      projectRevision = (
        await commands.execute({
          projectId: project.id,
          actorId: user.id,
          editLease,
          command: {
            version: 'localmind-office-command/v1',
            commandId: `surface-validation-project-edit-${sample.format}`,
            idempotencyKey: `surface-validation-project-edit-${sample.format}`,
            artifactId: projectImport.artifact.id,
            expectedRevisionId: projectImport.revision.id,
            source: 'user',
            ...sample.edit,
          },
        })
      ).revision;
      await models.projectResourceEditLease.release({
        projectId: project.id,
        actorId: user.id,
        resourceId: projectImport.artifact.id,
        ...editLease,
      });
    }
    evidence.push({
      format: sample.format,
      workspace: {
        ownerId: workspace.id,
        artifactId: workspaceImport.artifact.id,
        revisionId: workspaceRevision.id,
        sequence: workspaceRevision.sequence,
      },
      project: {
        ownerId: project.id,
        artifactId: projectImport.artifact.id,
        revisionId: projectRevision.id,
        sequence: projectRevision.sequence,
      },
    });
  }
  console.log(
    `OFFICE_SURFACE_EVIDENCE=${JSON.stringify({
      generatedAt: new Date().toISOString(),
      actorId: user.id,
      workspaceId: workspace.id,
      projectId: project.id,
      artifacts: evidence,
    })}`
  );
} finally {
  await app.close();
}
