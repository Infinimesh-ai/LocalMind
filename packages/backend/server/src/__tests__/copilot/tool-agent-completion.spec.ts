import test from 'ava';

import {
  buildToolAgentCompletionContract,
  buildToolAgentDestructiveIntent,
  requestsExplicitPermanentDelete,
} from '../../plugins/copilot/mcp/tool-agent-completion';

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
        version: 'localmind-tool-agent-completion-contract/v3',
        kind: 'requirements',
        requirements: [
          {
            kind: 'tool_success',
            toolNames: ['doc_update'],
            minCount: 1,
            documentId,
          },
        ],
      }
    );
  }
});

test('does not require a body update for read-only or upload requests', t => {
  for (const request of [
    'Update me about the document status.',
    'Upload the attachment and summarize the supplied document.',
    '读取文档并总结日志内容。',
    '上传附件，然后总结日志文档。',
    '提交今日日志给管理员。',
  ]) {
    t.deepEqual(
      buildToolAgentCompletionContract({ request, documentIds: [documentId] }),
      {
        version: 'localmind-tool-agent-completion-contract/v3',
        kind: 'none',
      }
    );
  }
});

test('requires a metadata tool for explicit document title changes', t => {
  for (const request of [
    'Change the document title to Daily Log.',
    '修改文档标题为今日日志。',
  ]) {
    t.deepEqual(
      buildToolAgentCompletionContract({ request, documentIds: [documentId] }),
      {
        version: 'localmind-tool-agent-completion-contract/v3',
        kind: 'requirements',
        requirements: [
          {
            kind: 'tool_success',
            toolNames: ['doc_update_meta'],
            minCount: 1,
            documentId,
          },
        ],
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
      version: 'localmind-tool-agent-completion-contract/v3',
      kind: 'none',
    }
  );
});

test('classifies guarded append requests as conditional document updates', t => {
  t.deepEqual(
    buildToolAgentCompletionContract({
      request:
        '如果今日日志还没有这条记录，就写入；如果已经存在，则不要修改文档。',
      documentIds: [documentId],
    }),
    {
      version: 'localmind-tool-agent-completion-contract/v3',
      kind: 'requirements',
      requirements: [
        {
          kind: 'tool_success',
          toolNames: ['doc_read'],
          minCount: 1,
          documentId,
        },
        {
          kind: 'any_of',
          minCount: 1,
          requirements: [
            {
              kind: 'tool_success',
              toolNames: ['doc_update'],
              minCount: 1,
              documentId,
              afterToolName: 'doc_read',
            },
            {
              kind: 'tool_success',
              toolNames: ['conditional_noop_complete'],
              minCount: 1,
              documentId,
              afterToolName: 'doc_read',
            },
          ],
        },
      ],
    }
  );
});

test('requires concrete successful tools for document, folder, and external work', t => {
  t.like(
    buildToolAgentCompletionContract({
      request: 'Create a new workspace document named Release Notes.',
      documentIds: [],
    }),
    {
      kind: 'requirements',
      requirements: [{ toolNames: ['doc_create'] }],
    }
  );
  t.like(
    buildToolAgentCompletionContract({
      request: '删除这个文件夹，放入回收站。',
      documentIds: [],
    }),
    {
      kind: 'requirements',
      requirements: [{ toolNames: ['workspace_folder_trash'] }],
    }
  );
  t.like(
    buildToolAgentCompletionContract({
      request: '查询我今天的钉钉日程。',
      documentIds: [],
    }),
    {
      kind: 'requirements',
      requirements: [
        {
          toolNames: ['enterprise_cli_execute'],
          enterpriseProviders: ['DINGTALK'],
        },
      ],
    }
  );
});

test('requires explicit permanent-delete wording and classifies mixed Chinese Trash requests', t => {
  t.false(requestsExplicitPermanentDelete('删除这个文档。'));
  t.false(requestsExplicitPermanentDelete('不要永久删除这个文档。'));
  t.false(requestsExplicitPermanentDelete('Do not permanently delete it.'));
  t.deepEqual(buildToolAgentDestructiveIntent('不要从 Trash 中删除文档。'), {
    permanentDocumentDelete: false,
    permanentFolderDelete: false,
  });
  t.deepEqual(buildToolAgentDestructiveIntent('从 Trash 中删除这个文档。'), {
    permanentDocumentDelete: true,
    permanentFolderDelete: false,
  });
  t.deepEqual(buildToolAgentDestructiveIntent('从 trash 中删除这个文件夹。'), {
    permanentDocumentDelete: false,
    permanentFolderDelete: true,
  });
  t.deepEqual(buildToolAgentDestructiveIntent('清空 Trash。'), {
    permanentDocumentDelete: true,
    permanentFolderDelete: true,
  });
});
