import { createHash } from 'node:crypto';

import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmStrikethroughFromMarkdown } from 'mdast-util-gfm-strikethrough';
import { gfmTableFromMarkdown } from 'mdast-util-gfm-table';
import { gfmTaskListItemFromMarkdown } from 'mdast-util-gfm-task-list-item';
import { gfmStrikethrough } from 'micromark-extension-gfm-strikethrough';
import { gfmTable } from 'micromark-extension-gfm-table';
import { gfmTaskListItem } from 'micromark-extension-gfm-task-list-item';
import { type DefaultTreeAdapterMap, parseFragment } from 'parse5';
import * as Y from 'yjs';

import type { NativeEditContext } from './document-database';
import { DocumentEditError } from './document-edit-error';
import {
  type DocumentBlockFlavour,
  type DocumentNativeCommand,
  documentNativeCommand,
} from './document-schema';
import type { NativeTextRun } from './native-text';

type Rewrite = Extract<DocumentNativeCommand, { type: 'markdown.rewrite' }>;
type Node = {
  type: string;
  children?: Node[];
  value?: string;
  lang?: string | null;
  url?: string;
  alt?: string | null;
  identifier?: string;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  checked?: boolean | null;
  align?: (string | null)[] | null;
};
type ProjectedBlock = {
  flavour: Exclude<DocumentBlockFlavour, 'affine:page'>;
  properties?: Record<string, unknown>;
  text?: NativeTextRun[];
  children?: ProjectedBlock[];
  cells?: NativeTextRun[][][];
  assetUrl?: string;
};
function fail(reason: string, objectId?: string): never {
  throw new DocumentEditError('invalid_input', { reason, objectId });
}

/** Markdown is an explicit projection input. Identity is supplied by the caller,
 * never inferred from repeated text or array positions in the stored document. */
