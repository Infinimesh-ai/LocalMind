import { OfficeCommandSchema } from '@localmind/office';
import { z } from 'zod';

import { documentColumn } from './document-database-schema';
import { documentFileCommand } from './document-file-schema';
import {
  type DocumentBlockFlavour,
  documentBlockProperties,
  documentBlockVersions,
} from './document-schema';
import { surfaceElementDefinition } from './document-surface-schema';

// Fields owned by a typed domain command rather than block.properties. This is
// also checked against actual editor model defaults in the browser registry test.
const domainFields: Partial<
  Record<DocumentBlockFlavour, Record<string, string>>
> = {
  'affine:page': { title: 'metadata.title' },
  'affine:surface': { elements: 'element.*' },
  'affine:paragraph': { text: 'text.*' },
  'affine:list': { text: 'text.*' },
  'affine:code': { text: 'text.*' },
  'affine:callout': { text: 'text.*' },
  'affine:frame': { title: 'text.*', childElementIds: 'frame.members.set' },
  'affine:table': {
    rows: 'table.axis.*',
    columns: 'table.axis.*',
    cells: 'table.cells.set/text.*',
  },
  'affine:database': {
    title: 'text.*',
    columns: 'database.column.*',
    cells: 'database.cell.*/text.*',
    views: 'database.view.*',
  },
  'affine:data-view': {
    columns: 'database.column.*',
    cells: 'database.cell.*/text.*',
    views: 'database.view.*',
  },
  'affine:image': { sourceId: 'block.asset.set', size: 'block.asset.set' },
  'affine:attachment': {
    sourceId: 'block.asset.set',
    size: 'block.asset.set',
    type: 'block.asset.set',
  },
  'affine:surface-ref': {
    reference: 'block.reference.set',
    refFlavour: 'block.reference.set',
  },
  'affine:embed-linked-doc': {
    pageId: 'block.reference.set',
    params: 'block.reference.set',
  },
  'affine:embed-synced-doc': {
    pageId: 'block.reference.set',
    params: 'block.reference.set',
  },
  'localmind:subpage': {
    kind: 'block.reference.set',
    resourceId: 'block.reference.set',
  },
};
const provenance: Partial<Record<DocumentBlockFlavour, readonly string[]>> = {
  'affine:embed-ai-chat': [
    'messages',
    'sessionId',
    'rootWorkspaceId',
    'rootDocId',
  ],
  'affine:transcription': ['transcription', 'jobId', 'createdBy'],
};

export function documentPropertyCapability(flavour: string, field: string) {
  if (!Object.hasOwn(documentBlockVersions, flavour))
    return { kind: 'opaque' as const };
  const type = flavour as DocumentBlockFlavour;
  const rootField = field.split('.')[0];
  if (Object.hasOwn(documentBlockProperties[type].shape, rootField))
    return { kind: 'editable' as const, command: 'block.properties' };
  if (rootField === 'comments')
    return { kind: 'domain' as const, command: 'workspace_doc_comments_apply' };
  const command = domainFields[type]?.[rootField];
  if (command) return { kind: 'domain' as const, command };
  if (
    [
      'meta:createdAt',
      'meta:createdBy',
      'meta:updatedAt',
      'meta:updatedBy',
    ].includes(rootField) ||
    provenance[type]?.includes(rootField)
  )
    return { kind: 'server-maintained' as const };
  return { kind: 'opaque' as const };
}

export function documentAdapterManifest() {
  return {
    schemaVersion: 'localmind-document-mcp/v2',
    blocks: Object.entries(documentBlockVersions).map(
      ([flavour, schemaVersion]) => ({
        flavour,
        schemaVersion,
        properties: Object.keys(
          documentBlockProperties[flavour as DocumentBlockFlavour].shape
        ),
        domainFields: domainFields[flavour as DocumentBlockFlavour] ?? {},
        serverMaintained: provenance[flavour as DocumentBlockFlavour] ?? [],
      })
    ),
    databaseColumns: documentColumn.options.map(
      option => option.shape.type.value
    ),
    elements: surfaceElementDefinition.options.map(option => ({
      kind: option.shape.kind.value,
      properties: Object.keys(option.shape.properties.shape),
    })),
    unknownFields: 'preserve-without-writes',
    mindmapBounds: 'explicit-native-geometry',
  };
}

export function documentFileAdapterManifest(kind: 'office' | 'file') {
  return {
    schemaVersion: 'localmind-document-mcp/v2',
    engine:
      kind === 'office' ? 'localmind-office-command/v1' : 'workspace-file',
    operations:
      kind === 'office'
        ? OfficeCommandSchema.options.map(option => {
            const command =
              option instanceof z.ZodEffects ? option.innerType() : option;
            return command.shape.operation.value;
          })
        : documentFileCommand.options.map(option => option.shape.type.value),
    preservation: 'untouched-native-state-and-assets',
    unsupportedConversion: 'reject-without-commit',
  };
}
