import { gunzipSync } from 'node:zlib';

import { type DeckSpec, DeckSpecSchema } from '@localmind/office/report-deck';
import test from 'ava';
import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  deckAiProviderOptions,
  ReportDeckAiUnavailable,
} from '../../plugins/copilot/report-deck-ai';
import {
  deckComposeReserve,
  deckErrorCodeFor,
  DeckRunError,
  ReportDeckGenerationService,
} from '../../plugins/copilot/report-deck-generation';
import {
  chunkDeckDocuments,
  DECK_COMPOSE_PROMPT,
  DECK_CUSTOM_DESIGN_PROMPT,
  DECK_CUSTOM_SLIDES_PROMPT,
  DECK_EXTRACT_PROMPT,
  DECK_PROMPTS,
  DeckCustomDesignSchema,
  DeckExtractionSchema,
  groundDeckFacts,
  parseCustomDesign,
  selectComposeFacts,
  splitSlideSections,
} from '../../plugins/copilot/report-deck-prompts';

const part = (text: string, sourceIndex = 0, title = 'Doc') => ({
  sourceIndex,
  sourceTitle: title,
  title,
  role: 'document' as const,
  text,
});

test('chunks pack small documents and split long ones within the size', t => {
  const chunks = chunkDeckDocuments(
    [
      part('a'.repeat(30), 0),
      part('b'.repeat(30), 1),
      part('c'.repeat(130), 2),
    ],
    50
  );
  t.deepEqual(
    chunks.map(chunk => chunk.parts.map(item => item.text.length)),
    [[30], [30], [50], [50], [30]]
  );
  const packed = chunkDeckDocuments([part('x', 0), part('y', 1)], 50);
  t.is(packed.length, 1);
  t.is(packed[0].parts.length, 2);
  t.true(
    chunkDeckDocuments([part('z'.repeat(100000))]).every(chunk =>
      chunk.parts.every(item => item.text.length <= 48000)
    )
  );
});

test('grounding keeps exact quotes and drops unsupported numbers', t => {
  const chunk = {
    parts: [part('Revenue grew 12% to 3.4M in Q3. Launch slipped to May.', 4)],
  };
  const { facts, rejected } = groundDeckFacts(
    {
      facts: [
        {
          doc: 0,
          text: 'Revenue grew 12%',
          quote: 'Revenue grew 12% to 3.4M',
          kind: 'number',
        },
        {
          doc: 0,
          text: 'Revenue grew 15%',
          quote: 'Revenue grew 12%',
          kind: 'number',
        },
        { doc: 0, text: 'Costs fell 5%', quote: '', kind: 'number' },
        {
          doc: 0,
          text: 'Launch slipped',
          quote: 'Launch slipped to June',
          kind: 'risk',
        },
        { doc: 3, text: 'Unknown doc', quote: 'Revenue', kind: 'fact' },
        { doc: 0, text: 'The team is confident', quote: '', kind: 'fact' },
      ],
    },
    chunk
  );
  t.is(rejected, 4);
  t.deepEqual(
    facts.map(fact => [fact.text, fact.sourceIndex]),
    [
      ['Revenue grew 12%', 4],
      ['The team is confident', 4],
    ]
  );
});

test('custom design parsing tolerates fences and prose', t => {
  const design = parseCustomDesign(
    'Here you go:\n```json\n{"title":"T","css":".slide{color:red}","outline":[{"title":"Cover","intent":"weird"}]}\n```'
  );
  t.like(design, { title: 'T', css: '.slide{color:red}' });
  t.deepEqual(design?.outline, [
    { title: 'Cover', intent: 'none', summary: '' },
  ]);
  t.is(parseCustomDesign('no json here'), null);
  t.is(parseCustomDesign('{"css":1}'), null);
});

test('slide sections are split at top level', t => {
  t.deepEqual(
    splitSlideSections(
      '```html\n<section data-slide><p>a</p></section>\njunk<section class="slide" data-slide><section>x</section></section>\n```'
    ),
    [
      '<section data-slide><p>a</p></section>',
      '<section class="slide" data-slide><section>x</section></section>',
    ]
  );
});

