import { isDeepStrictEqual } from 'node:util';

import { ResourceError } from '../doc/resource-types';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const key = (value: unknown) =>
  object(value) && typeof value.id === 'string' ? value.id : undefined;

/**
 * Apply the native engine's semantic delta to the independently stored state.
 * Parsing a package is not permission to erase unrelated state extensions.
 */
export function preserveOfficeState<T>(
  before: T,
  after: T,
  stored: unknown,
  structuralChange = false,
  identityMapping: ReadonlyMap<string, string> = new Map()
): T {
  // Stored state is JSON. Optional undefined fields from the native parser are
  // absence, not independently stored extensions or an ambiguous structural edit.
  before = JSON.parse(JSON.stringify(before)) as T;
  after = JSON.parse(JSON.stringify(after)) as T;
  const identity = (value: unknown) => {
    let id = key(value);
    const seen = new Set<string>();
    while (id !== undefined && identityMapping.has(id)) {
      if (seen.has(id)) throw new ResourceError('preservation_failed');
      seen.add(id);
      const next = identityMapping.get(id);
      if (next === id) break;
      id = next;
    }
    return id;
  };
  let visited = 0;
  const merge = (
    before: unknown,
    after: unknown,
    stored: unknown,
    depth = 0
  ): unknown => {
    if (++visited > 1000000 || depth > 128)
      throw new ResourceError('content_too_large');
    if (isDeepStrictEqual(before, after))
      return structuredClone(stored === undefined ? after : stored);
    if (object(before) && object(after) && object(stored)) {
      const result = { ...stored };
      for (const name of Object.keys(before))
        if (!Object.hasOwn(after, name)) delete result[name];
      for (const [name, value] of Object.entries(after))
        result[name] =
          Object.hasOwn(before, name) && Object.hasOwn(stored, name)
            ? merge(before[name], value, stored[name], depth + 1)
            : structuredClone(value);
      return result;
    }
    if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      Array.isArray(stored)
    ) {
      const keys = (values: unknown[]) => values.map(identity);
      const oldKeys = keys(before),
        newKeys = keys(after),
        storedKeys = keys(stored);
      const unique = (keys: (string | undefined)[]) =>
        keys.every(key => key !== undefined) &&
        new Set(keys).size === keys.length;
      if (
        (structuralChange || before.length !== after.length) &&
        before.some(
          value =>
            object(value) &&
            typeof value.id === 'string' &&
            !value.sourceId &&
            !identityMapping.has(value.id) &&
            /^(paragraph|table|contentControl):[0-9]+(?::[0-9]+)?$/.test(
              value.id
            )
        ) &&
        !isDeepStrictEqual(before, stored)
      )
        throw new ResourceError('preservation_failed');
      if (unique(oldKeys) && unique(newKeys) && unique(storedKeys)) {
        const previous = new Map(
            oldKeys.map((id, index) => [id, before[index]])
          ),
          saved = new Map(storedKeys.map((id, index) => [id, stored[index]]));
        if (storedKeys.some(id => !previous.has(id) && newKeys.includes(id)))
          throw new ResourceError('preservation_failed');
        const result = after.map((value, index) =>
          previous.has(newKeys[index]) && saved.has(newKeys[index])
            ? merge(
                previous.get(newKeys[index]),
                value,
                saved.get(newKeys[index]),
                depth + 1
              )
            : structuredClone(value)
        );
        // Entries only present in stored state belong to its independent model.
        result.push(
          ...stored
            .filter((_, index) => !previous.has(storedKeys[index]))
            .map(value => structuredClone(value))
        );
        return result;
      }
      if (structuralChange && !isDeepStrictEqual(before, stored))
        throw new ResourceError('preservation_failed');
      if (before.length === after.length && before.length === stored.length)
        return after.map((value, index) =>
          merge(before[index], value, stored[index], depth + 1)
        );
      if (!isDeepStrictEqual(before, stored))
        throw new ResourceError('preservation_failed');
    }
    return structuredClone(after);
  };
  return merge(before, after, stored) as T;
}
