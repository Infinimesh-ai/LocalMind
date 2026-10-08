import { createRequire } from 'node:module';
import path from 'node:path';

function resolvePackageDirectory(from: string, name: string) {
  const require = createRequire(path.join(from, 'package.json'));
  return path.dirname(require.resolve(`${name}/package.json`));
}

export function desktopContextAliases(rendererPath: string, corePath: string) {
  const routerDom = resolvePackageDirectory(rendererPath, 'react-router-dom');
  const router = resolvePackageDirectory(routerDom, 'react-router');

  // Resolve from each owner so both hoisted and focused installs share
  // one context, including imports of package subpaths such as jotai/vanilla.
  return {
    react: resolvePackageDirectory(rendererPath, 'react'),
    'react-dom': resolvePackageDirectory(rendererPath, 'react-dom'),
    'react-router-dom': routerDom,
    'react-router': router,
    '@remix-run/router': resolvePackageDirectory(router, '@remix-run/router'),
    jotai: resolvePackageDirectory(corePath, 'jotai'),
  };
}
