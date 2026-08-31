import { localMindLogoUrl } from '@affine/component/localmind-logo';
import { DebugLogger } from '@affine/debug';
import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import {
  type BlockModel,
  type DeltaInsert,
  Text,
} from '@blocksuite/affine/store';

import type { DocsService } from '../modules/doc';
import type { Workspace } from '../modules/workspace';

const logger = new DebugLogger('showcaseMigration');

const LEGACY_SHOWCASE_TITLE = 'Getting Started';
const showcaseFingerprintTexts = new Set([
  'Data-intensive blocks',
  'Examples for advanced blocks',
  'Continue with the rabbit hole',
  'And one more thing:',
]);

type Replacement = {
  from: string;
  to: DeltaInsert<AffineTextAttributes>[];
};

const textReplacements: Replacement[] = [
  {
    from: 'Welcome to AFFiNE! ',
    to: [{ insert: 'Welcome to LocalMind! ' }],
  },
  {
    from: 'Observe what AFFiNE can do',
    to: [{ insert: 'Explore what LocalMind can do' }],
  },
  {
    from: 'Observe what LocalMind can do',
    to: [{ insert: 'Explore what LocalMind can do' }],
  },
  {
    from: 'Visit AFFiNE ',
    to: [
      {
        insert: 'Visit LocalMind',
        attributes: { link: 'https://github.com/Infinimesh-ai/LocalMind' },
      },
    ],
  },
  {
    from: 'Visit LocalMind',
    to: [
      {
        insert: 'Visit LocalMind',
        attributes: { link: 'https://github.com/Infinimesh-ai/LocalMind' },
      },
    ],
  },
  {
    from: 'Login to give it a try',
    to: [{ insert: 'Sign in and configure a model provider to try it' }],
  },
  {
    from: 'free 7-day trial !',
    to: [{ insert: 'Use LocalMind AI with your configured providers' }],
  },
  {
    from: 'Selfhost, check',
    to: [{ insert: 'Self-host LocalMind' }],
  },
  {
    from: 'https://docs.affine.pro/docs/self-host-affine',
    to: [
      {
        insert: 'LocalMind self-hosting guide',
        attributes: {
          link: 'https://github.com/Infinimesh-ai/LocalMind/blob/main/docs/localmind-deployment.zh-CN.md',
        },
      },
    ],
  },
  {
    from: 'GitHub and Discord',
    to: [{ insert: 'Source and support' }],
  },
  {
    from: 'Code available (Consider Starring\u{1F31F}) ',
    to: [
      {
        insert: 'LocalMind source code',
        attributes: { link: 'https://github.com/Infinimesh-ai/LocalMind' },
      },
    ],
  },
  {
    from: 'Discord channel',
    to: [
      {
        insert: 'Issues and support',
        attributes: {
          link: 'https://github.com/Infinimesh-ai/LocalMind/issues',
        },
      },
    ],
  },
  {
    from: 'Cloud',
    to: [{ insert: 'Sync and backup' }],
  },
  {
    from: 'Sign in and enable cloud service to sync across devices',
    to: [
      {
        insert:
          'Sign in and enable LocalMind Sync to keep your workspace available across devices',
      },
    ],
  },
  {
    from: 'Import from generic markdown files, or Notion',
    to: [
      {
        insert: 'Import Markdown, HTML, Notion, and other supported formats',
        attributes: {
          link: 'https://github.com/Infinimesh-ai/LocalMind/blob/main/docs/localmind-user-guide.zh-CN.md',
        },
      },
    ],
  },
  {
    from: 'Web Clipper',
    to: [
      {
        insert: 'Import a LocalMind backup',
        attributes: {
          link: 'https://github.com/Infinimesh-ai/LocalMind/blob/main/docs/localmind-user-guide.zh-CN.md',
        },
      },
    ],
  },
  {
    from: 'Readwise integration',
    to: [
      {
        insert: 'Read the LocalMind user guide',
        attributes: {
          link: 'https://github.com/Infinimesh-ai/LocalMind/blob/main/docs/localmind-user-guide.zh-CN.md',
        },
      },
    ],
  },
];

const legacyLinks = new Map([
  [
    'https://github.com/toeverything/AFFiNE',
    'https://github.com/Infinimesh-ai/LocalMind',
  ],
]);

const legacyImageSourceIds = new Set([
  'Qc7GmuDZmGIxbQkYlKi-rA1lcn7-ZbLTzbim0Ww_Oaw=',
  '4Pd3nlOWl6vwhEOB6c2Isyhp-O5zALhun7-hKzwanYU=',
  'JHrcbru2ztXmKH4JUuYL5ws7uQEvyfhtewbtRiTJY0I=',
]);
const legacyLogoSourceId = 'i3piAMnoD4STQnEjTrAe_ZRdwHcD34n-sJZY8IN1blg=';
const legacyYouTubeUrl = 'https://www.youtube.com/watch?v=WqOe9HgpsDY';
const legacyBookmarkUrl = 'https://affine.pro/';

type TextBlockModel = BlockModel<{ text: Text<AffineTextAttributes> }>;
type GenericBlockModel = BlockModel<Record<string, unknown>>;

function getTextModels(blockSuiteDoc: {
  getBlocksByFlavour: (flavour: string) => { model: BlockModel }[];
}) {
  return ['affine:paragraph', 'affine:list'].flatMap(flavour =>
    blockSuiteDoc
      .getBlocksByFlavour(flavour)
      .map(block => block.model as TextBlockModel)
  );
}

