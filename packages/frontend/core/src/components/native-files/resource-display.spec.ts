import {
  compareWorkspaceResources,
  readResourceUpdateEvent,
  workspaceDocumentType,
  workspaceDocumentTypes,
  workspaceResourceIdentity,
} from '@affine/graphql';
import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';

import {
  defaultResourceProperties,
  migrateResourcePreference,
  resourcePreferenceKey,
} from '../explorer/resource-preferences';
import {
  groupWorkspaceResources,
  matchesResourceTags,
  type ResourceDisplayRecord,
} from './resource-groups';

const record = (
  id: string,
  overrides: Partial<ResourceDisplayRecord> = {}
): ResourceDisplayRecord => ({
  id,
  identity: workspaceResourceIdentity('workspace', 'file', id),
  title: id,
  documentType: 'txt',
  createdAt: 10,
  updatedAt: 20,
  createdBy: 'creator',
  tagIds: [],
  ...overrides,
});
const definitions = [
  'tags',
  'createdBy',
  'createdAt',
  'updatedBy',
  'updatedAt',
  'docPrimaryMode',
].map(type => ({ id: `custom-${type}`, type }));

describe('resource display contracts', () => {
  test('types come from native identity and effective MIME, including unknown binaries', () => {
    expect(
      workspaceDocumentType({ kind: 'doc', primaryMode: 'edgeless' })
    ).toBe('edgeless');
    expect(
      ['document', 'workbook', 'presentation', 'pdf'].map(officeKind =>
        workspaceDocumentType({ kind: 'office', officeKind })
      )
    ).toEqual(['docx', 'xlsx', 'pptx', 'pdf']);
    expect(
      [
        'text/plain',
        'text/markdown',
        'text/csv',
        'application/json',
        'image/png',
        'audio/mpeg',
        'video/mp4',
        'application/zip',
      ].map(mimeType => workspaceDocumentType({ kind: 'file', mimeType }))
    ).toEqual([
      'txt',
      'markdown',
      'csv',
      'json',
      'image',
      'audio',
      'video',
      'other',
    ]);
  });
  test('sorts naturally with stable cross-kind ties and unknown values last in either direction', () => {
    const rows = [
      record('10', { title: '资源10' }),
      record('2', { title: '资源2' }),
      record('a', { createdAt: null }),
      record('b', { createdAt: null }),
    ];
    expect(
      rows
        .slice(0, 2)
        .sort((a, b) => compareWorkspaceResources(a, b, 'title', false))
        .map(r => r.id)
    ).toEqual(['2', '10']);
    for (const desc of [false, true]) {
      expect(
        [...rows]
          .sort((a, b) => compareWorkspaceResources(a, b, 'createdAt', desc))
          .slice(-2)
          .map(r => r.id)
      ).toEqual(['a', 'b']);
      expect(
        compareWorkspaceResources(
          record('a', { documentType: 'other' }),
          record('b'),
          'documentType',
          desc
        )
      ).toBeGreaterThan(0);
    }
    const same = [
      record('a'),
      record('a', {
        identity: workspaceResourceIdentity('workspace', 'office', 'a'),
      }),
    ];
    expect(
      compareWorkspaceResources(same[0], same[1], 'createdAt', false)
    ).not.toBe(0);
    expect(() =>
      compareWorkspaceResources(rows[0], rows[1], 'tags' as never, false)
    ).toThrow();
  });
  test('groups all supported formats and multiple tags without duplicating within a group', () => {
    const rows = workspaceDocumentTypes.map((documentType, index) =>
      record(String(index), {
        documentType,
        tagIds: index === 0 ? ['one', 'two', 'one'] : [],
      })
    );
    expect(
      groupWorkspaceResources(rows, 'documentType', false, 'documentType').map(
        g => g.key
      )
    ).toEqual(workspaceDocumentTypes);
    const groups = groupWorkspaceResources(rows, 'title', false, 'tags');
    expect(groups.find(g => g.key === 'one')?.items).toEqual(['0']);
    expect(groups.find(g => g.key === 'two')?.items).toEqual(['0']);
    expect(new Set(groups.flatMap(g => g.items)).size).toBe(rows.length);
    expect(
      groupWorkspaceResources(
        [record('unknown', { createdBy: null }), record('known')],
        'title',
        false,
        'createdBy'
      ).at(-1)?.key
    ).toBe('');
    expect(
      matchesResourceTags(
        ['one', 'two'],
        [
          {
            type: 'system',
            key: 'tags',
            method: 'include-all',
            value: 'one,two',
          },
        ]
      )
    ).toBe(true);
    expect(
      matchesResourceTags(
        ['one'],
        [
          {
            type: 'property',
            key: 'tag-id',
            method: 'include-all',
            value: 'one,two',
          },
        ]
      )
    ).toBe(false);
  });
  test('complete snapshots produce the same stable order across pagination boundaries', () => {
    const rows = Array.from({ length: 525 }, (_, i) =>
      record(String(i), { title: `文件${525 - i}` })
    );
    const reordered = [...rows.slice(200), ...rows.slice(0, 200)];
    expect(groupWorkspaceResources(rows, 'title', false)).toEqual(
      groupWorkspaceResources(reordered, 'title', false)
    );
    expect(
      new Set(groupWorkspaceResources(rows, 'title', false)[0].items).size
    ).toBe(525);
  });
  test('migrates by property types, preserves explicit off and independent direction, isolates accounts and layouts', () => {
    expect(
      migrateResourcePreference(undefined, definitions, {}).preference
        .resourceProperties
    ).toEqual(defaultResourceProperties);
    expect(
      migrateResourcePreference({ displayProperties: [] }, definitions, {})
        .preference.resourceProperties
    ).toEqual({
      tags: false,
      created: false,
      updated: false,
      documentType: false,
    });
    const migrated = migrateResourcePreference(
      {
        displayProperties: ['property:custom-createdAt', 'system:updatedBy'],
        orderBy: { type: 'system', key: 'title', desc: true },
        groupBy: { type: 'property', key: 'custom-tags' },
      },
      definitions,
      {}
    );
    expect(migrated.preference.resourceProperties).toEqual({
      tags: false,
      created: true,
      updated: true,
      documentType: false,
    });
    expect(migrated.preference.orderBy?.desc).toBe(true);
    expect(migrated.preference.groupBy?.key).toBe('tags');
    expect(
      migrateResourcePreference({ displayProperties: [] }, [], {}).preference
        .resourceProperties?.documentType
    ).toBe(true);
    const invalid = migrateResourcePreference(
      { orderBy: { type: 'system', key: 'createdBy', desc: false } },
      definitions,
      {}
    );
    expect(invalid.adjustedSort).toBe(true);
    expect(invalid.preference.orderBy).toEqual({
      type: 'system',
      key: 'updatedAt',
      desc: true,
    });
    expect(
      new Set([
        resourcePreferenceKey('a', 'list'),
        resourcePreferenceKey('b', 'list'),
        resourcePreferenceKey('a', 'masonry'),
        resourcePreferenceKey(null, 'list'),
      ]).size
    ).toBe(4);
  });
  test('compact list migration hides old previews once and preserves subsequent choices and card preferences', () => {
    const saved = {
      view: 'list' as const,
      showDocPreview: true,
      groupBy: { type: 'system' as const, key: 'updatedAt' },
      resourceProperties: defaultResourceProperties,
    };
    const migrated = migrateResourcePreference(
      saved,
      definitions,
      {}
    ).preference;
    expect(migrated.showDocPreview).toBe(false);
    expect(migrated.resourceListLayoutVersion).toBe(1);
    expect(migrated.groupBy).toEqual(saved.groupBy);
    expect(
      migrateResourcePreference(
        { ...migrated, showDocPreview: true },
        definitions,
        {}
      ).preference.showDocPreview
    ).toBe(true);
    expect(
      migrateResourcePreference({ ...saved, view: 'grid' }, definitions, {})
        .preference.showDocPreview
    ).toBe(true);
  });
  test('offline CRDT merges retain an entire update event regardless of packet order', () => {
    const first = new Y.Doc(),
      second = new Y.Doc();
    first
      .getMap('meta')
      .set(
        'displayUpdateEvent',
        JSON.stringify({ at: 1, actor: 'user', by: 'a' })
      );
    second
      .getMap('meta')
      .set(
        'displayUpdateEvent',
        JSON.stringify({ at: 2, actor: 'user', by: 'b' })
      );
    const a = Y.encodeStateAsUpdate(first),
      b = Y.encodeStateAsUpdate(second);
    Y.applyUpdate(first, b);
    Y.applyUpdate(second, a);
    expect(first.getMap('meta').toJSON()).toEqual(
      second.getMap('meta').toJSON()
    );
    const event = readResourceUpdateEvent(
      first.getMap('meta').get('displayUpdateEvent')
    );
    expect(event?.at).toBe(event?.by === 'a' ? 1 : 2);
    expect(
      readResourceUpdateEvent(
        JSON.stringify({ at: 2, actor: 'system', by: 'a' })
      )
    ).toBeNull();
    first.destroy();
    second.destroy();
  });
});
