import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { ModelAdapterCapabilityId } from '../types';

export const QWEN36_COMPLETION_CONTRACT_VERSION =
  'qwen36-completion-contract/v5';
export const QWEN36_COMPLETION_MAX_EXECUTIONS = 16;

const REQUIREMENT_IDS = [
  'document.read',
  'document.create',
  'document.update',
  'document.update_meta',
  'document.search',
  'workspace.folder.list',
  'workspace.folder.create',
  'workspace.folder.rename',
  'workspace.folder.move',
  'workspace.folder.delete',
  'workspace.folder.add_document',
  'workspace.folder.remove_document',
  'workspace.folder.move_document',
] as const;

const DOCUMENT_RELATIONS = ['created', 'updated'] as const;
const WORKSPACE_OPERATIONS = [
  'create_folder',
  'rename_folder',
  'move_folder',
  'delete_folder',
  'add_document',
  'remove_document',
  'move_document',
] as const;

const Qwen36CompletionRequirementSchema = z
  .object({
    id: z.enum(REQUIREMENT_IDS),
    toolNames: z.array(z.string().trim().min(1)).min(1),
    requiresEffect: z.boolean(),
    minimumExecutions: z
      .number()
      .int()
      .min(1)
      .max(QWEN36_COMPLETION_MAX_EXECUTIONS),
    documentRelation: z.enum(DOCUMENT_RELATIONS).optional(),
    workspaceOperation: z.enum(WORKSPACE_OPERATIONS).optional(),
  })
  .strict();