export function compileDocumentMarkdown(
  context: NativeEditContext,
  command: Rewrite
): DocumentNativeCommand[] {
  const tree: Node = fromMarkdown(command.markdown, {
    extensions: [gfmTable(), gfmStrikethrough(), gfmTaskListItem()],
    mdastExtensions: [
      gfmTableFromMarkdown(),
      gfmStrikethroughFromMarkdown(),
      gfmTaskListItemFromMarkdown(),
    ],
  });
  const definitions = new Map<string, Node>();
  const findDefinitions = (node: Node, depth = 0) => {
    if (depth > 64) fail('markdown_nesting_limit');
    if (node.type === 'definition' && node.identifier)
      definitions.set(node.identifier, node);
    node.children?.forEach(child => findDefinitions(child, depth + 1));
  };
  findDefinitions(tree);
  const htmlMarks = (node: DefaultTreeAdapterMap['element']) => {
    const marks: Record<string, unknown> = {};
    const allowed = [
      'b',
      'strong',
      'i',
      'em',
      'u',
      's',
      'del',
      'code',
      'span',
      'a',
      'br',
    ];
    if (!allowed.includes(node.tagName))
      fail('unsupported_markdown_html', node.tagName);
    const key = (
      {
        b: 'bold',
        strong: 'bold',
        i: 'italic',
        em: 'italic',
        u: 'underline',
        s: 'strike',
        del: 'strike',
        code: 'code',
      } as Record<string, string>
    )[node.tagName];
    if (key) marks[key] = true;
    for (const attr of node.attrs) {
      if (node.tagName === 'a' && attr.name === 'href') marks.link = attr.value;
      else if (attr.name === 'style') {
        for (const declaration of attr.value
          .split(';')
          .filter(value => value.trim())) {
          const match = /^\s*(color|background-color)\s*:\s*([^;]+)\s*$/.exec(
            declaration
          );
          if (!match) fail('unsupported_markdown_html_style');
          marks[match[1] === 'color' ? 'color' : 'background'] =
            match[2].trim();
        }
      } else fail('unsupported_markdown_html_attribute', attr.name);
    }
    return marks;
  };
  const inline = (
    nodes: Node[],
    inherited: Record<string, unknown> = {}
  ): NativeTextRun[] => {
    const result: NativeTextRun[] = [];
    const stack: { tag: string; marks: Record<string, unknown> }[] = [];
    const marks = () =>
      Object.assign({}, inherited, ...stack.map(item => item.marks));
    for (const node of nodes) {
      if (
        node.type === 'text' ||
        node.type === 'inlineCode' ||
        node.type === 'break'
      ) {
        result.push({
          insert: node.type === 'break' ? '\n' : (node.value ?? ''),
          attributes: {
            ...marks(),
            ...(node.type === 'inlineCode' ? { code: true } : {}),
          },
        });
      } else if (
        ['strong', 'emphasis', 'delete', 'link', 'linkReference'].includes(
          node.type
        )
      ) {
        const attributes = { ...marks() };
        if (node.type === 'link' || node.type === 'linkReference') {
          const url = node.url ?? definitions.get(node.identifier ?? '')?.url;
          if (!url) fail('unresolved_markdown_reference');
          attributes.link = url;
        } else
          attributes[
            node.type === 'strong'
              ? 'bold'
              : node.type === 'emphasis'
                ? 'italic'
                : 'strike'
          ] = true;
        result.push(...inline(node.children ?? [], attributes));
      } else if (node.type === 'html') {
        const source = node.value ?? '',
          close = /^<\/([a-z]+)\s*>$/i.exec(source);
        if (close) {
          if (stack.pop()?.tag !== close[1].toLowerCase())
            fail('unbalanced_markdown_html');
          continue;
        }
        const fragment = parseFragment(source);
        const children = fragment.childNodes;
        if (children.length !== 1 || !('tagName' in children[0]))
          fail('unsupported_markdown_inline_html');
        const element = children[0],
          attributes = htmlMarks(element);
        if (element.tagName === 'br')
          result.push({ insert: '\n', attributes: marks() });
        else if (element.childNodes.length) {
          const visit = (
            child: DefaultTreeAdapterMap['childNode'],
            parent: Record<string, unknown>
          ) => {
            if (child.nodeName === '#text' && 'value' in child)
              result.push({ insert: child.value, attributes: parent });
            else if ('tagName' in child) {
              const next = { ...parent, ...htmlMarks(child) };
              if (child.tagName === 'br')
                result.push({ insert: '\n', attributes: next });
              else child.childNodes.forEach(nested => visit(nested, next));
            } else fail('unsupported_markdown_html_node');
          };
          element.childNodes.forEach(child =>
            visit(child, { ...marks(), ...attributes })
          );
        } else stack.push({ tag: element.tagName, marks: attributes });
      } else fail('unsupported_markdown_inline', node.type);
    }
    if (stack.length) fail('unbalanced_markdown_html');
    return result;
  };
  const project = (nodes: Node[], depth = 0): ProjectedBlock[] => {
    if (depth > 64) fail('markdown_nesting_limit');
    return nodes.flatMap((node): ProjectedBlock[] => {
      if (node.type === 'definition') return [];
      if (node.type === 'paragraph' || node.type === 'heading') {
        const only = node.children?.length === 1 ? node.children[0] : undefined;
        if (only && ['image', 'imageReference'].includes(only.type)) {
          const url = only.url ?? definitions.get(only.identifier ?? '')?.url;
          if (!url) fail('unresolved_markdown_reference');
          return [
            {
              flavour: 'affine:image',
              assetUrl: url,
              properties: { caption: only.alt ?? '' },
            },
          ];
        }
        return [
          {
            flavour: 'affine:paragraph',
            text: inline(node.children ?? []),
            properties: {
              type: node.type === 'heading' ? `h${node.depth}` : 'text',
            },
          },
        ];
      }
      if (node.type === 'code')
        return [
          {
            flavour: 'affine:code',
            text: [{ insert: node.value ?? '' }],
            properties: { language: node.lang ?? null },
          },
        ];
      if (node.type === 'thematicBreak') return [{ flavour: 'affine:divider' }];
      if (node.type === 'html')
        return [
          {
            flavour: 'affine:paragraph',
            properties: { type: 'text' },
            text: inline([node]),
          },
        ];
      if (node.type === 'blockquote') {
        const children = project(node.children ?? [], depth + 1);
        return children.map(child => {
          if (child.flavour !== 'affine:paragraph')
            fail('unsupported_markdown_quote_structure');
          return {
            ...child,
            properties: { ...child.properties, type: 'quote' },
          };
        });
      }
      if (node.type === 'list')
        return (node.children ?? []).map((item, index) => {
          const children = project(item.children ?? [], depth + 1),
            first = children.shift();
          if (first && first.flavour !== 'affine:paragraph')
            fail('unsupported_markdown_list_lead');
          return {
            flavour: 'affine:list',
            text: first?.text ?? [],
            children,
            properties: {
              type:
                item.checked !== null && item.checked !== undefined
                  ? 'todo'
                  : node.ordered
                    ? 'numbered'
                    : 'bulleted',
              ...(item.checked !== null && item.checked !== undefined
                ? { checked: item.checked }
                : {}),
              ...(node.ordered ? { order: (node.start ?? 1) + index } : {}),
            },
          };
        });
      if (node.type === 'table') {
        const align = node.align?.filter(value => value !== null) ?? [];
        if (
          new Set(align).size > 1 ||
          (align.length && align.length !== node.align?.length)
        )
          fail('per_column_alignment_not_representable');
        return [
          {
            flavour: 'affine:table',
            properties: align.length ? { textAlign: align[0] } : {},
            cells: (node.children ?? []).map(row =>
              (row.children ?? []).map(cell => inline(cell.children ?? []))
            ),
          },
        ];
      }
      return fail('unsupported_markdown_node', node.type);
    });
  };
  const projected = project(tree.children ?? []);
  const parentId = context.resolve(command.parentId);
  const childrenOf = (id: string) => {
    const value = context.blockById(id).get('sys:children');
    if (!(value instanceof Y.Array)) fail('invalid_children', id);
    return value.toArray() as string[];
  };
  const siblings = childrenOf(parentId),
    selected = command.selectedBlockIds.map(context.resolve);
  if (
    new Set(selected).size !== selected.length ||
    selected.some(id => !siblings.includes(id))
  )
    fail('invalid_markdown_scope');
  const indexes = selected
    .map(id => siblings.indexOf(id))
    .sort((a, b) => a - b);
  if (
    command.mode === 'replace_selected' &&
    indexes.some((index, at) => at && index !== indexes[at - 1] + 1)
  )
    fail('markdown_scope_must_be_contiguous');
  if (command.index !== undefined && command.index > siblings.length)
    fail('invalid_child_index');
  const scoped = new Set<string>();
  const collect = (id: string, depth = 0) => {
    if (depth > 64 || scoped.has(id)) fail('invalid_markdown_scope');
    scoped.add(id);
    childrenOf(id).forEach(child => collect(child, depth + 1));
  };
  selected.forEach(id => collect(id));
  const mappings = new Map(
    command.mappings.map(mapping => [
      mapping.path,
      { ...mapping, blockId: context.resolve(mapping.blockId) },
    ])
  );
  const mappedIds = new Set(
    [...mappings.values()].map(mapping => mapping.blockId)
  );
  if (
    mappings.size !== command.mappings.length ||
    mappedIds.size !== mappings.size
  )
    fail('identity_ambiguous');
  if ([...mappedIds].some(id => !scoped.has(id)))
    fail('mapping_outside_markdown_scope');
  const output: DocumentNativeCommand[] = [],
    used = new Set<string>();
  const prefix = `markdown:${createHash('sha256').update(command.opId).digest('hex').slice(0, 16)}`;
  let sequence = 0;
  const emit = (value: object) =>
    output.push(
      documentNativeCommand.parse({ ...value, opId: `${prefix}:${sequence++}` })
    );
  const virtual = new Map<string, string[]>();
  for (const [id] of context.blocks) virtual.set(id, childrenOf(id));
  const insert = (id: string, parentId: string, index: number) => {
    for (const children of virtual.values()) {
      const at = children.indexOf(id);
      if (at >= 0) children.splice(at, 1);
    }
    const children = virtual.get(parentId) ?? [];
    index = Math.min(index, children.length);
    children.splice(index, 0, id);
    virtual.set(parentId, children);
    return index;
  };
  const visit = (
    node: ProjectedBlock,
    path: string,
    parentId: string,
    index: number
  ) => {
    const mapping = mappings.get(path),
      existing = mapping ? context.blockById(mapping.blockId) : undefined;
    const reference = `${prefix}:${path}`,
      id = mapping?.blockId ?? `$${reference}`;
    used.add(path);
    if (existing) {
      const flavour = String(existing.get('sys:flavour'));
      if (flavour !== node.flavour) {
        if (
          ![flavour, node.flavour].every(value =>
            [
              'affine:paragraph',
              'affine:list',
              'affine:code',
              'affine:callout',
            ].includes(value)
          )
        )
          fail('markdown_type_conversion_requires_native_command', id);
        emit({ type: 'block.convert', blockId: id, flavour: node.flavour });
      }
      const currentParent = [...virtual].find(([, children]) =>
        children.includes(id)
      );
      if (!currentParent) fail('ambiguous_parent', id);
      const previousIndex = currentParent[1].indexOf(id);
      const desired = insert(id, parentId, index);
      if (currentParent[0] !== parentId || previousIndex !== desired)
        emit({ type: 'block.move', blockId: id, parentId, index: desired });
      if (node.text) {
        const text = existing.get('prop:text');
        if (!(text instanceof Y.Text)) fail('invalid_text_storage', id);
        emit({
          type: 'text.splice',
          target: { kind: 'block_text', blockId: id, field: 'text' },
          offset: 0,
          deleteCount: text.length,
          insert: node.text,
          marksPolicy:
            command.marksPolicy === 'preserve_existing'
              ? 'preserve_existing'
              : 'explicit',
        });
      }
    } else {
      const desired = insert(id, parentId, index);
      virtual.set(id, []);
      emit({
        type: 'block.create',
        clientRef: reference,
        parentId,
        index: desired,
        flavour: node.flavour,
        ...(node.text ? { text: node.text } : {}),
      });
    }
    if (node.properties && Object.keys(node.properties).length)
      emit({
        type: 'block.properties',
        blockId: id,
        flavour: node.flavour,
        properties: node.properties,
      });
    if (node.assetUrl) {
      const assets = command.assets.filter(
        asset => asset.url === node.assetUrl
      );
      if (assets.length !== 1)
        fail('markdown_image_requires_asset_binding', node.assetUrl);
      emit({ type: 'block.asset.set', blockId: id, blobId: assets[0].blobId });
    }
    if (node.cells) {
      const axes = (
        axis: 'row' | 'column',
        count: number,
        declared?: (string | null)[]
      ) => {
        const pattern = new RegExp(`^prop:${axis}s\\.([^.]+)\\.${axis}Id$`);
        const previous = existing
          ? [...existing.keys()].flatMap(key => {
              const match = pattern.exec(key);
              return match ? [match[1]] : [];
            })
          : [];
        if (existing && (!declared || declared.length !== count))
          fail('table_identity_mapping_required', id);
        const values =
            declared ??
            Array.from({ length: count }, (): string | null => null),
          reused = values.filter(value => value !== null).map(context.resolve);
        if (
          new Set(reused).size !== reused.length ||
          reused.some(value => !previous.includes(value))
        )
          fail('identity_ambiguous', id);
        const ordered = [...previous].sort((a, b) => {
          const left = String(existing?.get(`prop:${axis}s.${a}.order`)),
            right = String(existing?.get(`prop:${axis}s.${b}.order`));
          return left < right ? -1 : left > right ? 1 : 0;
        });
        const ids = values.map((value, index) => {
          const ref = `${reference}:${axis}:${index}`,
            axisId = value === null ? `$${ref}` : context.resolve(value);
          if (value === null)
            emit({
              type: 'table.axis.insert',
              blockId: id,
              axis,
              clientRef: ref,
              index,
            });
          else if (ordered.indexOf(axisId) !== index)
            emit({
              type: 'table.axis.move',
              blockId: id,
              axis,
              id: axisId,
              index,
            });
          const at = ordered.indexOf(axisId);
          if (at >= 0) ordered.splice(at, 1);
          ordered.splice(index, 0, axisId);
          return axisId;
        });
        if (command.mode === 'replace_selected')
          for (const old of previous.filter(value => !reused.includes(value)))
            emit({ type: 'table.axis.delete', blockId: id, axis, id: old });
        return ids;
      };
      const width = node.cells[0]?.length ?? 0;
      if (!width || node.cells.some(row => row.length !== width))
        fail('invalid_markdown_table');
      const rows = axes('row', node.cells.length, mapping?.rowIds),
        columns = axes('column', width, mapping?.columnIds);
      emit({
        type: 'table.cells.set',
        blockId: id,
        rowIds: rows,
        columnIds: columns,
        cells: node.cells,
        marksPolicy:
          command.marksPolicy === 'preserve_existing'
            ? 'preserve_existing'
            : 'explicit',
      });
    }
    node.children?.forEach((child, index) =>
      visit(child, `${path}/${index}`, id, index)
    );
  };
  const start = command.index ?? indexes[0] ?? siblings.length;
  projected.forEach((node, index) =>
    visit(node, String(index), parentId, start + index)
  );
  if ([...mappings.keys()].some(path => !used.has(path)))
    fail('unused_markdown_identity_mapping');
  if (command.mode === 'replace_selected') {
    const deleted = new Set([...scoped].filter(id => !mappedIds.has(id)));
    for (const id of deleted) {
      const owner = [...virtual].find(([, children]) =>
        children.includes(id)
      )?.[0];
      if (owner && !deleted.has(owner))
        emit({
          type: 'block.delete',
          blockId: id,
          includeDescendants: true,
          references: 'reject',
        });
    }
  }
  return output;
}
