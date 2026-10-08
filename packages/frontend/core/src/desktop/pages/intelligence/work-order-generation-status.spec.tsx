/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/i18n', () => ({
  useI18n: () => new Proxy({}, { get: (_, key) => () => String(key) }),
}));

import { WorkOrderGenerationStatus } from './work-order-generation-status';

type StatusOrder = Parameters<typeof WorkOrderGenerationStatus>[0]['order'];
function order(): StatusOrder {
  return {
    viewerRole: 'recipient',
    status: 'open',
    requirements: [
      {
        id: 'cpu',
        itemKey: 'cpu',
        kind: 'file',
        title: 'CPU Markdown document',
        instructions: 'Explain CPU concepts',
        required: true,
        acceptedMimeTypes: ['text/markdown'],
        minCount: 1,
        maxCount: 1,
        validationMode: 'mime_and_container',
      },
    ],
    deliveryDraft: {
      workOrderId: 'order',
      orderVersion: 1,
      version: 0,
      ready: false,
      updatedAt: null,
      confirmationToken: null,
      items: [],
      checks: [
        {
          requirementId: 'cpu',
          ready: false,
          reason: 'File count does not match',
          supportedGenerationFormats: ['md'],
          generation: {
            runId: 'failed-run',
            status: 'failed',
            format: 'txt',
            failureCode: 'mime_mismatch',
          },
        },
      ],
    },
  };
}
afterEach(cleanup);

test('failed generation shows recovery, a new attempt shows pending, and a valid draft clears both', () => {
  const value = order();
  const view = render(<WorkOrderGenerationStatus order={value} />);
  expect(screen.getByRole('alert').textContent).toContain(
    'fileGenerationFormatMismatch'
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'fileGenerationRecovery'
  );
  expect(screen.getByRole('alert').textContent).toContain(
    'CPU Markdown document'
  );
  expect(screen.queryByRole('status')).toBeNull();
  const check = value.deliveryDraft!.checks[0];
  check.generation = {
    ...check.generation!,
    runId: 'new-run',
    status: 'queued',
    failureCode: null,
    format: 'md',
  };
  view.rerender(<WorkOrderGenerationStatus order={value} />);
  expect(screen.getByRole('status').textContent).toContain(
    'fileGenerationPending'
  );
  expect(screen.queryByRole('alert')).toBeNull();
  check.ready = true;
  check.generation.status = 'completed';
  view.rerender(<WorkOrderGenerationStatus order={value} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

test('private generation failures are hidden for senders, completed and cancelled work orders', () => {
  for (const override of [
    { viewerRole: 'sender' },
    { status: 'delivered' },
    { status: 'cancelled' },
  ]) {
    const view = render(
      <WorkOrderGenerationStatus order={{ ...order(), ...override }} />
    );
    expect(view.container.textContent).toBe('');
    view.unmount();
  }
});
