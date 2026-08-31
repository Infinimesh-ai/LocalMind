import { readFile } from 'node:fs/promises';

import type { AffineTextAttributes } from '@blocksuite/affine/shared/types';
import { type DeltaInsert, Text } from '@blocksuite/affine/store';
import { Unzip } from '@blocksuite/affine/widgets/linked-doc';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Doc as YDoc } from 'yjs';

vi.mock('@affine/component/localmind-logo', () => ({
  localMindLogoUrl: '/localmind-logo.png',
}));

const legacyCreatedAt = 1744858915258;
const legacyLogoSourceId = 'i3piAMnoD4STQnEjTrAe_ZRdwHcD34n-sJZY8IN1blg=';

type TestModel = {
  flavour: string;
  props: Record<string, unknown> & {
    text?: Text<AffineTextAttributes>;
  };
};

let textDocumentIndex = 0;

function bindText(text: Text<AffineTextAttributes>) {
  const yDoc = new YDoc();
  yDoc.getMap('root').set(`text-${textDocumentIndex++}`, text.yText);
  return text;
}

function textModel(
  flavour: 'affine:paragraph' | 'affine:list',
  input: string | DeltaInsert<AffineTextAttributes>[]
): TestModel {
  return {
    flavour,
    props: {
      text: bindText(new Text(input)),
    },
  };
}

function model(flavour: string, props: Record<string, unknown>): TestModel {
  return { flavour, props };
}

function createMigrationContext({
  title = 'Getting Started ',
  createdAt = legacyCreatedAt,
  includeFingerprint = true,
  models,
}: {
  title?: string;
  createdAt?: number;
  includeFingerprint?: boolean;
  models: TestModel[];
}) {
  const allModels = includeFingerprint
    ? [
        ...models,
        textModel('affine:paragraph', 'Data-intensive blocks'),
        textModel('affine:paragraph', 'Examples for advanced blocks'),
        textModel('affine:paragraph', 'Continue with the rabbit hole'),
      ]
    : models;
  const deleted = new Set<TestModel>();
  const updateBlock = vi.fn(
    (target: TestModel, props: Record<string, unknown>) => {
      if (props.text instanceof Text) {
        props.text = bindText(props.text);
      }
      Object.assign(target.props, props);
    }
  );
  const blockSuiteDoc = {
    getBlocksByFlavour: (flavour: string) =>
      allModels
        .filter(item => item.flavour === flavour && !deleted.has(item))
        .map(item => ({ model: item })),
    transact: (callback: () => void) => callback(),
    updateBlock,
    deleteBlock: vi.fn((target: TestModel) => deleted.add(target)),
  };
  const release = vi.fn();
  const disposePriorityLoad = vi.fn();
  const open = vi.fn(() => ({
    doc: {
      addPriorityLoad: () => disposePriorityLoad,
      blockSuiteDoc,
      waitForSyncReady: vi.fn(async () => {}),
    },
    release,
  }));
  const docsService = {
    list: {
      ['docs$']: {
        value: [
          {
            id: 'showcase-doc',
            ['createdAt$']: { value: createdAt },
            ['title$']: { value: title },
          },
        ],
      },
    },
    open,
  };
  const blobSet = vi.fn(async () => 'localmind-logo-source');
  const workspace = {
    openOptions: { isSharedMode: false },
    docCollection: { blobSync: { set: blobSet } },
  };

  return {
    blobSet,
    deleted,
    disposePriorityLoad,
    docsService,
    models,
    open,
    release,
    updateBlock,
    workspace,
  };
}

function textOf(item: TestModel) {
  return item.props.text?.toString();
}

