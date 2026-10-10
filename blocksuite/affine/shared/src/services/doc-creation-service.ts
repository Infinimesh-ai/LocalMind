import { createIdentifier } from '@blocksuite/global/di';
import type { Store } from '@blocksuite/store';

/** The host allocates document identity and ownership before editor content is inserted. */
export const DocCreationProvider = createIdentifier<{
  create: () => Promise<Store>;
}>('AffineDocCreation');
