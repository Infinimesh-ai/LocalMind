/** @vitest-environment happy-dom */
import { stashDeckSources } from '@affine/core/modules/report-decks/source-handoff';
import type {
  DeckAiOptionsResult,
  DeckPreflightResult,
  DeckSourceRef,
} from '@localmind/office/report-deck';
import {
  DECK_TEMPLATES,
  DeckCommandSchema,
} from '@localmind/office/report-deck';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type * as ReactRouter from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { apiState } from './__tests__/api-mock';
import { mockApi, renderAt } from './__tests__/test-utils';

vi.mock('@affine/component', () => import('./__tests__/component-mock'));
vi.mock(
  '@affine/core/modules/report-decks/i18n',
  () => import('./__tests__/i18n-mock')
);
vi.mock(
  '@affine/core/modules/report-decks/api',
  () => import('./__tests__/api-mock')
);
vi.mock('./source-picker', () => ({
  SourcePicker: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">source picker</div> : null,
}));
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async importOriginal => ({
  ...(await importOriginal<typeof ReactRouter>()),
  useNavigate: () => navigate,
}));

import { DeckConfigPage } from './config-page';

const sources: DeckSourceRef[] = [
  { scopeKind: 'project', scopeId: 'p1', kind: 'project_all', title: '项目A' },
  {
    scopeKind: 'workspace',
    scopeId: 'w1',
    kind: 'doc',
    resourceId: 'd1',
    title: '私密文档',
  },
];

function preflight(included: boolean): DeckPreflightResult {
  return {
    sources: [
      {
        scopeKind: 'project',
        scopeId: 'p1',
        scopeLabel: '项目A',
        kind: 'project_all',
        resourceId: null,
        title: '项目A',
        status: included ? 'included' : 'excluded',
        reason: included ? null : 'empty',
        chars: included ? 3200 : null,
      },
      {
        scopeKind: 'workspace',
        scopeId: 'w1',
        scopeLabel: '工作区X',
        kind: 'doc',
        resourceId: 'd1',
        title: '私密文档',
        status: 'excluded',
        reason: 'no_permission',
        chars: null,
      },
    ],
    totalChars: included ? 3200 : 0,
    includedCount: included ? 1 : 0,
    excludedCount: included ? 1 : 2,
    estimatedMinutes: 3,
  };
}

const aiOptions: DeckAiOptionsResult = {
  options: [
    {
      scopeKind: 'project',
      scopeId: 'p1',
      label: '项目A',
      fromSources: true,
      available: true,
      reason: null,
      providerName: 'OpenAI',
      models: [{ id: 'gpt-x', name: 'GPT X' }],
      defaultModelId: 'gpt-x',
      modelLocked: true,
    },
  ],
  defaultChoice: { scopeKind: 'project', scopeId: 'p1' },
  defaultFallbackFrom: null,
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  navigate.mockReset();
});
afterEach(() => {
  cleanup();
  apiState.api = null;
});

it('shows handoff sources with preflight state and submits a valid create command', async () => {
  const api = mockApi({
    preflight: vi.fn(async () => preflight(true)),
    aiOptions: vi.fn(async () => aiOptions),
    command: vi.fn(async () => ({
      deck: { id: 'deck-9' } as never,
    })),
  });
  apiState.api = api;
  const path = stashDeckSources(sources);
  renderAt(path, '/reports/new', <DeckConfigPage />);

  expect(screen.getAllByTestId('deck-source')).toHaveLength(2);
  expect(await screen.findByText('source.reason.no_permission')).toBeTruthy();
  const excluded = screen
    .getAllByTestId('deck-source')
    .find(row => row.textContent?.includes('私密文档'));
  expect(excluded?.dataset.excluded).toBe('true');
  expect(api.preflight).toHaveBeenCalledWith(sources);

  const submit = screen.getByRole('button', { name: 'config.submit' });
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
  expect(screen.getByTestId('deck-config-summary').textContent).toContain(
    '"minutes":3'
  );

  fireEvent.change(
    screen.getByPlaceholderText('config.instructionsPlaceholder'),
    {
      target: { value: '  重点讲风险  ' },
    }
  );
  fireEvent.click(submit);
  await waitFor(() => expect(api.command).toHaveBeenCalledTimes(1));
  const input = vi.mocked(api.command).mock.calls[0][0];
  expect(DeckCommandSchema.safeParse(input).success).toBe(true);
  expect(input).toMatchObject({
    operation: 'create',
    sources,
    config: {
      mode: 'template',
      templateKey: DECK_TEMPLATES[0].key,
      purpose: 'progress',
      audience: 'team',
      length: 'standard',
      language: 'zh-CN',
      tone: 'formal',
      preferences: { charts: true, citations: false, conclusionFirst: true },
      instructions: '重点讲风险',
    },
  });
  expect(
    input.operation === 'create' && input.requestKey.length
  ).toBeGreaterThanOrEqual(8);
  expect(input.operation === 'create' && 'ai' in input.config).toBe(false);
  await waitFor(() => expect(navigate).toHaveBeenCalledWith('/reports/deck-9'));
  // Remembered preferences never include the instructions.
  const remembered = JSON.parse(
    localStorage.getItem('report-deck:last-config') ?? '{}'
  );
  expect(remembered.templateKey).toBe(DECK_TEMPLATES[0].key);
  expect(remembered.instructions).toBeUndefined();
});

