/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

vi.mock('@affine/component', () => ({
  useDraggable: () => ({ dragRef: { current: null } }),
}));
vi.mock('@affine/core/components/hooks/affine-async-hooks', () => ({
  useAsyncCallback: (callback: unknown) => callback,
}));
vi.mock('@affine/core/utils', () => ({ inferOpenMode: vi.fn() }));
vi.mock('../../navigation/utils', () => ({ resolveRouteLinkMeta: vi.fn() }));
vi.mock('../services/workbench', () => ({ WorkbenchService: class {} }));
vi.mock('@toeverything/infra', () => ({
  useLiveData: (value: unknown) => value,
  useServices: () => ({
    workbenchService: { workbench: { ['basename$']: '/workspace/test' } },
  }),
}));

import { WorkbenchLink } from './workbench-link';

afterEach(cleanup);

test('disabling link dragging also disables the browser native anchor drag', () => {
  const view = render(
    <WorkbenchLink to="/doc" draggable={false}>
      Document
    </WorkbenchLink>
  );
  const link = screen.getByRole('link') as HTMLAnchorElement;
  expect(link.getAttribute('draggable')).toBe('false');
  view.rerender(<WorkbenchLink to="/doc">Document</WorkbenchLink>);
  expect(link.getAttribute('draggable')).toBe('true');
});
