import type { SwcJsMinimizerRspackPluginOptions } from '@rspack/core';

export const diMinimizerOptions = {
  ecma: 2020,
  // BlockSuite DI identifies extension factories by their constructor names.
  // Compression can remove these names before the mangling pass runs.
  compress: { unused: true, keep_classnames: true },
  mangle: { keep_classnames: true },
} satisfies SwcJsMinimizerRspackPluginOptions['minimizerOptions'];
