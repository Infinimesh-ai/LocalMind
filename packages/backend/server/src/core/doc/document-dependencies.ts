import type { DocumentNativeCommand } from './document-schema';

export type DocumentDependencies = {
  assets: Record<string, { size: number; mimeType: string; url?: string }>;
  resources: Set<string>;
  queryRows?: Set<string>;
  versions?: Record<string, string>;
  members?: Set<string>;
};
export function nativeDependencies(commands: DocumentNativeCommand[]) {
  const members = new Set<string>();
  const queryRows: { documentId: string; rowId: string }[] = [];
  const assets = new Set<string>(),
    resources = new Map<
      string,
      { kind: 'blocksuite' | 'office' | 'file' | 'folder'; id: string }
    >();
  const resource = (
    kind: 'blocksuite' | 'office' | 'file' | 'folder',
    id: string
  ) => resources.set(`${kind}:${id}`, { kind, id });
  const marks = (
    value:
      | {
          reference?: { pageId: string } | null;
          footnote?: {
            reference: { type: string; blobId?: string; docId?: string };
          } | null;
        }
      | undefined
  ) => {
    if (value?.reference) resource('blocksuite', value.reference.pageId);
    const footnote = value?.footnote?.reference;
    if (footnote?.blobId) assets.add(footnote.blobId);
    if (footnote?.docId) resource('blocksuite', footnote.docId);
  };
  for (const command of commands) {
    if (command.type === 'markdown.rewrite')
      command.assets.forEach(asset => assets.add(asset.blobId));
    if (command.type === 'database.cell.files.set')
      command.files.forEach(file => assets.add(file.blobId));
    if (command.type === 'database.cell.members.set')
      command.userIds.forEach(id => members.add(id));
    if (
      command.type === 'database.column.convert' &&
      command.column.type === 'member'
    )
      command.values.forEach(value => {
        if (Array.isArray(value.value))
          value.value.forEach(id => members.add(id));
      });
    const cell =
      command.type === 'database.cell.set' ||
      command.type === 'database.cell.files.set' ||
      command.type === 'database.cell.members.set' ||
      command.type === 'database.cell.asset.set'
        ? command
        : (command.type === 'text.splice' || command.type === 'text.format') &&
            command.target.kind === 'database_cell'
          ? command.target
          : undefined;
    if (cell?.rowDocumentId)
      queryRows.push({ documentId: cell.rowDocumentId, rowId: cell.rowId });
    if (command.type === 'database.column.convert')
      for (const value of command.values)
        if (value.rowDocumentId)
          queryRows.push({
            documentId: value.rowDocumentId,
            rowId: value.rowId,
          });
    if (command.type === 'block.asset.set') assets.add(command.blobId);
    if (command.type === 'database.cell.asset.set' && command.blobId)
      assets.add(command.blobId);
    if (command.type === 'block.reference.set') {
      const reference = command.reference;
      if (reference.kind === 'document')
        resource('blocksuite', reference.value.pageId);
      if (reference.kind === 'resource')
        resource(
          reference.resourceKind === 'doc'
            ? 'blocksuite'
            : reference.resourceKind,
          reference.resourceId
        );
    }
    if (command.type === 'text.splice')
      command.insert.forEach(run => marks(run.attributes));
    if (command.type === 'text.format') marks(command.marks);
    if (command.type === 'block.create')
      command.text?.forEach(run => marks(run.attributes));
    if (command.type === 'table.cells.set')
      command.cells.flat(2).forEach(run => marks(run.attributes));
  }
  return { assets, resources, queryRows, members };
}
