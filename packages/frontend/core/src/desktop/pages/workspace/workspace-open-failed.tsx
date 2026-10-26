import { ErrorDetail } from '@affine/core/components/affine/affine-error-boundary/error-basic/error-detail';
import { WorkspaceSwitchService } from '@affine/core/modules/workspace';
import { useI18n } from '@affine/i18n';
import { useLiveData, useService } from '@toeverything/infra';

export const WorkspaceOpenFailed = ({
  workspaceId,
}: {
  workspaceId: string;
}) => {
  const switches = useService(WorkspaceSwitchService);
  const state = useLiveData(switches.state$);
  const t = useI18n();

  if (state.phase !== 'failed' || state.targetWorkspaceId !== workspaceId) {
    return null;
  }

  return (
    <ErrorDetail
      title={t['com.affine.error.unexpected-error.title']()}
      description={t['com.affine.localmind.aiContext.loadFailed.description']()}
      buttonText={t['com.affine.error.refetch']()}
      resetError={() => switches.begin(workspaceId)}
    />
  );
};
