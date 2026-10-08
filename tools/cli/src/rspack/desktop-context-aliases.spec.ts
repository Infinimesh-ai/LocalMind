import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { desktopContextAliases } from './desktop-context-aliases';

const fixtures: string[] = [];

function fixture() {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), 'localmind-desktop-aliases-'))
  );
  fixtures.push(root);
  return {
    root,
    renderer: path.join(root, 'packages', 'electron-renderer'),
    core: path.join(root, 'packages', 'core'),
  };
}

function install(from: string, name: string) {
  const directory = path.join(from, 'node_modules', name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'package.json'),
    JSON.stringify({ name, version: '1.0.0' })
  );
  return directory;
}

afterEach(() => {
  for (const root of fixtures.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('desktop context aliases', () => {
  test('resolves root-hoisted dependencies without workspace node_modules', () => {
    const { root, renderer, core } = fixture();
    const names = [
      'react',
      'react-dom',
      'react-router-dom',
      'react-router',
      '@remix-run/router',
      'jotai',
    ];
    const expected = Object.fromEntries(
      names.map(name => [name, install(root, name)])
    );

    expect(desktopContextAliases(renderer, core)).toEqual(expected);
  });

  test('uses owner dependencies when focused installs contain other copies', () => {
    const { root, renderer, core } = fixture();
    const react = install(renderer, 'react');
    const reactDom = install(renderer, 'react-dom');
    const routerDom = install(renderer, 'react-router-dom');
    const router = install(routerDom, 'react-router');
    const remixRouter = install(router, '@remix-run/router');
    const jotai = install(core, 'jotai');
    install(root, 'react');
    install(core, 'react');
    install(renderer, 'react-router');
    install(renderer, '@remix-run/router');
    install(renderer, 'jotai');

    expect(desktopContextAliases(renderer, core)).toEqual({
      react,
      'react-dom': reactDom,
      'react-router-dom': routerDom,
      'react-router': router,
      '@remix-run/router': remixRouter,
      jotai,
    });
  });
});
