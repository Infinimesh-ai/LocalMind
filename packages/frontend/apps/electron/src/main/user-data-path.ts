import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

type BuildType = 'stable' | 'beta' | 'canary' | 'internal';

export function getProductDataName(buildType: BuildType) {
  return buildType === 'stable' ? 'LocalMind' : `LocalMind-${buildType}`;
}

function getLegacyProductDataName(buildType: BuildType) {
  return buildType === 'stable' ? 'AFFiNE' : `AFFiNE-${buildType}`;
}

export function prepareUserDataPath(appDataPath: string, buildType: BuildType) {
  const targetPath = path.join(appDataPath, getProductDataName(buildType));
  const legacyPath = path.join(
    appDataPath,
    getLegacyProductDataName(buildType)
  );

  if (existsSync(targetPath) || !existsSync(legacyPath)) {
    return targetPath;
  }

  const lockPath = `${targetPath}.migration-lock`;
  const stagingPath = `${targetPath}.migrating`;

  try {
    mkdirSync(lockPath);
  } catch {
    return existsSync(targetPath) ? targetPath : legacyPath;
  }

  try {
    rmSync(stagingPath, { force: true, recursive: true });
    cpSync(legacyPath, stagingPath, {
      errorOnExist: true,
      recursive: true,
    });
    writeFileSync(
      path.join(stagingPath, '.localmind-profile-migrated-v1'),
      'source=legacy-affine-profile\n'
    );
    renameSync(stagingPath, targetPath);
    return targetPath;
  } catch {
    rmSync(stagingPath, { force: true, recursive: true });
    return legacyPath;
  } finally {
    rmSync(lockPath, { force: true, recursive: true });
  }
}
