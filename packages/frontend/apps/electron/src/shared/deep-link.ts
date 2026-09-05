export type DeepLinkBuildType = 'stable' | 'beta' | 'canary' | 'internal';

export type DeepLinkNavigationMode =
  | 'authentication'
  | 'new-tab'
  | 'hidden-window'
  | 'active-tab';

export type AppRouteLocation = {
  basename: string;
  pathname: string;
  search: string;
  hash: string;
};

const WORKSPACE_BASENAME_PATTERN = /^\/workspace\/[^/]+(?=\/|$)/;

function normalizePathname(pathname: string) {
  if (!pathname || pathname === '/') {
    return '/';
  }
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

export function getDeepLinkSchemes(
  buildType: DeepLinkBuildType,
  isDev: boolean
) {
  const suffix = isDev ? '-dev' : buildType === 'stable' ? '' : `-${buildType}`;
  const primary = `localmind${suffix}`;

  return {
    primary,
    supported: [primary] as const,
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

export function getDeepLinkNavigationMode(
  rawUrl: string
): DeepLinkNavigationMode | null {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === 'authentication') {
      return 'authentication';
    }
    if (url.searchParams.get('new-tab')) {
      return 'new-tab';
    }
    if (url.searchParams.get('hidden')) {
      return 'hidden-window';
    }
    return 'active-tab';
  } catch {
    return null;
  }
}

export function parseAppRouteLocation(rawUrl: string): AppRouteLocation {
  const url = new URL(rawUrl);
  const basename = url.pathname.match(WORKSPACE_BASENAME_PATTERN)?.[0] ?? '/';
  const routePathname =
    basename === '/' ? url.pathname : url.pathname.slice(basename.length);

  return {
    basename,
    pathname: normalizePathname(routePathname),
    search: url.search,
    hash: url.hash,
  };
}

export function joinAppRoutePathname(basename: string, pathname: string) {
  const normalizedBasename = normalizePathname(basename).replace(/\/+$/, '');
  const normalizedPathname = normalizePathname(pathname);

  if (!normalizedBasename) {
    return normalizedPathname;
  }
  if (normalizedPathname === '/') {
    return normalizedBasename;
  }
  return `${normalizedBasename}${normalizedPathname}`;
}
