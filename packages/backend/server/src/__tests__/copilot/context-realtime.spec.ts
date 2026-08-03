import test from 'ava';
import sinon from 'sinon';

import { CopilotEmbeddingRealtimeProvider } from '../../plugins/copilot/context/realtime';

test('document embedding events are ignored when realtime publisher is unavailable', async t => {
  const getConfig = sinon.stub();
  const provider = new CopilotEmbeddingRealtimeProvider(
    {} as any,
    { copilotContext: { getConfig } } as any,
    {} as any,
    undefined as any
  );

  await provider.onDocEmbedFinished({
    contextId: 'context-id',
    workspaceId: 'workspace-id',
  } as any);
  await provider.onDocEmbedFailed({
    workspaceId: 'workspace-id',
  } as any);

  t.false(getConfig.called);
});
