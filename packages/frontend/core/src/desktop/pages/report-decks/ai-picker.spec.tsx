/** @vitest-environment happy-dom */
import type {
  DeckAiOption,
  DeckAiOptionsResult,
} from '@localmind/office/report-deck';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock(
  '@affine/core/modules/report-decks/i18n',
  () => import('./__tests__/i18n-mock')
);

import { aiBlockReason, AiPicker } from './ai-picker';

afterEach(cleanup);

function option(overrides: Partial<DeckAiOption>): DeckAiOption {
  return {
    scopeKind: 'workspace',
    scopeId: 'w1',
    label: '工作区1',
    fromSources: true,
    available: true,
    reason: null,
    providerName: 'OpenAI',
    models: [
      { id: 'm1', name: 'Model 1' },
      { id: 'm2', name: 'Model 2' },
    ],
    defaultModelId: 'm1',
    modelLocked: false,
    ...overrides,
  };
}

const result: DeckAiOptionsResult = {
  options: [
    option({
      scopeKind: 'project',
      scopeId: 'pA',
      label: '项目A',
      available: false,
      reason: 'not_configured',
    }),
    option({}),
    option({
      scopeKind: 'project',
      scopeId: 'pB',
      label: '项目B',
      fromSources: false,
      providerName: 'Anthropic',
      modelLocked: true,
      models: [{ id: 'proj', name: 'Project model' }],
      defaultModelId: 'proj',
    }),
  ],
  defaultChoice: { scopeKind: 'workspace', scopeId: 'w1' },
  defaultFallbackFrom: { scopeKind: 'project', scopeId: 'pA' },
};

it('groups options, marks the first source scope as default and disables unavailable ones', () => {
  render(
    <AiPicker result={result} loading={false} value={null} onChange={vi.fn()} />
  );
  const groups = document.querySelectorAll('optgroup');
  expect([...groups].map(group => group.label)).toEqual([
    'ai.groupSources',
    'ai.groupOther',
  ]);
  const options = [...groups[0].querySelectorAll('option')];
  expect(options[0].textContent).toContain('ai.defaultMark');
  expect(options[0].textContent).toContain('ai.reason.not_configured');
  expect(options[0].disabled).toBe(true);
  expect(options[1].disabled).toBe(false);
  const select = screen.getByRole('combobox', {
    name: 'ai.label',
  }) as HTMLSelectElement;
  expect(select.value).toBe('workspace:w1');
});

it('shows the fallback notice and the cross-scope notice', () => {
  render(
    <AiPicker result={result} loading={false} value={null} onChange={vi.fn()} />
  );
  expect(screen.getByText(/ai\.fallback/).textContent).toContain(
    '"from":"项目A"'
  );
  const notice = screen.getByTestId('ai-cross-scope');
  expect(notice.textContent).toContain('"sources":"项目A"');
  expect(notice.textContent).toContain('"target":"工作区1"');
  expect(notice.textContent).toContain('"provider":"OpenAI"');
});

it('picks models for workspaces and shows locked project models read-only', () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <AiPicker
      result={result}
      loading={false}
      value={null}
      onChange={onChange}
    />
  );
  fireEvent.change(screen.getByRole('combobox', { name: 'ai.model' }), {
    target: { value: 'm2' },
  });
  expect(onChange).toHaveBeenLastCalledWith({
    scopeKind: 'workspace',
    scopeId: 'w1',
    modelId: 'm2',
  });

  fireEvent.change(screen.getByRole('combobox', { name: 'ai.label' }), {
    target: { value: 'project:pB' },
  });
  expect(onChange).toHaveBeenLastCalledWith({
    scopeKind: 'project',
    scopeId: 'pB',
  });
  rerender(
    <AiPicker
      result={result}
      loading={false}
      value={{ scopeKind: 'project', scopeId: 'pB' }}
      onChange={onChange}
    />
  );
  expect(screen.queryByRole('combobox', { name: 'ai.model' })).toBeNull();
  expect(screen.getByText('ai.modelLocked')).toBeTruthy();
  expect(screen.queryByText(/ai\.fallback/)).toBeNull();
  expect(screen.getByTestId('ai-cross-scope').textContent).toContain(
    '"target":"项目B"'
  );
});

it('reports why the selection blocks generation', () => {
  expect(aiBlockReason(undefined, null, { loading: true, error: null })).toBe(
    'ai.loading'
  );
  expect(
    aiBlockReason(undefined, null, { loading: false, error: new Error() })
  ).toBe('ai.loadFailed');
  expect(
    aiBlockReason({ ...result, defaultChoice: null }, null, {
      loading: false,
      error: null,
    })
  ).toBe('ai.noneAvailable');
  expect(
    aiBlockReason(
      result,
      { scopeKind: 'project', scopeId: 'pA' },
      { loading: false, error: null }
    )
  ).toBe('ai.selectedUnavailable');
  expect(
    aiBlockReason(result, null, { loading: false, error: null })
  ).toBeNull();
});
