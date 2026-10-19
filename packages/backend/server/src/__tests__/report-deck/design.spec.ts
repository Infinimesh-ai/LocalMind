import test from 'ava';

import type { Models } from '../../models';
import type { ResolvedPrompt } from '../../plugins/copilot/prompt';
import type { PromptService } from '../../plugins/copilot/prompt/service';
import { awaitReportCall } from '../../plugins/copilot/report-web-design/bounds';
import { groundDesignFacts } from '../../plugins/copilot/report-web-design/facts';
import {
  assertDesignReview,
  reportDesignPromptName,
} from '../../plugins/copilot/report-web-design/generation';
import type { CapabilityRuntime } from '../../plugins/copilot/runtime/capability-runtime';
import type { CapabilityPolicyHost } from '../../plugins/copilot/runtime/hosts/capability-policy-host';
import { PromptRuntime } from '../../plugins/copilot/runtime/prompt-runtime';

test('facts require exact quotes and do not promote planned work to completion', t => {
  const text = 'The launch is planned for October. Target: 12 checks.';
  const chunk = {
    parts: [
      {
        sourceIndex: 0,
        sourceTitle: 'Fixture',
        title: 'Fixture',
        role: 'document' as const,
        text,
      },
    ],
  };
  const fact = {
    doc: 0,
    text: 'The launch is planned for October.',
    quote: 'The launch is planned for October.',
    kind: 'fact' as const,
    status: 'planned' as const,
    timeScope: 'October',
    quantities: [],
  };
  const result = groundDesignFacts(
    {
      facts: [
        fact,
        { ...fact, status: 'completed' },
        { ...fact, quote: 'The launch was completed.' },
        { ...fact, quantities: [{ value: '99', unit: null, baseline: null }] },
      ],
    },
    chunk
  );
  t.is(result.facts.length, 1);
  t.is(result.rejected, 3);
  t.is(result.facts[0].quoteOffset, 0);
  t.is(result.facts[0].status, 'planned');
});

test('bounded model calls stop waiting even when a provider ignores AbortSignal', async t => {
  const controller = new AbortController();
  let resolve!: (value: string) => void;
  const underlying = new Promise<string>(done => {
    resolve = done;
  });
  const waiting = awaitReportCall(underlying, controller.signal);
  controller.abort();
  await t.throwsAsync(waiting, { message: 'timeout' });
  resolve('late output');
  t.is(await underlying, 'late output');
});

test('effective prompt snapshots survive registry changes; images remain user data and model pinning rejects drift', async t => {
  const prompt = {
    name: 'Report Web Review v3',
    source: 'registry',
    category: 'text',
    config: { maxTokens: 6000 },
    messages: [
      { role: 'system', content: 'Frozen trusted policy' },
      { role: 'user', content: '{{content}}' },
    ],
  } as ResolvedPrompt;
  let lookups = 0,
    observed: unknown[] = [];
  const service = {
    get: async () => {
      lookups++;
      return prompt;
    },
    finish: (snapshot: ResolvedPrompt, params: { content: string }) =>
      snapshot.messages?.map(m => ({
        ...m,
        content: m.content.replace('{{content}}', params.content),
      })),
  } as unknown as PromptService;
  let selected = 'pinned';
  const policy = {
    selectPrompt: async () => ({ model: selected, contextWindow: 32000 }),
  } as unknown as CapabilityPolicyHost;
  const capability = {
    text: async (...args: unknown[]) => {
      observed = args;
      return 'ok';
    },
  } as unknown as CapabilityRuntime;
  const runtime = new PromptRuntime(service, policy, capability, {} as Models);
  const snapshot = await runtime.snapshot(prompt.name);
  prompt.messages![0].content = 'Changed policy';
  const options = {
    promptSnapshot: snapshot,
    modelId: 'pinned',
    requireModelId: true,
    attachments: [
      {
        kind: 'data' as const,
        data: 'AA==',
        encoding: 'base64' as const,
        mimeType: 'image/jpeg',
      },
    ],
  };
  t.is(
    await runtime.runText(prompt.name, { content: 'Untrusted page' }, options),
    'ok'
  );
  t.is(lookups, 1);
  t.deepEqual(observed[1], [
    { role: 'system', content: 'Frozen trusted policy' },
    {
      role: 'user',
      content: 'Untrusted page',
      attachments: options.attachments,
    },
  ]);
  selected = 'other';
  await t.throwsAsync(
    runtime.runText(prompt.name, { content: 'page' }, options),
    { message: 'Pinned report model is no longer available' }
  );
});

test('unverified optional quantity labels do not discard a grounded metric', t => {
  const quote = 'There were 12 checks: 9 passed and 3 remain planned.';
  const result = groundDesignFacts(
    {
      facts: [
        {
          doc: 0,
          text: quote,
          quote,
          kind: 'number',
          status: 'ongoing',
          timeScope: 'this quarter',
          quantities: [
            {
              value: '12',
              unit: 'checks',
              baseline: 'total validation checks',
            },
          ],
        },
      ],
    },
    {
      parts: [
        {
          sourceIndex: 0,
          sourceTitle: 'Fixture',
          title: 'Fixture',
          role: 'document',
          text: quote,
        },
      ],
    }
  );
  t.is(result.facts.length, 1);
  t.is(result.rejected, 0);
  t.is(result.facts[0].quantities[0].baseline, null);
  t.is(result.facts[0].timeScope, null);
});

test('prompt upgrades preserve frozen v3 runs and select v3.1 only from its snapshot', t => {
  t.is(
    reportDesignPromptName('Plan', { 'Report Web Plan v3': {} }),
    'Report Web Plan v3'
  );
  t.is(
    reportDesignPromptName('Plan', { 'Report Web Plan v3.1': {} }),
    'Report Web Plan v3.1'
  );
});

test('a weak visual assessment must produce an actionable issue for repair', t => {
  const review = {
    artifactHash: 'a'.repeat(64),
    checkedCaptureIds: [],
    issues: [],
    designAssessment: {
      composition: {
        result: 'met' as const,
        evidence: 'Clear primary subject',
      },
      typography: { result: 'met' as const, evidence: 'Distinct type roles' },
      chartEncoding: {
        result: 'needs_work' as const,
        evidence: 'Numbers are disconnected; no visual comparison',
      },
    },
  };
  t.throws(() => assertDesignReview(review), {
    message: 'model_invalid_output',
  });
  const issue = {
    id: 'chart',
    category: 'composition' as const,
    severity: 'warning' as const,
    chapterId: 'rd-c-evidence',
    viewport: 'desktop',
    elementId: 'rd-c-evidence-plot',
    evidence: 'Numbers are disconnected',
    suggestedFix: 'Encode the counts on a common baseline with direct labels',
  };
  t.notThrows(() =>
    assertDesignReview({ ...review, issues: [issue] }, ['rd-c-evidence'])
  );
  t.throws(
    () => assertDesignReview({ ...review, issues: [issue] }, ['rd-c-another']),
    { message: 'model_invalid_output' }
  );
});
