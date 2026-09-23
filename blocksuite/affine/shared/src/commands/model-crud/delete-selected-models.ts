import type { Command } from '@blocksuite/std';
import type { BlockModel } from '@blocksuite/store';

import { deleteBlockWithListOrder } from '../../utils/model/list.js';

export const deleteSelectedModelsCommand: Command<{
  selectedModels?: BlockModel[];
}> = (ctx, next) => {
  const models = ctx.selectedModels;

  if (!models) {
    console.error(
      '`selectedModels` is required, you need to use `getSelectedModels` command before adding this command to the pipeline.'
    );
    return;
  }

  ctx.std.store.transact(() => {
    models.forEach(model => {
      deleteBlockWithListOrder(ctx.std.store, model);
    });
  });

  return next();
};
