import { Inject, Injectable, Optional } from '@nestjs/common';

import { Config, safeFetch } from '../../base';
import { DocumentOcrError } from './error';

const OCR_PROMPT =
  'Extract all readable content from the image in natural human reading order and output the result as a single Markdown document. For charts or images, represent them using an HTML image tag: <img src="images/bbox_{left}_{top}_{right}_{bottom}.jpg" />, where left, top, right, bottom are bounding box coordinates scaled to [0, 1000). Format formulas as LaTeX. Format tables as HTML: <table>...</table>. Transcribe all other text as standard Markdown. Preserve the original text without translation or paraphrasing.';
const OVIS_OCR2_MIN_PIXELS = 448 * 448;
const OVIS_OCR2_MAX_PIXELS = 2880 * 2880;

type DocumentOcrFetch = typeof safeFetch;

export const DOCUMENT_OCR_FETCH = Symbol('DOCUMENT_OCR_FETCH');

type OcrCompletion = {
  model?: unknown;
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
};

function cleanTruncatedRepeats(value: string) {
  const characters = Array.from(value);
  const length = characters.length;
  if (length < 8000) return value;

  const maxPeriod = Math.min(200, length - 1);
  for (let unitLength = 1; unitLength <= maxPeriod; unitLength++) {
    if (characters[length - 1] !== characters[length - 1 - unitLength]) {
      continue;
    }
    let matchLength = 1;
    for (
      let index = length - 2;
      index >= unitLength &&
      characters[index] === characters[index - unitLength];
      index--
    ) {
      matchLength++;
    }
    const totalLength = matchLength + unitLength;
    const repeatTimes = Math.floor(totalLength / unitLength);
    const tailLength = totalLength % unitLength;
    if (repeatTimes >= 5 && totalLength >= 100) {
      const cleaned = characters.slice(0, length - totalLength + unitLength);
      if (tailLength > 0) {
        cleaned.push(...characters.slice(length - tailLength));
      }
      return cleaned.join('');
    }
  }
  return value;
}

