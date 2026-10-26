import { type DefaultTreeAdapterTypes, parse, serialize } from 'parse5';

import {
  REPORT_RUNTIME_HASH,
  REPORT_RUNTIME_HEAD_HASH,
  REPORT_RUNTIME_SCRIPT,
} from './runtime';
import { sha256Base64 } from './sha256';
import {
  DECK_SHELL_SCRIPT,
  DECK_SHELL_SCRIPT_HASH,
  wrapDeckHtml,
} from './shell';

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
const V1_SCRIPT_HASH = 'kuUz5uBcGJRbaJui+v5EnGGyi7qPlZbKUwRUQOjMF3w=';
const V2_SCRIPT_HASH = 'R7T9kjbGeVYZVdG6amLxwYXUMayZ1D+lYFh5q362MEo=';
const V2_FULLSCREEN_SCRIPT_HASH =
  'jQgUoKP//k3SXA8QwRH2vcq2iC7DpraroFqVlCQBFzQ=';
const WEB_SCROLL_SCRIPT_HASH = 'PCRGc87DW2uqOrPGEgBdPmg9DdxMPSEqIB4KhL1J7IA=';
const WEB_REVEAL_RUNTIME_HASH = 'N9dMp7b2wD2wk5mEmjfi0SaAXQdu3klMjYNs9WVuvdI=';
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
  const hashes = scripts.map(e => sha256Base64(text(e)));
  const replacements = new Map([
    [WEB_SCROLL_SCRIPT_HASH, DECK_SHELL_SCRIPT],
    [WEB_REVEAL_RUNTIME_HASH, REPORT_RUNTIME_SCRIPT],
  ]);
  if (hashes.some(hash => replacements.has(hash))) {
    // Upgrade exact trusted runtimes and their CSP hashes at read time only.
    // Preserve all content, design CSS and immutable stored evidence.
    const shellHashes = new Set([
      WEB_SCROLL_SCRIPT_HASH,
      DECK_SHELL_SCRIPT_HASH,
    ]);
    const runtimeHashes = new Set([
      WEB_REVEAL_RUNTIME_HASH,
      REPORT_RUNTIME_HASH,
    ]);
    const allowed = new Set([
      ...shellHashes,
      ...runtimeHashes,
      REPORT_RUNTIME_HEAD_HASH,
    ]);
    if (
      scripts.some(e => attr(e, 'src') !== undefined) ||
      new Set(hashes).size !== scripts.length ||
      !hashes.every(hash => allowed.has(hash)) ||
      hashes.filter(hash => shellHashes.has(hash)).length !== 1 ||
      (scripts.length !== 1 &&
        !(
          scripts.length === 3 &&
          hashes.includes(REPORT_RUNTIME_HEAD_HASH) &&
          hashes.filter(hash => runtimeHashes.has(hash)).length === 1
        ))
    )
      return html;
    const policies = elements.filter(
      e =>
        e.tagName === 'meta' &&
        attr(e, 'http-equiv')?.toLowerCase() === 'content-security-policy'
    );
    if (policies.length !== 1) return html;
    const policy = policies[0].attrs.find(a => a.name === 'content');
    if (
      !policy ||
      !hashes.every(hash => policy.value.includes(`'sha256-${hash}'`))
    )
      return html;
    if (
      scripts.some(
        script =>
          script.childNodes.length !== 1 ||
          script.childNodes[0]?.nodeName !== '#text'
      )
    )
      return html;
    scripts.forEach((script, index) => {
      const replacement = replacements.get(hashes[index]);
      if (!replacement) return;
      (script.childNodes[0] as DefaultTreeAdapterTypes.TextNode).value =
        replacement;
      policy.value = policy.value.replaceAll(
        `'sha256-${hashes[index]}'`,
        `'sha256-${sha256Base64(replacement)}'`
      );
    });
    return serialize(document);
  }
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
