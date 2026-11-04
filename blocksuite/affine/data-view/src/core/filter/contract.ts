/** Shared headless contract. createFilter requires every registered name here. */
export const filterContracts = {
  contains: 'string',
  doesNoContains: 'string',
  startsWith: 'string',
  endsWith: 'string',
  is: 'string',
  isNot: 'string',
  equal: 'number',
  notEqual: 'number',
  greatThan: 'number',
  lessThan: 'number',
  greatThanOrEqual: 'number',
  lessThanOrEqual: 'number',
  before: 'date',
  after: 'date',
  isOneOf: 'tag',
  isNotOneOf: 'tag',
  containsOneOf: 'tags',
  doesNotContainOneOf: 'tags',
  containsAll: 'tags',
  doesNotContainAll: 'tags',
  isChecked: 'boolean',
  isUnchecked: 'boolean',
  isEmpty: 'unknown',
  isNotEmpty: 'unknown',
} as const;

export function validateFilterContract(
  name: string,
  columnType: string,
  args: unknown[]
): boolean {
  const contract = filterContracts[name as keyof typeof filterContracts];
  if (!contract) return false;
  if (contract === 'unknown') return args.length === 0;
  if (contract === 'boolean')
    return columnType === 'checkbox' && args.length === 0;
  if (args.length !== 1) return false;
  if (contract === 'string')
    return (
      ['title', 'rich-text', 'text', 'link', 'created-by'].includes(
        columnType
      ) && typeof args[0] === 'string'
    );
  if (contract === 'number')
    return (
      ['number', 'progress'].includes(columnType) &&
      typeof args[0] === 'number' &&
      Number.isFinite(args[0])
    );
  if (contract === 'date')
    return (
      ['date', 'created-time'].includes(columnType) &&
      typeof args[0] === 'number' &&
      Number.isFinite(args[0])
    );
  return (
    columnType === (contract === 'tag' ? 'select' : 'multi-select') &&
    Array.isArray(args[0]) &&
    args[0].every(value => typeof value === 'string')
  );
}
