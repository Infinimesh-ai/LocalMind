import { AIModelService } from '@affine/core/modules/ai-button/services/models';
import { LifeCycleWatcher } from '@blocksuite/affine/std';
import type { FrameworkProvider } from '@toeverything/infra';

import { buildAIPanelConfig } from '../ai-panel';
import { setupSpaceAIEntry } from '../entries/space/setup-space';
import { AffineAIPanelWidget } from '../widgets/ai-panel/ai-panel';

export function getAIPageRootWatcher(framework?: FrameworkProvider) {
  class AIPageRootWatcher extends LifeCycleWatcher {
    static override key = 'ai-page-root-watcher';

    override mounted() {
      super.mounted();
      const { view } = this.std;
      view.viewUpdated.subscribe(payload => {
        if (payload.type !== 'widget' || payload.method !== 'add') {
          return;
        }
        const component = payload.view;
        if (component instanceof AffineAIPanelWidget) {
          component.style.width = '630px';
          const aiModelService = framework?.getOptional(AIModelService);
          component.config = buildAIPanelConfig(component, {
            resolveActionModelId: aiModelService
              ? ({ promptName, workspaceId }) =>
                  aiModelService.ensureModelForPrompt(promptName, workspaceId)
              : undefined,
          });
          setupSpaceAIEntry(component);
        }
      });
    }
  }
  return AIPageRootWatcher;
}
