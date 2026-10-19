import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runInNewContext } from 'node:vm';

import rspack from '@rspack/core';
import { expect, test } from 'vitest';

import { diMinimizerOptions } from './di-minimizer-options';

test('production compression preserves constructors returned by extension factories', async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), 'localmind-di-minifier-')
  );
  const entry = path.join(directory, 'entry.js');
  await writeFile(
    entry,
    `class BaseExtension {}
    function extensionFactory() {
      return class ProjectTreeExtension extends BaseExtension {
        static key = 'project-tree';
      };
    }
    function anotherExtensionFactory() {
      class ProjectThemeExtension extends BaseExtension {
        static key = 'project-theme';
      }
      return ProjectThemeExtension;
    }
    module.exports = [extensionFactory(), anotherExtensionFactory()];`
  );
  const compiler = rspack({
    mode: 'production',
    target: 'node',
    entry,
    output: {
      path: directory,
      filename: 'result.js',
      library: { type: 'commonjs2' },
    },
    optimization: {
      minimizer: [
        new rspack.SwcJsMinimizerRspackPlugin({
          minimizerOptions: diMinimizerOptions,
        }),
      ],
    },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      compiler.run((error, stats) => {
        if (error) reject(error);
        else if (stats?.hasErrors()) reject(new Error(stats.toString()));
        else resolve();
      });
    });
    const compiled: { exports: unknown } = { exports: {} };
    runInNewContext(await readFile(path.join(directory, 'result.js'), 'utf8'), {
      module: compiled,
      exports: compiled.exports,
    });
    const constructors = compiled.exports as Array<new () => object>;
    expect(constructors.map(constructor => constructor.name)).toEqual([
      'ProjectTreeExtension',
      'ProjectThemeExtension',
    ]);
    expect(
      constructors.map(constructor => new constructor().constructor.name)
    ).toEqual(['ProjectTreeExtension', 'ProjectThemeExtension']);
  } finally {
    await new Promise<void>((resolve, reject) => {
      compiler.close(error => (error ? reject(error) : resolve()));
    });
    await rm(directory, { recursive: true, force: true });
  }
});
