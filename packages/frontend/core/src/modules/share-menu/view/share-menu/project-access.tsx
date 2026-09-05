import { Button, Loading, notify, useConfirmModal } from '@affine/component';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { GraphQLService } from '@affine/core/modules/cloud';
import { UserFriendlyError } from '@affine/error';
import {
  approveCopilotAccessRequestMutation,
  copilotWorkbenchSourceAuthorizationGetQuery,
  rejectCopilotAccessRequestMutation,
  revokeCopilotProjectGrantMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useCallback, useState } from 'react';

import * as styles from './project-access.css';

const formatDate = (value: string) => new Date(value).toLocaleString();

export const ProjectAccess = ({
  workspaceId,
  docId,
}: {
  workspaceId: string;
  docId: string;
}) => {
  const t = useI18n();
  const graphqlService = useService(GraphQLService);
  const { openConfirmModal } = useConfirmModal();
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const { data, error, isLoading, mutate } = useQuery(
    {
      query: copilotWorkbenchSourceAuthorizationGetQuery,
      variables: { workspaceId, docId },
    },
    { suspense: false, shouldRetryOnError: false }
  );
  const requests = data?.currentUser?.copilot.workbenchAccessRequests ?? [];
  const grants =
    data?.currentUser?.copilot.workbenchProjectGrantsForSource ?? [];

  const reportError = useCallback(
    (caught: unknown) => {
      notify.error({
        title: t['com.affine.localmind.share.projectAccess.actionFailed'](),
        message: UserFriendlyError.fromAny(caught).message,
      });
    },
    [t]
  );

  const resolveRequest = useCallback(
    async (requestId: string, decision: 'approve' | 'reject') => {
      if (pendingKey) return;
      setPendingKey(`${decision}:${requestId}`);
      try {
        await graphqlService.gql({
          query:
            decision === 'approve'
              ? approveCopilotAccessRequestMutation
              : rejectCopilotAccessRequestMutation,
          variables: { input: { requestId } },
        });
        await mutate();
        notify.success({
          title:
            decision === 'approve'
              ? t['com.affine.localmind.share.projectAccess.approved']()
              : t['com.affine.localmind.share.projectAccess.rejected'](),
        });
      } catch (caught) {
        reportError(caught);
      } finally {
        setPendingKey(null);
      }
    },
    [graphqlService, mutate, pendingKey, reportError, t]
  );

  const revokeGrant = useCallback(
    (grant: (typeof grants)[number]) => {
      openConfirmModal({
        title: t['com.affine.localmind.share.projectAccess.revokeConfirm'](),
        description: t[
          'com.affine.localmind.share.projectAccess.revokeDescription'
        ]({ project: grant.projectName }),
        confirmText: t['com.affine.localmind.share.projectAccess.revoke'](),
        cancelText: t['Cancel'](),
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          if (pendingKey) return;
          setPendingKey(`revoke:${grant.id}`);
          try {
            await graphqlService.gql({
              query: revokeCopilotProjectGrantMutation,
              variables: { input: { grantId: grant.id } },
            });
            await mutate();
            notify.success({
              title: t['com.affine.localmind.share.projectAccess.revoked'](),
            });
          } catch (caught) {
            reportError(caught);
          } finally {
            setPendingKey(null);
          }
        },
      });
    },
    [graphqlService, mutate, openConfirmModal, pendingKey, reportError, t]
  );

  return (
    <section
      className={styles.root}
      aria-label={t['com.affine.localmind.share.projectAccess.title']()}
    >
      <h3 className={styles.heading}>
        {t['com.affine.localmind.share.projectAccess.title']()}
      </h3>
      {isLoading ? (
        <div className={styles.centerState}>
          <Loading size={20} />
        </div>
      ) : error ? (
        <div className={styles.centerState} role="alert">
          <span>{error.message}</span>
          <Button onClick={() => void mutate()}>
            {t['com.affine.localmind.workbench.retry']()}
          </Button>
        </div>
      ) : (
        <>
          {requests.length ? (
            <div className={styles.group}>
              <h4>
                {t['com.affine.localmind.share.projectAccess.requests']()}
              </h4>
              {requests.map(request => {
                const projectBeneficiary =
                  request.beneficiaryType === 'project';
                return (
                  <div className={styles.item} key={request.id}>
                    <div className={styles.identity}>
                      <strong title={request.requestedTitle ?? undefined}>
                        {request.requestedTitle ||
                          (projectBeneficiary
                            ? t[
                                'com.affine.localmind.share.projectAccess.projectRequest'
                              ]()
                            : t[
                                'com.affine.localmind.share.projectAccess.personalRequest'
                              ]())}
                      </strong>
                      <span>
                        {t[
                          'com.affine.localmind.share.projectAccess.requestMeta'
                        ]({
                          level: request.requestedLevel,
                          time: formatDate(request.createdAt),
                        })}
                      </span>
                      <span>
                        {projectBeneficiary
                          ? t[
                              'com.affine.localmind.share.projectAccess.projectBeneficiary'
                            ]({ id: request.beneficiaryProjectId ?? '-' })
                          : t[
                              'com.affine.localmind.share.projectAccess.userBeneficiary'
                            ]({ id: request.beneficiaryUserId ?? '-' })}
                      </span>
                      <span>
                        {t[
                          'com.affine.localmind.share.projectAccess.requester'
                        ]({ id: request.requesterUserId ?? '-' })}
                      </span>
                    </div>
                    <div className={styles.actions}>
                      <Button
                        size="custom"
                        variant="primary"
                        disabled={pendingKey !== null}
                        loading={pendingKey === `approve:${request.id}`}
                        onClick={() =>
                          void resolveRequest(request.id, 'approve')
                        }
                      >
                        {t[
                          'com.affine.localmind.share.projectAccess.approve'
                        ]()}
                      </Button>
                      <Button
                        size="custom"
                        variant="error"
                        disabled={pendingKey !== null}
                        loading={pendingKey === `reject:${request.id}`}
                        onClick={() =>
                          void resolveRequest(request.id, 'reject')
                        }
                      >
                        {t['com.affine.localmind.share.projectAccess.reject']()}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className={styles.group}>
            <h4>{t['com.affine.localmind.share.projectAccess.grants']()}</h4>
            {grants.length ? (
              grants.map(grant => (
                <div className={styles.item} key={grant.id}>
                  <div className={styles.identity}>
                    <strong title={grant.projectName}>
                      {grant.projectName}
                    </strong>
                    <span>
                      {t['com.affine.localmind.share.projectAccess.grantMeta']({
                        level: grant.level,
                        source: grant.source,
                        grantor: grant.grantedByUserId ?? '-',
                        time: formatDate(grant.grantedAt),
                      })}
                    </span>
                  </div>
                  <Button
                    size="custom"
                    variant="error"
                    disabled={!grant.revocable || pendingKey !== null}
                    loading={pendingKey === `revoke:${grant.id}`}
                    onClick={() => revokeGrant(grant)}
                  >
                    {t['com.affine.localmind.share.projectAccess.revoke']()}
                  </Button>
                </div>
              ))
            ) : (
              <div className={styles.empty}>
                {t['com.affine.localmind.share.projectAccess.empty']()}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
};