beforeEach(() => {
  textDocumentIndex = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(new Blob(['localmind-logo'], { type: 'image/png' }))
    )
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('migrateLegacyShowcaseWorkspace', () => {
  test('migrates exact legacy showcase content and removes upstream promos', async () => {
    const models = [
      textModel('affine:paragraph', 'Welcome to AFFiNE! '),
      textModel('affine:paragraph', 'Observe what AFFiNE can do'),
      textModel('affine:paragraph', 'Visit AFFiNE '),
      textModel('affine:list', [
        {
          insert: 'Code available',
          attributes: { link: 'https://github.com/toeverything/AFFiNE' },
        },
        { insert: ' (Consider Starring\u{1F31F}) ' },
      ]),
      textModel('affine:paragraph', [
        { insert: 'Keep this paragraph and its ' },
        {
          insert: 'link',
          attributes: { link: 'https://github.com/toeverything/AFFiNE' },
        },
        { insert: '.' },
      ]),
      model('affine:image', { sourceId: legacyLogoSourceId }),
      model('affine:image', {
        sourceId: 'Qc7GmuDZmGIxbQkYlKi-rA1lcn7-ZbLTzbim0Ww_Oaw=',
      }),
      model('affine:embed-youtube', {
        url: 'https://www.youtube.com/watch?v=WqOe9HgpsDY',
      }),
      model('affine:bookmark', { url: 'https://affine.pro/' }),
    ];
    const context = createMigrationContext({ models });
    const { migrateLegacyShowcaseWorkspace } =
      await import('../showcase-migration');

    await expect(
      migrateLegacyShowcaseWorkspace(
        context.workspace as never,
        context.docsService as never
      )
    ).resolves.toBe(true);

    expect(models.map(textOf).filter(Boolean)).toEqual([
      'Welcome to LocalMind! ',
      'Explore what LocalMind can do',
      'Visit LocalMind',
      'LocalMind source code',
      'Keep this paragraph and its link.',
    ]);
    expect(models[4].props.text?.toDelta()[1]?.attributes?.link).toBe(
      'https://github.com/Infinimesh-ai/LocalMind'
    );
    expect(models[5].props).toMatchObject({
      height: 1024,
      sourceId: 'localmind-logo-source',
      width: 1024,
    });
    expect(context.deleted).toEqual(new Set([models[6], models[7], models[8]]));
    expect(context.blobSet).toHaveBeenCalledOnce();
    expect(context.disposePriorityLoad).toHaveBeenCalledOnce();
    expect(context.release).toHaveBeenCalledOnce();
  });

  test('does not touch a user document that only has the same title', async () => {
    const userText = textModel('affine:paragraph', 'Welcome to AFFiNE! ');
    const context = createMigrationContext({
      createdAt: legacyCreatedAt + 1,
      includeFingerprint: false,
      models: [userText],
      title: 'Getting Started',
    });
    const { migrateLegacyShowcaseWorkspace } =
      await import('../showcase-migration');

    await expect(
      migrateLegacyShowcaseWorkspace(
        context.workspace as never,
        context.docsService as never
      )
    ).resolves.toBe(false);

    expect(textOf(userText)).toBe('Welcome to AFFiNE! ');
    expect(context.open).toHaveBeenCalledOnce();
    expect(context.updateBlock).not.toHaveBeenCalled();
  });

  test('preserves user-edited blocks inside the legacy showcase document', async () => {
    const edited = textModel(
      'affine:paragraph',
      'My notes about the original welcome section'
    );
    const untouchedLegacy = textModel(
      'affine:paragraph',
      'Observe what AFFiNE can do'
    );
    const context = createMigrationContext({
      models: [edited, untouchedLegacy],
    });
    const { migrateLegacyShowcaseWorkspace } =
      await import('../showcase-migration');

    await migrateLegacyShowcaseWorkspace(
      context.workspace as never,
      context.docsService as never
    );

    expect(textOf(edited)).toBe('My notes about the original welcome section');
    expect(textOf(untouchedLegacy)).toBe('Explore what LocalMind can do');
  });
});

test('the bundled onboarding template contains LocalMind copy', async () => {
  const archivePath = new URL(
    '../../../../templates/onboarding/onboarding.zip',
    import.meta.url
  );
  const archive = await readFile(archivePath);
  const unzip = new Unzip();
  await unzip.load(new Blob([archive]));

  const snapshotEntry = [...unzip].find(({ path }) =>
    path.startsWith('Getting Started ')
  );
  expect(snapshotEntry).toBeDefined();
  const snapshot = await snapshotEntry?.content.text();

  expect(snapshot).toContain('Welcome to LocalMind!');
  expect(snapshot).toContain('Explore what LocalMind can do');
  expect(snapshot).toContain('Visit LocalMind');
  expect(snapshot).not.toContain('Welcome to AFFiNE!');
  expect(snapshot).not.toContain('https://github.com/toeverything/AFFiNE');
  expect(snapshot).not.toContain('https://affine.pro/');
});
