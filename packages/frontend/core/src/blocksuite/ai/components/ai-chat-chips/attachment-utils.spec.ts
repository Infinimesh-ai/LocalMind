/**
 * @vitest-environment happy-dom
 */
import { expect, test, vi } from 'vitest';

import { addFilesToChat } from './attachment-utils';
import type { ChatChip } from './type';

test('adds multiple files without overlapping context mutations', async () => {
  const first = new File(['first'], 'first.txt', { type: 'text/plain' });
  const second = new File(['second'], 'second.txt', { type: 'text/plain' });
  let releaseFirst!: () => void;
  const firstPending = new Promise<void>(resolve => {
    releaseFirst = resolve;
  });
  const added: string[] = [];
  const addChip = vi.fn(async (chip: ChatChip) => {
    if (!('file' in chip)) throw new Error('Expected a file chip');
    if (chip.file === first) await firstPending;
    added.push(chip.file.name);
  });

  const completion = addFilesToChat([first, second], {
    addImages: vi.fn(),
    addChip,
  });
  expect(addChip).toHaveBeenCalledTimes(1);
  releaseFirst();
  await completion;
  expect(added).toEqual(['first.txt', 'second.txt']);
});
