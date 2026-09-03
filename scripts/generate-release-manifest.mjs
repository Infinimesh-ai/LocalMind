import path from 'node:path';

import { generateReleaseIntegrity } from './release-integrity.mjs';

try {
  const { manifest } = await generateReleaseIntegrity({
    channel: process.env.RELEASE_CHANNEL,
    commit: process.env.RELEASE_COMMIT,
    privateKeyBase64: process.env.LOCALMIND_RELEASE_PRIVATE_KEY_BASE64,
    publicKeyBase64: process.env.LOCALMIND_RELEASE_PUBLIC_KEY_BASE64,
    releaseDir: path.join(process.cwd(), 'release'),
    repository: process.env.RELEASE_REPOSITORY,
    version: process.env.RELEASE_VERSION,
  });
  console.log(
    `Generated LocalMind release manifest for ${manifest.artifacts.length} artifacts with key ${manifest.signing.keyId}`
  );
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : 'Failed to generate release manifest'
  );
  process.exitCode = 1;
}
