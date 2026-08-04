export const MCP_CAPABILITY_GROUPS = [
  { key: 'documents', read: 'documents:read', write: 'documents:write' },
  { key: 'workspace', read: 'workspace:read', write: 'workspace:write' },
  { key: 'assets', read: 'assets:read', write: 'assets:write' },
  { key: 'comments', read: 'comments:read', write: 'comments:write' },
  {
    key: 'collaboration',
    read: 'collaboration:read',
    write: 'collaboration:write',
  },
  { key: 'history', read: 'history:read', write: 'history:write' },
  { key: 'context', read: 'ai-context:read', write: 'ai-context:write' },
  { key: 'chat', read: 'ai-chat:read', write: 'ai-chat:write' },
  {
    key: 'operations',
    read: 'ai-operations:read',
    write: 'ai-operations:write',
  },
] as const;

export function updateMcpCapabilities(
  current: ReadonlySet<string>,
  capability: string,
  checked: boolean
) {
  const next = new Set(current);
  const group = MCP_CAPABILITY_GROUPS.find(
    item => item.read === capability || item.write === capability
  );
  if (checked) {
    next.add(capability);
    if (group && capability === group.write) next.add(group.read);
  } else {
    next.delete(capability);
    if (group && capability === group.read) next.delete(group.write);
  }
  return next;
}
