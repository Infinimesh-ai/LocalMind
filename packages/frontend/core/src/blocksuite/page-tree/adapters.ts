import {
  embedLinkedDocBlockHtmlAdapterMatcher,
  embedLinkedDocBlockMarkdownAdapterMatcher,
  embedLinkedDocBlockPlainTextAdapterMatcher,
} from '@blocksuite/affine/blocks/embed-doc';
import {
  BlockHtmlAdapterExtension,
  type BlockHtmlAdapterMatcher,
  BlockMarkdownAdapterExtension,
  type BlockMarkdownAdapterMatcher,
  BlockPlainTextAdapterExtension,
  type BlockPlainTextAdapterMatcher,
} from '@blocksuite/affine/shared/adapters';
import type { BlockSnapshot } from '@blocksuite/affine/store';

const reference = (node: BlockSnapshot) => ({
  ...node,
  flavour: 'affine:embed-linked-doc',
  props: { pageId: node.props.resourceId },
});
// Exports and ordinary pastes carry a reference, never a second ownership edge.
const markdown: BlockMarkdownAdapterMatcher = {
  flavour: 'localmind:subpage',
  toMatch: () => false,
  fromMatch: o => o.node.flavour === 'localmind:subpage',
  toBlockSnapshot: {},
  fromBlockSnapshot: {
    enter: (o, context) =>
      embedLinkedDocBlockMarkdownAdapterMatcher.fromBlockSnapshot.enter?.(
        { ...o, node: reference(o.node) },
        context
      ),
  },
};
const html: BlockHtmlAdapterMatcher = {
  flavour: 'localmind:subpage',
  toMatch: () => false,
  fromMatch: o => o.node.flavour === 'localmind:subpage',
  toBlockSnapshot: {},
  fromBlockSnapshot: {
    enter: (o, context) =>
      embedLinkedDocBlockHtmlAdapterMatcher.fromBlockSnapshot.enter?.(
        { ...o, node: reference(o.node) },
        context
      ),
  },
};
const text: BlockPlainTextAdapterMatcher = {
  flavour: 'localmind:subpage',
  toMatch: () => false,
  fromMatch: o => o.node.flavour === 'localmind:subpage',
  toBlockSnapshot: {},
  fromBlockSnapshot: {
    enter: (o, context) =>
      embedLinkedDocBlockPlainTextAdapterMatcher.fromBlockSnapshot.enter?.(
        { ...o, node: reference(o.node) },
        context
      ),
  },
};
export const subpageAdapters = [
  BlockMarkdownAdapterExtension(markdown),
  BlockHtmlAdapterExtension(html),
  BlockPlainTextAdapterExtension(text),
];
