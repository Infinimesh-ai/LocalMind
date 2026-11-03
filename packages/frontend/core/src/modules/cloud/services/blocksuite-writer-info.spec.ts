import { Framework, LiveData } from '@toeverything/infra';
import { Subject } from 'rxjs';
import { expect, test, vi } from 'vitest';

import { BlocksuiteWriterInfoService } from './blocksuite-writer-info';

vi.mock('@blocksuite/affine/shared/services', () => ({
  WriterInfoServiceExtension: (service: unknown) => service,
}));

test('collaboration cursor name and writer info follow a renamed account', () => {
  const account$ = new LiveData<{
    id: string;
    label: string;
    avatar: string | null;
  } | null>({ id: 'me', label: 'Old name', avatar: null });
  const docMetaAdded$ = new Subject<string>();
  const docs = new Map<string, unknown>();
  const createDoc = () => {
    const awareness = { setLocalStateField: vi.fn() };
    return {
      awarenessStore: { awareness },
      storeExtensions: [] as {
        getWriterInfo: () => { id: string; name: string } | null;
      }[],
    };
  };
  const framework = new Framework();
  framework.service(
    BlocksuiteWriterInfoService,
    () => new BlocksuiteWriterInfoService({ server: { account$ } } as never)
  );
  const service = framework.provider().get(BlocksuiteWriterInfoService);
  service.onWorkspaceInitialized({
    // eslint-disable-next-line rxjs/finnish -- mirrors the workspace meta API
    docCollection: { meta: { docMetaAdded: docMetaAdded$ }, docs },
  } as never);

  const doc = createDoc();
  docs.set('doc', doc);
  docMetaAdded$.next('doc');
  expect(
    doc.awarenessStore.awareness.setLocalStateField
  ).toHaveBeenLastCalledWith('user', { name: 'Old name' });

  account$.next({ id: 'me', label: 'New name', avatar: null });
  expect(
    doc.awarenessStore.awareness.setLocalStateField
  ).toHaveBeenLastCalledWith('user', { name: 'New name' });
  expect(doc.storeExtensions[0].getWriterInfo()).toMatchObject({
    id: 'me',
    name: 'New name',
  });

  const calls =
    doc.awarenessStore.awareness.setLocalStateField.mock.calls.length;
  account$.next({ id: 'me', label: 'New name', avatar: 'avatar' });
  expect(doc.awarenessStore.awareness.setLocalStateField).toHaveBeenCalledTimes(
    calls
  );
  service.dispose();
});
