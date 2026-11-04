import { type DefaultTreeAdapterMap, parseFragment } from 'parse5';

/** Validate without rewriting markup: rejection cannot silently sanitize data. */
export function isPassiveDocumentMarkup(html: string) {
  const document = parseFragment(html);
  const visit = (node: DefaultTreeAdapterMap['node']): boolean => {
    if ('tagName' in node) {
      if (
        ['script', 'iframe', 'object', 'embed', 'base', 'form'].includes(
          node.tagName
        )
      )
        return false;
      for (const attribute of node.attrs) {
        if (
          attribute.name.startsWith('on') ||
          ['srcdoc', 'formaction'].includes(attribute.name)
        )
          return false;
        if (['href', 'src', 'action', 'xlink:href'].includes(attribute.name)) {
          const value = [...attribute.value.trim()]
            .filter(character => character.charCodeAt(0) > 32)
            .join('');
          if (/^(?:javascript|vbscript|data):/i.test(value)) return false;
        }
        if (node.tagName === 'meta' && attribute.name === 'http-equiv')
          return false;
      }
    }
    if ('content' in node && node.content && !visit(node.content)) return false;
    return !('childNodes' in node) || node.childNodes.every(visit);
  };
  return visit(document);
}
