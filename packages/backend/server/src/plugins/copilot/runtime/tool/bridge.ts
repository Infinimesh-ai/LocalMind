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
import type { ModelAdapterToolPolicy } from '../../model-adapters';
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
  options: CopilotToolExecuteOptions = {},
  policy?: ModelAdapterToolPolicy
) {
  const governor = policy ? new ToolExecutionGovernor(policy) : undefined;
  return async (request: LlmToolCallbackRequest) => {
    return governor
      ? await governor.execute(tools, request, options)
      : await executeToolCall(tools, request, options);
  };
}

function stableToolArguments(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) {
    return `[${value.map(stableToolArguments).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, item]) => `${JSON.stringify(key)}:${stableToolArguments(item)}`
      )
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function toolCallFingerprint(request: LlmToolCallbackRequest) {
  return `${request.name}:${stableToolArguments(request.args)}`;
}

function toolDocumentId(request: LlmToolCallbackRequest) {
  if (
    !request.args ||
    typeof request.args !== 'object' ||
    Array.isArray(request.args)
  ) {
    return undefined;
  }
  const args = request.args as Record<string, unknown>;
  const value = args.doc_id ?? args.docId;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function toolCallbackFailed(result: LlmToolCallbackResponse) {
  const output =
    result.output &&
    typeof result.output === 'object' &&
    !Array.isArray(result.output)
      ? (result.output as Record<string, unknown>)
      : undefined;
  return (
    result.isError === true ||
    output?.type === 'error' ||
    output?.success === false
  );
}

class ToolExecutionGovernor {
  readonly #successfulReads = new Map<string, LlmToolCallbackResponse>();
  readonly #successfulMutations = new Map<string, LlmToolCallbackResponse>();
  readonly #failuresByFingerprint = new Map<string, number>();
  readonly #failuresByTool = new Map<string, number>();
  readonly #mutationToolNames: Set<string>;
  readonly #readDocumentIds = new Set<string>();
  #executions = 0;

  constructor(private readonly policy: ModelAdapterToolPolicy) {
    this.#mutationToolNames = new Set(policy.mutationToolNames);
  }

  private blocked(
    request: LlmToolCallbackRequest,
    message: string
  ): LlmToolCallbackResponse {
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      isError: true,
      output: { message },
    };
  }

  async execute(
    tools: CopilotToolSet,
    request: LlmToolCallbackRequest,
    options: CopilotToolExecuteOptions
  ) {
    const normalizedArgs = this.policy.normalizeArguments?.(
      request.name,
      request.args
    );
    if (normalizedArgs !== undefined && normalizedArgs !== request.args) {
      request = { ...request, args: normalizedArgs };
    }
    const fingerprint = toolCallFingerprint(request);
    const mutation = this.#mutationToolNames.has(request.name);
    const successful = mutation
      ? this.#successfulMutations
      : this.#successfulReads;
    const cached = successful.get(fingerprint);
    if (this.policy.deduplicateSuccessfulCalls && cached) {
      const cachedOutput =
        cached.output &&
        typeof cached.output === 'object' &&
        !Array.isArray(cached.output)
          ? {
              ...cached.output,
              governorReplay: true,
              ...(mutation ? { idempotentReplay: true } : {}),
            }
          : cached.output;
      return {
        ...cached,
        callId: request.callId,
        rawArgumentsText: request.rawArgumentsText,
        output: cachedOutput,
      };
    }
    if (
      this.policy.requireDocumentReadBeforeUpdate &&
      request.name === 'doc_update'
    ) {
      const documentId = toolDocumentId(request);
      if (!documentId || !this.#readDocumentIds.has(documentId)) {
        return this.blocked(
          request,
          'Before doc_update, call doc_read successfully for the same doc_id. Then retry this update with the exact target document ID.'
        );
      }
    }
    if (this.#executions >= this.policy.maxExecutions) {
      return this.blocked(
        request,
        'Tool execution limit reached. Stop calling tools and report that the task could not be completed.'
      );
    }
    if (
      (this.#failuresByFingerprint.get(fingerprint) ?? 0) >=
      this.policy.maxFailuresPerFingerprint
    ) {
      return this.blocked(
        request,
        'This exact tool call already failed repeatedly. Do not retry it with the same arguments.'
      );
    }
    if (
      (this.#failuresByTool.get(request.name) ?? 0) >=
      this.policy.maxFailuresPerTool
    ) {
      return this.blocked(
        request,
        'This tool has failed too many times in this task. Stop using it and report the failure.'
      );
    }

    this.#executions += 1;
    const result = await executeToolCall(tools, request, options);
    if (toolCallbackFailed(result)) {
      this.#failuresByFingerprint.set(
        fingerprint,
        (this.#failuresByFingerprint.get(fingerprint) ?? 0) + 1
      );
      this.#failuresByTool.set(
        request.name,
        (this.#failuresByTool.get(request.name) ?? 0) + 1
      );
      return result.isError ? result : { ...result, isError: true };
    }

    if (mutation) {
      this.#successfulReads.clear();
      this.#readDocumentIds.clear();
    } else if (request.name === 'doc_read') {
      const documentId = toolDocumentId(request);
      if (documentId) this.#readDocumentIds.add(documentId);
    }
    successful.set(fingerprint, result);
    return result;
  }
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
    const output = await tool.execute(args, options);
    return {
      callId: request.callId,
      name: request.name,
      args: request.args,
      rawArgumentsText: request.rawArgumentsText,
      argumentParseError: request.argumentParseError,
      output: (output ?? null) as LlmToolCallbackResponse['output'],
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
  maxSteps = 20,
  toolPolicy?: ModelAdapterToolPolicy
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
    const execute = createToolExecutionCallback(
      tools,
      toolExecuteOptions,
      toolPolicy
    );
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
