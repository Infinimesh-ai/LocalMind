import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

export const LOCALMIND_LOG_ARCHIVE_SCHEMA = 'localmind-log-archive-manifest/v1';

export type LocalMindLogArchiveKeyring = {
  activeKeyVersion: string;
  keys: Record<string, string>;
};

export type LocalMindLogArchiveManifest = {
  schemaVersion: typeof LOCALMIND_LOG_ARCHIVE_SCHEMA;
  batchId: string;
  instanceId: string;
  createdAt: string;
  itemCount: number;
  fromOccurredAt: string | null;
  toOccurredAt: string | null;
  entries: unknown[];
};

export type LocalMindLogArchiveEnvelope = {
  keyVersion: string;
  fingerprint: string;
  signature: string;
  manifest: LocalMindLogArchiveManifest;
};

export function readLocalMindLogArchiveKeyring(
  source: NodeJS.ProcessEnv = process.env
): LocalMindLogArchiveKeyring {
  const activeKeyVersion = source.LOCALMIND_AUDIT_ARCHIVE_ACTIVE_KEY_VERSION;
  const serialized = source.LOCALMIND_AUDIT_ARCHIVE_KEYS;
  if (!activeKeyVersion || !serialized) {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_KEYRING_MISSING');
  }
  let keys: Record<string, unknown>;
  try {
    keys = JSON.parse(serialized) as Record<string, unknown>;
  } catch {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_KEYRING_INVALID');
  }
  const normalized = Object.fromEntries(
    Object.entries(keys).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length >= 32
    )
  );
  if (!normalized[activeKeyVersion]) {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_ACTIVE_KEY_MISSING');
  }
  return { activeKeyVersion, keys: normalized };
}

export function localMindLogArchiveDirectory(
  source: NodeJS.ProcessEnv = process.env
) {
  const directory = source.LOCALMIND_AUDIT_ARCHIVE_DIR?.trim();
  if (!directory) throw new Error('LOCALMIND_AUDIT_ARCHIVE_DIR_MISSING');
  if (!isAbsolute(directory)) {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_DIR_NOT_ABSOLUTE');
  }
  return directory;
}

export function createLocalMindLogArchiveEnvelope(
  manifest: LocalMindLogArchiveManifest,
  keyring: LocalMindLogArchiveKeyring
): LocalMindLogArchiveEnvelope {
  const serialized = JSON.stringify(manifest);
  const fingerprint = createHash('sha256').update(serialized).digest('hex');
  const signature = createHmac('sha256', keyring.keys[keyring.activeKeyVersion])
    .update(serialized)
    .digest('base64url');
  return {
    keyVersion: keyring.activeKeyVersion,
    fingerprint,
    signature,
    manifest,
  };
}

export function verifyLocalMindLogArchiveEnvelope(
  envelope: LocalMindLogArchiveEnvelope,
  keyring: LocalMindLogArchiveKeyring
) {
  if (envelope.manifest.schemaVersion !== LOCALMIND_LOG_ARCHIVE_SCHEMA) {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_SCHEMA_INVALID');
  }
  const key = keyring.keys[envelope.keyVersion];
  if (!key) throw new Error('LOCALMIND_AUDIT_ARCHIVE_KEY_VERSION_UNKNOWN');
  const serialized = JSON.stringify(envelope.manifest);
  const fingerprint = createHash('sha256').update(serialized).digest('hex');
  if (fingerprint !== envelope.fingerprint) {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_FINGERPRINT_MISMATCH');
  }
  const expected = createHmac('sha256', key)
    .update(serialized)
    .digest('base64url');
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(envelope.signature);
  if (
    expectedBytes.length !== actualBytes.length ||
    !timingSafeEqual(expectedBytes, actualBytes)
  ) {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_SIGNATURE_MISMATCH');
  }
  if (envelope.manifest.itemCount !== envelope.manifest.entries.length) {
    throw new Error('LOCALMIND_AUDIT_ARCHIVE_COUNT_MISMATCH');
  }
  return {
    fingerprint,
    keyVersion: envelope.keyVersion,
    itemCount: envelope.manifest.itemCount,
  };
}

export async function writeLocalMindLogArchiveEnvelope(
  directory: string,
  envelope: LocalMindLogArchiveEnvelope
) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, `${envelope.manifest.batchId}.json`);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(envelope), {
    encoding: 'utf8',
    mode: 0o600,
  });
  await rename(temporaryPath, path);
  return path;
}

export async function readAndVerifyLocalMindLogArchiveEnvelope(
  path: string,
  keyring: LocalMindLogArchiveKeyring
) {
  const envelope = JSON.parse(
    await readFile(path, 'utf8')
  ) as LocalMindLogArchiveEnvelope;
  return {
    envelope,
    verification: verifyLocalMindLogArchiveEnvelope(envelope, keyring),
  };
}
