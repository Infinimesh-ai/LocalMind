import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getProductDataName,
  prepareUserDataPath,
} from '../../src/main/user-data-path';

const tempDirs: string[] = [];

function createAppDataDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'localmind-user-data-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true });
  }
});

describe('LocalMind user data path', () => {
  it.each([
    ['stable', 'LocalMind'],
    ['beta', 'LocalMind-beta'],
    ['canary', 'LocalMind-canary'],
    ['internal', 'LocalMind-internal'],
  ] as const)('uses a LocalMind-owned directory for %s', (buildType, name) => {
    expect(getProductDataName(buildType)).toBe(name);
    expect(prepareUserDataPath(createAppDataDir(), buildType)).toBe(
      path.join(tempDirs.at(-1)!, name)
    );
  });

  it('copies a legacy profile once and preserves the source directory', () => {
    const appDataDir = createAppDataDir();
    const legacyDir = path.join(appDataDir, 'AFFiNE');
    const targetDir = path.join(appDataDir, 'LocalMind');
    mkdirSync(legacyDir);
    writeFileSync(path.join(legacyDir, 'config.json'), '{"theme":"dark"}');

    expect(prepareUserDataPath(appDataDir, 'stable')).toBe(targetDir);
    expect(readFileSync(path.join(targetDir, 'config.json'), 'utf8')).toBe(
      '{"theme":"dark"}'
    );
    expect(
      existsSync(path.join(targetDir, '.localmind-profile-migrated-v1'))
    ).toBe(true);
    expect(existsSync(path.join(legacyDir, 'config.json'))).toBe(true);

    writeFileSync(path.join(targetDir, 'config.json'), '{"theme":"light"}');
    expect(prepareUserDataPath(appDataDir, 'stable')).toBe(targetDir);
    expect(readFileSync(path.join(targetDir, 'config.json'), 'utf8')).toBe(
      '{"theme":"light"}'
    );
  });

  it('does not overwrite an existing LocalMind profile', () => {
    const appDataDir = createAppDataDir();
    const legacyDir = path.join(appDataDir, 'AFFiNE');
    const targetDir = path.join(appDataDir, 'LocalMind');
    mkdirSync(legacyDir);
    mkdirSync(targetDir);
    writeFileSync(path.join(legacyDir, 'config.json'), 'legacy');
    writeFileSync(path.join(targetDir, 'config.json'), 'current');

    expect(prepareUserDataPath(appDataDir, 'stable')).toBe(targetDir);
    expect(readFileSync(path.join(targetDir, 'config.json'), 'utf8')).toBe(
      'current'
    );
  });

  it('falls back to the legacy profile while another migration owns the lock', () => {
    const appDataDir = createAppDataDir();
    const legacyDir = path.join(appDataDir, 'AFFiNE');
    mkdirSync(legacyDir);
    mkdirSync(path.join(appDataDir, 'LocalMind.migration-lock'));

    expect(prepareUserDataPath(appDataDir, 'stable')).toBe(legacyDir);
  });
});
