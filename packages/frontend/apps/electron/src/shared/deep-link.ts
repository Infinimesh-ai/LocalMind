export type DeepLinkBuildType = 'stable' | 'beta' | 'canary' | 'internal';

export function getDeepLinkSchemes(
  buildType: DeepLinkBuildType,
  isDev: boolean
) {
  const suffix = isDev ? '-dev' : buildType === 'stable' ? '' : `-${buildType}`;
  const primary = `localmind${suffix}`;
  const legacy = `affine${suffix}`;

  return {
    primary,
    legacy,
    supported: [primary, legacy] as const,
  };
}

export function isSupportedDeepLink(
  rawUrl: string,
  schemes: readonly string[]
) {
  try {
    const scheme = new URL(rawUrl).protocol.slice(0, -1);
    return schemes.includes(scheme);
  } catch {
    return false;
  }
}
