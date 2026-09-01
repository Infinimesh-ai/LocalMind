import test from 'ava';

import type { Config, SafeFetchOptions } from '../../../base';
import { DocumentOcrError } from '../error';
import { cleanDocumentOcrMarkdown, DocumentOcrService } from '../service';

function config(overrides: Partial<Config['documentOcr']> = {}): Config {
  return {
    documentOcr: {
      enabled: true,
      baseUrl: 'https://sparkclaw.infinimesh.cloud/ocr/v1',
      allowedHost: 'sparkclaw.infinimesh.cloud',
      model: 'sparkclaw-ocr',
      apiKey: '',
      timeoutMs: 120_000,
      maxUploadBytes: 12 * 1024 * 1024,
      maxOutputBytes: 1024 * 1024,
      maxTokens: 16_384,
      maxConcurrency: 2,
      ...overrides,
    },
  } as Config;
}

test('sends the SparkClaw OvisOCR2 request contract and cleans output', async t => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  let capturedOptions: SafeFetchOptions | undefined;
  const service = new DocumentOcrService(config(), (async (
    url: string | URL,
    init: RequestInit = {},
    options: SafeFetchOptions = {}
  ) => {
    capturedUrl = url.toString();
    capturedInit = init;
    capturedOptions = options;
    return new Response(
      JSON.stringify({
        model: 'ATH-MaaS/OvisOCR2',
        choices: [
          {
            message: {
              content:
                '# Receipt\n\n<table><tr><td>Total</td><td>42</td></tr></table>\n\n<img src="images/bbox_1_2_3_4.jpg" />',
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }) as never);

  const result = await service.parsePage({
    content: Buffer.from('jpeg'),
    contentType: 'image/jpeg',
  });
  const payload = JSON.parse(String(capturedInit?.body)) as {
    model: string;
    max_tokens: number;
    temperature: number;
    chat_template_kwargs: { enable_thinking: boolean };
    mm_processor_kwargs: {
      images_kwargs: { min_pixels: number; max_pixels: number };
    };
    messages: Array<{
      content: Array<{
        image_url?: { url: string };
        text?: string;
      }>;
    }>;
  };

  t.is(
    capturedUrl,
    'https://sparkclaw.infinimesh.cloud/ocr/v1/chat/completions'
  );
  t.is(payload.model, 'sparkclaw-ocr');
  t.is(payload.max_tokens, 16_384);
  t.is(payload.temperature, 0);
  t.false(payload.chat_template_kwargs.enable_thinking);
  t.is(payload.mm_processor_kwargs.images_kwargs.min_pixels, 448 * 448);
  t.is(payload.mm_processor_kwargs.images_kwargs.max_pixels, 2880 * 2880);
  t.true(
    payload.messages[0]?.content[0]?.image_url?.url.startsWith(
      'data:image/jpeg;base64,'
    ) ?? false
  );
  t.true(
    payload.messages[0]?.content[1]?.text?.includes(
      'Preserve the original text without translation or paraphrasing.'
    ) ?? false
  );
  t.deepEqual(capturedOptions?.allowedHosts, ['sparkclaw.infinimesh.cloud']);
  t.is(capturedOptions?.maxRedirects, 0);
  t.is(result.model, 'ATH-MaaS/OvisOCR2');
  t.true(result.markdown.includes('<table>'));
  t.false(result.markdown.includes('bbox_'));
});

test('fails closed when OCR is disabled or the host is not allowlisted', async t => {
  const disabled = new DocumentOcrService(
    config({ enabled: false }),
    undefined
  );
  const disabledError = await t.throwsAsync(
    disabled.parsePage({
      content: Buffer.from('png'),
      contentType: 'image/png',
    })
  );
  t.true(disabledError instanceof DocumentOcrError);
  t.is((disabledError as DocumentOcrError).code, 'OCR_DISABLED');

  const invalidHost = new DocumentOcrService(
    config({ allowedHost: 'ocr.example.com' }),
    undefined
  );
  const hostError = await t.throwsAsync(
    invalidHost.parsePage({
      content: Buffer.from('png'),
      contentType: 'image/png',
    })
  );
  t.is((hostError as DocumentOcrError).code, 'OCR_INVALID_CONFIG');
});

test('bounds upload and cleaned OCR output', async t => {
  const oversized = new DocumentOcrService(
    config({ maxUploadBytes: 3 }),
    undefined
  );
  const uploadError = await t.throwsAsync(
    oversized.parsePage({
      content: Buffer.from('large'),
      contentType: 'image/png',
    })
  );
  t.is((uploadError as DocumentOcrError).code, 'OCR_IMAGE_TOO_LARGE');

  const cleaned = cleanDocumentOcrMarkdown(
    `# Title\n\n<img src="images/bbox_1_2_3_4.jpg" />`
  );
  t.is(cleaned, '# Title');
});
