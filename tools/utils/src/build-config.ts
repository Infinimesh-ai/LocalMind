import type { Package } from '@affine-tools/utils/workspace';

import { PackageToDistribution } from './distribution';

export interface BuildFlags {
  channel: 'stable' | 'beta' | 'internal' | 'canary';
  mode: 'development' | 'production';
}

const DEFAULT_LOCALMIND_CLOUD_URL = 'https://localmind.infinimesh.cloud';

function normalizeCloudUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `LOCALMIND_CLOUD_URL must be a valid URL, received [${value}]`
    );
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'LOCALMIND_CLOUD_URL must be an HTTP(S) base URL without credentials, query parameters, or a fragment'
    );
  }

  return url.toString().replace(/\/+$/, '');
}

export function getBuildConfig(
  pkg: Package,
  buildFlags: BuildFlags
): BUILD_CONFIG_TYPE {
  const distribution = PackageToDistribution.get(pkg.name);
  const githubUrl =
    process.env.LOCALMIND_GITHUB_URL?.trim() ||
    'https://github.com/Infinimesh-ai/LocalMind';
  const licenseRequestUrl =
    `${githubUrl}/issues/new?template=FEATURE-REQUEST.yml` +
    '&title=%5BLicense%5D%20LocalMind%20license%20request';
  const cloudUrl = normalizeCloudUrl(
    process.env.LOCALMIND_CLOUD_URL?.trim() ||
      (buildFlags.mode === 'development'
        ? process.env.DEV_SERVER_URL?.trim()
        : '') ||
      DEFAULT_LOCALMIND_CLOUD_URL
  );

  if (!distribution) {
    throw new Error(`Distribution for ${pkg.name} is not found`);
  }

  const buildPreset: Record<BuildFlags['channel'], BUILD_CONFIG_TYPE> = {
    get stable() {
      return {
        debug: buildFlags.mode === 'development',
        distribution,
        isDesktopEdition: (
          ['web', 'desktop', 'admin'] as BUILD_CONFIG_TYPE['distribution'][]
        ).includes(distribution),
        isMobileEdition: (
          ['mobile', 'ios', 'android'] as BUILD_CONFIG_TYPE['distribution'][]
        ).includes(distribution),
        isElectron: distribution === 'desktop',
        isWeb: distribution === 'web',
        isMobileWeb: distribution === 'mobile',
        isIOS: distribution === 'ios',
        isAndroid: distribution === 'android',
        isNative:
          distribution === 'desktop' ||
          distribution === 'ios' ||
          distribution === 'android',
        isAdmin: distribution === 'admin',

        appBuildType: 'stable' as const,
        appVersion: pkg.version,
        // editorVersion: pkg.dependencies['@blocksuite/affine'],
        editorVersion: pkg.version,
        cloudUrl,
        githubUrl,
        changelogUrl:
          process.env.LOCALMIND_CHANGELOG_URL?.trim() ||
          `${githubUrl}/releases`,
        downloadUrl:
          process.env.LOCALMIND_DOWNLOAD_URL?.trim() || `${githubUrl}/releases`,
        pricingUrl:
          process.env.LOCALMIND_PRICING_URL?.trim() || licenseRequestUrl,
        discordUrl: `${githubUrl}/issues`,
        requestLicenseUrl:
          process.env.LOCALMIND_LICENSE_REQUEST_URL?.trim() ||
          licenseRequestUrl,
        privacyUrl: process.env.LOCALMIND_PRIVACY_URL?.trim() || '',
        termsUrl: process.env.LOCALMIND_TERMS_URL?.trim() || '',
        imageProxyUrl: '/api/worker/image-proxy',
        linkPreviewUrl: '/api/worker/link-preview',
        SENTRY_DSN: process.env.SENTRY_DSN ?? '',
      };
    },
    get beta() {
      return {
        ...this.stable,
        appBuildType: 'beta' as const,
      };
    },
    get internal() {
      return {
        ...this.stable,
        appBuildType: 'internal' as const,
      };
    },
    // canary will be aggressive and enable all features
    get canary() {
      return {
        ...this.stable,
        appBuildType: 'canary' as const,
      };
    },
  };

  const currentBuild = buildFlags.channel;

  if (!(currentBuild in buildPreset)) {
    throw new Error(`BUILD_TYPE ${currentBuild} is not supported`);
  }

  const currentBuildPreset = buildPreset[currentBuild];

  const environmentPreset = {
    changelogUrl: process.env.CHANGELOG_URL ?? currentBuildPreset.changelogUrl,
  };

  return {
    ...currentBuildPreset,
    // environment preset will overwrite current build preset
    // this environment variable is for debug proposes only
    // do not put them into CI
    ...(process.env.CI ? {} : environmentPreset),
  };
}
