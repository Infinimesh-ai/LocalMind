import '../src/prelude';

import assert from 'node:assert/strict';

import type { PermissionService } from '../src/core/permission';
import type { Models } from '../src/models';
import { ContextScopeResolver } from '../src/plugins/copilot/context-scope-resolver';
import type { PromptMessage } from '../src/plugins/copilot/providers/types';
import {
  CONTEXT_PLANNER_STRATEGY_VERSION,
  ContextPlanner,
  SYSTEM_CONTEXT_PLANNER_STRATEGY_VERSION,
} from '../src/plugins/copilot/runtime/context-planner';

const planner = new ContextPlanner();
const turns = [{ role: 'user' as const, content: 'What is the codename?' }];
const memories = [
  {
    id: 'memory-a',
    scope: 'project' as const,
    kind: 'auto_memory' as const,
    content: 'The project codename is Juniper.',
  },
];
const render = (plannedTurns: PromptMessage[]) => [
  { role: 'system' as const, content: 'Base prompt' },
  ...plannedTurns,
];
const active = planner.plan({ turns, memories, render });
assert.equal(
  active.diagnostics.strategyVersion,
  CONTEXT_PLANNER_STRATEGY_VERSION
);
assert.equal(
  active.messages.find(message => message.role === 'system')?.content,
  'Base prompt'
);
assert.ok(
  active.messages.some(
    message => message.role === 'user' && message.content.includes('Juniper')
  )
);
assert.equal(JSON.stringify(active.trace).includes('Juniper'), false);
assert.deepEqual(active.trace.candidateMemoryIds, ['memory-a']);

const v4 = planner.plan(
  { turns, memories, render },
  SYSTEM_CONTEXT_PLANNER_STRATEGY_VERSION
);
assert.ok(
  v4.messages.some(
    message => message.role === 'system' && message.content.includes('Juniper')
  )
);

const memberships = [
  { docId: 'doc-a', projectId: 'project-a' },
  { docId: 'doc-b', projectId: 'project-b' },
];
const scopeResolver = new ContextScopeResolver(
  {
    copilotContext: {
      listSessionDocIds: async () => ['doc-a', 'doc-b', 'doc-denied'],
    },
    copilotContextMemory: {
      listProjectMembershipsForDocs: async () => memberships,
    },
  } as unknown as Models,
  {
    filterReadableDocs: async (input: { docs: Array<{ docId: string }> }) =>
      input.docs.filter(doc => doc.docId !== 'doc-denied'),
  } as unknown as PermissionService
);
const scope = await scopeResolver.resolve({
  userId: 'user-a',
  workspaceId: 'workspace-a',
  sessionId: 'session-a',
});
assert.deepEqual(scope.readableDocIds, ['doc-a', 'doc-b']);
assert.deepEqual(scope.projectIds, []);
assert.equal(scope.projectResolution, 'ambiguous');

console.log('Context memory scope smoke passed.');
