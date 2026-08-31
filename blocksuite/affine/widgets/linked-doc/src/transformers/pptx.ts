import type { ExtensionType, Schema, Workspace } from '@blocksuite/store';
import JSZip from 'jszip';

import { HtmlTransformer } from './html.js';
import {
  createOfficeHtmlDocument,
  directChildrenByLocalName,
  elementsByLocalName,
  firstElementByLocalName,
  officeFileName,
  type OfficeHtmlResult,
  readOfficeXml,
  relationshipId,
  relationshipTargets,
  resolveOfficePart,
  textFromRuns,
} from './office.js';

type ImportPptxOptions = {
  collection: Workspace;
  schema: Schema;
  imported: Blob;
  extensions: ExtensionType[];
};

const MAX_SLIDES = 200;
const MAX_PARAGRAPHS = 5_000;
const MAX_TABLE_CELLS = 50_000;
const MAX_TEXT_CHARACTERS = 500_000;

function paragraphText(paragraph: Element) {
  return (
    directChildrenByLocalName(paragraph, 'r')
      .flatMap(run => elementsByLocalName(run, 't'))
      .map(element => element.textContent ?? '')
      .join('') || textFromRuns(paragraph)
  );
}

function shapeParagraphs(shape: Element) {
  return elementsByLocalName(shape, 'p')
    .map(paragraphText)
    .map(text => text.trim())
    .filter(Boolean);
}

function isTitleShape(shape: Element) {
  const placeholder = firstElementByLocalName(shape, 'ph');
  const type = placeholder?.getAttribute('type');
  return type === 'title' || type === 'ctrTitle';
}

function appendSlideTable(
  output: Document,
  tableElement: Element,
  budget: { cells: number; characters: number }
) {
  const table = output.createElement('table');
  const body = output.createElement('tbody');

  for (const rowElement of directChildrenByLocalName(tableElement, 'tr')) {
    const row = output.createElement('tr');
    for (const cellElement of directChildrenByLocalName(rowElement, 'tc')) {
      budget.cells += 1;
      if (budget.cells > MAX_TABLE_CELLS) {
        throw new Error(
          `The presentation exceeds the ${MAX_TABLE_CELLS}-table-cell import limit.`
        );
      }
      const cell = output.createElement('td');
      const text = textFromRuns(cellElement).trim();
      budget.characters += text.length;
      cell.textContent = text;
      row.append(cell);
    }
    body.append(row);
  }

  if (body.children.length) {
    table.append(body);
    output.body.append(table);
  }
}

function appendSlide(
  output: Document,
  slide: Document,
  slideNumber: number,
  budget: { paragraphs: number; cells: number; characters: number }
) {
  const shapes = elementsByLocalName(slide, 'sp');
  const titleShape = shapes.find(isTitleShape);
  const title = titleShape ? shapeParagraphs(titleShape).join(' ') : '';
  budget.characters += title.length;

  const heading = output.createElement('h2');
  heading.textContent = title || `Slide ${slideNumber}`;
  output.body.append(heading);

  for (const shape of shapes) {
    if (shape === titleShape) continue;
    for (const text of shapeParagraphs(shape)) {
      budget.paragraphs += 1;
      budget.characters += text.length;
      if (budget.paragraphs > MAX_PARAGRAPHS) {
        throw new Error(
          `The presentation exceeds the ${MAX_PARAGRAPHS}-paragraph import limit.`
        );
      }
      const paragraph = output.createElement('p');
      paragraph.textContent = text;
      output.body.append(paragraph);
    }
  }

  for (const table of elementsByLocalName(slide, 'tbl')) {
    appendSlideTable(output, table, budget);
  }

  if (budget.characters > MAX_TEXT_CHARACTERS) {
    throw new Error(
      `The presentation exceeds the ${MAX_TEXT_CHARACTERS}-character import limit.`
    );
  }
}

export async function parsePptxToHtml(
  imported: Blob
): Promise<OfficeHtmlResult> {
  const archive = await JSZip.loadAsync(imported);
  if (!archive.file('[Content_Types].xml')) {
    throw new Error(
      'The selected file is not a valid PowerPoint presentation.'
    );
  }

  const presentationPath = 'ppt/presentation.xml';
  const presentation = await readOfficeXml(archive, presentationPath);
  const relationships = relationshipTargets(
    await readOfficeXml(archive, 'ppt/_rels/presentation.xml.rels')
  );
  const slideIds = elementsByLocalName(presentation, 'sldId');
  if (!slideIds.length) {
    throw new Error('The PowerPoint presentation does not contain any slides.');
  }
  if (slideIds.length > MAX_SLIDES) {
    throw new Error(
      `The presentation exceeds the ${MAX_SLIDES}-slide import limit.`
    );
  }

  const output = createOfficeHtmlDocument();
  const budget = { paragraphs: 0, cells: 0, characters: 0 };
  for (const [index, slideId] of slideIds.entries()) {
    const id = relationshipId(slideId);
    const target = id ? relationships.get(id) : null;
    if (!target) {
      throw new Error(`The presentation is missing slide ${index + 1}.`);
    }
    const slidePath = resolveOfficePart(presentationPath, target);
    appendSlide(
      output,
      await readOfficeXml(archive, slidePath),
      index + 1,
      budget
    );
  }

  return {
    html: output.documentElement.outerHTML,
    fileName: officeFileName(imported, /\.pptx$/i),
  };
}

async function importPptx({
  collection,
  schema,
  imported,
  extensions,
}: ImportPptxOptions) {
  const { html, fileName } = await parsePptxToHtml(imported);
  return HtmlTransformer.importHTMLToDoc({
    collection,
    schema,
    html,
    fileName,
    extensions,
  });
}

export const PptxTransformer = {
  importPptx,
  parsePptxToHtml,
};
