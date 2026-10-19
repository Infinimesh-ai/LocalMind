import { type DefaultTreeAdapterTypes, parse, serialize } from 'parse5';

import { sha256Base64 } from './sha256';
import { wrapDeckHtml } from './shell';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
const V1_SCRIPT_HASH = 'kuUz5uBcGJRbaJui+v5EnGGyi7qPlZbKUwRUQOjMF3w=';
const V2_SCRIPT_HASH = 'R7T9kjbGeVYZVdG6amLxwYXUMayZ1D+lYFh5q362MEo=';
const V2_FULLSCREEN_SCRIPT_HASH =
  'jQgUoKP//k3SXA8QwRH2vcq2iC7DpraroFqVlCQBFzQ=';
const attr = (node: Element, name: string) =>
  node.attrs.find(a => a.name === name)?.value;
const text = (node: Element) =>
  node.childNodes
    .map(n =>
      n.nodeName === '#text'
        ? (n as DefaultTreeAdapterTypes.TextNode).value
        : ''
    )
    .join('');

/** Read-time compatibility; never rewrites stored evidence or invokes a model. */
export function upgradeDeckHtml(html: string): string {
  if (!html.includes('id="deck-stage"')) return html;
  const document = parse(html);
  const elements: Element[] = [];
  const visit = (node: Node) => {
    if ('tagName' in node) elements.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(document);
  const scripts = elements.filter(e => e.tagName === 'script');
  // Recognize only exact trusted historical shells, never arbitrary scripts.
  if (scripts.length !== 1) return html;
  const hash = sha256Base64(text(scripts[0]));
  if (
    hash !== V1_SCRIPT_HASH &&
    hash !== V2_SCRIPT_HASH &&
    hash !== V2_FULLSCREEN_SCRIPT_HASH
  )
    return html;
  const root = elements.find(e => e.tagName === 'html');
  const stage = elements.find(
    e => e.tagName === 'main' && attr(e, 'id') === 'deck-stage'
  );
  const styles = elements.filter(e => e.tagName === 'style');
  if (!root || !stage || styles.length !== (hash === V1_SCRIPT_HASH ? 2 : 3))
    return html;
  const title = elements.find(e => e.tagName === 'title');
  return wrapDeckHtml({
    title: title ? text(title) : '',
    lang: attr(root, 'lang') ?? 'zh-CN',
    css: text(styles[1]),
    slidesHtml: serialize(stage),
  });
}
