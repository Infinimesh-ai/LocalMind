import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { Models } from '../../models';
import { PermissionAccess } from '../permission';
import { ResourceError, type WorkspaceResourceActor } from './resource-types';
import { WorkspaceOrganizationService } from './workspace-organization';
import { WorkspaceResourceService } from './workspace-resource';
import { DocWriter } from './writer';

const short = z.string().max(8192);
export const documentPropertiesPatch = z
  .object({
    title: z.string().min(1).max(512).optional(),
    icon: z
      .discriminatedUnion('type', [
        z.object({ type: z.literal('emoji'), unicode: short }).strict(),
        z
          .object({ type: z.literal('affine-icon'), name: short, color: short })
          .strict(),
      ])
      .nullable()
      .optional(),
    tagIds: z.array(z.string().min(1).max(256)).max(100).optional(),
    primaryMode: z.enum(['page', 'edgeless']).optional(),
    edgelessColorTheme: z.enum(['light', 'dark']).nullable().optional(),
    journal: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    pageWidth: z.enum(['full', 'standard']).nullable().optional(),
    isTemplate: z.boolean().optional(),
    custom: z
      .array(
        z
          .object({
            propertyId: z.string().min(1).max(256),
            value: short.nullable(),
          })
          .strict()
      )
      .max(100)
      .optional(),
  })
  .strict();

@Injectable()
export class DocumentPropertiesService {
  constructor(
    private readonly resources: WorkspaceResourceService,
    private readonly organization: WorkspaceOrganizationService,
    private readonly writer: DocWriter,
    private readonly ac: PermissionAccess,
    private readonly models: Models
  ) {}

  async read(actor: WorkspaceResourceActor, id: string) {
    await this.resources.assertDocument(actor, id);
    await this.ac
      .user(actor.actorId)
      .workspace(actor.workspaceId)
      .doc(id)
      .projectScope(null)
      .assert('Doc.Properties.Read');
    const state = await this.organization.readOrganization(
      actor.workspaceId,
      actor.actorId
    );
    const properties =
      state.documentProperties.find(record => record.id === id) ?? {};
    const icon =
      state.explorerIcons.find(record => record.id === `doc:${id}`)?.icon ??
      null;
    const page = state.documents.find(page => page.id === id);
    const value = {
      properties,
      icon,
      tags: z.array(z.string()).parse(page?.tags ?? []),
    };
    return {
      ...value,
      version: createHash('sha256').update(JSON.stringify(value)).digest('hex'),
      definitions: state.workspaceProperties,
    };
  }

  async update(
    actor: WorkspaceResourceActor,
    input: {
      documentId: string;
      expectedVersion: string;
      expectedMetadataVersion: string;
      properties: z.infer<typeof documentPropertiesPatch>;
    },
    authorize: () => Promise<void>,
    preview = false
  ) {
    await authorize();
    await this.resources.assertDocument(actor, input.documentId);
    const acl = this.ac
      .user(actor.actorId)
      .workspace(actor.workspaceId)
      .doc(input.documentId)
      .projectScope(null);
    await acl.assert('Doc.Properties.Update');
    const document = await this.resources.describe(actor, input.documentId),
      previous = await this.read(actor, input.documentId);
    if (document.version !== input.expectedVersion)
      throw new ResourceError('version_conflict', document.version);
    if (previous.version !== input.expectedMetadataVersion)
      throw new ResourceError('version_conflict', previous.version);
    const { title, icon, tagIds, custom, ...fields } =
      documentPropertiesPatch.parse(input.properties);
    if (tagIds) {
      const tags = await this.organization.resourceTagDefinitions(
        actor.workspaceId
      );
      if (
        new Set(tagIds).size !== tagIds.length ||
        tagIds.some(id => !tags.some(tag => tag.id === id))
      )
        throw new ResourceError('invalid_input');
    }
    let changed = false;
    if (title !== undefined && title !== document.title) {
      await acl.assert('Doc.Update');
      if (!preview) {
        await this.writer.updateDocMeta(
          actor.workspaceId,
          input.documentId,
          { title },
          actor.actorId,
          authorize
        );
        await this.models.doc.upsertMeta(actor.workspaceId, input.documentId, {
          title,
        });
      }
      changed = true;
    }
    const values: Record<string, string | boolean | null> = {};
    for (const [key, value] of Object.entries(fields))
      if (!isDeepStrictEqual(previous.properties[key], value))
        values[key] = value;
    for (const field of custom ?? []) {
      const definition = previous.definitions.find(
        item => item.id === field.propertyId && item.isDeleted !== true
      );
      if (
        !definition ||
        !['text', 'number', 'checkbox', 'date'].includes(
          String(definition.type)
        )
      )
        throw new ResourceError('invalid_input');
      if (
        field.value !== null &&
        definition.type === 'number' &&
        field.value !== '' &&
        !Number.isFinite(Number(field.value))
      )
        throw new ResourceError('invalid_input');
      const key = `custom:${field.propertyId}`;
      if (!isDeepStrictEqual(previous.properties[key], field.value))
        values[key] = field.value;
    }
    if (Object.keys(values).length) {
      if (!preview)
        await this.organization.applyDataOperations(
          actor.workspaceId,
          actor.actorId,
          actor.actorId,
          'document_properties',
          [{ op: 'upsert', key: input.documentId, values }]
        );
      changed = true;
    }
    if (icon !== undefined && !isDeepStrictEqual(previous.icon, icon)) {
      if (!preview)
        await this.organization.applyDataOperations(
          actor.workspaceId,
          actor.actorId,
          actor.actorId,
          'explorer_icons',
          [
            icon === null
              ? { op: 'delete', key: `doc:${input.documentId}` }
              : {
                  op: 'upsert',
                  key: `doc:${input.documentId}`,
                  values: { icon },
                },
          ]
        );
      changed = true;
    }
    if (tagIds !== undefined && !isDeepStrictEqual(previous.tags, tagIds)) {
      if (!preview)
        await this.organization.applyRootOperations(
          actor.workspaceId,
          actor.actorId,
          [{ op: 'set_document_tags', docId: input.documentId, tagIds }]
        );
      changed = true;
    }
    if (changed && !preview)
      await this.writer.recordMetadataUpdate(
        actor.workspaceId,
        input.documentId,
        actor.actorId
      );
    await authorize();
    return {
      beforeVersion: document.version,
      afterVersion: (await this.resources.describe(actor, input.documentId))
        .version,
      metadataVersion: (await this.read(actor, input.documentId)).version,
      changed,
      changedIds: changed ? [input.documentId] : [],
    };
  }
}
