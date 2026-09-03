import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const targets = [
  '.github/CLA.md',
  '.github/ISSUE_TEMPLATE',
  '.github/helm/affine',
  '.github/workflows/build-images.yml',
  '.github/workflows/release-desktop-platform.yml',
  '.github/workflows/release-desktop.yml',
  '.github/workflows/release.yml',
  'docs/BUILDING.md',
  'docs/CONTRIBUTING.md',
  'docs/contributing/releases.md',
  'docs/developing-server.md',
  'docs/types-of-contributions.md',
  'packages/common/graphql/README.md',
  'packages/common/graphql/package.json',
  'packages/frontend/apps/electron/forge.config.mjs',
  'packages/frontend/apps/electron/package.json',
  'packages/frontend/apps/electron/resources/deb/postinst',
  'packages/frontend/apps/electron/resources/deb/prerm',
  'packages/frontend/apps/electron/resources/localmind.metainfo.xml',
  'packages/frontend/apps/electron/scripts/linux-metainfo.ts',
  'packages/frontend/apps/electron/scripts/make-env.ts',
  'packages/frontend/apps/electron/src/main/legacy-user-data.ts',
  'packages/frontend/apps/electron/src/main/protocol.ts',
  'packages/frontend/apps/electron/src/main/updater/localmind-update-provider.ts',
  'packages/frontend/apps/electron/src/shared/deep-link.ts',
  'packages/frontend/apps/android/App/app/src/main/AndroidManifest.xml',
  'packages/frontend/apps/ios/App/App/Info.plist',
  'packages/frontend/apps/ios/App/Packages/Intelligents/Sources/Intelligents/IntelligentContext/IntelligentContext.swift',
  'scripts/cleanup-canary-releases.sh',
  'scripts/generate-release-manifest.mjs',
  'scripts/release-integrity.mjs',
  'scripts/set-version.sh',
  'scripts/verify-release-manifest.mjs',
];

const forbiddenPatterns = [
  ['upstream GitHub repository', /github\.com\/toeverything\/affine/i],
  ['upstream container image', /ghcr\.io\/toeverything\/affine/i],
  ['AFFiNE external domain', /\b(?:[a-z0-9-]+\.)*affine\.(?:pro|fail|run)\b/i],
  ['legacy AFFiNE URL scheme', /\baffine(?:-[a-z0-9-]+)?:\/\//i],
  ['AFFiNE Sentry project', /SENTRY_PROJECT:\s*['"]affine['"]/i],
  ['legacy Linux metadata name', /affine\.metainfo\.xml/i],
  ['legacy release app name', /APP_NAME:\s*affine\b/i],
  ['AFFiNE remote signer configuration', /AFFINE_SIGN(?:ER|_CLIENT)/i],
  ['AFFiNE signer client', /affine-sign-client/i],
  ['legacy Windows signer gate', /require-windows-signing/i],
];

async function collectFiles(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  const info = await stat(absolutePath);
  if (info.isFile()) {
    return [relativePath];
  }

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(entry =>
      collectFiles(
        path.join(relativePath, entry.name).split(path.sep).join('/')
      )
    )
  );
  return files.flat();
}

const files = (await Promise.all(targets.map(collectFiles))).flat();
const violations = [];

for (const file of files) {
  const content = await readFile(path.join(repoRoot, file), 'utf8');

  for (const [index, line] of content.split('\n').entries()) {
    for (const [label, pattern] of forbiddenPatterns) {
      if (pattern.test(line)) {
        violations.push(`${file}:${index + 1}: ${label}: ${line.trim()}`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error('Found LocalMind product surfaces pointing to AFFiNE:');
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    'LocalMind product surfaces contain no unexpected AFFiNE pointers.'
  );
}
