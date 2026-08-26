import type { ModelAdapterCapabilityId } from '../types';
import {
  createQwen36CompletionContract,
  qwen36OperationRequested,
} from './completion-contract';
import { qwen36Profile } from './profile';

export type Qwen36DelegationPlan =
  | { kind: 'answer'; answer: string }
  | {
      kind: 'document_update';
      docId: string;
      content: string;
      summary: string;
    }
  | { kind: 'tool_agent'; summary: string }
  | { kind: 'unsupported_task'; reason: string };

const WORKSPACE_OPERATION =
  /(?:\b(?:create|update|modify|replace|delete|remove|move|rename|search|find|read|list|query|publish|restore|open|generate|build)\b|创建|新建|更新|修改|替换|删除|移除|移动|重命名|改名|搜索|查找|查询|读取|列出|查看|发布|恢复|打开|生成|制作)/i;

const UNAVAILABLE_CAPABILITIES: ReadonlyArray<{
  id: ModelAdapterCapabilityId;
  pattern: RegExp;
}> = [
  { id: 'whiteboard', pattern: /\bwhiteboard\b|白板|画布|edgeless/i },
  { id: 'database', pattern: /\bdatabase\b|数据库|数据表|database block/i },
  { id: 'comment', pattern: /\bcomments?\b|评论|批注/i },
  { id: 'tag', pattern: /\btags?\b|标签/i },
  { id: 'collection', pattern: /\bcollections?\b|集合/i },
  { id: 'trash', pattern: /\btrash\b|recycle bin|回收站/i },
  { id: 'publish', pattern: /\bpublish(?:ed|ing)?\b|发布/i },
  {
    id: 'history',
    pattern: /version history|document history|历史版本|版本历史/i,
  },
  {
    id: 'asset',
    pattern: /workspace assets?|asset library|工作区资产|资源库/i,
  },
  {
    id: 'artifact',
    pattern:
      /code artifact|代码产物|可运行的?(?:网页|html)|不要保存为(?:工作区)?文档/i,
  },
  {
    id: 'web',
    pattern: /web search|internet search|browse the web|网页搜索|联网|上网/i,
  },
  {
    id: 'enterprise',
    pattern: /\b(?:wecom|lark|feishu|dingtalk)\b|企业微信|企微|飞书|钉钉/i,
  },
];

function requestClauses(request: string) {
  return request
    .split(
      /(?:[\n,.;!?，。；！？]+|\b(?:and then|then|and|but|however)\b|然后|并且|随后|接着|但是|而不是|而非|但)/i
    )
    .map(clause => clause.trim())
    .filter(Boolean);
}

function unavailableCapability(request: string) {
  return UNAVAILABLE_CAPABILITIES.find(capability =>
    requestClauses(request).some(
      clause =>
        capability.pattern.test(clause) &&
        qwen36OperationRequested(clause, WORKSPACE_OPERATION)
    )
  );
}

function supportedWorkspaceToolRequest(request: string) {
  return requestClauses(request).some(
    clause =>
      qwen36OperationRequested(clause, WORKSPACE_OPERATION) &&
      /\b(?:documents?|docs?|folders?|workspace)\b|文档|文件夹|目录|工作区/i.test(
        clause
      )
  );
}

function capabilityReason(id: ModelAdapterCapabilityId) {
  return qwen36Profile.capabilities.find(capability => capability.id === id)
    ?.reason;
}

export function preflightQwen36PlannerPolicy(
  request: string
): Qwen36DelegationPlan | undefined {
  const unavailable = unavailableCapability(request);
  if (unavailable) {
    return {
      kind: 'unsupported_task',
      reason:
        capabilityReason(unavailable.id) ??
        `The ${unavailable.id} capability is disabled for this model.`,
    };
  }
  if (
    supportedWorkspaceToolRequest(request) &&
    !createQwen36CompletionContract(request)
  ) {
    return {
      kind: 'unsupported_task',
      reason:
        'This request cannot yet be mapped to a deterministic Qwen3.6 completion contract within the tool execution limit.',
    };
  }
  if (supportedWorkspaceToolRequest(request)) {
    return {
      kind: 'tool_agent',
      summary:
        'Use the available LocalMind document and workspace tools to complete the request.',
    };
  }
  return undefined;
}

export function applyQwen36PlannerPolicy(input: {
  request: string;
  requestedDocumentIds: readonly string[];
  plan: Qwen36DelegationPlan;
}): Qwen36DelegationPlan {
  const preflight = preflightQwen36PlannerPolicy(input.request);
  if (preflight?.kind === 'unsupported_task') return preflight;

  const supportedToolRequest = supportedWorkspaceToolRequest(input.request);
  const completionContract = createQwen36CompletionContract(input.request);
  if (
    input.plan.kind === 'document_update' &&
    !input.requestedDocumentIds.includes(input.plan.docId)
  ) {
    return {
      kind: 'tool_agent',
      summary:
        'Resolve the requested document or workspace target with tools, then perform the requested operation.',
    };
  }

  if (
    supportedToolRequest &&
    completionContract &&
    (input.plan.kind === 'answer' || input.plan.kind === 'unsupported_task')
  ) {
    return {
      kind: 'tool_agent',
      summary:
        'Use the available LocalMind document and workspace tools to complete the request.',
    };
  }

  if (input.plan.kind === 'tool_agent' && !completionContract) {
    return {
      kind: 'unsupported_task',
      reason:
        'This request cannot yet be mapped to a deterministic Qwen3.6 completion contract.',
    };
  }

  return input.plan;
}