const Qwen36CompletionContractSchema = z
  .object({
    version: z.literal(QWEN36_COMPLETION_CONTRACT_VERSION),
    requirements: z.array(Qwen36CompletionRequirementSchema).min(1),
    contractFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type Qwen36CompletionRequirement = z.infer<
  typeof Qwen36CompletionRequirementSchema
>;
export type Qwen36CompletionContract = z.infer<
  typeof Qwen36CompletionContractSchema
>;

const DOCUMENT = /\b(?:documents?|docs?)\b|文档|笔记|页面/i;
const ATTACHMENT = /\battachments?\b|附件/i;
const FOLDER = /\bfolders?\b|文件夹|目录/i;
const CREATE = /\b(?:create|make|add|new)\b|创建|新建|新增/i;
const UPDATE =
  /\b(?:update|modify|edit|replace|rewrite|append|write)\b|更新|修改|编辑|替换|重写|追加|写入/i;
const RENAME = /\brename\b|重命名|改名|修改标题|更改标题/i;
const MOVE = /\bmove\b|移动|移到|放到|归档到/i;
const DELETE = /\b(?:delete|remove)\b|删除|移除/i;
const ADD = /\b(?:add|put|place)\b|加入|添加|放入/i;
const LIST = /\b(?:list|show)\b|列出|查看|展示/i;
const SEARCH = /\b(?:search|find|locate|query)\b|搜索|查找|查询|定位/i;
const READ =
  /\b(?:read|open|summarize|analyse|analyze|extract|compare|translate|review)\b|读取|打开|总结|摘要|分析|提取|对比|翻译|审阅/i;
const TITLE = /\btitle\b|标题/i;
const DOCUMENT_PLACEMENT =
  /(?:document|doc).{0,320}(?:placements?|from (?:all )?folders?)|(?:placements?|from (?:all )?folders?).{0,320}(?:document|doc)|文档.{0,320}(?:(?:所有|全部).{0,16})?(?:放置位置|文件夹位置)|(?:放置位置|文件夹位置).{0,320}文档/i;
const CREATED_DOCUMENT_INITIAL_CONTENT =
  /\b(?:write|put).{0,64}\b(?:it|the (?:new|created) (?:document|doc))\b|(?:写入|写到|放入).{0,32}(?:其中|新建|创建的?文档)/i;

const ENGLISH_COUNTS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};
const ENGLISH_COUNT_TOKEN = Object.keys(ENGLISH_COUNTS).join('|');
const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function qwen36OperationRequested(clause: string, operation: RegExp) {
  if (!operation.test(clause)) return false;
  const source = `(?:${operation.source})`;
  const englishNegation = new RegExp(
    `\\b(?:do\\s+not|don't|never|must\\s+not|without|no\\s+need\\s+to)\\s+(?:[a-z0-9_-]+\\s+){0,3}${source}`,
    'i'
  );
  const chineseNegation = new RegExp(
    `(?:不要|不得|禁止|无需|不需要|不能|不可|别)[^，。；！？,.!?\\n]{0,12}${source}`,
    'i'
  );
  return !englishNegation.test(clause) && !chineseNegation.test(clause);
}

const REQUIREMENTS: Record<
  Qwen36CompletionRequirement['id'],
  Qwen36CompletionRequirement
> = {
  'document.read': {
    id: 'document.read',
    toolNames: ['doc_read'],
    requiresEffect: false,
    minimumExecutions: 1,
  },
  'document.create': {
    id: 'document.create',
    toolNames: ['doc_create'],
    requiresEffect: true,
    minimumExecutions: 1,
    documentRelation: 'created',
  },
  'document.update': {
    id: 'document.update',
    toolNames: ['doc_update'],
    requiresEffect: true,
    minimumExecutions: 1,
    documentRelation: 'updated',
  },
  'document.update_meta': {
    id: 'document.update_meta',
    toolNames: ['doc_update_meta'],
    requiresEffect: true,
    minimumExecutions: 1,
    documentRelation: 'updated',
  },
  'document.search': {
    id: 'document.search',
    toolNames: ['doc_keyword_search', 'doc_semantic_search'],
    requiresEffect: false,
    minimumExecutions: 1,
  },
  'workspace.folder.list': {
    id: 'workspace.folder.list',
    toolNames: ['workspace_folder_list'],
    requiresEffect: false,
    minimumExecutions: 1,
  },
  'workspace.folder.create': {
    id: 'workspace.folder.create',
    toolNames: ['workspace_folder_create'],
    requiresEffect: true,
    minimumExecutions: 1,
    workspaceOperation: 'create_folder',
  },
  'workspace.folder.rename': {
    id: 'workspace.folder.rename',
    toolNames: ['workspace_folder_rename'],
    requiresEffect: true,
    minimumExecutions: 1,
    workspaceOperation: 'rename_folder',
  },
  'workspace.folder.move': {
    id: 'workspace.folder.move',
    toolNames: ['workspace_folder_move'],
    requiresEffect: true,
    minimumExecutions: 1,
    workspaceOperation: 'move_folder',
  },
  'workspace.folder.delete': {
    id: 'workspace.folder.delete',
    toolNames: ['workspace_folder_delete'],
    requiresEffect: true,
    minimumExecutions: 1,
    workspaceOperation: 'delete_folder',
  },
  'workspace.folder.add_document': {
    id: 'workspace.folder.add_document',
    toolNames: ['workspace_folder_add_document'],
    requiresEffect: true,
    minimumExecutions: 1,
    workspaceOperation: 'add_document',
  },
  'workspace.folder.remove_document': {
    id: 'workspace.folder.remove_document',
    toolNames: ['workspace_folder_remove_document'],
    requiresEffect: true,
    minimumExecutions: 1,
    workspaceOperation: 'remove_document',
  },
  'workspace.folder.move_document': {
    id: 'workspace.folder.move_document',
    toolNames: ['workspace_folder_move_document'],
    requiresEffect: true,
    minimumExecutions: 1,
    workspaceOperation: 'move_document',
  },
};

function clauses(request: string) {
  return request
    .split(
      /(?:[\n,.;!?，。；！？]+|\b(?:and then|then|and|but|however)\b|然后|并且|随后|接着|但是|而不是|而非|但)/i
    )
    .map(clause => clause.trim())
    .filter(Boolean);
}

function chineseCount(value: string) {
  if (/^\d+$/.test(value)) return Number(value);
  if (value === '十') return 10;
  if (value.includes('十')) {
    const [tens, units] = value.split('十');
    const tensValue = tens ? CHINESE_DIGITS[tens] : 1;
    const unitsValue = units ? CHINESE_DIGITS[units] : 0;
    return tensValue === undefined || unitsValue === undefined
      ? undefined
      : tensValue * 10 + unitsValue;
  }
  return CHINESE_DIGITS[value];
}

function requestedObjectCount(clause: string, objectPattern: RegExp) {
  const match = objectPattern.exec(clause);
  if (match?.index === undefined) return 1;
  const prefix = clause.slice(Math.max(0, match.index - 32), match.index);
  const english = prefix.match(
    new RegExp(
      `\\b(\\d+|${ENGLISH_COUNT_TOKEN})\\b(?:\\s+[a-z-]+){0,3}\\s*$`,
      'i'
    )
  );
  if (english) {
    const token = english[1].toLowerCase();
    return /^\d+$/.test(token) ? Number(token) : ENGLISH_COUNTS[token];
  }
  const chinese = prefix.match(
    /([零一二两三四五六七八九十\d]+)\s*(?:个|份|篇|张|本)?\s*$/
  );
  return chinese ? (chineseCount(chinese[1]) ?? 1) : 1;
}

function minimumExecutionsForRequirement(
  clause: string,
  id: Qwen36CompletionRequirement['id']
) {
  if (id === 'document.search' || id === 'workspace.folder.list') return 1;
  const countsDocuments =
    id === 'workspace.folder.add_document' ||
    id === 'workspace.folder.remove_document' ||
    id === 'workspace.folder.move_document';
  return requestedObjectCount(
    clause,
    id.startsWith('workspace.folder.') && !countsDocuments ? FOLDER : DOCUMENT
  );
}

const ADDITIONAL_OBJECT =
  /\b(?:another|an additional|one more|a second|a third)\b|另一个|再(?:新建|创建|新增)|又(?:新建|创建|新增)/i;

function namedTargetsForRequirement(
  clause: string,
  id: Qwen36CompletionRequirement['id']
) {
  if (id !== 'workspace.folder.create') return [];
  const targets = new Set<string>();
  const patterns = [
    /(?:folders?|directories)(?:\s+(?:named|called))?[^"'\n]{0,24}["']([^"'\n]+)["']/gi,
    /(?:子)?文件夹|目录/g,
  ];
  for (const pattern of patterns) {
    if (pattern === patterns[1]) {
      for (const match of clause.matchAll(
        /(?:(?:子)?文件夹|目录)[^“”\n]{0,16}“([^”\n]+)”/g
      )) {
        targets.add(match[1].trim());
      }
      continue;
    }
    for (const match of clause.matchAll(pattern)) {
      targets.add(match[1].trim());
    }
  }
  return [...targets].filter(Boolean);
}

function requirementIdsForClause(
  clause: string,
  request: string
): Qwen36CompletionRequirement['id'][] {
  const hasDocument = DOCUMENT.test(clause);
  const hasAttachment = ATTACHMENT.test(clause);
  const hasFolder = FOLDER.test(clause);
  const globalDocument = DOCUMENT.test(request);
  const globalFolder = FOLDER.test(request);
  const inferredDocument =
    hasDocument ||
    (!hasAttachment && !hasFolder && globalDocument && !globalFolder);
  const inferredFolder =
    hasFolder || (!hasDocument && globalFolder && !globalDocument);
  const create = qwen36OperationRequested(clause, CREATE);
  const update = qwen36OperationRequested(clause, UPDATE);
  const rename = qwen36OperationRequested(clause, RENAME);
  const move = qwen36OperationRequested(clause, MOVE);
  const deleteOperation = qwen36OperationRequested(clause, DELETE);
  const add = qwen36OperationRequested(clause, ADD);
  const list = qwen36OperationRequested(clause, LIST);
  const search = qwen36OperationRequested(clause, SEARCH);
  const read = qwen36OperationRequested(clause, READ);

  if (hasDocument && move && (hasFolder || globalFolder)) {
    return ['workspace.folder.move_document'];
  }
  if (hasDocument && add && (hasFolder || globalFolder)) {
    return ['workspace.folder.add_document'];
  }
  if (hasDocument && deleteOperation && DOCUMENT_PLACEMENT.test(clause)) {
    return ['workspace.folder.remove_document'];
  }

  const ids: Qwen36CompletionRequirement['id'][] = [];
  if (inferredFolder) {
    if (rename) ids.push('workspace.folder.rename');
    else if (move) ids.push('workspace.folder.move');
    else if (deleteOperation) ids.push('workspace.folder.delete');
    else if (create) ids.push('workspace.folder.create');
    if (list || read) ids.push('workspace.folder.list');
  }

  if (inferredDocument) {
    if (create) ids.push('document.create');
    else if (rename || (TITLE.test(clause) && update)) {
      ids.push('document.update_meta');
    } else if (
      update &&
      !(
        qwen36OperationRequested(request, CREATE) &&
        CREATED_DOCUMENT_INITIAL_CONTENT.test(clause)
      )
    ) {
      ids.push('document.update');
    }
    if (search) ids.push('document.search');
    if (read) ids.push('document.read');
  }
  return [...new Set(ids)];
}

function contractFingerprint(
  requirements: readonly Qwen36CompletionRequirement[]
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: QWEN36_COMPLETION_CONTRACT_VERSION,
        requirements,
      })
    )
    .digest('hex');
}