function hasLegacyContent(
  textModels: TextBlockModel[],
  imageModels: GenericBlockModel[],
  embedModels: GenericBlockModel[],
  bookmarkModels: GenericBlockModel[]
) {
  return (
    textModels.some(model =>
      textReplacements.some(({ from }) => model.props.text.toString() === from)
    ) ||
    textModels.some(model =>
      model.props.text
        .toDelta()
        .some(delta => legacyLinks.has(delta.attributes?.link ?? ''))
    ) ||
    imageModels.some(model => {
      const sourceId = model.props.sourceId;
      return (
        sourceId === legacyLogoSourceId ||
        (typeof sourceId === 'string' && legacyImageSourceIds.has(sourceId))
      );
    }) ||
    embedModels.some(model => model.props.url === legacyYouTubeUrl) ||
    bookmarkModels.some(model => model.props.url === legacyBookmarkUrl)
  );
}

function isShowcaseDocument(textModels: TextBlockModel[]) {
  const matches = textModels.reduce(
    (count, model) =>
      count +
      (showcaseFingerprintTexts.has(model.props.text.toString()) ? 1 : 0),
    0
  );
  return matches >= 3;
}

async function loadLocalMindLogo(workspace: Workspace) {
  const response = await fetch(localMindLogoUrl);
  if (!response.ok) {
    throw new Error(`Failed to load LocalMind logo: ${response.status}`);
  }
  const blob = await response.blob();
  const file = new File([blob], 'localmind-logo.png', { type: 'image/png' });
  const sourceId = await workspace.docCollection.blobSync.set(file);
  return { sourceId, size: file.size };
}

export async function migrateLegacyShowcaseWorkspace(
  workspace: Workspace,
  docsService: DocsService
) {
  if (workspace.openOptions.isSharedMode) {
    return false;
  }

  const records = docsService.list.docs$.value.filter(
    doc => doc.title$.value.trim() === LEGACY_SHOWCASE_TITLE
  );
  if (!records.length) {
    return false;
  }

  let migrated = false;
  for (const record of records) {
    const { doc, release } = docsService.open(record.id);
    const disposePriorityLoad = doc.addPriorityLoad(10);
    try {
      await doc.waitForSyncReady();

      const blockSuiteDoc = doc.blockSuiteDoc;
      const textModels = getTextModels(blockSuiteDoc);
      if (!isShowcaseDocument(textModels)) {
        continue;
      }
      const imageModels = blockSuiteDoc
        .getBlocksByFlavour('affine:image')
        .map(block => block.model as GenericBlockModel);
      const embedModels = blockSuiteDoc
        .getBlocksByFlavour('affine:embed-youtube')
        .map(block => block.model as GenericBlockModel);
      const bookmarkModels = blockSuiteDoc
        .getBlocksByFlavour('affine:bookmark')
        .map(block => block.model as GenericBlockModel);

      if (
        !hasLegacyContent(textModels, imageModels, embedModels, bookmarkModels)
      ) {
        continue;
      }

      let logo: Awaited<ReturnType<typeof loadLocalMindLogo>> | null = null;
      if (
        imageModels.some(model => model.props.sourceId === legacyLogoSourceId)
      ) {
        try {
          logo = await loadLocalMindLogo(workspace);
        } catch (error) {
          logger.warn('Failed to store the LocalMind showcase logo', error);
        }
      }

      blockSuiteDoc.transact(() => {
        for (const model of textModels) {
          const currentText = model.props.text.toString();
          const replacement = textReplacements.find(
            ({ from }) => from === currentText
          );
          if (replacement) {
            blockSuiteDoc.updateBlock(model, {
              text: new Text(replacement.to),
            });
            continue;
          }

          const currentDelta = model.props.text.toDelta();
          let linkChanged = false;
          const nextDelta = currentDelta.map(delta => {
            const link = delta.attributes?.link;
            const replacementLink = link ? legacyLinks.get(link) : undefined;
            if (!replacementLink) {
              return delta;
            }
            linkChanged = true;
            return {
              ...delta,
              attributes: { ...delta.attributes, link: replacementLink },
            };
          });
          if (linkChanged) {
            blockSuiteDoc.updateBlock(model, {
              text: new Text(nextDelta as DeltaInsert<AffineTextAttributes>[]),
            });
          }
        }

        for (const model of imageModels) {
          const sourceId = model.props.sourceId;
          if (sourceId === legacyLogoSourceId && logo) {
            blockSuiteDoc.updateBlock(model, {
              height: 1024,
              size: logo.size,
              sourceId: logo.sourceId,
              width: 1024,
            });
          } else if (
            sourceId === legacyLogoSourceId ||
            (typeof sourceId === 'string' && legacyImageSourceIds.has(sourceId))
          ) {
            blockSuiteDoc.deleteBlock(model);
          }
        }

        for (const model of embedModels) {
          if (model.props.url === legacyYouTubeUrl) {
            blockSuiteDoc.deleteBlock(model);
          }
        }
        for (const model of bookmarkModels) {
          if (model.props.url === legacyBookmarkUrl) {
            blockSuiteDoc.deleteBlock(model);
          }
        }
      });

      migrated = true;
    } finally {
      disposePriorityLoad();
      release();
    }
  }
  return migrated;
}
