import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { UpdateCheckResult } from 'electron-updater';
import { parseUpdateInfo } from 'electron-updater/out/providers/Provider';
import fs from 'fs-extra';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  availableForMyPlatformAndInstaller,
  LocalMindUpdateProvider,
} from '../../src/main/updater/localmind-update-provider';
import { MockedAppAdapter, MockedUpdater } from './mocks';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

vi.mock('electron', () => ({
  app: {
    getPath: () => __dirname,
  },
}));

type FixtureAsset = {
  name: string;
  url: string;
} & Record<string, unknown>;

type FixtureRelease = {
  assets: FixtureAsset[];
} & Record<string, unknown>;

describe('testing for client update', () => {
  const expectReleaseList = [
    { buildType: 'beta', version: '0.16.3-beta.2' },
    { buildType: 'canary', version: '0.17.0-canary.7' },
    { buildType: 'stable', version: '0.18.0' },
  ];

  const basicRequestHandlers = [
    http.get(
      'https://api.github.com/repos/Infinimesh-ai/LocalMind/releases',
      async () => {
        const releases = (
          await Promise.all(
            expectReleaseList.map(async ({ buildType, version }) => {
              const content = await fs.readFile(
                path.join(
                  __dirname,
                  'fixtures',
                  'candidates',
                  `${buildType}.json`
                ),
                'utf8'
              );

              return (JSON.parse(content) as FixtureRelease[]).map(release => ({
                ...release,
                draft: false,
                prerelease: buildType !== 'stable',
                assets: release.assets.map((asset, index) => ({
                  ...asset,
                  url: `https://api.github.com/repos/Infinimesh-ai/LocalMind/releases/assets/${version}-${index}`,
                  browser_download_url: asset.url,
                })),
              }));
            })
          )
        ).flat();

        return HttpResponse.json(releases);
      }
    ),
    ...expectReleaseList.map(({ version }) =>
      http.get(
        `https://github.com/Infinimesh-ai/LocalMind/releases/download/v${version}/latest.yml`,
        async req => {
          const buffer = await fs.readFile(
            path.join(
              __dirname,
              'fixtures',
              'releases',
              version,
              path.parse(req.request.url).base
            )
          );
          return HttpResponse.text(buffer.toString());
        }
      )
    ),
  ];

  describe('release api request successfully', () => {
    const server = setupServer(...basicRequestHandlers);
    beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
    afterAll(() => server.close());
    afterEach(() => server.resetHandlers());

    for (const { buildType, version } of expectReleaseList) {
      it(`check update for ${buildType} channel successfully`, async () => {
        const app = new MockedAppAdapter('0.10.0');
        const updater = new MockedUpdater(null, app);

        updater.setFeedURL(
          LocalMindUpdateProvider.configFeed({
            channel: buildType as any,
          })
        );

        const info = (await updater.checkForUpdates()) as UpdateCheckResult;
        expect(info).not.toBe(null);
        expect(info.updateInfo.releaseName).toBe(version);
        expect(info.updateInfo.version).toBe(version);
        // expect(info.updateInfo.releaseNotes?.length).toBeGreaterThan(0);
      });
    }
  });

  describe('filter valid installer files', async () => {
    const platforms: NodeJS.Platform[] = ['darwin', 'win32', 'linux'];
    const arches: NodeJS.Architecture[] = ['x64', 'arm64'];

    for (const platform of platforms) {
      for (const arch of arches) {
        if (platform === 'linux' && arch === 'arm64') {
          // not support arm64 on linux yet
          continue;
        }
        const data = await fs.readFile(
          path.join(__dirname, 'fixtures', 'releases', '0.18.0', `latest.yml`),
          'utf-8'
        );

        const files = parseUpdateInfo(
          data,
          '',
          new URL('https://github.com/Infinimesh-ai/LocalMind')
        ).files.map(file => file.url);

        it(`filter for platform [${platform}] arch [${arch}]`, () => {
          expect(
            files.filter(file =>
              availableForMyPlatformAndInstaller(file, platform, arch, false)
            )
          ).toMatchSnapshot();
        });

        if (platform === 'win32') {
          it(`filter for platform [${platform}] arch [${arch}] and is squirrel installer`, () => {
            expect(
              files.filter(file =>
                availableForMyPlatformAndInstaller(file, platform, arch, true)
              )
            ).toMatchSnapshot();
          });
        }
      }
    }

    it('rejects installers that are not branded for LocalMind', () => {
      expect(
        availableForMyPlatformAndInstaller(
          'affine-0.27.0-stable-macos-arm64.dmg',
          'darwin',
          'arm64',
          false
        )
      ).toBe(false);
      expect(
        availableForMyPlatformAndInstaller(
          'other-0.27.0-stable-macos-arm64.dmg',
          'darwin',
          'arm64',
          false
        )
      ).toBe(false);
    });
  });
});