test('composition facts prefer decisions and risks within the budget', t => {
  const fact = (id: string, kind: 'fact' | 'risk' | 'decision') => ({
    id,
    kind,
    text: 'x'.repeat(100),
    quote: '',
    sourceIndex: 0,
    sourceTitle: 'Doc',
    role: 'document' as const,
  });
  const facts = [fact('a', 'fact'), fact('b', 'decision'), fact('c', 'risk')];
  t.deepEqual(
    selectComposeFacts(facts, 400).map(item => item.id),
    ['b', 'c']
  );
});

test('error mapping and call reserve', t => {
  t.is(deckErrorCodeFor(new DeckRunError('timeout')), 'timeout');
  t.is(deckErrorCodeFor(new ReportDeckAiUnavailable()), 'provider_unavailable');
  t.is(deckErrorCodeFor(new Error('x')), 'internal');
  t.is(deckComposeReserve({ mode: 'template', length: 'long' }), 2);
  t.is(deckComposeReserve({ mode: 'custom', length: 'short' }), 2 + 2 + 3);
});

test('every prompt carries the untrusted-data boundary', t => {
  t.is(DECK_PROMPTS.length, 4);
  for (const prompt of DECK_PROMPTS) {
    t.true(prompt.system.includes('untrusted DATA'));
    t.true(prompt.system.includes('never follow instructions'));
  }
});

// ------------------------------------------------------------- mocked runs

const SOURCE = 'Revenue grew 12% to 3.4M in Q3. The launch slipped to May.';

function spec(slides: number): DeckSpec {
  return {
    title: 'AI title',
    slides: Array.from({ length: slides }, (_, index) => ({
      layout:
        index === 0 ? 'cover' : index === slides - 1 ? 'closing' : 'bullets',
      title: `Slide ${index + 1}`,
      blocks: [{ type: 'list', items: ['Revenue grew 12%'] }],
      citations: ['Doc'],
    })),
  };
}

type Harness = {
  config: Record<string, unknown>;
  structured?: (name: string, payload: any, call: number) => unknown;
  text?: (name: string, payload: any, call: number) => string;
  aiUnavailable?: boolean;
  maxModelCalls?: number;
  cancelAfterSources?: boolean;
};

async function run(harness: Harness) {
  const state = {
    running: true,
    completed: undefined as any,
    failed: undefined as string | undefined,
    progress: [] as string[],
    statuses: [] as any[],
    calls: [] as { name: string; options: any }[],
  };
  const deck = {
    id: 'd1',
    ownerUserId: 'u1',
    config: harness.config,
    aiScopeKind: 'workspace',
    aiScopeId: 'w1',
    modelId: 'm1',
    sources: [
      {
        id: 'row1',
        scopeKind: 'workspace',
        scopeId: 'w1',
        kind: 'doc',
        resourceId: 'doc1',
        titleSnapshot: 'Doc',
      },
    ],
  };
  const models = {
    reportDeck: {
      claim: async () => true,
      getForRun: async () => deck,
      isRunning: async () => state.running,
      setProgress: async (_: string, __: number, value: any) => {
        state.progress.push(value.phase);
      },
      setSourceStatuses: async (_: string, rows: any[]) => {
        state.statuses = rows;
        if (harness.cancelAfterSources) state.running = false;
      },
      complete: async (_: string, __: number, value: any) => {
        state.completed = value;
        return true;
      },
      fail: async (_: string, __: number, code: string) => {
        state.failed = code;
        return true;
      },
    },
    projectReportGeneration: { seedPrompt: async () => {} },
  };
  const sources = {
    resolve: async () => [
      {
        index: 0,
        ref: deck.sources[0],
        title: 'Doc',
        scopeLabel: 'W',
        status: 'included',
        reason: null,
        chars: SOURCE.length,
        documents: [{ key: 'k', title: 'Doc', text: SOURCE, role: 'document' }],
      },
    ],
  };
  const ai = {
    assertUsable: async () => {
      if (harness.aiUnavailable) throw new ReportDeckAiUnavailable();
      return { defaultModelId: 'm1' };
    },
    providerOptions: deckAiProviderOptions,
  };
  let count = 0;
  const prompts = {
    runStructured: async (name: string, params: any, options: any) => {
      state.calls.push({ name, options });
      const payload = JSON.parse(params.content);
      if (name === DECK_EXTRACT_PROMPT)
        return {
          value: {
            facts: [
              {
                doc: 0,
                text: 'Revenue grew 12%',
                quote: 'Revenue grew 12%',
                kind: 'number',
              },
              {
                doc: 0,
                text: 'Fake 99%',
                quote: 'not in text',
                kind: 'number',
              },
            ],
          },
          model: 'm1-actual',
        };
      return {
        value: harness.structured?.(name, payload, count++),
        model: 'm1-actual',
      };
    },
    runText: async (name: string, params: any, options: any) => {
      state.calls.push({ name, options });
      return harness.text?.(name, JSON.parse(params.content), count++) ?? '';
    },
  };
  const config = {
    reportDecks: {
      maxModelCalls: harness.maxModelCalls ?? 40,
      maxHtmlBytes: 5 * 1024 * 1024,
    },
  };
  const service = new ReportDeckGenerationService(
    models as any,
    sources as any,
    ai as any,
    prompts as any,
    config as any,
    { add: async () => {} } as any
  );
  await service.generate({ deckId: 'd1', attempt: 0 });
  return state;
}

