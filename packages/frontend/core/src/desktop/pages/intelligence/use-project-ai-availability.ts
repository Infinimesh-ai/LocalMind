import type { AIChatComposerNotice } from '@affine/core/blocksuite/ai/components/ai-chat-composer/notice';
import { ProjectAIModel } from '@affine/core/modules/ai-button/entities/project-model';
import { AuthService, UserFeatureService } from '@affine/core/modules/cloud';
import { useSignalValue } from '@affine/core/modules/doc-info/utils';
import { useProjectRefresh } from '@affine/core/modules/project-resources/realtime';
import { useI18n } from '@affine/i18n';
import { useFramework, useLiveData, useService } from '@toeverything/infra';
import { useEffect, useMemo } from 'react';

export function useProjectAIAvailability(projectId: string | null) {
  const t = useI18n();
  const framework = useFramework();
  const model = useMemo(
    () => framework.createEntity(ProjectAIModel, { projectId }),
    [framework, projectId]
  );
  useEffect(() => () => model.dispose(), [model]);
  useProjectRefresh(projectId, 'list', model.refresh);
  const configuration = useSignalValue(model.configuration);
  const userFeature = useService(UserFeatureService).userFeature;
  const account = useLiveData(useService(AuthService).session.account$);
  // The Project shell may mount after sign-in, before the full profile arrives.
  useEffect(() => {
    userFeature.revalidate();
  }, [account, userFeature]);
  const isAdmin = useLiveData(userFeature.isAdmin$);
  let notice: AIChatComposerNotice | undefined;
  if (projectId && configuration === 'loading') {
    notice = { title: t['com.affine.localmind.project-byok.checking']() };
  } else if (projectId && configuration === 'missing') {
    notice = {
      title: t['com.affine.localmind.project-byok.unavailableTitle'](),
      description:
        t[
          isAdmin
            ? 'com.affine.localmind.project-byok.adminSetupHelp'
            : 'com.affine.localmind.project-byok.memberSetupHelp'
        ](),
      action: isAdmin
        ? {
            label: t['com.affine.localmind.project-byok.configure'](),
            href: '/admin/ai/config',
          }
        : undefined,
    };
  } else if (projectId && configuration === 'error') {
    notice = {
      title: t['com.affine.localmind.project-byok.error'](),
      description: t['com.affine.localmind.project-byok.retryHelp'](),
      action: { label: t['Retry'](), onClick: model.refresh },
    };
  }
  return {
    model,
    configuration,
    notice,
    sendBlocked: !!projectId && configuration !== 'configured',
  };
}
