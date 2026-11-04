import { createHash } from 'node:crypto';

import * as Y from 'yjs';

import { createDocWithMarkdown } from '../../native';
import type { DocumentDependencies } from './document-dependencies';
import { editNativeDocument, loadNativeDocument } from './document-editor';
import { ResourceError } from './resource-types';

/** Deterministic domain identities; CRDT client clocks remain native Yjs clocks. */
export function createNativeDocument(input: {
  title: string;
  documentId: string;
  actorId: string;
  operationId: string;
  commands?: unknown;
  dependencies?: DocumentDependencies;
}) {
  const source = loadNativeDocument(
    createDocWithMarkdown(input.title, '', input.documentId)
  );
  const doc = new Y.Doc();
  try {
    const old = source.getMap<Y.Map<unknown>>('blocks'),
      blocks = doc.getMap<Y.Map<unknown>>('blocks');
    const identities: Record<string, string> = {};
    const mapping = new Map<string, string>();
    for (const [index, [id, block]] of [...old].entries()) {
      const flavour = String(block.get('sys:flavour'));
      const name =
        flavour === 'affine:page'
          ? 'page'
          : flavour === 'affine:note'
            ? 'note'
            : flavour === 'affine:surface'
              ? 'surface'
              : `initial-${index}`;
      const next = createHash('sha256')
        .update(JSON.stringify([input.operationId, name]))
        .digest('base64url')
        .slice(0, 21);
      identities[name] = next;
      mapping.set(id, next);
    }
    for (const [id, block] of old) {
      const copy = block.clone(),
        next = mapping.get(id);
      if (!next) throw new ResourceError('unsupported_document_structure');
      blocks.set(next, copy);
      copy.set('sys:id', next);
      const children = copy.get('sys:children') as Y.Array<string>;
      const ids = children.toArray().map(id => {
        const next = mapping.get(id);
        if (!next) throw new ResourceError('unsupported_document_structure');
        return next;
      });
      children.delete(0, children.length);
      children.insert(0, ids);
    }
    const bin = Y.encodeStateAsUpdate(doc);
    if (input.commands) {
      const edit = editNativeDocument({
        ...input,
        bin,
        commands: input.commands,
        now: Date.now(),
        initialReferences: identities,
      });
      Y.applyUpdate(doc, edit.update);
      Object.assign(identities, edit.identities);
    }
    return { bin: Y.encodeStateAsUpdate(doc), identities };
  } finally {
    doc.destroy();
    source.destroy();
  }
}
