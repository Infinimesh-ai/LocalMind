/** @vitest-environment happy-dom */
import { getOrCreateI18n } from '@affine/i18n';
import { render } from 'lit';
import { beforeAll, expect, test } from 'vitest';

import { ChatPanelFileChip } from './file-chip';
import type { FileChip } from './type';

beforeAll(async () => {
  await getOrCreateI18n().changeLanguage('en');
});

test('uploaded Workspace source remains usable after index failure, while inaccessible Project files remain failed', () => {
  const instance = Object.create(
    ChatPanelFileChip.prototype
  ) as ChatPanelFileChip;
  const chip: FileChip = {
    file: new File(['test'], 'source.csv'),
    fileId: 'file-1',
    state: 'failed',
    directSource: true,
    tooltip: 'No provider',
  };
  Object.defineProperty(instance, 'chip', { value: chip, writable: true });
  const container = document.createElement('div');
  render(instance.render(), container);
  const element = container.querySelector('chat-panel-chip') as HTMLElement & {
    state: string;
    tooltip: string;
    closeable: boolean;
  };
  expect(element.state).toBe('finished');
  expect(element.tooltip).toContain('source can be read directly');
  expect(element.tooltip).toContain('Semantic indexing failed');
  expect(element.closeable).toBe(true);
  instance.chip = { ...chip, directSource: false, tooltip: 'Access revoked' };
  render(instance.render(), container);
  expect(element.state).toBe('failed');
  expect(element.tooltip).toBe('Access revoked');
});
