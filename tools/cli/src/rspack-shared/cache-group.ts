function testPackageName(regexp: RegExp): (module: any) => boolean {
  return (module: any) =>
    module.nameForCondition && regexp.test(module.nameForCondition());
}

export function getAsyncVendorChunkName(modulePath: string) {
  const shikiAsset = modulePath.match(
    /[\\/]node_modules[\\/]@shikijs[\\/](langs|themes)[\\/]dist[\\/]([^\\/]+)\.mjs$/
  );
  if (shikiAsset) {
    return `npm-async-shiki-${shikiAsset[1]}-${shikiAsset[2]}`;
  }

  // Keep the existing package-level grouping for other async dependencies.
  const name = modulePath.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)?.[1];
  return name ? `npm-async-${name}` : 'app-async';
}

// https://hackernoon.com/the-100-correct-way-to-split-your-chunks-with-webpack-f8a9df5b7758
export const productionCacheGroups = {
  i18n: {
    test: /frontend[\\/]i18n[\\/]/,
    name: (module: any) => {
      const name = module.resource.match(/[\\/]([^\\/]+)\.json$/)?.[1];
      if (name && name !== 'en') {
        return `i18n-langs.${name}`;
      }

      return 'i18n';
    },
    priority: 200,
    enforce: true,
  },
  asyncVendor: {
    test: /[\\/]node_modules[\\/]/,
    name(module: any) {
      const modulePath =
        module?.nameForCondition?.() || module?.context || module?.resource;

      if (!modulePath || typeof modulePath !== 'string') {
        return 'app-async';
      }

      // monorepo linked in node_modules, so it's not a npm package
      if (!modulePath.includes('node_modules')) {
        return `app-async`;
      }
      return getAsyncVendorChunkName(modulePath);
    },
    priority: Number.MAX_SAFE_INTEGER,
    chunks: 'async' as const,
  },
  blocksuite: {
    name: `npm-blocksuite`,
    test: testPackageName(/[\\/]node_modules[\\/](@blocksuite)[\\/]/),
    priority: 200,
    enforce: true,
  },
  react: {
    name: `npm-react`,
    test: testPackageName(
      /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/
    ),
    priority: 200,
    enforce: true,
  },
  jotai: {
    name: `npm-jotai`,
    test: testPackageName(/[\\/]node_modules[\\/](jotai)[\\/]/),
    priority: 200,
    enforce: true,
  },
  rxjs: {
    name: `npm-rxjs`,
    test: testPackageName(/[\\/]node_modules[\\/]rxjs[\\/]/),
    priority: 200,
    enforce: true,
  },
  lodash: {
    name: `npm-lodash`,
    test: testPackageName(/[\\/]node_modules[\\/]lodash[\\/]/),
    priority: 200,
    enforce: true,
  },
  emotion: {
    name: `npm-emotion`,
    test: testPackageName(/[\\/]node_modules[\\/](@emotion)[\\/]/),
    priority: 200,
    enforce: true,
  },
  vendor: {
    name: 'vendor',
    test: /[\\/]node_modules[\\/]/,
    priority: 190,
    enforce: true,
  },
  styles: {
    name: 'styles',
    test: (module: any) =>
      module.nameForCondition &&
      module.nameForCondition()?.endsWith('.css') &&
      !module.type.startsWith('javascript'),
    chunks: 'all' as const,
    minSize: 1,
    minChunks: 1,
    reuseExistingChunk: true,
    priority: 1000,
    enforce: true,
  },
};
