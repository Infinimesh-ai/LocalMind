/**
 * @vitest-environment happy-dom
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type {
  ButtonHTMLAttributes,
  PropsWithChildren,
  ReactElement,
} from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  graph: null as unknown,
  loading: false,
  error: null as Error | null,
  detailsError: null as Error | null,
  detailsLoading: false,
}));
const tokens = vi.hoisted(() => ({
  graphQuery: Symbol('graphQuery'),
  detailsQuery: Symbol('detailsQuery'),
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    ...props
  }: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement>>) => (
    <button {...props}>{children}</button>
  ),
  IconButton: ({
    icon,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactElement;
    size?: string;
  }) => <button {...props}>{icon}</button>,
  Loading: () => <span>Loading</span>,
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: (options?: { query: symbol }) =>
    options?.query === tokens.detailsQuery
      ? {
          data: {
            currentUser: {
              copilot: {
                myWorkOrder: {
                  purpose: '核准下一季度预算',
                  requirements: [
                    {
                      id: 'budget',
                      title: '预算',
                      instructions: '附上批准人和日期',
                      required: true,
                    },
                  ],
                },
              },
            },
          },
          isLoading: state.detailsLoading,
          error: state.detailsError,
          mutate: state.mutate,
        }
      : {
          data: {
            currentUser: { copilot: { myCollaborationGraph: state.graph } },
          },
          isLoading: state.loading,
          error: state.error,
          mutate: state.mutate,
        },
}));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  projectErrorMessage: (error: Error) => error.message,
}));
vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: () => {},
}));
vi.mock('@affine/graphql', () => ({
  copilotCollaborationGraphGetQuery: tokens.graphQuery,
  copilotCollaborationOrderDetailsQuery: tokens.detailsQuery,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_target, key) => () => String(key) }),
}));
vi.mock('@blocksuite/icons/rc', () => ({
  ArrowDownSmallIcon: () => <svg />,
  ArrowLeftSmallIcon: () => <svg />,
  ArrowRightSmallIcon: () => <svg />,
  SidebarIcon: () => <svg />,
  ExpandFullIcon: () => <svg />,
  MinusIcon: () => <svg />,
  PlusIcon: () => <svg />,
}));

import { CollaborationGraph } from './collaboration-graph';

const graph = {
  nodes: [
    { id: 'a', label: '发单人', self: true },
    { id: 'b', label: '接单人', self: false },
  ],
  edges: [
    {
      id: 'order-1',
      kind: 'sent',
      from: 'a',
      to: 'b',
      status: 'open',
      label: '预算与排期',
      requirementTitles: ['批准后的预算'],
      requirementItems: [{ id: 'budget', title: '批准后的预算', kind: 'text' }],
      ownConversationExists: true,
      sourceKind: 'project',
      project: { id: 'p', name: '甲项目' },
      updatedAt: '2026-09-24T00:00:00.000Z',
      expiresAt: null,
      ownNavigationKind: 'project_session',
      ownSessionId: 'source',
      ownProjectId: 'p',
      ownWorkOrderId: null,
      ownWorkspaceId: null,
      ownDocId: null,
    },
  ],
  truncated: false,
};

class ResizeObserverMock {
  static host: ResizeObserverMock | undefined;
  static root: ResizeObserverMock | undefined;
  static initialWidth = 900;
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(element: Element) {
    if (element.getAttribute('role') === 'region')
      ResizeObserverMock.host = this;
    if (element instanceof HTMLElement && element.dataset.compact !== undefined)
      ResizeObserverMock.root = this;
    this.resize(ResizeObserverMock.initialWidth, 520);
  }
  resize(width: number, height: number) {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver
    );
  }
  disconnect() {}
}

describe('CollaborationGraph', () => {
  beforeEach(() => {
    state.graph = graph;
    state.loading = false;
    state.error = null;
    state.detailsError = null;
    state.detailsLoading = false;
    state.mutate.mockReset().mockResolvedValue(undefined);
    ResizeObserverMock.initialWidth = 900;
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test('selecting a summary reveals and focuses the work order without opening a conversation', async () => {
    const onOpenRelation = vi.fn();
    const { container } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={onOpenRelation} />
    );
    fireEvent.click(container.querySelector('[data-relation-id="order-1"]')!);
    expect(onOpenRelation).not.toHaveBeenCalled();
    const card = container.querySelector<HTMLLIElement>(
      '#relation-list-items > li'
    )!;
    expect(card.dataset.active).toBe('true');
    expect(document.activeElement).toBe(card);
    expect(card.querySelector('li[data-active="true"]')?.textContent).toContain(
      '批准后的预算'
    );
    fireEvent.click(
      screen.getByRole('button', { name: /graphOpenConversation/ })
    );
    await waitFor(() =>
      expect(onOpenRelation).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'order-1' })
      )
    );
  });

  test('14 orders with 25 requirements expand into separate sides with a single self node', () => {
    state.graph = {
      ...graph,
      edges: Array.from({ length: 14 }, (_, index) => ({
        ...graph.edges[0],
        id: `order-${index}`,
        requirementItems:
          index < 11
            ? [
                { id: 'file', title: `文件 ${index}`, kind: 'file' },
                { id: 'text', title: `说明 ${index}`, kind: 'text' },
              ]
            : [{ id: 'text', title: `说明 ${index}`, kind: 'text' }],
        project: { id: `p-${index}`, name: `项目 ${index}` },
        from: index % 2 ? 'b' : 'a',
        to: index % 2 ? 'a' : 'b',
      })),
    };
    const { container } = render(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-self]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-item-id]')).toHaveLength(2);
    expect(container.querySelector('path[marker-start]')).toBeNull();
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(2);
    for (const button of screen.getAllByRole('button', {
      name: /graphExpandPerson/,
    }))
      fireEvent.click(button);
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(14);
    expect(
      container.querySelectorAll('[data-list-requirement-id]')
    ).toHaveLength(25);
    expect(
      container.querySelector('[data-relation-id="order-0"]')?.textContent
    ).toBe('预算与排期');
    expect(
      container.querySelector('[data-relation-id="order-13"]')
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /graphNext/ })).toBeNull();
    expect(
      container
        .querySelector('[data-item-id]')
        ?.getAttribute('stroke-dasharray')
    ).toBe('5 5');
    const self = container.querySelector<HTMLElement>('[data-self="true"]')!;
    const position = self.getAttribute('style');
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    const world = container.querySelector<HTMLElement>('[data-graph-world]')!;
    const transform = world.style.transform;
    const paths = [...world.querySelectorAll('path[d]')].map(path =>
      path.getAttribute('d')
    );
    fireEvent.wheel(region, { deltaY: 600 });
    expect(world.style.transform).not.toBe(transform);
    expect(
      [...world.querySelectorAll('path[d]')].map(path => path.getAttribute('d'))
    ).toEqual(paths);
    expect(self.getAttribute('style')).toBe(position);
    fireEvent.click(screen.getByRole('button', { name: /graphCollapseAll/ }));
    expect(container.querySelectorAll('[data-item-id]')).toHaveLength(2);
  });

  test('the two directional placements of one person centre vertically and filter orders independently', () => {
    state.graph = {
      ...graph,
      edges: Array.from({ length: 4 }, (_, i) => ({
        ...graph.edges[0],
        id: `order-${i}`,
        label: `工单 ${i}`,
        from: i < 2 ? 'a' : 'b',
        to: i < 2 ? 'b' : 'a',
      })),
    };
    const { container } = render(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    for (const button of screen.getAllByRole('button', {
      name: /graphExpandPerson/,
    }))
      fireEvent.click(button);
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(4);
    const people = [
      ...container.querySelectorAll<HTMLElement>('[data-person-id]'),
    ];
    expect(new Set(people.map(person => person.style.top)).size).toBe(1);
    expect(Number.parseFloat(people[0].style.top)).toBe(
      Number(region.dataset.cameraY)
    );
    fireEvent.click(
      container.querySelector('[data-person-id="b"][data-direction="left"]')!
    );
    expect(
      container.querySelectorAll('#relation-list-items > li')
    ).toHaveLength(2);
    expect(
      container.querySelector('#relation-list-items')!.textContent
    ).toContain('工单 0');
    expect(
      container.querySelector('#relation-list-items')!.textContent
    ).not.toContain('工单 2');
    fireEvent.click(screen.getByRole('button', { name: /graphFilterMine/ }));
    expect(
      container.querySelector('#relation-list-items')!.textContent
    ).toContain('工单 2');
    expect(
      container.querySelector('#relation-list-items')!.textContent
    ).not.toContain('工单 0');
    fireEvent.click(
      container.querySelector('#relation-list-items button[title="工单 3"]')!
    );
    expect(
      container.querySelectorAll('[data-relation-id][data-active="true"]')
    ).toHaveLength(1);
    expect(
      container.querySelector<HTMLElement>('[data-relation-id="order-3"]')
        ?.dataset.groupKey
    ).toBe('right:b');
    const zoom = region.dataset.zoom;
    fireEvent.click(
      screen.getByRole('button', {
        name: /graphCollapseGroup.*graphOutgoingLane/,
      })
    );
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(3);
    fireEvent.click(
      screen.getByRole('button', { name: /graphLocateSelection/ })
    );
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(4);
    expect(
      container
        .querySelector('[data-relation-id="order-3"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(region.dataset.zoom).toBe(zoom);
    fireEvent.click(container.querySelector('[data-relation-id="order-1"]')!);
    expect(
      container.querySelectorAll('#relation-list-items > li')
    ).toHaveLength(2);
    expect(
      container.querySelector('#relation-list-items')!.textContent
    ).not.toContain('工单 3');
  });

  test('the first measured narrow viewport fits both directional person placements', () => {
    ResizeObserverMock.initialWidth = 390;
    state.graph = {
      ...graph,
      edges: [
        graph.edges[0],
        { ...graph.edges[0], id: 'outgoing', from: 'b', to: 'a' },
      ],
    };
    const { container } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    expect(Number(region.dataset.zoom)).toBeCloseTo(390 / 1100);
    expect(Number(region.dataset.cameraX)).toBe(550);
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(3);
    act(() => ResizeObserverMock.host?.resize(900, 520));
    expect(Number(region.dataset.zoom)).toBeCloseTo(390 / 1100);
    fireEvent.wheel(region, { deltaY: 100 });
    expect(Number(region.dataset.zoom)).toBeCloseTo(390 / 1100);
    fireEvent.click(screen.getByRole('button', { name: /graphResetZoom/ }));
    act(() => ResizeObserverMock.host?.resize(500, 440));
    expect(Number(region.dataset.zoom)).toBe(1);
  });

  test('initial fitting waits for the measured width to match the committed two-column layout', () => {
    const getRect = HTMLElement.prototype.getBoundingClientRect;
    const measure = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        const rect = getRect.call(this);
        return this.getAttribute('role') === 'region'
          ? { ...rect, width: 390, height: 520, toJSON: rect.toJSON }
          : rect;
      });
    try {
      render(<CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />);
      const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
      act(() => ResizeObserverMock.host?.resize(390, 520));
      expect(Number(region.dataset.zoom)).toBeCloseTo(390 / 900);
    } finally {
      measure.mockRestore();
    }
  });

  test('seven incoming and eight outgoing collaborators stay on the same graph when multiple groups expand', () => {
    state.graph = {
      ...graph,
      nodes: [
        graph.nodes[0],
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `person-${i}`,
          label: `协作者 ${i}`,
          self: false,
        })),
      ],
      edges: Array.from({ length: 15 }, (_, i) =>
        Array.from({ length: 2 }, (_, j) => ({
          ...graph.edges[0],
          id: `order-${i}-${j}`,
          from: i < 7 ? 'a' : `person-${i}`,
          to: i < 7 ? `person-${i}` : 'a',
        }))
      ).flat(),
    };
    const { container } = render(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    expect(container.querySelectorAll('[data-self]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-direction="left"]')).toHaveLength(
      7
    );
    expect(container.querySelectorAll('[data-direction="right"]')).toHaveLength(
      8
    );
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(15);
    expect(screen.queryByRole('button', { name: /graphNext/ })).toBeNull();
    const expand = (key: string) =>
      fireEvent.click(
        container
          .querySelector(`[data-group-key="${key}"]`)!
          .parentElement!.querySelector('[aria-expanded]')!
      );
    expand('left:person-3');
    expand('right:person-10');
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(16);
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(17);
    act(() => ResizeObserverMock.host?.resize(390, 440));
    expect(container.querySelectorAll('[data-person-id]')).toHaveLength(16);
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(17);
  });

  test('a single summary selects the whole work order and keeps both requirements in its card across refreshes', () => {
    state.graph = {
      ...graph,
      edges: [
        {
          ...graph.edges[0],
          requirementItems: [
            { id: 'budget', title: '预算', kind: 'text' },
            { id: 'timeline', title: '排期', kind: 'text' },
          ],
        },
      ],
    };
    const { container, rerender } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    expect(
      screen.queryByRole('button', { name: /graphExpandPerson/ })
    ).toBeNull();
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(1);
    fireEvent.click(container.querySelector('[data-relation-id="order-1"]')!);
    expect(
      container.querySelectorAll('#relation-list-items > li')
    ).toHaveLength(1);
    expect(
      container.querySelectorAll(
        '#relation-list-items li li[data-active="true"]'
      )
    ).toHaveLength(2);
    expect(
      container.querySelector('[data-relation-id="order-1"]')?.textContent
    ).toBe('预算与排期');
    rerender(<CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />);
    expect(
      container.querySelector<HTMLLIElement>('#relation-list-items > li')
        ?.dataset.active
    ).toBe('true');
  });

  test('conversation creation prevents duplicate clicks and leaves errors on the selected order', async () => {
    state.graph = {
      ...graph,
      edges: [{ ...graph.edges[0], ownConversationExists: false }],
    };
    let reject: (error: Error) => void = () => {};
    const onOpenRelation = vi.fn(
      () =>
        new Promise<void>((_resolve, onReject) => {
          reject = onReject;
        })
    );
    const { container } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={onOpenRelation} />
    );
    fireEvent.click(container.querySelector('[data-relation-id]')!);
    const button = screen.getByRole('button', {
      name: /graphCreateConversation/,
    });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onOpenRelation).toHaveBeenCalledTimes(1);
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await act(async () => reject(new Error('Conversation unavailable')));
    expect(screen.getByRole('alert').textContent).toBe(
      'Conversation unavailable'
    );
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  test('an expired draft disappears without a reload, even when refresh fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
    state.graph = {
      ...graph,
      edges: [
        {
          ...graph.edges[0],
          kind: 'draft',
          status: 'draft',
          expiresAt: '2026-09-24T00:00:01.000Z',
        },
      ],
    };
    state.mutate.mockRejectedValue(new Error('offline'));
    const { container } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    expect(container.querySelectorAll('[data-relation-id]')).toHaveLength(1);
    await act(() => vi.advanceTimersByTimeAsync(1001));
    expect(
      screen.getByText('com.affine.localmind.workbench.v9.graphFilterEmpty')
    ).toBeTruthy();
    expect(state.mutate).toHaveBeenCalled();
  });

  test('expanded workspace keeps the graph and work orders in separate columns and narrow screens retain a dismissible drawer', () => {
    const view = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    const panel = document.getElementById('relation-list-panel');
    expect(panel?.hidden).toBe(true);
    view.rerender(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    expect(panel?.hidden).toBe(false);
    expect(
      view.container.querySelector('[data-compact="false"]')
    ).not.toBeNull();
    expect(
      screen.queryByRole('button', { name: /collapseRelationList/ })
    ).toBeNull();
    expect(view.container.querySelectorAll('[data-person-id]')).toHaveLength(2);
    act(() => ResizeObserverMock.root?.resize(390, 592));
    expect(panel?.hidden).toBe(true);
    const toggle = screen.getByRole('button', { name: /relationList/ });
    fireEvent.click(toggle);
    expect(panel?.hidden).toBe(false);
    fireEvent.keyDown(panel!, { key: 'Escape' });
    expect(panel?.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  test('loading, retry, empty search, and truncation remain accessible', () => {
    state.graph = null;
    state.loading = true;
    const view = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    expect(screen.getAllByText('Loading')).toHaveLength(2);
    state.loading = false;
    state.error = new Error('Network unavailable');
    view.rerender(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.mutate).toHaveBeenCalledTimes(1);
    state.error = null;
    state.graph = { ...graph, truncated: true };
    view.rerender(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    expect(
      screen.getByText('com.affine.localmind.workbench.v9.graphTruncated')
    ).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: '不存在' },
    });
    expect(
      screen.getByText('com.affine.localmind.workbench.v9.graphFilterEmpty')
    ).toBeTruthy();
  });

  test('whole-order and individual requirement selections highlight the same single graph summary', async () => {
    state.graph = {
      ...graph,
      edges: [
        {
          ...graph.edges[0],
          requirementItems: [
            { id: 'budget', title: '预算', kind: 'file' },
            { id: 'timeline', title: '排期', kind: 'text' },
          ],
        },
      ],
    };
    const view = render(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    const card = view.container.querySelector('#relation-list-items > li')!;
    const order = card.querySelector<HTMLButtonElement>(
      'button[title="预算与排期"]'
    )!;
    fireEvent.click(order);
    expect(
      view.container.querySelectorAll('[data-relation-id][data-active="true"]')
    ).toHaveLength(1);
    fireEvent.click(order);
    expect(
      view.container.querySelectorAll('[data-relation-id][data-active="true"]')
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /graphShowDetails/ }));
    expect(screen.getByText('附上批准人和日期')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /graphHideDetails/ }));
    expect(
      view.container.querySelectorAll('[data-relation-id][data-active="true"]')
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole('button', { name: /graphTextItem.*排期/ })
    );
    expect(
      view.container.querySelectorAll('[data-relation-id][data-active="true"]')
    ).toHaveLength(1);
    expect(
      view.container
        .querySelector('[data-relation-id="order-1"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(
      view.container
        .querySelector('[data-item-id][data-active="true"]')
        ?.getAttribute('stroke')
    ).toBe('var(--relation-selected)');
    expect(card.querySelectorAll('li[data-active="true"]')).toHaveLength(1);
    expect(
      card
        .querySelector('[data-list-requirement-id="timeline"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
  });

  test('selecting an offscreen item reveals it, clears hidden peer search and preserves user scroll on data refresh', () => {
    state.graph = {
      ...graph,
      edges: Array.from({ length: 25 }, (_, i) => ({
        ...graph.edges[0],
        id: `order-${i}`,
        label: `任务总结 ${i}`,
        requirementItems: [{ id: `r-${i}`, title: `交付 ${i}`, kind: 'file' }],
      })),
    };
    const view = render(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'no-match' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /graphFileItem.*交付 24$/ })
    );
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    expect(Number(region.dataset.cameraY)).toBeGreaterThan(1000);
    expect(
      view.container
        .querySelector('[data-relation-id="order-24"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    fireEvent.wheel(region, { deltaY: -500 });
    const position = region.dataset.cameraY;
    state.graph = { ...(state.graph as typeof graph) };
    view.rerender(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    expect(region.dataset.cameraY).toBe(position);
  });

  test('wheel zoom stays anchored at the viewport centre regardless of pointer position', () => {
    const { container } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    const x = region.dataset.cameraX;
    const y = region.dataset.cameraY;
    const world = container.querySelector<HTMLElement>('[data-graph-world]')!;
    const geometry = world.innerHTML;
    // happy-dom's WheelEvent extends UIEvent and omits mouse modifiers.
    const zoomWheel = (modifiers: {
      ctrlKey?: boolean;
      metaKey?: boolean;
      clientX: number;
      clientY: number;
    }) =>
      fireEvent(
        region,
        Object.assign(
          new WheelEvent('wheel', {
            deltaY: -60,
            bubbles: true,
            cancelable: true,
          }),
          modifiers
        )
      );
    zoomWheel({ ctrlKey: true, clientX: 0, clientY: 0 });
    const topLeftZoom = region.dataset.zoom;
    expect(Number(topLeftZoom)).toBeGreaterThan(1);
    expect(region.dataset.cameraX).toBe(x);
    expect(region.dataset.cameraY).toBe(y);
    expect(world.innerHTML).toBe(geometry);
    fireEvent.click(screen.getByRole('button', { name: /graphResetZoom/ }));
    zoomWheel({ metaKey: true, clientX: 899, clientY: 519 });
    expect(region.dataset.zoom).toBe(topLeftZoom);
    expect(region.dataset.cameraX).toBe(x);
    expect(region.dataset.cameraY).toBe(y);
  });

  test('blank-space dragging pans only the camera; summaries cannot be dragged and Space permits panning over them', () => {
    const { container } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    const summary = container.querySelector<HTMLElement>('[data-relation-id]')!;
    fireEvent.click(screen.getByRole('button', { name: /graphZoomIn/ }));
    const before = region.dataset.cameraX;
    const down = {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 450,
      clientY: 260,
    };
    const move = { ...down, clientX: 500, clientY: 300 };
    fireEvent.pointerDown(summary, down);
    fireEvent.pointerMove(summary, move);
    fireEvent.pointerUp(summary, move);
    expect(region.dataset.cameraX).toBe(before);
    const style = summary.parentElement!.getAttribute('style');
    fireEvent.pointerDown(region, down);
    fireEvent.pointerMove(region, move);
    fireEvent.pointerUp(region, move);
    expect(Number(region.dataset.cameraX)).toBeLessThan(Number(before));
    expect(summary.parentElement!.getAttribute('style')).toBe(style);
    const panned = region.dataset.cameraX;
    fireEvent.keyDown(region, { code: 'Space', key: ' ' });
    fireEvent.pointerDown(summary, down);
    fireEvent.pointerMove(summary, { ...move, clientX: 400 });
    fireEvent.pointerUp(summary, move);
    fireEvent.keyUp(region, { code: 'Space', key: ' ' });
    expect(Number(region.dataset.cameraX)).toBeGreaterThan(Number(panned));
    fireEvent.click(summary);
    expect(summary.getAttribute('aria-pressed')).toBe('false');
    fireEvent.pointerDown(summary, down);
    fireEvent.pointerUp(summary, down);
    fireEvent.click(summary);
    expect(summary.getAttribute('aria-pressed')).toBe('true');
  });

  test('touch pinch and single-finger pan move the view, and cancelled gestures release the camera', () => {
    render(<CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />);
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    const first = {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 350,
      clientY: 260,
    };
    const second = { ...first, pointerId: 2, clientX: 550 };
    fireEvent.pointerDown(region, first);
    fireEvent.pointerDown(region, second);
    fireEvent.pointerMove(region, { ...second, clientX: 650 });
    expect(Number(region.dataset.zoom)).toBeCloseTo(1.5);
    expect(Number(region.dataset.cameraX)).toBe(450);
    fireEvent.pointerUp(region, second);
    fireEvent.pointerMove(region, { ...first, clientX: 400 });
    expect(Number(region.dataset.cameraX)).toBeLessThan(450);
    fireEvent.pointerCancel(region, first);
    expect(region.dataset.panning).toBe('false');
    const x = region.dataset.cameraX;
    fireEvent.pointerMove(region, { ...first, clientX: 500 });
    expect(region.dataset.cameraX).toBe(x);
  });

  test('touch capture can transfer from a summary to the viewport without cancelling the pan', () => {
    const { container } = render(
      <CollaborationGraph projectFilter="" onOpenRelation={vi.fn()} />
    );
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    const summary = container.querySelector<HTMLElement>('[data-relation-id]')!;
    fireEvent.click(screen.getByRole('button', { name: /graphZoomIn/ }));
    const touch = {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 450,
      clientY: 260,
    };
    fireEvent.pointerDown(summary, touch);
    fireEvent.pointerMove(summary, { ...touch, clientX: 470 });
    const x = Number(region.dataset.cameraX);
    fireEvent.lostPointerCapture(summary, touch);
    fireEvent.pointerMove(region, { ...touch, clientX: 490 });
    expect(Number(region.dataset.cameraX)).toBeLessThan(x);
    fireEvent.pointerUp(region, touch);
    expect(region.dataset.panning).toBe('false');
  });

  test('selection, locating, resizing and refresh preserve scale; fitting shows every order with bounded panning', () => {
    state.graph = {
      ...graph,
      edges: Array.from({ length: 25 }, (_, i) => ({
        ...graph.edges[0],
        id: `order-${i}`,
        label: `总结 ${i}`,
        requirementItems: [{ id: `r-${i}`, title: `交付 ${i}`, kind: 'file' }],
      })),
    };
    const view = render(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    const region = screen.getByRole('region', { name: /graphKeyboardHint/ });
    fireEvent.click(screen.getByRole('button', { name: /graphExpandPerson/ }));
    fireEvent.click(screen.getByRole('button', { name: /graphZoomIn/ }));
    const zoom = region.dataset.zoom;
    fireEvent.click(
      screen.getByRole('button', { name: /graphFileItem.*交付 24$/ })
    );
    expect(region.dataset.zoom).toBe(zoom);
    expect(Number(region.dataset.cameraY)).toBeGreaterThan(1800);
    const selectedY = region.dataset.cameraY;
    fireEvent.click(
      screen.getByRole('button', { name: /graphFileItem.*交付 24$/ })
    );
    expect(region.dataset.cameraY).toBe(selectedY);
    fireEvent.wheel(region, { deltaY: -1200 });
    fireEvent.click(
      screen.getByRole('button', { name: /graphLocateSelection/ })
    );
    expect(region.dataset.cameraY).toBe(selectedY);
    act(() => ResizeObserverMock.host?.resize(700, 440));
    expect(region.dataset.zoom).toBe(zoom);
    state.graph = { ...(state.graph as typeof graph) };
    view.rerender(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
      />
    );
    expect(region.dataset.zoom).toBe(zoom);
    fireEvent.click(screen.getByRole('button', { name: /graphFitView/ }));
    expect(Number(region.dataset.zoom)).toBeLessThan(0.3);
    const fitted = [region.dataset.cameraX, region.dataset.cameraY];
    fireEvent.wheel(region, { deltaX: 1e6, deltaY: 1e6 });
    expect([region.dataset.cameraX, region.dataset.cameraY]).toEqual(fitted);
    expect(view.container.querySelectorAll('[data-relation-id]')).toHaveLength(
      25
    );
    fireEvent.keyDown(region, { key: '+' });
    expect(Number(region.dataset.zoom)).toBeGreaterThan(0.2);
    fireEvent.keyDown(region, { key: '0' });
    expect(Number(region.dataset.zoom)).toBe(1);
    fireEvent.keyDown(region, { key: 'Home' });
    expect(Number(region.dataset.zoom)).toBeLessThan(0.3);
  });

  test('filters use delivery responsibility, detail fetch errors are retryable, and enlarge preserves selection', () => {
    state.graph = {
      ...graph,
      edges: [
        graph.edges[0],
        { ...graph.edges[0], id: 'mine', from: 'b', to: 'a', status: 'open' },
        { ...graph.edges[0], id: 'ended', status: 'cancelled' },
      ],
    };
    const expand = vi.fn();
    const view = render(
      <CollaborationGraph
        projectFilter=""
        onOpenRelation={vi.fn()}
        workspaceExpanded
        onExpandWorkspace={expand}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /graphFilterMine/ }));
    expect(
      view.container.querySelectorAll('#relation-list-items > li')
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /graphFilterEnded/ }));
    expect(
      view.container.querySelectorAll('#relation-list-items > li')
    ).toHaveLength(1);
    fireEvent.click(
      view.container.querySelector('#relation-list-items button[title]')!
    );
    fireEvent.click(screen.getByRole('button', { name: /graphEnlargeView/ }));
    expect(expand).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[data-enlarged="true"]')).toBeTruthy();
    expect(
      view.container
        .querySelector('[data-relation-id="ended"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    state.detailsError = new Error('Details unavailable');
    fireEvent.click(screen.getByRole('button', { name: /graphShowDetails/ }));
    expect(screen.getByRole('alert').textContent).toContain(
      'Details unavailable'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.mutate).toHaveBeenCalled();
  });
});
