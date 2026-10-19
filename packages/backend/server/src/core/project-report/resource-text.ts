import { BadRequest } from '../../base';
import type { Models } from '../../models';
import type { ProjectActor } from '../../models/project-resource';
import { parseYDocToMarkdown } from '../../native';
import type { OfficeArtifactService } from '../office';
import {
  officeFormatFromKind,
  officeStateSearchText,
  readNativeOfficeState,
} from '../office/formats';
import type { ProjectResourceService } from '../project';

/**
 * Dependencies needed to turn one Project resource revision into plain text.
 * Shared by Project reports and report decks so both read sources identically.
 */
export type ProjectResourceTextDeps = {
  models: Models;
  resources: ProjectResourceService;
  office: OfficeArtifactService;
  /** Defaults to `readPdfText`. */
  readPdf?: (
    bytes: Uint8Array,
    budget: number
  ) => Promise<{ text: string; truncated: boolean }>;
};

export type ProjectResourceTextTarget = {
  resourceId: string;
  /** Report source kind: page, edgeless, pdf, document, workbook, presentation, file. */
  kind: string;
  /** Office revision id (Office/PDF artifacts) or the resource revision sequence. */
  revision: string;
  sequence?: number;
  artifactId?: string;
};

/**
 * Read the text of a captured Project resource revision. Throws when the
 * source cannot be decoded; callers decide how a failure is reported.
 * `truncated` follows the historical Project report rules exactly.
 */
export async function readProjectResourceText(
  deps: ProjectResourceTextDeps,
  input: ProjectActor,
  target: ProjectResourceTextTarget,
  budget: number
): Promise<{ text: string; truncated: boolean }> {
  if (target.artifactId) {
    const asset = await deps.office.readRevisionAsset(
      { projectId: input.projectId },
      input.actorId,
      target.artifactId,
      target.revision,
      'package'
    );
    if (target.kind === 'pdf')
      return (deps.readPdf ?? readPdfText)(asset.bytes, budget);
    const resource = await deps.models.projectResource.get({
      ...input,
      resourceId: target.resourceId,
    });
    if (
      resource.kind === 'folder' ||
      resource.kind === 'page' ||
      resource.kind === 'edgeless' ||
      resource.kind === 'file'
    )
      throw new BadRequest('Invalid Office report source');
    const native = await readNativeOfficeState(
      officeFormatFromKind(resource.kind),
      asset.bytes
    );
    const text = officeStateSearchText(native);
    return { text, truncated: text.length >= 249999 || text.length > budget };
  }
  if (target.kind === 'page' || target.kind === 'edgeless') {
    const file = await deps.resources.readDocument({
      ...input,
      resourceId: target.resourceId,
      sequence: target.sequence,
    });
    const text = parseYDocToMarkdown(
      file.bytes,
      file.resource.id,
      true
    ).markdown;
    return { text, truncated: text.length > budget };
  }
  const file = await deps.resources.readTextFile({
    ...input,
    resourceId: target.resourceId,
    sequence: target.sequence,
  });
  return { text: file.text, truncated: file.text.length > budget };
}

export async function readPdfText(bytes: Uint8Array, budget: number) {
  if (bytes.byteLength > 64 * 1024 * 1024)
    throw new BadRequest('PDF source exceeds extraction budget');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({
    data: Uint8Array.from(bytes),
    isEvalSupported: false,
    useWorkerFetch: false,
    useSystemFonts: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const parts: string[] = [];
  let remaining = budget;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const extract = async () => {
    const doc = await task.promise;
    let truncated = false;
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      if (pageNumber > 500 || remaining <= 0) {
        truncated = true;
        break;
      }
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const body = content.items
        .map(item => ('str' in item ? item.str : ''))
        .join(' ')
        .trim();
      // A page locator is evidence metadata, never extractable document text.
      if (!body) {
        page.cleanup();
        continue;
      }
      const text = `[page ${pageNumber}]\n${body}\n`;
      parts.push(text.slice(0, remaining));
      remaining -= text.length;
      if (remaining < 0) truncated = true;
      page.cleanup();
    }
    return { text: parts.join(''), truncated };
  };
  try {
    return await Promise.race([
      extract(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new BadRequest('PDF source extraction timed out')),
          15000
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof BadRequest) throw error;
    throw new BadRequest('PDF source could not be read');
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
