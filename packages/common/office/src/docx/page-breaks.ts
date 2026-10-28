import type { DocxParagraph, DocxRun, DocxRunContent } from './semantic';

const textOf = (content: DocxRunContent) =>
  content.type === 'text'
    ? content.text
    : content.type === 'tab'
      ? '\t'
      : content.type === 'break'
        ? content.breakType === 'page'
          ? '\f'
          : '\n'
        : content.type === 'noBreakHyphen'
          ? '\u2011'
          : content.type === 'softHyphen'
            ? '\u00ad'
            : '';

/** Derived page fragments retain one source paragraph and logical offsets. */
export function splitDocxParagraphPages(paragraph: DocxParagraph) {
  const fragments: Array<{
    paragraph: DocxParagraph;
    offset: number;
    objectOffset: number;
  }> = [];
  let runs: DocxRun[] = [],
    offset = 0,
    start = 0,
    objects = 0,
    objectStart = 0;
  const flush = () => {
    fragments.push({
      paragraph: {
        ...paragraph,
        properties: fragments.length
          ? {
              ...paragraph.properties,
              pageBreakBefore: false,
              spacing: { ...paragraph.properties?.spacing, beforePt: 0 },
            }
          : paragraph.properties,
        runs,
        text: runs.flatMap(run => run.content.map(textOf)).join(''),
      },
      offset: start,
      objectOffset: objectStart,
    });
    runs = [];
    start = offset + 1;
    objectStart = objects;
  };
  const append = (run: DocxRun, content: DocxRunContent) => {
    runs.push({ ...run, content: [content] });
    offset += textOf(content).length;
    if (content.type === 'object') objects++;
  };
  for (const run of paragraph.runs)
    for (const content of run.content) {
      if (content.type === 'break' && content.breakType === 'page') {
        flush();
        offset++;
      } else if (content.type === 'text' && content.text.includes('\f')) {
        for (const [index, text] of content.text.split('\f').entries()) {
          if (index) {
            flush();
            offset++;
          }
          if (text) append(run, { ...content, text });
        }
      } else append(run, content);
    }
  if (!fragments.length) return [{ paragraph, offset: 0, objectOffset: 0 }];
  flush();
  return fragments;
}
