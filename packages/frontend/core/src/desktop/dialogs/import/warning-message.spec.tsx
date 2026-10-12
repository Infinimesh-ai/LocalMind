/** @vitest-environment happy-dom */
import { getOrCreateI18n } from '@affine/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { ImportWarningMessage } from './warning-message';

beforeEach(async () => {
  await getOrCreateI18n().changeLanguage('zh-Hans');
});
afterEach(async () => {
  cleanup();
  await getOrCreateI18n().changeLanguage('en');
});

test('placement warnings explain the outcome in Chinese and retain source evidence', () => {
  render(
    <ImportWarningMessage
      warning={{
        code: 'unresolved_folder',
        sourcePath: '测试目录/文档',
        message: 'Parent page was not imported',
      }}
    />
  );
  expect(
    screen.getByText('有资源未能放入原来的上级容器，请检查其当前位置。')
  ).toBeDefined();
  expect(screen.getByText('测试目录/文档')).toBeDefined();
  expect(screen.getByText('技术详情')).toBeDefined();
  expect(screen.getByText('Parent page was not imported')).toBeDefined();
});

test('unknown warning codes have a translated explanation with diagnostic details', () => {
  render(
    <ImportWarningMessage
      warning={{
        code: 'future-import-code',
        message: 'Detailed original error',
      }}
    />
  );
  expect(
    screen.getByText('部分内容未能完整导入，请查看下方详细信息。')
  ).toBeDefined();
  expect(screen.getByText('Detailed original error')).toBeDefined();
});

test('OCR warnings retain their translated page list', () => {
  const { container } = render(
    <ImportWarningMessage
      warning={{ code: 'pdf-pages-ocr-failed', message: '2, 4' }}
    />
  );
  expect(container.textContent).toContain('2, 4');
  expect(container.textContent).not.toContain('com.affine.');
  expect(container.querySelector('details')).toBeNull();
});
