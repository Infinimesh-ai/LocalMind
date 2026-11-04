import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTable } from 'micromark-extension-gfm-table';

/** Inspect syntax nodes, so HTML/image/table-looking code stays literal text. */
export function unsupportedResourceMarkdown(text: string): string[] {
  const root = fromMarkdown(text, {
    extensions: [gfmTable()],
    mdastExtensions: [gfmTableFromMarkdown()],
  });
  const unsupported = new Set<string>();
  const visit = (node: {
    type: string;
    children?: readonly { type: string }[];
  }) => {
    if (['html', 'image', 'imageReference', 'table'].includes(node.type))
      unsupported.add(node.type);
    if ('children' in node) node.children?.forEach(visit);
  };
  visit(root);
  return [...unsupported];
}
