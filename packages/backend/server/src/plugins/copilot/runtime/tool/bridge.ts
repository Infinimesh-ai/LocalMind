import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  type LlmBackendConfig,
  llmDispatchToolLoopStream,
  llmDispatchToolLoopStreamPrepared,
  llmDispatchToolLoopStreamRouted,
  type LlmPreparedDispatchRoute,
  type LlmProtocol,
  type LlmRequest,
  type LlmRoutedBackend,
  type LlmToolCallbackRequest,
  type LlmToolCallbackResponse,
  type LlmToolLoopStreamEvent,
} from '../../../../native';
import type {
  CopilotTool,
  CopilotToolExecuteOptions,
  CopilotToolSet,
} from '../../tools';

export type ToolLoopDispatch = (
  request: LlmRequest,
  signalOrOptions?: AbortSignal | CopilotToolExecuteOptions,
  maybeMessages?: CopilotToolExecuteOptions['messages']
) => AsyncIterableIterator<LlmToolLoopStreamEvent>;

export type ToolLoopBackend =
  | { protocol: LlmProtocol; backendConfig: LlmBackendConfig }
  | { routes: LlmRoutedBackend[] }
  | { preparedRoutes: LlmPreparedDispatchRoute[] };

function normalizeToolExecuteOptions(
  signalOrOptions?: AbortSignal | CopilotToolExecuteOptions,
  maybeMessages?: CopilotToolExecuteOptions['messages']
): CopilotToolExecuteOptions {
  if (
    signalOrOptions &&
    typeof signalOrOptions === 'object' &&
    'aborted' in signalOrOptions
  ) {
    return {
      signal: signalOrOptions,
      messages: maybeMessages,
    };
  }

  if (!signalOrOptions) {
    return maybeMessages ? { messages: maybeMessages } : {};
  }

  return {
    ...signalOrOptions,
    signal: signalOrOptions.signal,
    messages: signalOrOptions.messages ?? maybeMessages,
  };
}

export function createToolExecutionCallback(
  tools: CopilotToolSet,
  options: CopilotToolExecuteOptions = {}
) {
  const failures = new Map<string, { fingerprint: string; count: number }>();
  let stopped = false;
  return async (request: LlmToolCallbackRequest) => {
    if (stopped)
      throw new Error('Tool execution stopped after repeated failures');
    const result = await executeToolCall(tools, request, options);
    if (!result.isError) {
      failures.delete(request.name);
      return result;
    }
    // Count the error rather than the arguments: changing the document text or
    // call ID does not fix a repeated schema/permission failure. Other tools
    // cannot reset this tool's failure streak.
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(result.output) ?? 'null')
      .digest('hex');
    const previous = failures.get(request.name);
    const count =
      previous?.fingerprint === fingerprint ? previous.count + 1 : 1;
    failures.set(request.name, { fingerprint, count });
    if (count >= 3) {
      stopped = true;
      throw new Error(
        `Tool ${request.name} failed with the same error 3 times; execution stopped. Check tool arguments or configuration before retrying.`
      );
    }
    return result;
  };
}

export function toJsonSafeToolOutput(output: unknown): unknown {
  if (output === undefined) return null;
  return JSON.parse(JSON.stringify(output)) as unknown;
}

export async function executeToolCall(
  tools: CopilotToolSet,
  request: LlmToolCallbackRequest,
  options: CopilotToolExecuteOptions
): Promise<LlmToolCallbackResponse> {
  const tool = tools[request.name] as CopilotTool | undefined;

  if (options.signal?.aborted) {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      isError: true,
      output: { message: 'Tool execution was cancelled' },
    };
  }

  if (!tool?.execute) {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      isError: true,
      output: { message: `Tool not found: ${request.name}` },
    };
  }

  if (request.argumentParseError) {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      isError: true,
      output: {
        message: 'Invalid tool arguments JSON',
        ...(request.rawArgumentsText
          ? { rawArguments: request.rawArgumentsText }
          : {}),
        ...(request.argumentParseError
          ? { error: request.argumentParseError }
          : {}),
      },
    };
  }

  try {
    const args =
      tool.inputSchema instanceof z.ZodType
        ? tool.inputSchema.parse(request.args)
        : request.args;
    const output = await tool.execute(args, {
      ...options,
      toolCallId: request.callId,
    });
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      output: toJsonSafeToolOutput(output) as LlmToolCallbackResponse['output'],
    };
  } catch (error) {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      output: {
        message: error instanceof Error ? error.message : String(error),
      },
      isError: true,
    };
  }
}

export function createToolLoopBridge(
  backend: ToolLoopBackend,
  tools: CopilotToolSet,
  maxSteps = 20
): ToolLoopDispatch {
  return (
    request: LlmRequest,
    signalOrOptions?: AbortSignal | CopilotToolExecuteOptions,
    maybeMessages?: CopilotToolExecuteOptions['messages']
  ) => {
    const toolExecuteOptions = normalizeToolExecuteOptions(
      signalOrOptions,
      maybeMessages
    );
    const execute = createToolExecutionCallback(tools, toolExecuteOptions);
    const toolLoopRequest = { ...request, stream: true };

    if ('routes' in backend) {
      return llmDispatchToolLoopStreamRouted(
        backend.routes,
        toolLoopRequest,
        execute,
        maxSteps,
        toolExecuteOptions.signal
      );
    }

    if ('preparedRoutes' in backend) {
      return llmDispatchToolLoopStreamPrepared(
        backend.preparedRoutes,
        execute,
        maxSteps,
        toolExecuteOptions.signal
      );
    }

    return llmDispatchToolLoopStream(
      backend.protocol,
      backend.backendConfig,
      toolLoopRequest,
      execute,
      maxSteps,
      toolExecuteOptions.signal
    );
  };
}

// re-export for test consumers
export type { LlmToolCallbackRequest } from '../../../../native';
export type { CopilotToolExecuteOptions, CopilotToolSet } from '../../tools';
