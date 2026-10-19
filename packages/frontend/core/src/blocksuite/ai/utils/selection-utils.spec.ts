/**
 * @vitest-environment happy-dom
 */
import { type EditorHost, TextSelection } from '@blocksuite/affine/std';
import { type BlockModel, Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { getStoreManager } from '../../manager/store';
import { extractSelectedContent } from './extract';
import type * as SelectionUtils from './selection-utils';
import { getSelectedTextContent } from './selection-utils';

// Only attachment capture is stubbed; text selection, snapshots and Markdown
// serialization use the production path.
const capture = vi.hoisted(() => ({ images: [] as File[] }));
vi.mock('./selection-utils', async importOriginal => ({
  ...(await importOriginal<typeof SelectionUtils>()),
  getSelectedImagesAsBlobs: async () => capture.images,
  getSelectedAttachments: async () => [],
}));

const cleanup: Array<() => void> = [];
afterEach(() => {
  cleanup.splice(0).forEach(dispose => dispose());
  capture.images = [];
});

function fixture() {
  const workspace = new TestWorkspace();
  workspace.storeExtensions = getStoreManager()
    .config.init()
    .value.get('store');
  workspace.meta.initialize();
  const doc = workspace.createDoc();
  doc.load();
  const store = doc.getStore();
  cleanup.push(() => {
    store.dispose();
    workspace.dispose();
  });
  const root = store.addBlock('affine:page', {});
  const note = store.addBlock('affine:note', {}, root);
  const selectedModels: BlockModel[] = [];
  let selection: TextSelection | undefined;
  const host = {
    store,
    std: {
      store,
      command: { exec: () => [true, { selectedModels }] },
      get: () => ({ getEditorMode: () => 'page' }),
    },
    selection: { find: () => selection },
  } as unknown as EditorHost;
  const add = (
    text: string,
    flavour = 'affine:paragraph',
    props: Record<string, unknown> = {}
  ) => {
    const id = store.addBlock(
      flavour,
      { text: new Text(text), ...props },
      note
    );
    selectedModels.push(store.getModelById(id)!);
    return id;
  };
  return {
    add,
    extract: () => extractSelectedContent(host),
    read: () => getSelectedTextContent(host, 'ai-context'),
    readMarkdown: () => getSelectedTextContent(host, 'markdown'),
    select: (blockId: string, index: number, length: number) => {
      selection = new TextSelection({
        from: { blockId, index, length },
        to: null,
      });
    },
  };
}

describe('selection context serialization', () => {
  test('preserves consecutive empty blocks, whitespace-only blocks and paragraph boundaries', async () => {
    const f = fixture();
    for (const text of ['第一段', '', '', '  ', '\t', '第二段']) f.add(text);

    // The export serializer encodes the first of the two spaces; the AI
    // representation must retain the source whitespace instead.
    expect(await f.readMarkdown()).toContain('&#x20;');
    expect(await f.read()).toBe('第一段\n\n\n  \n\t\n第二段\n');
  });

  test('preserves whitespace within a paragraph, including leading and trailing indentation', async () => {
    const f = fixture();
    const source = '  第一行  \n  \n\t第三行  ';
    f.add(source);
    expect(await f.read()).toBe(`${source}\n`);
  });

  test('preserves literal entities without decoding or adding escapes', async () => {
    const f = fixture();
    const lines = ['&#x20;', '&#32;', '&nbsp;', '\\&#x20;', '  &#x20;  '];
    lines.forEach(text => f.add(text));
    expect(await f.read()).toBe(`${lines.join('\n')}\n`);
  });

  test('preserves code indentation, blank lines and literal entities in code', async () => {
    const f = fixture();
    const source =
      'if (ready) {\n\tconst text = "&#x20;";\n\n    return text;\n}\n&#x20;';
    f.add(source, 'affine:code', { language: 'javascript' });
    expect(await f.read()).toBe(`\`\`\`javascript\n${source}\n\`\`\`\n`);
  });

  test('preserves the exact selected substring and does not include unselected text', async () => {
    const f = fixture();
    const selected = '  \n\n&#x20;\n\t正文  ';
    const id = f.add(`prefix${selected}suffix`);
    f.select(id, 'prefix'.length, selected.length);
    expect(await f.read()).toBe(`${selected}\n`);
  });

  test('keeps heading, list and inline code structure', async () => {
    const f = fixture();
    f.add('标题', 'affine:paragraph', { type: 'h2' });
    f.add('条目', 'affine:list', { type: 'bulleted' });
    const text = new Text([{ insert: '&#x20;', attributes: { code: true } }]);
    f.add('', 'affine:paragraph', { text });
    const result = await f.read();
    expect(result).toContain('## 标题\n');
    expect(result).toContain('* 条目\n');
    expect(result).toContain('`&#x20;`\n');
  });

  test.each([false, true])(
    'extracts the same whitespace-preserving context with images: %s',
    async withImage => {
      const f = fixture();
      const source = '  第一段\n\n  \n\t&#x20;  ';
      f.add(source);
      if (withImage) capture.images = [new File(['image'], 'selection.png')];
      const context = await f.extract();
      expect(context?.markdown).toBe(`${source}\n`);
      expect(context?.quote).toContain(source);
      if (withImage) expect(context?.images).toEqual(capture.images);
    }
  );
});
