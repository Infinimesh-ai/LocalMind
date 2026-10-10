import type { FilterParams } from '@affine/core/modules/collection-rules';
import {
  compareWorkspaceResources,
  resourceDay,
  type ResourceSortField,
  workspaceDocumentTypes,
  type WorkspaceResourceSortValue,
} from '@affine/graphql';

export interface ResourceDisplayRecord extends WorkspaceResourceSortValue {
  id: string;
  createdBy: string | null;
  tagIds: string[];
}
export function matchesResourceTags(ids: string[], filters: FilterParams[]) {
  return filters.every(filter => {
    const selected = filter.value?.split(',').filter(Boolean) ?? [];
    switch (filter.method) {
      case 'is-empty':
        return !ids.length;
      case 'is-not-empty':
        return !!ids.length;
      case 'include-all':
        return selected.length > 0 && selected.every(id => ids.includes(id));
      case 'not-include-all':
        return selected.length > 0 && !selected.every(id => ids.includes(id));
      case 'include-any-of':
      case 'is':
        return selected.some(id => ids.includes(id));
      case 'not-include-any-of':
        return selected.length > 0 && selected.every(id => !ids.includes(id));
      case 'is-not':
        return selected.every(id => !ids.includes(id));
      default:
        return false;
    }
  });
}
export function groupWorkspaceResources(
  records: ResourceDisplayRecord[],
  field: ResourceSortField,
  desc: boolean,
  group?: string
) {
  const result = new Map<string, ResourceDisplayRecord[]>();
  for (const record of records) {
    let keys: string[];
    switch (group) {
      case undefined:
        keys = [''];
        break;
      case 'tags':
        keys =
          record.documentType === 'folder'
            ? ['$folders']
            : record.tagIds.length
              ? [...new Set(record.tagIds)]
              : [''];
        break;
      case 'createdBy':
        keys = [record.createdBy ?? ''];
        break;
      case 'createdAt':
      case 'updatedAt':
        keys = [resourceDay(record[group])];
        break;
      case 'documentType':
        keys = [record.documentType];
        break;
      default:
        throw new Error(`Unsupported resource grouping: ${group}`);
    }
    for (const key of keys)
      result.set(key, [...(result.get(key) ?? []), record]);
  }
  return [...result]
    .sort(([a], [b]) => {
      if (!a || !b) return a ? -1 : b ? 1 : 0;
      if (group === 'createdAt' || group === 'updatedAt')
        return b.localeCompare(a);
      if (group === 'documentType')
        return (
          workspaceDocumentTypes.indexOf(
            a as (typeof workspaceDocumentTypes)[number]
          ) -
          workspaceDocumentTypes.indexOf(
            b as (typeof workspaceDocumentTypes)[number]
          )
        );
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map(([key, rows]) => ({
      key,
      items: rows
        .sort((a, b) => compareWorkspaceResources(a, b, field, desc))
        .map(row => row.id),
    }));
}