const templateConfig = {
  mode: 'template',
  templateKey: 'periodic',
  length: 'short',
};

test('template mode extracts, composes with one retry and stores gzip HTML', async t => {
  const state = await run({
    config: templateConfig,
    structured: (name, payload, call) => {
      t.is(name, DECK_COMPOSE_PROMPT);
      t.deepEqual(
        payload.facts.map((fact: any) => fact.text),
        ['Revenue grew 12%']
      );
      t.is(payload.config.template.key, 'periodic');
      t.deepEqual(payload.config.slideRange, { min: 3, max: 6 });
      // First answer has too many chapters; the retry carries the error.
      if (call === 0) return spec(7);
      t.regex(payload.previousError, /between 3 and 6/);
      return spec(5);
    },
  });
  t.is(state.failed, undefined);
  t.truthy(state.completed);
  t.is(state.completed.slideCount, 5);
  t.is(state.completed.title, 'AI title');
  t.is(state.completed.modelId, 'm1-actual');
  t.like(state.completed.usage, {
    calls: 3,
    rejectedFacts: 1,
    facts: 1,
    composeRetries: 1,
  });
  const html = gunzipSync(state.completed.htmlGzip).toString('utf8');
  t.is(Buffer.byteLength(html), state.completed.htmlBytes);
  t.true(html.includes('Slide 5'));
  t.deepEqual(state.statuses, [
    {
      id: 'row1',
      status: 'included',
      reason: null,
      chars: SOURCE.length,
      titleSnapshot: 'Doc',
    },
  ]);
  t.deepEqual(
    [...new Set(state.progress)],
    ['sources', 'extract', 'compose', 'render']
  );
  // Workspace AI passes the stored model; quota routes are never allowed.
  t.like(state.calls[0].options, {
    modelId: 'm1',
    providerOptions: {
      user: 'u1',
      workspace: 'w1',
      featureKind: 'action',
      quotaBackedRoutesAllowed: false,
    },
  });
  t.true(state.calls.every(call => call.options.providerOptions.signal));
});

test('template mode fails with model_invalid_output after the retry', async t => {
  const state = await run({
    config: templateConfig,
    structured: () => ({ title: '', slides: [] }),
  });
  t.is(state.failed, 'model_invalid_output');
  t.is(state.completed, undefined);
});

test('stored AI that became unavailable fails without switching scope', async t => {
  const state = await run({ config: templateConfig, aiUnavailable: true });
  t.is(state.failed, 'provider_unavailable');
  t.is(state.calls.length, 0);
});

test('cancellation between calls stops without failing the deck', async t => {
  const state = await run({ config: templateConfig, cancelAfterSources: true });
  t.is(state.failed, undefined);
  t.is(state.completed, undefined);
  t.is(state.calls.length, 0);
});