export function createQwen36CompletionContract(
  request: string
): Qwen36CompletionContract | undefined {
  const counts = new Map<
    Qwen36CompletionRequirement['id'],
    { minimumExecutions: number; namedTargets: Set<string> }
  >();
  for (const clause of clauses(request)) {
    for (const id of requirementIdsForClause(clause, request)) {
      const namedTargets = namedTargetsForRequirement(clause, id);
      const requestedExecutions = Math.max(
        minimumExecutionsForRequirement(clause, id),
        namedTargets.length
      );
      const existing = counts.get(id);
      if (!existing) {
        counts.set(id, {
          minimumExecutions: requestedExecutions,
          namedTargets: new Set(namedTargets),
        });
        continue;
      }
      const newNamedTargets = namedTargets.filter(
        target => !existing.namedTargets.has(target)
      );
      if (ADDITIONAL_OBJECT.test(clause) || newNamedTargets.length) {
        existing.minimumExecutions += Math.max(
          requestedExecutions,
          newNamedTargets.length
        );
      } else {
        existing.minimumExecutions = Math.max(
          existing.minimumExecutions,
          requestedExecutions
        );
      }
      namedTargets.forEach(target => existing.namedTargets.add(target));
    }
  }
  if (!counts.size) {
    for (const id of requirementIdsForClause(request, request)) {
      counts.set(id, {
        minimumExecutions: minimumExecutionsForRequirement(request, id),
        namedTargets: new Set(namedTargetsForRequirement(request, id)),
      });
    }
  }
  if (!counts.size) return undefined;
  const totalMinimumExecutions = [...counts.values()].reduce(
    (total, count) => total + count.minimumExecutions,
    0
  );
  if (
    !Number.isSafeInteger(totalMinimumExecutions) ||
    totalMinimumExecutions > QWEN36_COMPLETION_MAX_EXECUTIONS
  ) {
    return undefined;
  }

  const requirements = [...counts.keys()]
    .sort((left, right) => left.localeCompare(right))
    .map(id => {
      const count = counts.get(id);
      if (!count) {
        throw new Error(`Missing Qwen3.6 completion count for ${id}`);
      }
      return {
        ...REQUIREMENTS[id],
        minimumExecutions: count.minimumExecutions,
      };
    });
  return {
    version: QWEN36_COMPLETION_CONTRACT_VERSION,
    requirements,
    contractFingerprint: contractFingerprint(requirements),
  };
}

export function parseQwen36CompletionContract(
  value: unknown
): Qwen36CompletionContract {
  const contract = Qwen36CompletionContractSchema.parse(value);
  const uniqueIds = new Set(
    contract.requirements.map(requirement => requirement.id)
  );
  if (
    uniqueIds.size !== contract.requirements.length ||
    contract.contractFingerprint !== contractFingerprint(contract.requirements)
  ) {
    throw new Error(
      'Persisted Qwen3.6 completion contract integrity check failed'
    );
  }
  return contract;
}

export function qwen36CompletionContractCapabilities(
  contract: Qwen36CompletionContract
): ModelAdapterCapabilityId[] {
  return [
    ...new Set(
      contract.requirements.map<ModelAdapterCapabilityId>(requirement => {
        switch (requirement.id) {
          case 'workspace.folder.list':
          case 'workspace.folder.create':
          case 'workspace.folder.rename':
          case 'workspace.folder.move':
          case 'workspace.folder.delete':
          case 'workspace.folder.add_document':
          case 'workspace.folder.remove_document':
          case 'workspace.folder.move_document':
            return 'workspace.folder';
          default:
            return requirement.id;
        }
      })
    ),
  ];
}
