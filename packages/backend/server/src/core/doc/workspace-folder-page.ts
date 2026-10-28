import { createHash, randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import type { TransactionalAdapterPrisma } from '@nestjs-cls/transactional-adapter-prisma';
import { generateKeyBetween } from 'fractional-indexing';
import { z } from 'zod';

import { BadRequest, ResourceConflict } from '../../base';
import { Models } from '../../models';
import { WorkspaceOrganizationService } from './workspace-organization';
import { WorkspaceResourceService } from './workspace-resource';
import { DocWriter } from './writer';

const commandSchema = z.object({
  workspaceId: z.string().min(1).max(256),
  actorId: z.string().min(1),
  folderId: z.string().min(1).max(256),
  requestKey: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(512),
  primaryMode: z.enum(['page', 'edgeless']),
});

@Injectable()
export class WorkspaceFolderPageService {
  constructor(
    private readonly resources: WorkspaceResourceService,
    private readonly organization: WorkspaceOrganizationService,
    private readonly writer: DocWriter,
    private readonly models: Models,
    private readonly transaction: TransactionHost<TransactionalAdapterPrisma>
  ) {}

  async create(input: z.infer<typeof commandSchema>) {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new BadRequest('Invalid folder page creation');
    const command = parsed.data;
    const { workspaceId, actorId, folderId, requestKey, title, primaryMode } =
      command;
    const requestHash = createHash('sha256')
      .update(JSON.stringify([folderId, title, primaryMode]))
      .digest('hex');
    return this.resources.snapshot(command, async () => {
      const authorize = async () => {
        await this.resources.assertWorkspace(command, 'Workspace.CreateDoc');
        await this.resources.assertWorkspace(command, 'Workspace.Sync');
        await this.organization.assertResourceFolderAccess(
          workspaceId,
          actorId,
          folderId,
          true
        );
      };
      await authorize();
      const receipt =
        await this.transaction.tx.workspaceFolderPageCreation.findUnique({
          where: {
            workspaceId_actorId_requestKey: {
              workspaceId,
              actorId,
              requestKey,
            },
          },
        });
      if (receipt) {
        if (receipt.requestHash !== requestHash)
          throw new ResourceConflict(
            'Creation request changed; resume the original request'
          );
        // Never recreate, move back, or revive a resource changed after creation.
        await this.resources.assertDocument(command, receipt.documentId);
        return { documentId: receipt.documentId, folderId, replayed: true };
      }
      const state = await this.models.workspacePageTree.state(workspaceId);
      if (state && !['preflight', 'needs_resolution'].includes(state.phase))
        throw new BadRequest('page_tree_protocol_retired');
      const documentId = randomUUID();
      await this.writer.createDoc(
        workspaceId,
        title,
        '',
        actorId,
        documentId,
        authorize
      );
      await this.models.doc.upsertMeta(workspaceId, documentId, { title });
      await this.models.docUser.setOwner(workspaceId, documentId, actorId);
      if (primaryMode === 'edgeless')
        await this.organization.applyDataOperations(
          workspaceId,
          actorId,
          actorId,
          'document_properties',
          [{ op: 'upsert', key: documentId, values: { primaryMode } }]
        );
      // The identity was allocated above in this transaction; no existing
      // placement or root access is used to grant authority over another page.
      const directory = await this.organization.readDirectory(
        workspaceId,
        actorId
      );
      const last = directory.entries
        .map(entry => entry.row)
        .filter(row => row.parentId === folderId)
        .map(row => String(row.index))
        .sort()
        .at(-1);
      await this.organization.applyDataOperations(
        workspaceId,
        actorId,
        actorId,
        'folders',
        [
          {
            op: 'upsert',
            key: randomUUID(),
            values: {
              type: 'doc',
              data: documentId,
              parentId: folderId,
              index: generateKeyBetween(last ?? null, null),
            },
          },
        ]
      );
      await authorize();
      await this.transaction.tx.workspaceFolderPageCreation.create({
        data: {
          workspaceId,
          actorId,
          requestKey,
          requestHash,
          documentId,
          folderId,
        },
      });
      return { documentId, folderId, replayed: false };
    });
  }
}
