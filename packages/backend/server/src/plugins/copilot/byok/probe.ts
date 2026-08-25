import { BadRequestException } from '@nestjs/common';

import type { safeFetch } from '../../../base';
import { ByokProvider } from './types';

const TEST_TIMEOUT_MS = 10_000;
export const PROVIDER_PROBE_MAX_BYTES = 1024 * 1024;

type ProbeFetch = typeof safeFetch;
type ProbeOperation = 'model_catalog' | 'chat';

export type ProviderProbeResult = {
  provider: ByokProvider;
  operation: ProbeOperation;
  modelId: string | null;
};

type ProbeRequest = {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
  operation: ProbeOperation;
};

export async function runProviderProbe(
  probeFetch: ProbeFetch,
  provider: ByokProvider,
  apiKey: string,
  endpoint: string | null,
  allowPrivateEndpoint: boolean,
  modelId?: string | null
): Promise<ProviderProbeResult> {
  const request = buildProbeRequest(provider, apiKey, endpoint, modelId);
  const response = await probeFetch(
    request.url,
    {
      method: request.method,
      headers: request.headers,
      body: request.body,
    },
    {
      timeoutMs: TEST_TIMEOUT_MS,
      maxRedirects: 3,
      maxBytes: PROVIDER_PROBE_MAX_BYTES,
      allowedHeaders: Object.keys(request.headers),
      allowHttp: endpoint?.startsWith('http:') ?? false,
      allowPrivateTargetOrigin: allowPrivateEndpoint,
    }
  );
  if (!response.ok) {
    throw new BadRequestException(providerProbeFailureMessage(response.status));
  }

  const payload = await parseProbePayload(response);
  const valid =
    request.operation === 'chat'
      ? hasValidChatResponse(provider, payload)
      : hasValidModelCatalog(provider, payload);
  if (!valid) {
    throw new BadRequestException(
      request.operation === 'chat'
        ? 'Provider returned an invalid chat response.'
        : 'Provider returned an invalid model catalog.'
    );
  }

  return {
    provider,
    operation: request.operation,
    modelId: request.operation === 'chat' ? (modelId ?? null) : null,
  };
}

function buildProbeRequest(
  provider: ByokProvider,
  apiKey: string,
  endpoint: string | null,
  modelId?: string | null
): ProbeRequest {
  switch (provider) {
    case ByokProvider.openai:
      if (modelId) {
        return {
          method: 'POST',
          url: joinEndpoint(
            endpoint ?? 'https://api.openai.com/v1',
            'responses'
          ),
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            input: 'Reply with OK.',
            max_output_tokens: 64,
            store: false,
          }),
          operation: 'chat',
        };
      }
      return {
        method: 'GET',
        url: joinEndpoint(endpoint ?? 'https://api.openai.com/v1', 'models'),
        headers: { Authorization: `Bearer ${apiKey}` },
        operation: 'model_catalog',
      };
    case ByokProvider.anthropic:
      if (modelId) {
        return {
          method: 'POST',
          url: joinEndpoint(
            endpoint ?? 'https://api.anthropic.com/v1',
            'messages'
          ),
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: modelId,
            max_tokens: 64,
            messages: [{ role: 'user', content: 'Reply with OK.' }],
          }),
          operation: 'chat',
        };
      }
      return {
        method: 'GET',
        url: joinEndpoint(endpoint ?? 'https://api.anthropic.com/v1', 'models'),
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        operation: 'model_catalog',
      };
    case ByokProvider.gemini:
      if (modelId) {
        const normalizedModelId = modelId.replace(/^models\//, '');
        return {
          method: 'POST',
          url: joinEndpoint(
            endpoint ?? 'https://generativelanguage.googleapis.com/v1beta',
            `models/${encodeURIComponent(normalizedModelId)}:generateContent`
          ),
          headers: {
            'x-goog-api-key': apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: 'Reply with OK.' }] }],
            generationConfig: { maxOutputTokens: 64 },
          }),
          operation: 'chat',
        };
      }
      return {
        method: 'GET',
        url: joinEndpoint(
          endpoint ?? 'https://generativelanguage.googleapis.com/v1beta',
          'models'
        ),
        headers: { 'x-goog-api-key': apiKey },
        operation: 'model_catalog',
      };
    case ByokProvider.fal:
      return {
        method: 'GET',
        url: 'https://api.fal.ai/v1/models?limit=10',
        headers: { Authorization: `Key ${apiKey}` },
        operation: 'model_catalog',
      };
  }
}

async function parseProbePayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new BadRequestException('Provider returned malformed JSON.');
  }
}

function hasValidModelCatalog(provider: ByokProvider, payload: unknown) {
  if (provider === ByokProvider.fal) {
    const entries = Array.isArray(payload)
      ? payload
      : isRecord(payload)
        ? (payload.models ?? payload.data ?? payload.items)
        : null;
    return hasModelEntries(
      entries,
      ['endpoint_id', 'id', 'model_id', 'name', 'model_url'],
      true
    );
  }
  if (!isRecord(payload)) return false;
  switch (provider) {
    case ByokProvider.openai:
    case ByokProvider.anthropic:
      return hasModelEntries(payload.data, ['id']);
    case ByokProvider.gemini:
      return hasModelEntries(payload.models, ['name']);
    case ByokProvider.fal:
      return false;
  }
}

function hasModelEntries(
  value: unknown,
  idFields: string[],
  allowStringEntries = false
) {
  return (
    Array.isArray(value) &&
    value.some(
      item =>
        (allowStringEntries && isNonEmptyString(item)) ||
        (isRecord(item) &&
          idFields.some(field => isNonEmptyString(item[field])))
    )
  );
}

function hasValidChatResponse(provider: ByokProvider, payload: unknown) {
  if (!isRecord(payload)) return false;
  switch (provider) {
    case ByokProvider.openai:
      return (
        isNonEmptyString(payload.output_text) ||
        arrayHasText(payload.output, item => {
          if (!isRecord(item)) return [];
          return item.content;
        }) ||
        arrayHasText(payload.choices, item => {
          if (!isRecord(item) || !isRecord(item.message)) return [];
          return item.message.content;
        })
      );
    case ByokProvider.anthropic:
      return arrayHasText(payload.content, item =>
        isRecord(item) ? item.text : item
      );
    case ByokProvider.gemini:
      return arrayHasText(payload.candidates, candidate => {
        if (!isRecord(candidate) || !isRecord(candidate.content)) return [];
        return candidate.content.parts;
      });
    case ByokProvider.fal:
      return false;
  }
}

function arrayHasText(
  value: unknown,
  content: (item: unknown) => unknown
): boolean {
  if (!Array.isArray(value)) return false;
  return value.some(item => contentHasText(content(item)));
}

function contentHasText(value: unknown): boolean {
  if (isNonEmptyString(value)) return true;
  if (!Array.isArray(value)) return false;
  return value.some(
    item =>
      isNonEmptyString(item) || (isRecord(item) && isNonEmptyString(item.text))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function joinEndpoint(endpoint: string, path: string) {
  return `${endpoint.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function providerProbeFailureMessage(status: number) {
  switch (status) {
    case 401:
      return 'Provider rejected the BYOK key.';
    case 403:
      return 'Provider rejected the BYOK key permissions.';
    case 404:
      return 'Provider probe endpoint was not found.';
    case 429:
      return 'Provider rate limit exceeded while testing the key.';
    default:
      return status >= 500
        ? 'Provider service is unavailable.'
        : `Provider key test failed with HTTP ${status}.`;
  }
}
