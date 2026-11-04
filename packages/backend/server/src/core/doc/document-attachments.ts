import * as Y from 'yjs';

/** Attachment cells use Blob IDs both as map keys and as item.id. */
export function* nativeAttachmentCells(blocks: Y.Map<Y.Map<unknown>>) {
  for (const block of blocks.values()) {
    const query = block.get('sys:flavour') === 'affine:data-view';
    if (!query && block.get('sys:flavour') !== 'affine:database') continue;
    const columns = block.get('prop:columns'),
      cells = block.get('prop:cells');
    if (!(columns instanceof Y.Array) || !(cells instanceof Y.Map)) continue;
    const attachmentColumns = columns
      .toArray()
      .filter(
        (column): column is Y.Map<unknown> =>
          column instanceof Y.Map && column.get('type') === 'attachment'
      );
    for (const row of cells.values()) {
      if (!(row instanceof Y.Map)) continue;
      for (const column of attachmentColumns) {
        const cell = row.get(String(column.get('id')));
        const value = query
          ? cell
          : cell instanceof Y.Map
            ? cell.get('value')
            : undefined;
        if (value instanceof Y.Map) yield value;
      }
    }
  }
}
