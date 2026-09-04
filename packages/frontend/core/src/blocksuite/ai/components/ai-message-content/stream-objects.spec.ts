/**
 * @vitest-environment happy-dom
 */
import { describe, expect, test } from 'vitest';

import { StreamObjectSchema } from '../ai-chat-messages/type';
import { officeToolResultView } from './stream-objects';

describe('Office tool result presentation', () => {
  test('states that an approval request has not created a revision', () => {
    const view = officeToolResultView('office_command_request', {
      success: true,
      approvalRequired: true,
      taskId: 'task-1',
      commandCount: 1,
      previewSummary: { operation: 'office.document.text.format' },
    });

    expect(view.status).toBe('success');
    if (view.status !== 'success') return;
    expect(view.name).toBe('Office change awaiting approval');
    expect(view.results[0]?.title).toBe('Approval required');
    expect(view.results[0]?.content).toContain(
      'No Office revision has been created'
    );
    expect(view.results[0]?.content).not.toMatch(
      /completed|modification done/i
    );
  });

  test('renders bounded read and persisted batch evidence without completion claims', () => {
    const read = officeToolResultView('office_read', {
      revisionId: 'revision-4',
      sequence: 4,
      truncated: false,
    });
    expect(read).toEqual({
      status: 'success',
      kind: 'read',
      name: 'Read Revision 4',
      results: [
        {
          title: 'Revision 4',
          content:
            'Bounded native Office semantic state was read successfully.',
        },
      ],
    });

    const batch = officeToolResultView('office_command_batch_request', {
      success: true,
      approvalRequired: false,
      taskId: 'task-2',
      commandCount: 3,
      previewSummary: { operation: 'office.command.batch' },
    });
    expect(batch.status).toBe('success');
    if (batch.status !== 'success') return;
    expect(batch.name).toBe('Office change request saved');
    expect(batch.results[0]?.content).toContain(
      'Execution status is available from the persisted Office task'
    );
    expect(batch.results[1]?.content).toContain('Commands: 3');
  });

  test('preserves and renders native Office tool execution errors', () => {
    const parsed = StreamObjectSchema.parse({
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'office_read',
      args: { selector: '{"kind":"pdf","page_index":0}' },
      result: { message: 'selector validation failed' },
      isError: true,
    });
    expect(parsed.type).toBe('tool-result');
    if (parsed.type !== 'tool-result') return;
    expect(parsed.isError).toBe(true);
    expect(
      officeToolResultView(parsed.toolName, parsed.result, parsed.isError)
    ).toEqual({ status: 'error', name: 'Office read failed' });
  });
});
