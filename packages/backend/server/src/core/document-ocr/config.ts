import { z } from 'zod';

import { defineModuleConfig } from '../../base';

declare global {
  interface AppConfigSchema {
    documentOcr: {
      enabled: ConfigItem<boolean>;
      baseUrl: ConfigItem<string>;
      allowedHost: ConfigItem<string>;
      model: ConfigItem<string>;
      apiKey: ConfigItem<string>;
      timeoutMs: ConfigItem<number>;
      maxUploadBytes: ConfigItem<number>;
      maxOutputBytes: ConfigItem<number>;
      maxTokens: ConfigItem<number>;
      maxConcurrency: ConfigItem<number>;
    };
  }
}

defineModuleConfig('documentOcr', {
  enabled: {
    desc: 'Enable permission-checked scanned PDF OCR through the server-controlled SparkClaw endpoint.',
    default: false,
    env: ['LOCALMIND_OCR_ENABLED', 'boolean'],
    shape: z.boolean(),
  },
  baseUrl: {
    desc: 'OpenAI-compatible SparkClaw OCR base URL. The server appends /chat/completions.',
    default: 'https://sparkclaw.infinimesh.cloud/ocr/v1',
    env: 'LOCALMIND_OCR_BASE_URL',
    shape: z.string().trim().url().max(2048),
  },
  allowedHost: {
    desc: 'Exact hostname allowed for outbound OCR requests.',
    default: 'sparkclaw.infinimesh.cloud',
    env: 'LOCALMIND_OCR_ALLOWED_HOST',
    shape: z.string().trim().min(1).max(253),
  },
  model: {
    desc: 'Model id sent to the OpenAI-compatible OCR endpoint.',
    default: 'sparkclaw-ocr',
    env: 'LOCALMIND_OCR_MODEL',
    shape: z.string().trim().min(1).max(256),
  },
  apiKey: {
    desc: 'Optional server-only bearer token for the OCR endpoint.',
    default: '',
    env: 'LOCALMIND_OCR_API_KEY',
    shape: z.string().max(4096),
  },
  timeoutMs: {
    desc: 'Maximum time for one OCR page inference.',
    default: 120_000,
    env: ['LOCALMIND_OCR_TIMEOUT_MS', 'integer'],
    shape: z.number().int().min(1_000).max(300_000),
  },
  maxUploadBytes: {
    desc: 'Maximum rasterized page image size accepted by the OCR API.',
    default: 12 * 1024 * 1024,
    env: ['LOCALMIND_OCR_MAX_UPLOAD_BYTES', 'integer'],
    shape: z
      .number()
      .int()
      .min(1024)
      .max(50 * 1024 * 1024),
  },
  maxOutputBytes: {
    desc: 'Maximum cleaned Markdown bytes accepted from one OCR completion.',
    default: 1024 * 1024,
    env: ['LOCALMIND_OCR_MAX_OUTPUT_BYTES', 'integer'],
    shape: z
      .number()
      .int()
      .min(1024)
      .max(8 * 1024 * 1024),
  },
  maxTokens: {
    desc: 'Maximum completion tokens requested from the OCR model.',
    default: 16_384,
    env: ['LOCALMIND_OCR_MAX_TOKENS', 'integer'],
    shape: z.number().int().min(256).max(65_536),
  },
  maxConcurrency: {
    desc: 'Maximum concurrent OCR page requests per LocalMind server process.',
    default: 2,
    env: ['LOCALMIND_OCR_MAX_CONCURRENCY', 'integer'],
    shape: z.number().int().min(1).max(16),
  },
});
