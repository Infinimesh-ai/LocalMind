import { z } from 'zod';

export const LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_LEGACY_VERSION =
  'localmind-tool-agent-completion-contract/v1';
export const LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION =
  'localmind-tool-agent-completion-contract/v2';

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
        version: z.literal(LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION),
        kind: z.literal('none'),
      })
      .strict(),
    z
      .object({
        version: z.literal(LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION),
        kind: z.literal('document_update'),
        documentId: z.string().trim().min(1).max(256),
        mode: z.enum(['required', 'conditional']),
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

export function requestsExplicitPermanentDelete(request: string) {
  return (
    /\b(?:permanently\s+(?:delete|remove)|(?:delete|remove)\s+permanently|(?:delete|remove)\s+from\s+(?:the\s+)?trash|from\s+(?:the\s+)?trash\s+(?:delete|remove)|empty\s+(?:the\s+)?trash)\b/is.test(
      request
    ) ||
    /(?:永久删除|彻底删除|从\s*(?:垃圾箱|回收站|trash)\s*中?\s*(?:删除|移除)|清空\s*(?:垃圾箱|回收站|trash))/is.test(
      request
    )
  );
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
  if (
    input.documentIds.length === 1 &&
    requestsDocumentBodyUpdate(input.request)
  ) {
    return {
      version: LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION,
      kind: 'document_update',
      documentId: input.documentIds[0],
      mode: requestsConditionalDocumentBodyUpdate(input.request)
        ? 'conditional'
        : 'required',
    };
  }

  return {
    version: LOCALMIND_TOOL_AGENT_COMPLETION_CONTRACT_VERSION,
    kind: 'none',
  };
}
