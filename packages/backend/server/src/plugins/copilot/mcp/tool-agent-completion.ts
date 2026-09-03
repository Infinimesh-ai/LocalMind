import { z } from 'zod';

export const LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_LEGACY_VERSION =
  'localmind-tool-agent-completion-contract/v1';
export const LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_PREVIOUS_VERSION =
  'localmind-tool-agent-completion-contract/v2';
export const LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION =
  'localmind-tool-agent-completion-contract/v3';

const ToolSuccessRequirementSchema = z
  .object({
    kind: z.literal('tool_success'),
    toolNames: z.array(z.string().trim().min(1).max(256)).min(1).max(16),
    minCount: z.number().int().min(1).max(20).default(1),
    sideEffectApplied: z.boolean().optional(),
    documentId: z.string().trim().min(1).max(256).optional(),
    workspaceOperations: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(16)
      .optional(),
    enterpriseProviders: z
      .array(z.string().trim().min(1).max(64))
      .min(1)
      .max(3)
      .optional(),
    sparkClawToolNames: z
      .array(z.string().trim().min(1).max(256))
      .min(1)
      .max(16)
      .optional(),
    afterToolName: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const AnyOfRequirementSchema = z
  .object({
    kind: z.literal('any_of'),
    minCount: z.number().int().min(1).max(8).default(1),
    requirements: z.array(ToolSuccessRequirementSchema).min(1).max(8),
  })
  .strict();

export const LocalMindToolAgentCompletionContractSchema = z.union([
  z.discriminatedUnion('kind', [
    z
      .object({
        version: z.literal(
          LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_LEGACY_VERSION
        ),
        kind: z.literal('none'),
      })
      .strict(),
    z
      .object({
        version: z.literal(
          LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_LEGACY_VERSION
        ),
        kind: z.literal('document_update'),
        documentId: z.string().trim().min(1).max(256),
      })
      .strict(),
  ]),
  z.discriminatedUnion('kind', [
    z
      .object({
        version: z.literal(
          LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_PREVIOUS_VERSION
        ),
        kind: z.literal('none'),
      })
      .strict(),
    z
      .object({
        version: z.literal(
          LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_PREVIOUS_VERSION
        ),
        kind: z.literal('document_update'),
        documentId: z.string().trim().min(1).max(256),
        mode: z.enum(['required', 'conditional']),
      })
      .strict(),
  ]),
  z.discriminatedUnion('kind', [
    z
      .object({
        version: z.literal(LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION),
        kind: z.literal('none'),
      })
      .strict(),
    z
      .object({
        version: z.literal(LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION),
        kind: z.literal('requirements'),
        requirements: z
          .array(
            z.union([ToolSuccessRequirementSchema, AnyOfRequirementSchema])
          )
          .min(1)
          .max(16),
      })
      .strict(),
  ]),
]);

export type LocalMindToolAgentCompletionContract = z.infer<
  typeof LocalMindToolAgentCompletionContractSchema
>;

export type LocalMindToolAgentDestructiveIntent = {
  permanentDocumentDelete: boolean;
  permanentFolderDelete: boolean;
};

const ENGLISH_DOCUMENT_BODY_UPDATE_REQUESTS = [
  /\b(?:modify|edit|revise|replace|overwrite)\b.{0,48}\b(?:document|doc|body|content|note|log|journal)\b(?!\s+(?:title|name|status|metadata)\b)/is,
  /\bupdate\b(?!\s+(?:me|us|the\s+team)\s+(?:on|about)\b).{0,48}\b(?:document|doc|body|content|note|log|journal)\b(?!\s+(?:title|name|status|metadata)\b)/is,
  /\b(?:add|append|merge|write)\b.{0,48}\b(?:to|into)\b.{0,32}\b(?:document|doc|body|content|note|log|journal)\b/is,
  /\b(?:save|submit)\b.{0,48}\b(?:to|into|as)\b.{0,32}\b(?:document|doc|body|content|note|log|journal)\b/is,
  /\bupload\b.{0,32}\bto\b.{0,32}\b(?:document|doc|log|journal)\b/is,
  /\b(?:document\s+body|document\s+content|doc\s+body|doc\s+content|note|log|journal)\b.{0,48}\b(?:update|modify|edit|revise|add|append|merge|write|replace|overwrite)\b/is,
];

const CHINESE_DOCUMENT_BODY_UPDATE_REQUESTS = [
  /(?:更新|修改|编辑|修订|替换|覆盖).{0,24}(?:文档|正文|内容|日志|记录)(?!标题|名称|状态|元数据)/is,
  /(?:追加|合并|写入|写进|补充|添加|提交|补交).{0,32}(?:到|至|进|入).{0,24}(?:文档|正文|内容|日志|记录)/is,
  /保存.{0,32}(?:文档|正文|内容|日志|记录)(?!标题|名称|状态|元数据)/is,
  /上传.{0,24}(?:到|至).{0,24}(?:文档|日志|记录)/is,
  /(?:文档|正文|内容|日志|记录)(?!标题|名称|状态|元数据).{0,24}(?:更新|修改|编辑|修订|追加|合并|写入|写进|替换|覆盖|保存|补充|添加)/is,
];

function requestsDocumentBodyUpdate(request: string) {
  const metadataOnlyRequest =
    /\b(?:change|update|modify|edit|rename)\b.{0,48}\b(?:document|doc|note|log|journal)\b.{0,16}\b(?:title|name|status|metadata)\b/is.test(
      request
    ) ||
    /(?:更新|修改|编辑|修订|替换|设置|改名|重命名).{0,24}(?:文档|日志|记录)(?:的)?(?:标题|名称|状态|元数据)/is.test(
      request
    );
  const explicitlyNamesBody = /\b(?:body|content)\b|(?:正文|内容)/is.test(
    request
  );
  if (metadataOnlyRequest && !explicitlyNamesBody) {
    return false;
  }

  return [
    ...ENGLISH_DOCUMENT_BODY_UPDATE_REQUESTS,
    ...CHINESE_DOCUMENT_BODY_UPDATE_REQUESTS,
  ].some(pattern => pattern.test(request));
}

function requestsConditionalDocumentBodyUpdate(request: string) {
  return [
    /\bif\b.{0,96}\b(?:missing|absent|not\s+(?:already\s+)?present|does\s+not\s+(?:already\s+)?contain)\b.{0,96}\b(?:add|append|write|update|insert)\b/is,
    /\b(?:do\s+not|don't)\b.{0,64}\b(?:change|modify|update|write|append)\b.{0,64}\b(?:if|when)\b.{0,96}\b(?:already|exists?|present|contains?)\b/is,
    /(?:如果|若|如若).{0,48}(?:没有|不存在|尚未|还没|未包含|不包含).{0,48}(?:写入|追加|添加|补充|更新|插入)/is,
    /(?:如果|若|如若).{0,48}(?:已经|已存在|已有|包含).{0,48}(?:不要|无需|不需要|别).{0,32}(?:修改|更新|写入|追加|添加|改动)/is,
  ].some(pattern => pattern.test(request));
}

const WRITE_DENIAL_PATTERNS = [
  /\b(?:do\s+not|don't|must\s+not|without)\b.{0,64}\b(?:create|update|modify|write|append|delete|remove|restore|rename|move|send|publish|execute)\b/is,
  /(?:不要|无需|不需要|不得|禁止|别).{0,32}(?:创建|新建|更新|修改|写入|追加|删除|移除|恢复|重命名|移动|发送|发布|执行)/is,
  /只(?:搜索|查询|检索|列出|查看|读取).{0,32}(?:不执行|不调用|不写入|不要修改|不要删除)/is,
];

function deniesWriteAction(request: string) {
  return WRITE_DENIAL_PATTERNS.some(pattern => pattern.test(request));
}

const PERMANENT_DELETE_DENIAL_PATTERNS = [
  /\b(?:do\s+not|don't|must\s+not|without)\b.{0,48}\b(?:permanently\s+(?:delete|remove)|(?:delete|remove)\s+permanently|delete\s+from\s+(?:the\s+)?trash|empty\s+(?:the\s+)?trash)\b/is,
  /(?:不要|无需|不需要|不得|禁止|别).{0,24}(?:永久删除|彻底删除|从\s*(?:垃圾箱|回收站|trash)\s*中?\s*(?:删除|移除)|清空\s*(?:垃圾箱|回收站|trash))/is,
];

export function requestsExplicitPermanentDelete(request: string) {
  if (PERMANENT_DELETE_DENIAL_PATTERNS.some(pattern => pattern.test(request))) {
    return false;
  }
  return (
    /\b(?:permanently\s+(?:delete|remove)|(?:delete|remove)\s+permanently|(?:delete|remove)\s+from\s+(?:the\s+)?trash|from\s+(?:the\s+)?trash\s+(?:delete|remove)|empty\s+(?:the\s+)?trash)\b/is.test(
      request
    ) ||
    /(?:永久删除|彻底删除|从\s*(?:垃圾箱|回收站|trash)\s*中?\s*(?:删除|移除)|清空\s*(?:垃圾箱|回收站|trash))/is.test(
      request
    )
  );
}

type ToolSuccessRequirement = z.infer<typeof ToolSuccessRequirementSchema>;
type CompletionRequirement =
  | ToolSuccessRequirement
  | z.infer<typeof AnyOfRequirementSchema>;

const toolSuccess = (
  toolNames: string[],
  input: Omit<Partial<ToolSuccessRequirement>, 'kind' | 'toolNames'> = {}
): ToolSuccessRequirement => ({
  kind: 'tool_success',
  toolNames,
  minCount: input.minCount ?? 1,
  ...(input.sideEffectApplied !== undefined
    ? { sideEffectApplied: input.sideEffectApplied }
    : {}),
  ...(input.documentId ? { documentId: input.documentId } : {}),
  ...(input.workspaceOperations
    ? { workspaceOperations: input.workspaceOperations }
    : {}),
  ...(input.enterpriseProviders
    ? { enterpriseProviders: input.enterpriseProviders }
    : {}),
  ...(input.sparkClawToolNames
    ? { sparkClawToolNames: input.sparkClawToolNames }
    : {}),
  ...(input.afterToolName ? { afterToolName: input.afterToolName } : {}),
});

function buildSpecificRequirements(input: {
  request: string;
  documentIds: string[];
}): CompletionRequirement[] {
  const { request } = input;
  const documentId =
    input.documentIds.length === 1 ? input.documentIds[0] : null;
  if (documentId && requestsDocumentBodyUpdate(request)) {
    if (requestsConditionalDocumentBodyUpdate(request)) {
      return [
        toolSuccess(['doc_read'], { documentId }),
        {
          kind: 'any_of',
          minCount: 1,
          requirements: [
            toolSuccess(['doc_update'], {
              documentId,
              afterToolName: 'doc_read',
            }),
            toolSuccess(['conditional_noop_complete'], {
              documentId,
              afterToolName: 'doc_read',
            }),
          ],
        },
      ];
    }
    if (deniesWriteAction(request)) return [];
    return [toolSuccess(['doc_update'], { documentId })];
  }

  if (deniesWriteAction(request)) return [];

  const enterpriseProviders = [
    /\bwecom\b|企业微信|企微/is.test(request) ? 'WECOM' : null,
    /\b(?:lark|feishu)\b|飞书/is.test(request) ? 'LARK' : null,
    /\bdingtalk\b|钉钉/is.test(request) ? 'DINGTALK' : null,
  ].filter((provider): provider is string => provider !== null);
  if (enterpriseProviders.length) {
    return [
      toolSuccess(['enterprise_cli_execute'], {
        enterpriseProviders,
      }),
    ];
  }
  if (/\bspark[ -]?claw\b|火花爪/is.test(request)) {
    return [toolSuccess(['sparkclaw_mcp_execute'])];
  }

  const namesFolder = /\b(?:folder|directory)\b|(?:文件夹|目录)/is.test(
    request
  );
  const namesDocument =
    /\b(?:document|doc|file|note|log|journal)\b|(?:文档|文件(?!夹)|笔记|日志|记录)/is.test(
      request
    );
  const destructiveIntent = buildToolAgentDestructiveIntent(request);
  if (destructiveIntent.permanentFolderDelete) {
    return [
      toolSuccess(['workspace_folder_delete_permanently'], {
        workspaceOperations: ['delete_folder_permanently'],
      }),
    ];
  }
  if (destructiveIntent.permanentDocumentDelete) {
    return [
      toolSuccess(['doc_delete_permanently'], {
        ...(documentId ? { documentId } : {}),
        workspaceOperations: ['delete_document_permanently'],
      }),
    ];
  }

  const restore = /\brestore\b|(?:恢复|还原)/is.test(request);
  const ordinaryDelete =
    /\b(?:delete|remove|trash)\b|(?:删除|移除|放入|移到|移至).{0,12}(?:垃圾箱|回收站|trash)?/is.test(
      request
    );
  if (namesFolder && restore) {
    return [
      toolSuccess(['workspace_folder_restore'], {
        workspaceOperations: ['restore_folder'],
      }),
    ];
  }
  if (namesFolder && ordinaryDelete) {
    return [
      toolSuccess(['workspace_folder_trash'], {
        workspaceOperations: ['trash_folder'],
      }),
    ];
  }
  if (namesDocument && restore) {
    return [
      toolSuccess(['doc_restore'], {
        ...(documentId ? { documentId } : {}),
        workspaceOperations: ['restore_document'],
      }),
    ];
  }
  if (namesDocument && ordinaryDelete) {
    return [
      toolSuccess(['doc_trash'], {
        ...(documentId ? { documentId } : {}),
        workspaceOperations: ['trash_document'],
      }),
    ];
  }

  if (
    /\b(?:create|new|make)\b.{0,40}\b(?:document|doc|note|file)\b|(?:创建|新建|生成).{0,24}(?:文档|文件|笔记|日志|记录)/is.test(
      request
    )
  ) {
    return [toolSuccess(['doc_create'])];
  }
  if (
    /\b(?:rename|change|update|edit)\b.{0,48}\b(?:document|doc|note|file)\b.{0,24}\b(?:title|name)\b|(?:修改|更新|设置|重命名|改名).{0,24}(?:文档|文件|笔记|日志|记录)(?:的)?(?:标题|名称)/is.test(
      request
    )
  ) {
    return [toolSuccess(['doc_update_meta'], documentId ? { documentId } : {})];
  }
  if (
    /\b(?:create|new|make)\b.{0,32}\b(?:folder|directory)\b|(?:创建|新建).{0,24}(?:文件夹|目录)/is.test(
      request
    )
  ) {
    return [
      toolSuccess(['workspace_folder_create'], {
        workspaceOperations: ['create_folder'],
      }),
    ];
  }
  if (
    /\brename\b.{0,32}\b(?:folder|directory)\b|(?:重命名|改名).{0,24}(?:文件夹|目录)/is.test(
      request
    )
  ) {
    return [
      toolSuccess(['workspace_folder_rename'], {
        workspaceOperations: ['rename_folder'],
      }),
    ];
  }
  if (
    /\bmove\b.{0,32}\b(?:folder|directory)\b|(?:移动).{0,24}(?:文件夹|目录)/is.test(
      request
    )
  ) {
    return [
      toolSuccess(['workspace_folder_move'], {
        workspaceOperations: ['move_folder'],
      }),
    ];
  }

  return [];
}

export function buildToolAgentDestructiveIntent(
  request: string
): LocalMindToolAgentDestructiveIntent {
  if (!requestsExplicitPermanentDelete(request)) {
    return {
      permanentDocumentDelete: false,
      permanentFolderDelete: false,
    };
  }

  const namesFolder = /\b(?:folder|directory)\b|(?:文件夹|目录)/is.test(
    request
  );
  const namesDocument =
    /\b(?:document|doc|file|note|log|journal)\b|(?:文档|文件(?!夹)|笔记|日志|记录)/is.test(
      request
    );
  return {
    permanentDocumentDelete: namesDocument || !namesFolder,
    permanentFolderDelete: namesFolder || !namesDocument,
  };
}

export function buildToolAgentCompletionContract(input: {
  request: string;
  documentIds: string[];
}): LocalMindToolAgentCompletionContract {
  const requirements = buildSpecificRequirements(input);
  if (requirements.length) {
    return {
      version: LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION,
      kind: 'requirements',
      requirements,
    };
  }

  return {
    version: LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION,
    kind: 'none',
  };
}
