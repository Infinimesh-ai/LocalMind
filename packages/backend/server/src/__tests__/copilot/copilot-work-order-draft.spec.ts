import test from 'ava';

import type { Models } from '../../models';
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
