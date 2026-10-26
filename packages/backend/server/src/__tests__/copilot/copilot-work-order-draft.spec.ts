import test from 'ava';

import type { Models } from '../../models';
import { executeToolCall } from '../../plugins/copilot/runtime/tool/bridge';
import { createWorkOrderDraftTools } from '../../plugins/copilot/tools/work-order';

const recipient = {
  id: 'recipient-id',
  name: 'Recipient',
  email: 'recipient@example.com',
};
const models = {
  copilotWorkOrder: {
    resolveRecipient: async () => recipient,
  },
} as unknown as Models;
const scope = {
  actorId: 'actor-id',
  sourceSessionId: 'source-session-id',
  turnId: 'turn-id',
};
const input = {
  recipients: [
    {
      recipient_exact: recipient.email,
      title: 'Demo work order',
      purpose: 'Exercise the relationship graph',
      relation_kind: 'original',
      requirements: [
        {
          kind: 'text',
          title: 'Short reply',
          instructions: 'Reply with one sentence',
          required: true,
          accepted_mime_types: [],
          min_count: 1,
          max_count: 1,
        },
      ],
    },
  ],
};

test('identical work-order drafts in one turn reuse one ID', async t => {
  const tools = createWorkOrderDraftTools(models, scope);
  const first = (await tools.work_order_draft.execute?.(input, {})) as {
    draftId: string;
  };
  const repeated = (await tools.work_order_draft.execute?.(input, {})) as {
    draftId: string;
  };
  const nextTurn = (await createWorkOrderDraftTools(models, {
    ...scope,
    turnId: 'next-turn',
  }).work_order_draft.execute?.(input, {})) as { draftId: string };

  t.regex(
    first.draftId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
  );
  t.is(repeated.draftId, first.draftId);
  t.not(nextTurn.draftId, first.draftId);
});

for (const relatedId of [null, undefined]) {
  test(`original work-order draft accepts ${relatedId === null ? 'explicit null' : 'omitted'} related ID through the tool bridge`, async t => {
    const tools = createWorkOrderDraftTools(models, scope);
    const result = await executeToolCall(
      tools,
      {
        name: 'work_order_draft',
        callId: 'draft-call',
        args: {
          recipients: input.recipients.map(draft => ({
            ...draft,
            ...(relatedId === null ? { related_work_order_id: null } : {}),
          })),
        },
      },
      {}
    );
    t.not(result.isError, true);
    const output = result.output as {
      confirmationRequired: boolean;
      recipients: Array<{ relatedWorkOrderId: null; relationKind: string }>;
    };
    t.true(output.confirmationRequired);
    t.is(output.recipients[0].relatedWorkOrderId, null);
    t.is(output.recipients[0].relationKind, 'original');
  });
}
