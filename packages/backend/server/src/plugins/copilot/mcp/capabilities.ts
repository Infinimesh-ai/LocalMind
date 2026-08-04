import { McpAccessMode } from '@prisma/client';

export const MCP_CAPABILITIES = [
  'documents:read',
  'documents:write',
  'workspace:read',
  'workspace:write',
  'assets:read',
  'assets:write',
  'comments:read',
  'comments:write',
  'collaboration:read',
  'collaboration:write',
  'history:read',
  'history:write',
  'ai-context:read',
  'ai-context:write',
  'ai-chat:read',
  'ai-chat:write',
  'ai-operations:read',
  'ai-operations:write',
] as const;

export type McpCapability = (typeof MCP_CAPABILITIES)[number];

const MCP_CAPABILITY_SET = new Set<string>(MCP_CAPABILITIES);

export function normalizeMcpCapabilities(
  capabilities: readonly string[] | null | undefined,
  accessMode: McpAccessMode
): McpCapability[] {
  const requested = capabilities?.length
    ? capabilities
    : accessMode === McpAccessMode.READ_WRITE
      ? ['documents:read', 'documents:write']
      : ['documents:read'];
  const normalized = [...new Set(requested.map(value => value.trim()))];
  const invalid = normalized.filter(value => !MCP_CAPABILITY_SET.has(value));
  if (invalid.length) {
    throw new Error(`Unsupported MCP capabilities: ${invalid.join(', ')}`);
  }
  for (const capability of normalized) {
    if (capability.endsWith(':write')) {
      const readCapability = capability.replace(/:write$/, ':read');
      if (MCP_CAPABILITY_SET.has(readCapability)) {
        normalized.push(readCapability);
      }
    }
  }
  return [...new Set(normalized)] as McpCapability[];
}

export function mcpAccessModeForCapabilities(
  capabilities: readonly McpCapability[]
) {
  return capabilities.some(capability => capability.endsWith(':write'))
    ? McpAccessMode.READ_WRITE
    : McpAccessMode.READ_ONLY;
}
