import test from 'ava';

import { buildToolAgentCompletionContract } from '../../plugins/copilot/mcp/tool-agent-completion';

const documentId = 'daily-log-document';

test('requires a document update for explicit English and Chinese body mutations', t => {
  for (const request of [
    'Read the supplied document, merge the deployment entry into the daily log, and save it.',
    '总结我们干了什么，然后上传到 LocalMind 今日日志。',
    '请把部署记录合并进这个文档。',
  ]) {
    t.deepEqual(
      buildToolAgentCompletionContract({ request, documentIds: [documentId] }),
      {
        version: 'localmind-tool-agent-completion-contract/v1',
        kind: 'document_update',
        documentId,
      }
    );
  }
});

test('does not require a body update for read-only, upload, or metadata requests', t => {
  for (const request of [
    'Update me about the document status.',
    'Upload the attachment and summarize the supplied document.',
    'Change the document title to Daily Log.',
    '读取文档并总结日志内容。',
    '上传附件，然后总结日志文档。',
    '修改文档标题为今日日志。',
    '提交今日日志给管理员。',
  ]) {
    t.deepEqual(
      buildToolAgentCompletionContract({ request, documentIds: [documentId] }),
      {
        version: 'localmind-tool-agent-completion-contract/v1',
        kind: 'none',
      }
    );
  }
});

test('does not require one document update when the target is ambiguous', t => {
  t.deepEqual(
    buildToolAgentCompletionContract({
      request: 'Merge the deployment entry into the supplied documents.',
      documentIds: ['first-document', 'second-document'],
    }),
    {
      version: 'localmind-tool-agent-completion-contract/v1',
      kind: 'none',
    }
  );
});
