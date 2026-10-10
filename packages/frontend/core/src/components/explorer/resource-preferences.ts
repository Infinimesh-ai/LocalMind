import type { ResourceDisplayProperties } from '@affine/graphql';

import type { ExplorerDisplayPreference } from './types';

export const resourceSortFields = [
  'title',
  'createdAt',
  'updatedAt',
  'documentType',
] as const;
export const resourceGroupFields = [
  'tags',
  'createdBy',
  'createdAt',
  'updatedAt',
  'documentType',
] as const;
export const defaultResourceProperties: ResourceDisplayProperties = {
  tags: true,
  created: true,
  updated: true,
  documentType: true,
};

/** Definitions, never translated names, resolve the old property IDs. */
export function migrateResourcePreference(
  saved: ExplorerDisplayPreference | undefined,
  definitions: readonly { id: string; type: string }[],
  defaults: ExplorerDisplayPreference
): { preference: ExplorerDisplayPreference; adjustedSort: boolean } {
  const resolve = (type: string, key: string) =>
    type === 'property'
      ? definitions.find(property => property.id === key)?.type
      : key;
  const selected = new Set(
    (saved?.displayProperties ?? []).map(key => {
      const colon = key.indexOf(':');
      return resolve(key.slice(0, colon), key.slice(colon + 1));
    })
  );
  const hadProperties = saved?.displayProperties !== undefined;
  const oldModeAvailable =
    definitions.some(property => property.type === 'docPrimaryMode') ||
    selected.has('docPrimaryMode');
  const properties =
    saved?.resourceProperties ??
    (hadProperties
      ? {
          tags: selected.has('tags'),
          created: selected.has('createdBy') || selected.has('createdAt'),
          updated: selected.has('updatedBy') || selected.has('updatedAt'),
          documentType: !oldModeAvailable || selected.has('docPrimaryMode'),
        }
      : defaultResourceProperties);
  const orderKey =
    saved?.orderBy && resolve(saved.orderBy.type, saved.orderBy.key);
  const order = orderKey === 'docPrimaryMode' ? 'documentType' : orderKey;
  const validSort = resourceSortFields.find(key => key === order);
  const oldGroup =
    saved?.groupBy && resolve(saved.groupBy.type, saved.groupBy.key);
  const group = oldGroup === 'docPrimaryMode' ? 'documentType' : oldGroup;
  const validGroup = resourceGroupFields.find(key => key === group);
  return {
    adjustedSort: !!saved?.orderBy && !validSort,
    preference: {
      ...defaults,
      ...saved,
      resourceProperties: { ...properties },
      orderBy: validSort
        ? {
            type: 'system',
            key: validSort,
            desc: saved?.orderBy?.desc ?? false,
          }
        : { type: 'system', key: 'updatedAt', desc: true },
      groupBy: saved
        ? validGroup
          ? { type: 'system', key: validGroup }
          : undefined
        : defaults.groupBy,
    },
  };
}

export function resourcePreferenceKey(accountId: string | null, mode: string) {
  return `allResources:v1:${JSON.stringify(accountId ?? 'local')}:${mode}`;
}
