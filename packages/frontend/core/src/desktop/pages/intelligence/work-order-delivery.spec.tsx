/** @vitest-environment happy-dom */
import { setWorkOrderDeliveryDraftItemMutation } from '@affine/graphql';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({
  gql: vi.fn(),
  mutate: vi.fn(),
  order: null as Record<string, unknown> | null,
}));

vi.mock('@affine/component', () => ({
  Button: ({
    children,
    loading: _loading,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    loading?: boolean;
    variant?: string;
  }) => <button {...props}>{children}</button>,
  IconButton: ({
    icon: _icon,
    size: _size,
    ...props
  }: Record<string, unknown>) => <button {...props} />,
  Loading: () => <span>Loading</span>,
  notify: { error: vi.fn() },
}));
vi.mock('@affine/core/components/hooks/use-query', () => ({
  useQuery: () => ({
    data: { currentUser: { copilot: { myWorkOrder: state.order } } },
    error: null,
    isLoading: false,
    mutate: state.mutate,
  }),
}));
vi.mock('@affine/core/modules/cloud', () => ({ GraphQLService: class {} }));
vi.mock('@affine/core/modules/project-resources/realtime', () => ({
  useProjectRefresh: vi.fn(),
}));
vi.mock('@affine/core/modules/project-resources/error', () => ({
  projectErrorMessage: (error: Error) => error.message,
}));
vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));
vi.mock('@toeverything/infra', () => ({
  useService: () => ({ gql: state.gql }),
}));

import { WorkOrderPanel } from './work-order-panel';

beforeEach(() => {
  localStorage.clear();
  state.gql.mockReset();
  state.mutate.mockReset();
  state.order = {
    id: 'order-1',
    title: 'Review report',
    purpose: 'Review the report',
    status: 'active',
    version: 1,
    relationKind: 'review',
    viewerRole: 'recipient',
    requirements: [
      {
        id: 'summary',
        kind: 'text',
        title: 'Summary',
        instructions: 'Write a summary',
        required: true,
      },
    ],
    deliveryDraft: {
      version: 1,
      items: [{ requirementId: 'summary', text: 'Saved text', blobIds: [] }],
      checks: [],
    },
    stagedBlobs: [],
    deliveries: [],
    exchanges: [],
  };
});
afterEach(() => {
  localStorage.clear();
});

test('editing a ready delivery blocks confirmation until the new text is saved', async () => {
  const onDraftStateChange = vi.fn();
  const view = render(
    <WorkOrderPanel
      workOrderId="order-1"
      onDraftStateChange={onDraftStateChange}
    />
  );
  await waitFor(() =>
    expect(onDraftStateChange).toHaveBeenLastCalledWith('order-1', false)
  );
  fireEvent.change(screen.getByDisplayValue('Saved text'), {
    target: { value: 'Updated text' },
  });
  await waitFor(() =>
    expect(onDraftStateChange).toHaveBeenLastCalledWith('order-1', true)
  );
  state.gql.mockImplementation(async ({ query, variables }) => {
    expect(query).toBe(setWorkOrderDeliveryDraftItemMutation);
    expect(variables).toMatchObject({
      workOrderId: 'order-1',
      requirementId: 'summary',
      expectedDraftVersion: 1,
      text: 'Updated text',
    });
    state.order = {
      ...state.order,
      deliveryDraft: {
        version: 2,
        items: [
          { requirementId: 'summary', text: 'Updated text', blobIds: [] },
        ],
        checks: [],
      },
    };
    return { setWorkOrderDeliveryDraftItem: { version: 2 } };
  });
  state.mutate.mockImplementation(async () => {
    view.rerender(
      <WorkOrderPanel
        workOrderId="order-1"
        onDraftStateChange={onDraftStateChange}
      />
    );
  });
  fireEvent.click(
    screen.getByRole('button', {
      name: 'com.affine.localmind.workbench.v9.saveDeliveryDraft',
    })
  );
  await waitFor(() => expect(state.gql).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(onDraftStateChange).toHaveBeenLastCalledWith('order-1', false)
  );
});
