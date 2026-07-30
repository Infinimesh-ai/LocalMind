import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const scriptPath = fileURLToPath(import.meta.url);
const serverRoot = resolve(dirname(scriptPath), '..');
const copilotTestRoot = resolve(serverRoot, 'src/__tests__/copilot');
const targetArgIndex = process.argv.indexOf('--file');

if (targetArgIndex !== -1) {
  typecheckTarget(process.argv[targetArgIndex + 1]);
} else {
  await typecheckAllTargets();
}

function typecheckTarget(targetArg) {
  if (!targetArg) {
    throw new Error('Missing Copilot test file');
  }

  const configPath = resolve(serverRoot, 'tsconfig.json');
  const config = ts.getParsedCommandLineOfConfigFile(configPath, {}, ts.sys);
  if (!config) {
    throw new Error(`Failed to parse ${configPath}`);
  }

  const testsSegment = `${sep}__tests__${sep}`;
  const target = resolve(serverRoot, targetArg);
  const rootNames = [
    ...config.fileNames.filter(file => !file.includes(testsSegment)),
    target,
  ];
  const program = ts.createProgram({
    rootNames,
    options: {
      ...config.options,
      composite: false,
      incremental: false,
      noEmit: true,
      tsBuildInfoFile: undefined,
    },
    projectReferences: config.projectReferences,
  });
  const diagnostics = [...config.errors];

  for (const sourceFile of program.getSourceFiles()) {
    if (
      sourceFile.fileName === target ||
      sourceFile.fileName.includes(testsSegment)
    ) {
      diagnostics.push(
        ...program.getSyntacticDiagnostics(sourceFile),
        ...program.getSemanticDiagnostics(sourceFile)
      );
    }
  }

  if (diagnostics.length > 0) {
    console.error(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => serverRoot,
        getNewLine: () => '\n',
      })
    );
    process.exitCode = 1;
  }
}

async function typecheckAllTargets() {
  const targets = readdirSync(copilotTestRoot)
    // The legacy smoke is executed with `yarn r`; its single 12k-line main
    // exceeds TypeScript's control-flow analysis limit.
    .filter(file => !file.startsWith('._') && /\.(?:e2e|spec)\.ts$/.test(file))
    .sort()
    .map(file => relative(serverRoot, resolve(copilotTestRoot, file)));
  const failures = [];
  let nextTarget = 0;

  async function runWorker() {
    while (nextTarget < targets.length) {
      const target = targets[nextTarget++];
      const result = await runTarget(target);
      if (result.exitCode !== 0) {
        failures.push(result);
      }
    }
  }

  await Promise.all([runWorker(), runWorker()]);

  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`\nCopilot test typecheck failed: ${failure.target}`);
      process.stderr.write(failure.output);
    }
    process.exitCode = 1;
    return;
  }

  console.log(`Copilot test typecheck passed (${targets.length} files).`);
}

function runTarget(target) {
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, [scriptPath, '--file', target], {
      cwd: serverRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';

    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.stderr.on('data', chunk => {
      output += chunk;
    });
    child.on('error', error => {
      resolveResult({
        exitCode: 1,
        output: `${output}${error.stack ?? error.message}\n`,
        target,
      });
    });
    child.on('exit', exitCode => {
      resolveResult({
        exitCode: exitCode ?? 1,
        output,
        target,
      });
    });
  });
}
