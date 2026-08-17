import ava, { type TestFn } from 'ava';
import Sinon from 'sinon';

import { ExternalMcpConnectionResolver } from '../../plugins/copilot/external-mcp/resolver';

const test = ava.serial as TestFn;

test('settings read requires permission and projects fixed transport settings', async t => {
  const get = Sinon.stub().resolves({
    id: 'connection-1',
    workspaceId: 'workspace-1',
    endpoint: 'http://database-drift.invalid/mcp',
    protocolVersion: 'database-drift',
    enabledToolNames: [],
    toolCatalog: [],
  });
  const assert = Sinon.stub().resolves();
  const access = {
    workspace: Sinon.stub().returnsThis(),
    allowLocal: Sinon.stub().returnsThis(),
    assert,
  };
  const resolver = new ExternalMcpConnectionResolver(
    {
      endpoint: 'http://192.168.20.252:18791/mcp',
      get,
      catalog: Sinon.stub().returns([]),
    } as any,
    { user: Sinon.stub().returns(access) } as any
  );

  const settings = await resolver.externalMcpSettings(
    { id: 'user-1' } as any,
    'workspace-1'
  );

  t.true(assert.calledWith('Workspace.Settings.Read'));
  t.is(settings.endpoint, 'http://192.168.20.252:18791/mcp');
  t.is(settings.connection?.endpoint, settings.endpoint);
  t.is(settings.connection?.protocolVersion, '2025-06-18');
});

test('resolver rejects unauthorized connection changes before using a ticket', async t => {
  const connect = Sinon.stub();
  const assert = Sinon.stub().rejects(new Error('permission denied'));
  const access = {
    workspace: Sinon.stub().returnsThis(),
    allowLocal: Sinon.stub().returnsThis(),
    assert,
  };
  const ac = { user: Sinon.stub().returns(access) };
  const resolver = new ExternalMcpConnectionResolver(
    { connect } as any,
    ac as any
  );

  await t.throwsAsync(
    resolver.connectExternalMcp({ id: 'user-1' } as any, {
      workspaceId: 'workspace-1',
      name: 'SparkClaw MCP',
      accessTicket: 'ticket-must-not-be-used',
    }),
    { message: 'permission denied' }
  );

  t.true(ac.user.calledWith('user-1'));
  t.true(access.workspace.calledWith('workspace-1'));
  t.true(assert.calledWith('Workspace.Settings.Update'));
  t.false(connect.called);
});
