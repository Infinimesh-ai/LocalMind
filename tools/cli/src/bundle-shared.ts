import type { Configuration as RspackDevServerConfiguration } from '@rspack/dev-server';

export const RSPACK_SUPPORTED_PACKAGES = [
  '@affine/admin',
  '@affine/web',
  '@affine/mobile',
  '@affine/ios',
  '@affine/android',
  '@affine/electron-renderer',
  '@affine/server',
  '@affine/reader',
  '@affine/media-capture-playground',
] as const;

const rspackSupportedPackageSet = new Set<string>(RSPACK_SUPPORTED_PACKAGES);
const devServerProxyTarget =
  process.env.AFFINE_DEV_SERVER_PROXY_TARGET || 'http://localhost:3010';
const selfHostedAdminAssetPathPattern =
  /^\/admin\/(?:(?:assets|fonts|js|static|workers)\/|[^/?#]+\.[^/?#]+)/;

export function isRspackSupportedPackageName(name: string) {
  return rspackSupportedPackageSet.has(name);
}

export function assertRspackSupportedPackageName(name: string) {
  if (isRspackSupportedPackageName(name)) {
    return;
  }

  throw new Error(
    `Rspack bundling currently supports: ${Array.from(RSPACK_SUPPORTED_PACKAGES).join(', ')}. Unsupported package: ${name}.`
  );
}

function rewriteSelfHostedAdminAssetPath(url: string | undefined) {
  if (process.env.SELF_HOSTED !== 'true' || !url) {
    return url;
  }

  const separatorIndex = url.search(/[?#]/);
  const pathname = separatorIndex === -1 ? url : url.slice(0, separatorIndex);

  if (!selfHostedAdminAssetPathPattern.test(pathname)) {
    return url;
  }

  return pathname.slice('/admin'.length) + url.slice(pathname.length);
}

export const DEFAULT_DEV_SERVER_CONFIG: RspackDevServerConfiguration = {
  host: '0.0.0.0',
  allowedHosts: 'all',
  hot: false,
  liveReload: true,
  compress: !process.env.CI,
  setupExitSignals: true,
  client: {
    overlay: process.env.DISABLE_DEV_OVERLAY === 'true' ? false : undefined,
    logging: process.env.CI ? 'none' : 'error',
    // see: https://webpack.js.org/configuration/dev-server/#websocketurl
    // must be an explicit ws/wss URL because custom protocols (e.g. assets://)
    // cannot be used to construct WebSocket endpoints in Electron
    webSocketURL: 'ws://0.0.0.0:8080/ws',
  },
  historyApiFallback: {
    rewrites: [
      {
        from: /.*/,
        to: () => {
          return process.env.SELF_HOSTED === 'true'
            ? '/selfhost.html'
            : '/index.html';
        },
      },
    ],
  },
  setupMiddlewares: middlewares => {
    middlewares.unshift({
      name: 'self-hosted-admin-asset-public-path',
      middleware: (req, _res, next) => {
        req.url = rewriteSelfHostedAdminAssetPath(req.url);
        next();
      },
    });

    return middlewares;
  },
  proxy: [
    {
      context: '/api',
      target: devServerProxyTarget,
    },
    {
      context: '/socket.io',
      target: devServerProxyTarget,
      ws: true,
    },
    {
      context: '/graphql',
      target: devServerProxyTarget,
    },
  ],
};
