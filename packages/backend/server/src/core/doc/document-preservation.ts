import { isDeepStrictEqual } from 'node:util';

import * as Y from 'yjs';

import { documentBlockVersions } from './document-schema';
import { ResourceError } from './resource-types';

/** Runtime postconditions supplement each adapter's field-level operations. */
export function captureDocumentPreservation(doc: Y.Doc) {
  const blocks = doc.getMap<Y.Map<unknown>>('blocks');
  const texts = new Map<string, Y.Text>();
  const created = new Map<string, Map<string, unknown>>();
  const opaqueBlocks = new Map<string, unknown>();
  const roots = new Map([...doc.share].filter(([key]) => key !== 'blocks'));
  const visit = (
    value: unknown,
    path: string[],
    result: Map<string, Y.Text>
  ) => {
    if (value instanceof Y.Text) result.set(JSON.stringify(path), value);
    else if (value instanceof Y.Map)
      for (const [key, child] of value) visit(child, [...path, key], result);
    // Array positions are not identities. A moved view/column is checked by its
    // domain adapter; its nested identity cannot be inferred from an index.
  };
  visit(blocks, [], texts);
  for (const [id, block] of blocks) {
    created.set(
      id,
      new Map(
        [...block].filter(([key]) => /^prop:meta:created(?:At|By)$/.test(key))
      )
    );
    const flavour = block.get('sys:flavour');
    if (
      typeof flavour !== 'string' ||
      !Object.hasOwn(documentBlockVersions, flavour)
    )
      opaqueBlocks.set(id, block.toJSON());
  }
  return () => {
    const fail = () => {
      throw new ResourceError('preservation_failed');
    };
    for (const [key, value] of roots) if (doc.share.get(key) !== value) fail();
    for (const [id, values] of created) {
      const block = blocks.get(id);
      if (block)
        for (const [key, value] of values)
          if (!isDeepStrictEqual(block.get(key), value)) fail();
    }
    for (const [id, value] of opaqueBlocks) {
      const block = blocks.get(id);
      if (!block || !isDeepStrictEqual(block.toJSON(), value)) fail();
    }
    const current = new Map<string, Y.Text>();
    visit(blocks, [], current);
    let survivingTexts = 0;
    for (const [path, text] of texts) {
      const next = current.get(path);
      if (next) {
        if (next !== text) fail();
        survivingTexts++;
      }
    }
    return {
      preservationVerified: true as const,
      preservation: {
        checks: [
          'surviving_text_identity',
          'creation_evidence',
          'opaque_blocks',
          'opaque_root_identity',
        ],
        survivingTexts,
        opaqueBlocks: opaqueBlocks.size,
      },
    };
  };
}