it('explains why generation is disabled', async () => {
  apiState.api = mockApi({ aiOptions: vi.fn(async () => aiOptions) });
  renderAt('/reports/new', '/reports/new', <DeckConfigPage />);
  const submit = screen.getByRole('button', { name: 'config.submit' });
  expect(submit.hasAttribute('disabled')).toBe(true);
  expect(screen.getByTestId('deck-config-reason').textContent).toContain(
    'block.noSources'
  );
  cleanup();

  apiState.api = mockApi({
    preflight: vi.fn(async () => preflight(false)),
    aiOptions: vi.fn(async () => aiOptions),
  });
  renderAt(stashDeckSources(sources), '/reports/new', <DeckConfigPage />);
  await waitFor(() =>
    expect(screen.getByTestId('deck-config-reason').textContent).toContain(
      'block.noIncluded'
    )
  );
  expect(
    screen
      .getByRole('button', { name: 'config.submit' })
      .hasAttribute('disabled')
  ).toBe(true);
});

it('disables generation when no AI is available', async () => {
  apiState.api = mockApi({
    preflight: vi.fn(async () => preflight(true)),
    aiOptions: vi.fn(async () => ({
      options: [
        {
          ...aiOptions.options[0],
          available: false,
          reason: 'not_configured' as const,
        },
      ],
      defaultChoice: null,
      defaultFallbackFrom: null,
    })),
  });
  renderAt(stashDeckSources(sources), '/reports/new', <DeckConfigPage />);
  await waitFor(() =>
    expect(screen.getByTestId('deck-config-reason').textContent).toContain(
      'block.ai.noneAvailable'
    )
  );
});

it('preselects the template from the gallery and switches to custom mode', async () => {
  apiState.api = mockApi({
    preflight: vi.fn(async () => preflight(true)),
    aiOptions: vi.fn(async () => aiOptions),
  });
  const key = DECK_TEMPLATES[3].key;
  renderAt(`/reports/new?template=${key}`, '/reports/new', <DeckConfigPage />);
  const selected = screen
    .getAllByRole('button', { pressed: true })
    .map(button => button.textContent);
  expect(selected).toContain(DECK_TEMPLATES[3].name);

  fireEvent.click(screen.getByRole('button', { name: /mode\.custom/ }));
  fireEvent.click(screen.getByRole('button', { name: 'styleChip.tech.label' }));
  expect(
    (
      screen.getByPlaceholderText(
        'config.customStylePlaceholder'
      ) as HTMLTextAreaElement
    ).value
  ).toBe('styleChip.tech.text');
});

it('submits the selected design mode, preserves it while switching modes, and never remembers it', async () => {
  const api = mockApi({
    preflight: vi.fn(async () => preflight(true)),
    aiOptions: vi.fn(async () => aiOptions),
    command: vi.fn(async () => ({})),
  });
  apiState.api = api;
  const path = stashDeckSources(sources);
  renderAt(path, '/reports/new', <DeckConfigPage />);
  fireEvent.click(screen.getByRole('button', { name: /mode\.custom/ }));
  expect(
    (
      screen.getByRole('radio', {
        name: /designMode.fast /,
      }) as HTMLInputElement
    ).checked
  ).toBe(true);
  fireEvent.click(screen.getByRole('radio', { name: /designMode.refine / }));
  expect((await screen.findByTestId('deck-vision-hint')).textContent).toContain(
    'designMode.visionUnknown'
  );
  fireEvent.click(screen.getByRole('button', { name: /mode\.template/ }));
  expect(
    screen.queryByRole('radio', { name: /designMode.refine / })
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /mode\.custom/ }));
  expect(
    (
      screen.getByRole('radio', {
        name: /designMode.refine /,
      }) as HTMLInputElement
    ).checked
  ).toBe(true);
  const submit = screen.getByRole('button', { name: 'designMode.refine' });
  await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false));
  fireEvent.click(submit);
  await waitFor(() => expect(api.command).toHaveBeenCalledOnce());
  expect(vi.mocked(api.command).mock.calls[0][0]).toMatchObject({
    config: { mode: 'custom', designMode: 'refine' },
  });
  expect(
    JSON.parse(localStorage.getItem('report-deck:last-config') ?? '{}')
      .designMode
  ).toBeUndefined();
  cleanup();
  renderAt(path, '/reports/new', <DeckConfigPage />);
  expect(
    (
      screen.getByRole('radio', {
        name: /designMode.fast /,
      }) as HTMLInputElement
    ).checked
  ).toBe(true);
});

it('reconfiguration starts fast even for a refined report or stored legacy preference', async () => {
  const { detail } = await import('./__tests__/test-utils');
  const original = detail();
  localStorage.setItem(
    'report-deck:last-config',
    JSON.stringify({ mode: 'custom', designMode: 'refine' })
  );
  apiState.api = mockApi({
    get: vi.fn(async () =>
      detail({
        mode: 'custom',
        designMode: 'refine',
        config: {
          ...original.config,
          mode: 'custom',
          templateKey: undefined,
          designMode: 'refine',
        },
      })
    ),
    preflight: vi.fn(async () => preflight(true)),
    aiOptions: vi.fn(async () => aiOptions),
  });
  renderAt('/reports/new?from=deck-1', '/reports/new', <DeckConfigPage />);
  await waitFor(() => expect(apiState.api?.get).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      (
        screen.getByRole('radio', {
          name: /designMode.fast /,
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
  );
});
