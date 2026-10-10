import {
  type StoreExtensionContext,
  StoreExtensionProvider,
} from '@blocksuite/affine/ext-loader';
import {
  BlockModel,
  BlockSchemaExtension,
  defineBlockSchema,
} from '@blocksuite/affine/store';

import { subpageAdapters } from './adapters';

export class SubpageBlockModel extends BlockModel<{
  resourceId: string;
  kind: string;
}> {}
export const SubpageBlockSchema = defineBlockSchema({
  flavour: 'localmind:subpage',
  props: () => ({ resourceId: '', kind: 'doc' }),
  metadata: {
    version: 1,
    role: 'content',
    parent: ['affine:note', 'affine:callout'],
    children: [],
  },
  toModel: () => new SubpageBlockModel(),
});
export class PageTreeStoreExtension extends StoreExtensionProvider {
  override name = 'localmind-page-tree-store';
  override setup(context: StoreExtensionContext) {
    super.setup(context);
    context.register(BlockSchemaExtension(SubpageBlockSchema));
    context.register(subpageAdapters);
  }
}
