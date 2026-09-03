import path from 'node:path';

import { verifyReleaseIntegrity } from './release-integrity.mjs';

const releaseDir = path.resolve(process.argv[2] ?? './release');

try {
  const manifest = await verifyReleaseIntegrity({
    publicKeyBase64: process.env.LOCALMIND_RELEASE_PUBLIC_KEY_BASE64,
    releaseDir,
  });
  console.log(
    `Verified LocalMind ${manifest.version} (${manifest.channel}) with ${manifest.artifacts.length} artifacts.`
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Failed to verify release manifest'
  );
  process.exitCode = 1;
}
