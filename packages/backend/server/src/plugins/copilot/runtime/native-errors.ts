import { CopilotProviderSideError, NetworkError } from '../../../base';

const LLM_TIMEOUT_ERROR_PREFIX = 'llm_timeout:';

// Only local parser failures belong here. Upstream authentication/status errors
// must retain the existing credential failure policy.
const STREAM_PROTOCOL_CODES = new Set([
  'conflicting_tool_identity',
  'conflicting_tool_arguments',
  'conflicting_tool_mapping',
  'missing_tool_identity',
  'invalid_tool_arguments',
  'invalid_tool_calls',
  'tool_arguments_limit',
  'tool_count_limit',
  'stream_size_limit',
  'missing_stream_terminal',
  'conflicting_stream_terminal',
  'unexpected_stream_eof',
  'invalid_response_status',
]);

export class NativeStreamProtocolError extends CopilotProviderSideError {
  constructor(readonly streamCode: string) {
    super({
      provider: 'AI',
      kind: 'stream_protocol',
      message: `The model response could not be verified (${streamCode}). Check the document and retry.`,
    });
  }
}

export function nativeStreamError(event: {
  message?: unknown;
  code?: unknown;
}): Error {
  if (typeof event.code === 'string' && STREAM_PROTOCOL_CODES.has(event.code)) {
    // Do not expose upstream bodies, prompts or tool arguments in user errors.
    return new NativeStreamProtocolError(event.code);
  }
  const error = new Error(
    typeof event.message === 'string'
      ? event.message
      : 'native runtime stream error'
  );
  return typeof event.code === 'string'
    ? Object.assign(error, { code: event.code })
    : error;
}

function nativeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (
    error &&
    typeof error === 'object' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }
  return typeof error === 'string' ? error : undefined;
}

export function mapNativeSemanticError(error: unknown): unknown {
  const message = nativeErrorMessage(error);
  if (message?.startsWith(LLM_TIMEOUT_ERROR_PREFIX)) {
    return new NetworkError(
      message.slice(LLM_TIMEOUT_ERROR_PREFIX.length).trim() ||
        'LLM request timed out'
    );
  }
  return error;
}