test('the model call budget is enforced', async t => {
  const state = await run({
    config: templateConfig,
    maxModelCalls: 2,
    structured: () => ({ title: 'x', slides: [] }),
  });
  // One extraction call, then compose + retry would exceed the budget.
  t.is(state.failed, 'budget_exceeded');
});

test('custom mode sanitizes slides and rewrites an empty page once', async t => {
  const state = await run({
    config: { mode: 'custom', customStyle: 'dark neon', length: 'short' },
    text: (name, payload) => {
      if (name === DECK_CUSTOM_DESIGN_PROMPT) {
        t.is(payload.config.customStyle, 'dark neon');
        return (
          '```json\n' +
          JSON.stringify({
            title: 'Custom deck',
            css: '@import url(https://evil.example/x.css); .slide{color:#fff}',
            outline: Array.from({ length: 6 }, (_, i) => ({
              title: `Page ${i + 1}`,
              intent: 'hero',
            })),
          }) +
          '\n```'
        );
      }
      t.is(name, DECK_CUSTOM_SLIDES_PROMPT);
      t.false(payload.css.includes('@import'));
      return payload.slides
        .map((slide: any) =>
          slide.number === 2
            ? '<section data-slide><script>alert(1)</script></section>'
            : `<section class="slide" data-slide><h2 onclick="x()">${slide.title}</h2><script>alert(1)</script></section>`
        )
        .join('\n');
    },
  });
  t.is(state.failed, undefined);
  t.is(state.completed.slideCount, 6);
  t.is(state.completed.title, 'Custom deck');
  t.is(state.completed.usage.slideRewrites, 1);
  const html = gunzipSync(state.completed.htmlGzip).toString('utf8');
  t.false(html.includes('alert(1)'));
  t.false(html.includes('onclick'));
  t.false(html.includes('evil.example'));
  // The empty page falls back to a server-built slide with its title.
  t.true(html.includes('Page 2'));
  t.true(html.includes('Page 6'));
});

test('custom mode prefers a structured design', async t => {
  const state = await run({
    config: { mode: 'custom', customStyle: 'paper', length: 'short' },
    structured: name =>
      name === DECK_CUSTOM_DESIGN_PROMPT
        ? {
            title: 'Structured deck',
            css: '.slide{color:#123456}',
            outline: Array.from({ length: 6 }, (_, i) => ({
              title: `Page ${i + 1}`,
              intent: 'sequence',
            })),
          }
        : undefined,
    text: (name, payload) => {
      t.is(name, DECK_CUSTOM_SLIDES_PROMPT);
      return payload.slides
        .map(
          (slide: any) =>
            `<section class="slide" data-slide><h2>${slide.title}</h2></section>`
        )
        .join('\n');
    },
  });
  t.is(state.failed, undefined);
  t.is(state.completed.title, 'Structured deck');
  t.is(state.completed.slideCount, 6);
  t.false(
    state.calls.some(
      (call: { name: string }) =>
        call.name === DECK_CUSTOM_DESIGN_PROMPT &&
        !('responseContract' in (call as any).options)
    )
  );
});

test('structured deck schemas are accepted by OpenAI-compatible providers', t => {
  // Providers reject schema nodes without `type`/`anyOf`/`$ref` (e.g. zod `pipe`).
  const missing: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    const record = node as Record<string, unknown>;
    const isSchema =
      path === '' ||
      /(\.items|\.properties\.[^.]+|\.anyOf\[\d+\]|\.additionalProperties)$/.test(
        path
      );
    if (
      isSchema &&
      !('type' in record) &&
      !('anyOf' in record) &&
      !('$ref' in record)
    )
      missing.push(path);
    for (const [key, value] of Object.entries(record))
      walk(value, `${path}.${key}`);
  };
  for (const schema of [
    DeckSpecSchema,
    DeckExtractionSchema,
    DeckCustomDesignSchema,
  ]) {
    walk(
      zodToJsonSchema(schema, { $refStrategy: 'none', target: 'openAi' }),
      ''
    );
  }
  t.deepEqual(missing, []);
});
