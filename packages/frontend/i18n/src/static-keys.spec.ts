/// <reference types="node" />

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const frontend = fileURLToPath(new URL('../..', import.meta.url));
const resources = dirname(
  fileURLToPath(new URL('./resources/en.json', import.meta.url))
);

test('every English key has a nonempty simplified Chinese translation, including dynamic keys', () => {
  const english = JSON.parse(readFileSync(join(resources, 'en.json'), 'utf8'));
  const chinese = JSON.parse(
    readFileSync(join(resources, 'zh-Hans.json'), 'utf8')
  );
  expect(Object.keys(english).filter(key => !chinese[key]?.trim())).toEqual([]);
});

test('literal UI keys have English and Chinese translations and confirmation defaults are localized', () => {
  const known = new Set(
    Object.keys(JSON.parse(readFileSync(join(resources, 'en.json'), 'utf8')))
  );
  const chinese = new Set(
    Object.keys(
      JSON.parse(readFileSync(join(resources, 'zh-Hans.json'), 'utf8'))
    )
  );
  for (const dictionary of [known, chinese]) {
    for (const key of dictionary) {
      if (key.endsWith('_other')) dictionary.add(key.slice(0, -6));
    }
  }
  const missing: string[] = [];
  const englishDefaults: string[] = [];
  const scan = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) scan(path);
      else if (
        /\.(ts|tsx)$/.test(entry.name) &&
        !/\.(spec|test|stories|gen)\./.test(entry.name)
      ) {
        const source = readFileSync(path, 'utf8');
        for (const expression of [
          /\b(?:t|i18n|I18n)\[\s*['"]([^'"]+)['"]\s*\]/g,
          /\b(?:t|i18n|I18n|i18next)\.t\(\s*['"]([^'"]+)['"]\s*[,)]/g,
          /\bi18nKey=\{?\s*['"]([^'"]+)['"]/g,
        ]) {
          for (const match of source.matchAll(expression)) {
            if (!known.has(match[1]))
              missing.push(`${path}: missing source ${match[1]}`);
            else if (!chinese.has(match[1]))
              missing.push(`${path}: missing zh-Hans ${match[1]}`);
          }
        }
        for (const match of source.matchAll(
          /\b(?:confirmText|cancelText)\s*(?:=|:)\s*['"]([A-Za-z ]+)['"]/g
        )) {
          englishDefaults.push(`${path}: ${match[0]}`);
        }
      }
    }
  };
  for (const packageName of ['core', 'component', 'admin'])
    scan(join(frontend, packageName, 'src'));
  scan(join(frontend, 'apps'));
  expect(missing).toEqual([]);
  expect(englishDefaults).toEqual([]);
});
