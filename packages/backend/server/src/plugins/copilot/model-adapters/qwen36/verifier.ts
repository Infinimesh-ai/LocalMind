import type {
  Qwen36CompletionContract,
  Qwen36CompletionRequirement,
} from './completion-contract';

export type Qwen36ToolExecutionEvidence = {
  argsFingerprint?: string;
  toolName: string;
  status: 'completed' | 'failed';
  sideEffectApplied?: boolean;
  effectSatisfied?: boolean;
  relation?: 'created' | 'updated';
  workspaceEffect?: {
    operation:
      | 'create_folder'
      | 'rename_folder'
      | 'move_folder'
      | 'delete_folder'
      | 'add_document'
      | 'remove_document'
      | 'move_document';
  };
};

function distinctExecutions(
  executions: readonly Qwen36ToolExecutionEvidence[]
) {
  const fingerprints = new Set<string>();
  let unprovable = 0;
  for (const execution of executions) {
    if (execution.argsFingerprint) {
      fingerprints.add(execution.argsFingerprint);
    } else {
      unprovable += 1;
    }
  }
  return fingerprints.size + Math.min(unprovable, 1);
}

export type Qwen36CompletionVerification =
  | { ok: true }
  | { ok: false; code: string; reason: string };

function matchesRequirement(
  execution: Qwen36ToolExecutionEvidence,
  requirement: Qwen36CompletionRequirement
) {
  return (
    execution.status === 'completed' &&
    requirement.toolNames.includes(execution.toolName) &&
    (!requirement.documentRelation ||
      execution.relation === requirement.documentRelation) &&
    (!requirement.workspaceOperation ||
      execution.workspaceEffect?.operation === requirement.workspaceOperation)
  );
}

export function verifyQwen36ToolCompletion(input: {
  answer: string;
  contract: Qwen36CompletionContract;
  executions: readonly Qwen36ToolExecutionEvidence[];
}): Qwen36CompletionVerification {
  if (!input.answer.trim()) {
    return {
      ok: false,
      code: 'empty_final_answer',
      reason: 'The model ended without a final result.',
    };
  }
  if (!input.executions.length) {
    return {
      ok: false,
      code: 'missing_tool_evidence',
      reason: 'The tool task ended without executing any tool.',
    };
  }

  const completed = input.executions.filter(
    execution => execution.status === 'completed'
  );
  if (!completed.length) {
    return {
      ok: false,
      code: 'all_tool_executions_failed',
      reason: 'Every recorded tool execution failed.',
    };
  }
  for (const requirement of input.contract.requirements) {
    const matching = completed.filter(execution =>
      matchesRequirement(execution, requirement)
    );
    const distinctMatching = distinctExecutions(matching);
    if (distinctMatching < requirement.minimumExecutions) {
      return {
        ok: false,
        code: 'missing_required_tool_evidence',
        reason: `Expected ${requirement.minimumExecutions} distinct successful ${requirement.id} tool execution(s), but only ${distinctMatching} were proven.`,
      };
    }
    const matchingEffects = matching.filter(
      execution => execution.effectSatisfied === true
    );
    if (
      requirement.requiresEffect &&
      distinctExecutions(matchingEffects) < requirement.minimumExecutions
    ) {
      return {
        ok: false,
        code: 'missing_required_effect_evidence',
        reason: `The ${requirement.id} tool did not prove ${requirement.minimumExecutions} distinct requested state effect(s).`,
      };
    }
  }

  return { ok: true };
}
