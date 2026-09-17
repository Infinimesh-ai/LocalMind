import * as Y from 'yjs';

// Synthetic editor-authored log: no production content or user identifiers.
export const DAILY_LOG_MARKDOWN = `## 今日完成

- [产品 / 进展] 保留 **已有成果** 与后续说明
  - [验证记录](https://example.com/check) 已完成
- 待更新事项

## 关键决策

- 保留原文档

## 问题与风险

- 验证更新结果

## 相关任务与文档

- [任务文档](https://example.com/task) 等资料
`;

export function addEditorProperties(
  doc: Y.Doc,
  editorId = 'previous-editor',
  now = 1700000000000
) {
  for (const block of doc.getMap<Y.Map<unknown>>('blocks').values()) {
    const flavour = block.get('sys:flavour');
    if (flavour === 'affine:note') {
      block.set('prop:lockedBySelf', false);
      block.set('prop:edgeless', {
        style: {
          borderRadius: 8,
          borderSize: 4,
          borderStyle: 'none',
          shadowType: '--affine-note-shadow-box',
        },
      });
    }
    if (flavour === 'affine:paragraph' || flavour === 'affine:list') {
      block.set('prop:collapsed', false);
      block.set('prop:meta:createdAt', now);
      block.set('prop:meta:createdBy', editorId);
      block.set('prop:meta:updatedAt', now);
      block.set('prop:meta:updatedBy', editorId);
    }
    if (flavour === 'affine:list') {
      block.set('prop:checked', false);
      block.set('prop:order', null);
    }
  }
}
