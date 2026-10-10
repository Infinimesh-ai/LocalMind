import type { DocProps } from '@affine/core/blocksuite/initialization';
import type { DocMode } from '@blocksuite/affine/model';

export interface DocCreateOptions {
  id?: string;
  parentNodeId?: string | null;
  title?: string;
  primaryMode?: DocMode;
  skipInit?: boolean;
  docProps?: DocProps;
  isTemplate?: boolean;
}
