import type { ReportDeckApi } from '@affine/core/modules/report-decks/types';
import type { DeckDetail, DeckSummary } from '@localmind/office/report-deck';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SWRConfig } from 'swr';
import { vi } from 'vitest';

export function mockApi(overrides: Partial<ReportDeckApi> = {}): ReportDeckApi {
  return {
    list: vi.fn(async () => ({ items: [], nextCursor: null })),
    get: vi.fn(async () => {
      throw new Error('not mocked');
    }),
    preflight: vi.fn(async () => ({
      sources: [],
      totalChars: 0,
      includedCount: 0,
      excludedCount: 0,
      estimatedMinutes: 0,
    })),
    aiOptions: vi.fn(async () => ({
      options: [],
      defaultChoice: null,
      defaultFallbackFrom: null,
    })),
    command: vi.fn(async () => ({})),
    fetchHtml: vi.fn(async () => '<!doctype html><title>deck</title>'),
    htmlUrl: vi.fn(
      (id: string, download?: boolean) =>
        `https://app.local/api/report-decks/${id}/html${download ? '?download=1' : ''}`
    ),
    ...overrides,
  };
}

export function summary(overrides: Partial<DeckSummary> = {}): DeckSummary {
  return {
    id: 'deck-1',
    title: 'Q3 进展',
    status: 'ready',
    mode: 'template',
    templateKey: 'periodic',
    slideCount: 12,
    sourceCount: 3,
    excludedCount: 0,
    progress: { phase: 'done', done: 0, total: 0 },
    errorCode: null,
    createdAt: '2026-10-15T08:00:00.000Z',
    completedAt: '2026-10-15T08:05:00.000Z',
    ...overrides,
  };
}

export function detail(overrides: Partial<DeckDetail> = {}): DeckDetail {
  return {
    ...summary(),
    config: {
      mode: 'template',
      templateKey: 'periodic',
      purpose: 'progress',
      audience: 'team',
      length: 'standard',
      language: 'zh-CN',
      tone: 'formal',
      preferences: { charts: true, citations: false, conclusionFirst: true },
      instructions: '',
    },
    ai: { scopeKind: 'project', scopeId: 'p1', scopeLabel: '项目A' },
    modelId: 'gpt-x',
    htmlBytes: 1024,
    sources: [
      {
        scopeKind: 'project',
        scopeId: 'p1',
        scopeLabel: '项目A',
        kind: 'doc',
        resourceId: 'r1',
        title: '周报',
        status: 'included',
        reason: null,
        chars: 1200,
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
    shares: [],
    ...overrides,
  };
}

export function renderAt(
  path: string,
  routePath: string,
  element: ReactElement
) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </SWRConfig>
  );
}

/** `t` stand-in: key plus JSON params, so assertions can see both. */
export const deckText = (key: string, params?: Record<string, unknown>) =>
  params ? `${key} ${JSON.stringify(params)}` : key;
