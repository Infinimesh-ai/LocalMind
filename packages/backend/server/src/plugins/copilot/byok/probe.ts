import { BadRequestException } from '@nestjs/common';

import type { safeFetch } from '../../../base';
import { ByokProvider } from './types';

const TEST_TIMEOUT_MS = 10_000;
export const PROVIDER_PROBE_MAX_BYTES = 1024 * 1024;

type ProbeFetch = typeof safeFetch;

export async function runProviderProbe(
  probeFetch: ProbeFetch,
  provider: ByokProvider,
  apiKey: string,
  endpoint: string | null,
  allowPrivateEndpoint: boolean,
  modelId?: string | null
) {
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
}

function buildProbeRequest(
  provider: ByokProvider,
  apiKey: string,
  endpoint: string | null,
  modelId?: string | null
): {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
} {
  switch (provider) {
    case ByokProvider.openai:
      if (modelId) {
        return {
          method: 'POST',
          url: `${endpoint ?? 'https://api.openai.com/v1'}/responses`,
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
        };
      }
      return {
        method: 'GET',
        url: `${endpoint ?? 'https://api.openai.com/v1'}/models`,
        headers: { Authorization: `Bearer ${apiKey}` },
      };
    case ByokProvider.anthropic:
      return {
        method: 'GET',
        url: `${endpoint ?? 'https://api.anthropic.com/v1'}/models`,
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
      };
    case ByokProvider.gemini:
      return {
        method: 'GET',
        url: `${endpoint ?? 'https://generativelanguage.googleapis.com/v1beta'}/models`,
        headers: { 'x-goog-api-key': apiKey },
      };
    case ByokProvider.fal:
      return {
        method: 'GET',
        url: 'https://api.fal.ai/v1/models?limit=10',
        headers: { Authorization: `Key ${apiKey}` },
      };
  }
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
