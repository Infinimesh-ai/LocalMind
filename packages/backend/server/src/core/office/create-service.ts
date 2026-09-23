import { createHash } from 'node:crypto';

import { createNativeFile, NativeFileContentSchema } from '@localmind/office';
import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { EventBus } from '../../base';
import { Models } from '../../models';
import {
  officeOwnerFromInput,
  type OfficeOwnerInput,
} from '../../models/office-owner';
import { PermissionAccess } from '../permission';
import { ProjectResourceService } from '../project';
import { OfficeImportService } from './import-service';
import { OfficeResourceStorage } from './resource-storage';

export const NativeFileCreateSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(480)
      .refine(
        value =>
          Array.from(value).every(
            c => c !== '/' && c !== '\\' && c.charCodeAt(0) >= 32
          ),
        'Invalid file name'
      ),
    content: NativeFileContentSchema,
    parent_id: z.string().min(1).max(256).nullish(),
  })
  .strict();

@Injectable()
export class NativeFileCreateService {
  constructor(
    private readonly models: Models,
    private readonly ac: PermissionAccess,
    private readonly storage: OfficeResourceStorage,
    private readonly imports: OfficeImportService,
    private readonly projects: ProjectResourceService,
    private readonly event: EventBus
  ) {}

  generatePrivate(fileInput: z.input<typeof NativeFileCreateSchema>) {
    const file = NativeFileCreateSchema.parse(fileInput);
    const generated = createNativeFile(file.content);
    const bytes = Buffer.from(generated.bytes);
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    const fileName = file.title
      .toLowerCase()
      .endsWith(`.${file.content.format}`)
      ? file.title
      : `${file.title}.${file.content.format}`;
    return {
      bytes,
      fingerprint,
      fileName,
      format: file.content.format,
      mimeType: generated.mimeType,
    };
  }

  async create(
    input: OfficeOwnerInput & {
      actorId: string;
      sessionId: string;
      requestKey: string;
      file: z.infer<typeof NativeFileCreateSchema>;
    }
  ) {
    const file = NativeFileCreateSchema.parse(input.file);
    if (!input.requestKey || input.requestKey.length > 256)
      throw new Error('File creation requires a stable request key');
    const owner = officeOwnerFromInput(input);
    const authorize = async () => {
      const session = await this.models.copilotSession.getMeta(input.sessionId);
      if (
        !session ||
        session.userId !== input.actorId ||
        (typeof owner === 'string'
          ? session.workspaceId !== owner || !!session.selectedContextProjectId
          : !!session.workspaceId ||
            !!session.docId ||
            session.selectedContextProjectId !== owner.projectId)
      )
        throw new Error('File creation conversation authorization changed');
      if (typeof owner === 'string') {
        const access = this.ac.user(input.actorId).workspace(owner);
        await Promise.all([
          access.assert('Workspace.Copilot'),
          access.assert('Workspace.CreateDoc'),
          access.assert('Workspace.Blobs.Write'),
        ]);
      } else
        await this.models.projectResource.assertMember({
          projectId: owner.projectId,
          actorId: input.actorId,
        });
    };
    await authorize();
    const execute = async () => {
      const office = ['docx', 'xlsx', 'pptx'].includes(file.content.format);
      if (typeof owner === 'string' && file.parent_id)
        throw new Error(
          'Workspace file creation currently supports the workspace root only'
        );
      const generated = this.generatePrivate(file);
      const { bytes, fingerprint, fileName } = generated;
      const requestKey = `ai-file:${createHash('sha256')
        .update(
          JSON.stringify([input.actorId, input.sessionId, input.requestKey])
        )
        .digest('hex')}`;
      const blobKey = await this.storage.putGenerated(
        owner,
        input.actorId,
        bytes,
        generated.mimeType,
        authorize
      );
      await authorize();
      if (office) {
        const saved = await this.imports.import({
          ...(typeof owner === 'string'
            ? { workspaceId: owner }
            : { projectId: owner.projectId }),
          actorId: input.actorId,
          sourceBlobKey: blobKey,
          sourceFileName: fileName,
          title: fileName,
          importIdempotencyKey: requestKey,
          parentId: file.parent_id,
          projectRequestKey: requestKey,
          generation: { sessionId: input.sessionId, requestKey },
        });
        return {
          status: 'saved',
          resourceId: saved.artifact.id,
          artifactId: saved.artifact.id,
          revisionId: saved.revision.id,
          fileName,
          format: file.content.format,
          byteSize: bytes.length,
          fingerprint,
          url:
            typeof owner === 'string'
              ? `/workspace/${owner}/office/${saved.artifact.id}`
              : `/project/${owner.projectId}/resources/${saved.artifact.id}`,
        };
      }
      if (typeof owner === 'string') {
        const saved = await this.models.workspaceFile.create({
          workspaceId: owner,
          createdBy: input.actorId,
          sourceSessionId: input.sessionId,
          fileName,
          mimeType: generated.mimeType,
          byteSize: bytes.length,
          blobKey,
          fingerprint,
          requestKey,
          requestFingerprint: createHash('sha256')
            .update(JSON.stringify([fileName, fingerprint, generated.mimeType]))
            .digest('hex'),
        });
        return {
          status: 'saved',
          resourceId: saved.id,
          fileName,
          format: file.content.format,
          byteSize: bytes.length,
          fingerprint,
          url: `/api/workspaces/${owner}/files/${saved.id}/download`,
        };
      }
      const saved = await this.projects.createFile({
        projectId: owner.projectId,
        actorId: input.actorId,
        title: fileName,
        blobKey,
        parentId: file.parent_id,
        requestKey,
        origin: 'ai',
        sourceSessionId: input.sessionId,
      });
      return {
        status: 'saved',
        resourceId: saved.id,
        fileName,
        format: file.content.format,
        byteSize: bytes.length,
        fingerprint,
        url: `/project/${owner.projectId}/resources/${saved.id}`,
      };
    };
    const result = await (typeof owner === 'string'
      ? this.models.copilotContext.withWorkspaceWriteAudit(
          {
            actorId: input.actorId,
            sessionId: input.sessionId,
            sink: {
              type: 'tool_write',
              id: input.requestKey,
              workspaceId: owner,
              phase: 'execute',
            },
          },
          execute
        )
      : this.models.copilotContext.withProjectSourcesShared(
          {
            projectId: owner.projectId,
            actorId: input.actorId,
            sessionId: input.sessionId,
            sink: {
              type: 'tool_write',
              id: input.requestKey,
              projectId: owner.projectId,
              phase: 'execute',
            },
          },
          execute
        ));
    if (typeof owner === 'string')
      await this.event.emitAsync('workspace.blobs.updated', {
        workspaceId: owner,
      });
    return result;
  }
}
