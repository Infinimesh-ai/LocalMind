import type { OrderedXmlNode } from './xml';

// Only rebuild structures whose complete semantics are represented by the editor.
// Other paragraphs remain readable and their original XML is preserved.
const allowed: Record<string, ReadonlySet<string>> = {
  p: new Set(['pPr', 'r']),
  pPr: new Set([
    'pStyle',
    'jc',
    'outlineLvl',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'numPr',
    'spacing',
    'ind',
  ]),
  numPr: new Set(['numId', 'ilvl']),
  r: new Set(['rPr', 't', 'br', 'tab']),
  rPr: new Set([
    'rFonts',
    'sz',
    'szCs',
    'color',
    'b',
    'i',
    'u',
    'strike',
    'highlight',
    'vertAlign',
    'lang',
  ]),
};
const supportedAttributes: Record<string, ReadonlySet<string>> = {
  p: new Set([
    'paraId',
    'textId',
    'rsidR',
    'rsidRDefault',
    'rsidP',
    'rsidDel',
    'rsidRPr',
  ]),
  r: new Set(['rsidR', 'rsidDel', 'rsidRPr']),
  pPr: new Set(),
  rPr: new Set(),
  numPr: new Set(),
  tab: new Set(),
  t: new Set(['space']),
  spacing: new Set(['before', 'after', 'line', 'lineRule']),
  ind: new Set(['left', 'right', 'firstLine', 'hanging']),
  rFonts: new Set(['ascii', 'hAnsi', 'eastAsia', 'cs']),
  color: new Set(['val', 'themeColor']),
  lang: new Set(['val']),
  u: new Set(['val', 'color']),
  br: new Set(['type']),
};
export function isEditableParagraphXml(node: OrderedXmlNode): boolean {
  for (const [key, value] of Object.entries(node)) {
    if (key === ':@' || key === '#text') continue;
    const name = key.split(':').pop() ?? key;
    if (!Array.isArray(value)) return false;
    const children = value as OrderedXmlNode[];
    const attrs = (node[':@'] ?? {}) as Record<string, string>;
    const acceptedAttributes = supportedAttributes[name] ?? new Set(['val']);
    if (
      Object.keys(attrs).some(
        key =>
          !key.startsWith('xmlns') &&
          !acceptedAttributes.has(key.split(':').pop() ?? key)
      )
    )
      return false;
    const attr = (name: string) =>
      Object.entries(attrs).find(([k]) => k.split(':').pop() === name)?.[1];
    if (
      name === 'br' &&
      attr('type') &&
      !['textWrapping', 'page'].includes(attr('type') ?? '')
    )
      return false;
    if (name === 'spacing' && attr('line') && attr('lineRule') !== 'exact')
      return false;
    if (name === 'rFonts' && Object.keys(attrs).some(k => /theme/i.test(k)))
      return false;
    if (name === 'color' && (attr('themeTint') || attr('themeShade')))
      return false;
    if (name === 'lang' && (attr('eastAsia') || attr('bidi'))) return false;
    if (allowed[name]) {
      for (const child of children) {
        const childKey = Object.keys(child).find(k => k !== ':@');
        if (
          !childKey ||
          !allowed[name].has(childKey.split(':').pop() ?? childKey) ||
          !isEditableParagraphXml(child)
        )
          return false;
      }
    } else if (
      children.some(c => Object.keys(c).some(k => k !== '#text' && k !== ':@'))
    )
      return false;
  }
  return true;
}
