/** @vitest-environment happy-dom */
import { setWorkOrderDeliveryDraftItemMutation } from '@affine/graphql';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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
    prefix: _prefix,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    children?: ReactNode;
    loading?: boolean;
    variant?: string;
    prefix?: ReactNode;
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
  cleanup();
  vi.unstubAllGlobals();
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

const key = (name: string) => `com.affine.localmind.workbench.v9.${name}`;
const file = new File(['presentation'], 'report.pptx', {
  type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
});
const blob = {
  id: 'file-new',
  requirementId: 'slides',
  fileName: file.name,
  mimeType: file.type,
  byteSize: file.size,
};
function fileOrder(maxCount = 1) {
  state.order = {
    ...state.order,
    status: 'open',
    requirements: [
      {
        id: 'slides',
        kind: 'file',
        title: 'Slides',
        instructions: 'Upload slides',
        acceptedMimeTypes: [file.type],
        maxCount,
        required: true,
      },
    ],
    deliveryDraft: { version: 1, items: [], checks: [] },
  };
}
const selectFiles = (files: File[]) =>
  fireEvent.change(screen.getByLabelText('Slides'), { target: { files } });

test('uploads once while busy and exposes the saved file with a replace action', async () => {
  fileOrder();
  let finish!: (response: Response) => void;
  const fetch = vi.fn(
    () =>
      new Promise<Response>(resolve => {
        finish = resolve;
      })
  );
  vi.stubGlobal('fetch', fetch);
  render(<WorkOrderPanel workOrderId="order-1" />);
  expect(screen.getByLabelText('Slides').hasAttribute('hidden')).toBe(true);
  selectFiles([file]);
  expect(
    screen
      .getByRole('button', { name: key('uploading') })
      .hasAttribute('disabled')
  ).toBe(true);
  selectFiles([file]);
  expect(fetch).toHaveBeenCalledTimes(1);
  finish(Response.json(blob));
  await screen.findByText('report.pptx');
  await screen.findByRole('button', { name: key('replaceDeliveryFiles') });
  expect(state.gql).not.toHaveBeenCalled();
});

test('keeps a failed upload inline, hides raw server text, and allows the same file again', async () => {
  fileOrder();
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      new Response('private server details', { status: 415 })
    )
    .mockResolvedValueOnce(Response.json(blob));
  vi.stubGlobal('fetch', fetch);
  render(<WorkOrderPanel workOrderId="order-1" />);
  selectFiles([file]);
  expect((await screen.findByRole('alert')).textContent).toBe(
    key('deliveryFileInvalid')
  );
  expect(screen.queryByText('private server details')).toBeNull();
  await waitFor(() =>
    expect(
      screen
        .getByRole('button', { name: key('uploadDeliveryFiles') })
        .hasAttribute('disabled')
    ).toBe(false)
  );
  selectFiles([file]);
  await screen.findByText('report.pptx');
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('rejects oversized selections and empty files before sending any request', () => {
  fileOrder();
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  render(<WorkOrderPanel workOrderId="order-1" />);
  selectFiles([file, file]);
  expect(screen.getByRole('alert').textContent).toBe(
    key('deliveryFileCountError')
  );
  selectFiles([new File([], 'empty.pptx')]);
  expect(screen.getByRole('alert').textContent).toBe(
    key('deliveryFileSizeError')
  );
  expect(fetch).not.toHaveBeenCalled();
});

test('replaces a multiple-file selection using the expected draft version', async () => {
  fileOrder(3);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(blob)));
  render(<WorkOrderPanel workOrderId="order-1" />);
  selectFiles([file]);
  await waitFor(() =>
    expect(state.gql).toHaveBeenCalledWith({
      query: setWorkOrderDeliveryDraftItemMutation,
      variables: {
        workOrderId: 'order-1',
        requirementId: 'slides',
        expectedDraftVersion: 2,
        blobIds: ['file-new'],
      },
    })
  );
});

test('keeps successfully staged files visible when a later file upload fails', async () => {
  fileOrder(3);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(blob))
      .mockRejectedValueOnce(new TypeError('Network failed'))
  );
  render(<WorkOrderPanel workOrderId="order-1" />);
  selectFiles([file, new File(['x'], 'second.pptx', { type: file.type })]);
  await screen.findByRole('alert');
  expect(screen.getByText('report.pptx')).toBeTruthy();
  expect(state.gql).not.toHaveBeenCalled();
});

test('shows the receipt for delivered orders and only opens draft controls on request', async () => {
  fileOrder();
  state.order = {
    ...state.order,
    status: 'delivered',
    deliveries: [
      {
        id: 'receipt-1',
        revision: 1,
        submittedAt: new Date().toISOString(),
        receiptFingerprint: 'receipt',
        items: [{ ...blob, blobId: blob.id }],
      },
    ],
    deliveryDraft: {
      version: 1,
      items: [],
      checks: [
        {
          requirementId: 'slides',
          ready: false,
          reason: 'A selected file is unavailable or does not match',
        },
      ],
    },
  };
  render(<WorkOrderPanel workOrderId="order-1" />);
  expect(screen.queryByLabelText('Slides')).toBeNull();
  expect(screen.queryByText(key('checkFileUnavailable'))).toBeNull();
  expect(screen.getAllByRole('link', { name: file.name })).toHaveLength(2);
  fireEvent.click(
    screen.getByRole('button', { name: key('prepareNewDelivery') })
  );
  expect(
    screen.getByRole('button', { name: key('uploadDeliveryFiles') })
  ).toBeTruthy();
  expect(screen.getByText(key('newDeliveryHint'))).toBeTruthy();
  expect(state.gql).not.toHaveBeenCalled();
});
