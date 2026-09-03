import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const GENERATED_FILE_NAMES = new Set([
  'SHA256SUMS',
  'release-manifest.json',
  'release-manifest.sig',
  'release-manifest.sigstore.json',
]);

function decodeKey(encoded, kind) {
  if (!encoded) {
    throw new Error(`Missing LocalMind ${kind} signing key`);
  }

  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length === 0) {
    throw new Error(`Invalid LocalMind ${kind} signing key`);
  }

  const pem = decoded.toString('utf8');
  if (pem.includes('-----BEGIN')) {
    return kind === 'private' ? createPrivateKey(pem) : createPublicKey(pem);
  }

  return kind === 'private'
    ? createPrivateKey({ key: decoded, format: 'der', type: 'pkcs8' })
    : createPublicKey({ key: decoded, format: 'der', type: 'spki' });
}

function publicKeyDer(key) {
  const publicKey = key.type === 'public' ? key : createPublicKey(key);
  return publicKey.export({ format: 'der', type: 'spki' });
}

function publicKeyId(key) {
  return createHash('sha256').update(publicKeyDer(key)).digest('hex');
}

function assertEd25519(key, kind) {
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`LocalMind ${kind} signing key must use Ed25519`);
  }
}

function equalBuffers(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

function classifyArtifact(name) {
  const platform = name.match(/-(windows|macos|linux)-/)?.[1] ?? 'all';
  const architecture = name.match(/-(x64|arm64)(?:\.|$)/)?.[1] ?? 'any';
  const format = name.endsWith('.nsis.exe')
    ? 'nsis.exe'
    : name.slice(name.lastIndexOf('.') + 1).toLowerCase();

  return { architecture, format, platform };
}

async function collectArtifacts(releaseDir) {
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const names = entries
    .filter(
      entry =>
        entry.isFile() &&
        !entry.name.startsWith('.') &&
        !GENERATED_FILE_NAMES.has(entry.name)
    )
    .map(entry => entry.name)
    .sort();

  if (names.length === 0) {
    throw new Error(`No release artifacts found in ${releaseDir}`);
  }

  return Promise.all(
    names.map(async name => {
      const filePath = path.join(releaseDir, name);
      const [content, fileStat] = await Promise.all([
        readFile(filePath),
        stat(filePath),
      ]);

      return {
        name,
        sha256: createHash('sha256').update(content).digest('hex'),
        size: fileStat.size,
        ...classifyArtifact(name),
      };
    })
  );
}

function validateReleaseMetadata({ channel, commit, repository, version }) {
  if (!['stable', 'beta', 'canary', 'internal'].includes(channel)) {
    throw new Error(`Unsupported LocalMind release channel: ${channel}`);
  }
  if (!version) {
    throw new Error('Missing LocalMind release version');
  }
  if (!/^[0-9a-f]{7,64}$/i.test(commit)) {
    throw new Error('LocalMind release commit must be a Git commit hash');
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('LocalMind release repository must be OWNER/REPO');
  }
}

export async function generateReleaseIntegrity({
  channel,
  commit,
  createdAt = new Date().toISOString(),
  privateKeyBase64,
  publicKeyBase64,
  releaseDir,
  repository,
  version,
}) {
  validateReleaseMetadata({ channel, commit, repository, version });

  const privateKey = decodeKey(privateKeyBase64, 'private');
  const expectedPublicKey = decodeKey(publicKeyBase64, 'public');
  assertEd25519(privateKey, 'private');
  assertEd25519(expectedPublicKey, 'public');

  const derivedPublicKey = createPublicKey(privateKey);
  if (
    !equalBuffers(
      publicKeyDer(derivedPublicKey),
      publicKeyDer(expectedPublicKey)
    )
  ) {
    throw new Error(
      'LocalMind release private key does not match the configured public key'
    );
  }

  const artifacts = await collectArtifacts(releaseDir);
  const keyId = publicKeyId(expectedPublicKey);
  const manifest = {
    schemaVersion: 1,
    product: 'LocalMind',
    version,
    channel,
    repository,
    commit,
    createdAt,
    signing: {
      algorithm: 'Ed25519',
      keyId,
    },
    artifacts,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const signature = sign(null, manifestBytes, privateKey);

  if (!verify(null, manifestBytes, expectedPublicKey, signature)) {
    throw new Error(
      'Generated LocalMind release signature failed verification'
    );
  }

  const signatureEnvelope = {
    algorithm: 'Ed25519',
    keyId,
    signature: signature.toString('base64'),
  };
  const checksumFile = `${artifacts
    .map(artifact => `${artifact.sha256}  ${artifact.name}`)
    .join('\n')}\n`;

  await Promise.all([
    writeFile(path.join(releaseDir, 'release-manifest.json'), manifestBytes),
    writeFile(
      path.join(releaseDir, 'release-manifest.sig'),
      `${JSON.stringify(signatureEnvelope, null, 2)}\n`
    ),
    writeFile(path.join(releaseDir, 'SHA256SUMS'), checksumFile),
  ]);

  return { manifest, signatureEnvelope };
}

export async function verifyReleaseIntegrity({ publicKeyBase64, releaseDir }) {
  const publicKey = decodeKey(publicKeyBase64, 'public');
  assertEd25519(publicKey, 'public');

  const [checksumBytes, manifestBytes, signatureBytes] = await Promise.all([
    readFile(path.join(releaseDir, 'SHA256SUMS'), 'utf8'),
    readFile(path.join(releaseDir, 'release-manifest.json')),
    readFile(path.join(releaseDir, 'release-manifest.sig'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const signatureEnvelope = JSON.parse(signatureBytes);
  const expectedKeyId = publicKeyId(publicKey);

  if (
    manifest.schemaVersion !== 1 ||
    manifest.product !== 'LocalMind' ||
    manifest.signing?.algorithm !== 'Ed25519' ||
    manifest.signing?.keyId !== expectedKeyId ||
    signatureEnvelope.algorithm !== 'Ed25519' ||
    signatureEnvelope.keyId !== expectedKeyId ||
    typeof signatureEnvelope.signature !== 'string' ||
    !Array.isArray(manifest.artifacts) ||
    manifest.artifacts.length === 0
  ) {
    throw new Error('LocalMind release manifest signing metadata is invalid');
  }

  const signature = Buffer.from(signatureEnvelope.signature, 'base64');
  if (!verify(null, manifestBytes, publicKey, signature)) {
    throw new Error('LocalMind release manifest signature is invalid');
  }

  const artifactNames = new Set();
  for (const artifact of manifest.artifacts) {
    if (
      !artifact?.name ||
      path.basename(artifact.name) !== artifact.name ||
      artifactNames.has(artifact.name) ||
      !/^[0-9a-f]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.size) ||
      Math.sign(artifact.size) === -1
    ) {
      throw new Error(
        'LocalMind release manifest contains an invalid artifact'
      );
    }
    artifactNames.add(artifact.name);

    const artifactPath = path.join(releaseDir, artifact.name);
    const [content, fileStat] = await Promise.all([
      readFile(artifactPath),
      stat(artifactPath),
    ]);
    const sha256 = createHash('sha256').update(content).digest('hex');
    if (sha256 !== artifact.sha256 || fileStat.size !== artifact.size) {
      throw new Error(
        `LocalMind release artifact verification failed: ${artifact.name}`
      );
    }
  }

  const expectedChecksums = `${manifest.artifacts
    .map(artifact => `${artifact.sha256}  ${artifact.name}`)
    .join('\n')}\n`;
  if (checksumBytes !== expectedChecksums) {
    throw new Error('LocalMind SHA256SUMS does not match the signed manifest');
  }

  return manifest;
}
