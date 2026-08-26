export const MCP_CAPABILITY_OPTIONS = [
  { key: 'attachment', capability: 'upload_localmind_attachment' },
  { key: 'delegate', capability: 'delegate_to_localmind' },
  { key: 'query', capability: 'get_localmind_task' },
  { key: 'control', capability: 'control_localmind_task' },
] as const;

export const DEFAULT_MCP_CAPABILITIES = MCP_CAPABILITY_OPTIONS.map(
  option => option.capability
);

export function updateMcpCapabilities(
  current: ReadonlySet<string>,
  capability: string,
  checked: boolean
) {
  const next = new Set(current);
  if (checked) {
    next.add(capability);
  } else {
    next.delete(capability);
  }
  return next;
}
