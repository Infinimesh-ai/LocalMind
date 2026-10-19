import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rspack } from '@rspack/core';
import { expect, test } from 'vitest';

test('browser report models compile without PDF or font-rendering dependencies', async () => {
  const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
  const temporary = await mkdtemp(resolve(tmpdir(), 'localmind-report-entry-'));
  const entry = resolve(temporary, 'entry.ts');
  await writeFile(
    entry,
    `import { BUILTIN_REPORT_TEMPLATES, createReportDocument, projectReportAudience, layoutReport } from '@localmind/office/report'; console.log(BUILTIN_REPORT_TEMPLATES, createReportDocument, projectReportAudience, layoutReport);`
  );
  const compiler = rspack({
    mode: 'development',
    context: repoRoot,
    entry,
    target: 'web',
    devtool: false,
    output: { path: resolve(temporary, 'dist'), filename: 'browser.js' },
    resolve: {
      extensions: ['.ts', '.js'],
      modules: [resolve(repoRoot, 'node_modules')],
    },
    module: {
      rules: [
        {
          test: /\.ts$/,
          exclude: /node_modules/,
          use: {
            loader: 'builtin:swc-loader',
            options: { jsc: { parser: { syntax: 'typescript' } } },
          },
        },
      ],
    },
    externals: [
      ({ request }, callback) => {
        if (request === 'pdf-lib' || request === '@pdf-lib/fontkit')
          callback(
            new Error(
              `Server export dependency reached the browser: ${request}`
            )
          );
        else callback();
      },
    ],
  });
  try {
    const stats = await new Promise<
      NonNullable<Parameters<Parameters<typeof compiler.run>[0]>[1]>
    >((accept, reject) =>
      compiler.run((error, result) => {
        if (error || !result)
          reject(error ?? new Error('Compiler result is unavailable'));
        else accept(result);
      })
    );
    expect(
      stats.hasErrors(),
      stats.toString({ all: false, errors: true })
    ).toBe(false);
  } finally {
    await new Promise<void>((accept, reject) =>
      compiler.close(error => (error ? reject(error) : accept()))
    );
    await rm(temporary, { recursive: true, force: true });
  }
}, 30000);
