import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import debug from 'debug';
import { z } from 'zod';

const log = debug('affine:make-env');

const ReleaseTypeSchema = z.enum(['stable', 'beta', 'canary', 'internal']);

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..');
const ROOT = path.resolve(__dirname, '..');

const envBuildType = (process.env.BUILD_TYPE || 'canary').trim().toLowerCase();
const buildType = ReleaseTypeSchema.parse(envBuildType);
const stableBuild = buildType === 'stable';
const productName = !stableBuild ? `LocalMind-${buildType}` : 'LocalMind';
const legacyProtocol = stableBuild ? 'affine' : `affine-${buildType}`;
const protocolSchemes = [productName.toLowerCase(), legacyProtocol];
const icoPath = path.join(
  ROOT,
  !stableBuild
    ? `./resources/icons/icon_${buildType}.ico`
    : './resources/icons/icon.ico'
);

const iconX64PngPath = path.join(
  ROOT,
  `./resources/icons/icon_${buildType}_64x64.png`
);

const iconX512PngPath = path.join(
  ROOT,
  `./resources/icons/icon_${buildType}_512x512.png`
);

const icnsPath = path.join(
  ROOT,
  !stableBuild
    ? `./resources/icons/icon_${buildType}.icns`
    : './resources/icons/icon.icns'
);

const iconPngPath = path.join(ROOT, './resources/icons/icon.png');

const iconRevision = process.env.GITHUB_SHA?.trim() || 'main';
const iconFileName = stableBuild ? 'icon.ico' : `icon_${buildType}.ico`;
const iconUrl =
  `https://raw.githubusercontent.com/Infinimesh-ai/LocalMind/${iconRevision}` +
  `/packages/frontend/apps/electron/resources/icons/${iconFileName}`;

log(`buildType=${buildType}, productName=${productName}, icoPath=${icoPath}`);

const {
  values: { arch, platform },
} = parseArgs({
  options: {
    arch: {
      type: 'string',
      description: 'The architecture to build for',
      default: process.arch,
    },
    platform: {
      type: 'string',
      description: 'The platform to build for',
      default: process.platform,
    },
  },
  allowPositionals: true,
  strict: false,
});

log(`parsed args: arch=${arch}, platform=${platform}`);

const appIdMap = {
  internal: 'ai.infinimesh.localmind.internal',
  canary: 'ai.infinimesh.localmind.canary',
  beta: 'ai.infinimesh.localmind.beta',
  stable: 'ai.infinimesh.localmind',
};

export {
  appIdMap,
  arch,
  buildType,
  icnsPath,
  iconPngPath,
  iconUrl,
  iconX64PngPath,
  iconX512PngPath,
  icoPath,
  platform,
  productName,
  protocolSchemes,
  REPO_ROOT,
  ROOT,
  stableBuild,
};
