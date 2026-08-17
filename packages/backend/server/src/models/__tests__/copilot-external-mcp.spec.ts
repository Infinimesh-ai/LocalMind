import { ExternalMcpConnectionStatus } from '@prisma/client';
import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';

import { CopilotExternalMcpModel } from '../copilot-external-mcp';

const test = ava.serial as TestFn;

class TestingCopilotExternalMcpModel extends CopilotExternalMcpModel {
  constructor(private readonly testingDb: any) {
    super();
  }

  protected override get db() {
    return this.testingDb;
  }
}

test('reauthentication failure clears the unusable encrypted session', async t => {
  const update = Sinon.stub().resolves({});
  const model = new TestingCopilotExternalMcpModel({
    aiExternalMcpConnection: { update },
  });

  await model.recordFailure(
    'connection-1',
    ExternalMcpConnectionStatus.REAUTH_REQUIRED,
    'mcp_session_invalid',
    'Session expired'
  );

  t.deepEqual(update.firstCall.args[0].data, {
    status: ExternalMcpConnectionStatus.REAUTH_REQUIRED,
    encryptedSessionId: null,
    sessionFingerprint: null,
    lastCheckedAt: update.firstCall.args[0].data.lastCheckedAt,
    lastErrorCode: 'mcp_session_invalid',
    lastErrorMessage: 'Session expired',
  });
  t.true(update.firstCall.args[0].data.lastCheckedAt instanceof Date);
});
