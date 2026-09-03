import { generateKeyPairSync, type KeyObject, verify } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  generateReleaseIntegrity,
  verifyReleaseIntegrity,
} from '../../scripts/release-integrity.mjs';

const tempDirs: string[] = [];

function encodeKey(key: KeyObject, type: 'pkcs8' | 'spki') {
  return Buffer.from(key.export({ format: 'pem', type }).toString()).toString(
    'base64'
  );
}

async function createReleaseDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'localmind-release-'));
  tempDirs.push(dir);
  await writeFile(
    path.join(dir, 'localmind-1.2.3-stable-windows-x64.zip'),
    'zip'
  );
  await writeFile(
    path.join(dir, 'localmind-1.2.3-stable-windows-x64.nsis.exe'),
    'installer'
  );
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(dir => rm(dir, { force: true, recursive: true }))
  );
});

describe('LocalMind release integrity', () => {
  it('generates a sorted manifest, checksums, and a verifiable signature', async () => {
    const releaseDir = await createReleaseDir();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyBase64 = encodeKey(privateKey, 'pkcs8');
    const publicKeyBase64 = encodeKey(publicKey, 'spki');

    const { manifest, signatureEnvelope } = await generateReleaseIntegrity({
      channel: 'stable',
      commit: '0123456789abcdef0123456789abcdef01234567',
      createdAt: '2026-09-03T00:00:00.000Z',
      privateKeyBase64,
      publicKeyBase64,
      releaseDir,
      repository: 'Infinimesh-ai/LocalMind',
      version: '1.2.3',
    });

    expect(manifest.artifacts.map(artifact => artifact.name)).toEqual([
      'localmind-1.2.3-stable-windows-x64.nsis.exe',
      'localmind-1.2.3-stable-windows-x64.zip',
    ]);
    expect(manifest.artifacts[0]).toMatchObject({
      architecture: 'x64',
      format: 'nsis.exe',
      platform: 'windows',
      size: 9,
    });

    const manifestBytes = await readFile(
      path.join(releaseDir, 'release-manifest.json')
    );
    expect(
      verify(
        null,
        manifestBytes,
        publicKey,
        Buffer.from(signatureEnvelope.signature, 'base64')
      )
    ).toBe(true);
    expect(await readFile(path.join(releaseDir, 'SHA256SUMS'), 'utf8')).toMatch(
      /^[0-9a-f]{64}[ ]{2}localmind-1\.2\.3-stable-windows-x64\.nsis\.exe/m
    );
    await expect(
      verifyReleaseIntegrity({ publicKeyBase64, releaseDir })
    ).resolves.toMatchObject({ product: 'LocalMind', version: '1.2.3' });
  });

  it('rejects a private key that does not match the configured public key', async () => {
    const releaseDir = await createReleaseDir();
    const { privateKey } = generateKeyPairSync('ed25519');
    const { publicKey } = generateKeyPairSync('ed25519');

    await expect(
      generateReleaseIntegrity({
        channel: 'stable',
        commit: '0123456789abcdef0123456789abcdef01234567',
        privateKeyBase64: encodeKey(privateKey, 'pkcs8'),
        publicKeyBase64: encodeKey(publicKey, 'spki'),
        releaseDir,
        repository: 'Infinimesh-ai/LocalMind',
        version: '1.2.3',
      })
    ).rejects.toThrow('does not match');
  });

  it('detects an artifact changed after the manifest was signed', async () => {
    const releaseDir = await createReleaseDir();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyBase64 = encodeKey(privateKey, 'pkcs8');
    const publicKeyBase64 = encodeKey(publicKey, 'spki');

    await generateReleaseIntegrity({
      channel: 'stable',
      commit: '0123456789abcdef0123456789abcdef01234567',
      privateKeyBase64,
      publicKeyBase64,
      releaseDir,
      repository: 'Infinimesh-ai/LocalMind',
      version: '1.2.3',
    });
    await writeFile(
      path.join(releaseDir, 'localmind-1.2.3-stable-windows-x64.zip'),
      'tampered'
    );

    await expect(
      verifyReleaseIntegrity({ publicKeyBase64, releaseDir })
    ).rejects.toThrow('artifact verification failed');
  });

  it('detects checksums changed after the manifest was signed', async () => {
    const releaseDir = await createReleaseDir();
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const privateKeyBase64 = encodeKey(privateKey, 'pkcs8');
    const publicKeyBase64 = encodeKey(publicKey, 'spki');

    await generateReleaseIntegrity({
      channel: 'stable',
      commit: '0123456789abcdef0123456789abcdef01234567',
      privateKeyBase64,
      publicKeyBase64,
      releaseDir,
      repository: 'Infinimesh-ai/LocalMind',
      version: '1.2.3',
    });
    await writeFile(path.join(releaseDir, 'SHA256SUMS'), 'tampered\n');

    await expect(
      verifyReleaseIntegrity({ publicKeyBase64, releaseDir })
    ).rejects.toThrow('does not match the signed manifest');
  });
});
