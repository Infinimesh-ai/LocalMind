import { z } from 'zod';

import { toToolJsonSchema } from '../tools/json-schema';

export type McpTextContent = {
  type: 'text';
  text: string;
};

export type McpToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
};

export type WorkspaceMcpToolResult = {
  content: McpTextContent[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

export type WorkspaceMcpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations: McpToolAnnotations;
  execute: (
    args: Record<string, unknown>,
    options: { signal: AbortSignal }
  ) => Promise<WorkspaceMcpToolResult>;
};

export type WorkspaceMcpResource = {
  uri: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type WorkspaceMcpResourceTemplate = {
  uriTemplate: string;
  name: string;
  title?: string;
  description?: string;
  mimeType?: string;
};

export type WorkspaceMcpResourceContents = {
  uri: string;
  mimeType?: string;
  text: string;
};

export type WorkspaceMcpResourcePage = {
  resources: WorkspaceMcpResource[];
  nextCursor?: string;
};

export type WorkspaceMcpServer = {
  name: string;
  version: string;
  instructions: string;
  tools: WorkspaceMcpToolDefinition[];
  listResources?: (cursor?: string) => Promise<WorkspaceMcpResourcePage | null>;
  resourceTemplates?: WorkspaceMcpResourceTemplate[];
  readResource?: (uri: string) => Promise<WorkspaceMcpResourceContents | null>;
};

type ToolExecutorInput<T extends z.ZodTypeAny> = {
  name: string;
  title: string;
  description: string;
  parser: T;
  outputSchema?: Record<string, unknown>;
  annotations: McpToolAnnotations;
  execute: (
    args: z.infer<T>,
    options: { signal: AbortSignal }
  ) => Promise<WorkspaceMcpToolResult>;
};

export const READ_ONLY_TOOL: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export const WRITE_TOOL: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

export const DESTRUCTIVE_WRITE_TOOL: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

export const OPEN_WORLD_WRITE_TOOL: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export const OPEN_WORLD_DESTRUCTIVE_TOOL: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const RESULT_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { result: {} },
  required: ['result'],
  additionalProperties: false,
};

export function toolText(text: string): WorkspaceMcpToolResult {
  return { content: [{ type: 'text', text }] };
}

export function toolResult(
  result: unknown,
  text = JSON.stringify(result)
): WorkspaceMcpToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent: { result },
  };
}

export function toolError(message: string): WorkspaceMcpToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: message }],
  };
}

function toInputError(error: z.ZodError) {
  const details = error.issues
    .map(issue => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
  return toolError(`Invalid arguments: ${details || 'Invalid input'}`);
}

export function abortIfNeeded(
  signal: AbortSignal
): WorkspaceMcpToolResult | undefined {
  if (signal.aborted) return toolError('Request aborted.');
  return;
}

export function defineTool<T extends z.ZodTypeAny>(
  config: ToolExecutorInput<T>
): WorkspaceMcpToolDefinition {
  return {
    name: config.name,
    title: config.title,
    description: config.description,
    inputSchema: toToolJsonSchema(config.parser),
    outputSchema: config.outputSchema,
    annotations: config.annotations,
    execute: async (args, options) => {
      const aborted = abortIfNeeded(options.signal);
      if (aborted) return aborted;

      const parsed = config.parser.safeParse(args ?? {});
      if (!parsed.success) return toInputError(parsed.error);
      return await config.execute(parsed.data, options);
    },
  };
}