export function cleanDocumentOcrMarkdown(value: string) {
  const blocks = value.trim().split(/\n\s*\n/u);
  const kept = blocks.filter(
    block => !/^<img\s+src=["']images\/bbox_/iu.test(block.trim())
  );
  return cleanTruncatedRepeats(kept.join('\n\n').trim());
}

@Injectable()
export class DocumentOcrService {
  private activeRequests = 0;
  private readonly fetcher: DocumentOcrFetch;

  constructor(
    private readonly config: Config,
    @Optional()
    @Inject(DOCUMENT_OCR_FETCH)
    fetcher?: DocumentOcrFetch
  ) {
    this.fetcher = fetcher ?? safeFetch;
  }

  get maxUploadBytes() {
    return this.config.documentOcr.maxUploadBytes;
  }

  async parsePage(input: { content: Buffer; contentType: string }) {
    const config = this.config.documentOcr;
    if (!config.enabled) {
      throw new DocumentOcrError(
        'OCR_DISABLED',
        'Scanned PDF OCR is not enabled on this LocalMind server.',
        503
      );
    }
    this.validateInput(input.content, input.contentType);
    const endpoint = this.endpoint();

    if (this.activeRequests >= config.maxConcurrency) {
      throw new DocumentOcrError(
        'OCR_BUSY',
        'The OCR service is busy. Try again shortly.',
        429
      );
    }

    this.activeRequests++;
    try {
      const payload = JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${input.contentType};base64,${input.content.toString('base64')}`,
                },
              },
              { type: 'text', text: OCR_PROMPT },
            ],
          },
        ],
        max_tokens: config.maxTokens,
        temperature: 0,
        chat_template_kwargs: { enable_thinking: false },
        mm_processor_kwargs: {
          images_kwargs: {
            min_pixels: OVIS_OCR2_MIN_PIXELS,
            max_pixels: OVIS_OCR2_MAX_PIXELS,
          },
        },
      });
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      };
      if (config.apiKey.trim()) {
        headers.Authorization = `Bearer ${config.apiKey.trim()}`;
      }

      let response: Response;
      try {
        response = await this.fetcher(
          endpoint,
          {
            method: 'POST',
            headers,
            body: payload,
          },
          {
            allowedHeaders: ['accept', 'authorization', 'content-type'],
            allowedHosts: [config.allowedHost],
            maxBytes: config.maxOutputBytes * 2 + 64 * 1024,
            maxRedirects: 0,
            timeoutMs: config.timeoutMs,
          }
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const timedOut = /timeout|timed out|deadline/iu.test(message);
        throw new DocumentOcrError(
          timedOut ? 'OCR_TIMEOUT' : 'OCR_UPSTREAM_UNAVAILABLE',
          timedOut
            ? 'The OCR request timed out.'
            : 'The OCR service is unavailable.',
          502
        );
      }

      if (!response.ok) {
        throw new DocumentOcrError(
          response.status === 429 ? 'OCR_BUSY' : 'OCR_UPSTREAM_REJECTED',
          response.status === 429
            ? 'The OCR service is busy. Try again shortly.'
            : 'The OCR service rejected the request.',
          response.status === 429 ? 429 : 502
        );
      }

      const decoded = await this.decodeResponse(response);
      const rawContent = decoded.choices?.[0]?.message?.content;
      if (typeof rawContent !== 'string') {
        throw new DocumentOcrError(
          'OCR_INVALID_RESPONSE',
          'The OCR service returned an invalid response.',
          502
        );
      }
      const markdown = cleanDocumentOcrMarkdown(rawContent);
      if (!markdown) {
        throw new DocumentOcrError(
          'OCR_EMPTY_RESULT',
          'The OCR service did not detect readable text on this page.',
          422
        );
      }
      if (Buffer.byteLength(markdown, 'utf8') > config.maxOutputBytes) {
        throw new DocumentOcrError(
          'OCR_INVALID_RESPONSE',
          'The OCR result exceeded the configured output limit.',
          502
        );
      }

      return {
        markdown,
        model:
          typeof decoded.model === 'string' && decoded.model.trim()
            ? decoded.model.trim().slice(0, 256)
            : config.model,
      };
    } finally {
      this.activeRequests--;
    }
  }

  private endpoint() {
    const config = this.config.documentOcr;
    let baseUrl: URL;
    try {
      baseUrl = new URL(config.baseUrl.trim());
    } catch {
      throw new DocumentOcrError(
        'OCR_INVALID_CONFIG',
        'The OCR service configuration is invalid.',
        503
      );
    }
    if (
      baseUrl.protocol !== 'https:' ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.hostname.toLowerCase() !== config.allowedHost.toLowerCase()
    ) {
      throw new DocumentOcrError(
        'OCR_INVALID_CONFIG',
        'The OCR service configuration is invalid.',
        503
      );
    }
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/u, '')}/chat/completions`;
    baseUrl.search = '';
    baseUrl.hash = '';
    return baseUrl;
  }

  private validateInput(content: Buffer, contentType: string) {
    if (!['image/jpeg', 'image/png'].includes(contentType)) {
      throw new DocumentOcrError(
        'OCR_INVALID_IMAGE',
        'OCR accepts JPEG or PNG page images only.',
        415
      );
    }
    if (!content.length) {
      throw new DocumentOcrError(
        'OCR_INVALID_IMAGE',
        'The OCR page image is empty.',
        400
      );
    }
    if (content.length > this.config.documentOcr.maxUploadBytes) {
      throw new DocumentOcrError(
        'OCR_IMAGE_TOO_LARGE',
        'The OCR page image exceeds the configured upload limit.',
        413
      );
    }
  }

  private async decodeResponse(response: Response): Promise<OcrCompletion> {
    try {
      return (await response.json()) as OcrCompletion;
    } catch {
      throw new DocumentOcrError(
        'OCR_INVALID_RESPONSE',
        'The OCR service returned invalid JSON.',
        502
      );
    }
  }
}
