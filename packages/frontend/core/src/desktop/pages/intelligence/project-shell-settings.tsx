import {
  Button,
  Loading,
  Modal,
  RadioGroup,
  Switch,
  useConfirmModal,
} from '@affine/component';
import { LanguageMenu } from '@affine/core/components/affine/language-menu';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { GraphQLService } from '@affine/core/modules/cloud';
import {
  projectErrorMessage,
  reportProjectError,
} from '@affine/core/modules/project-resources/error';
import {
  copilotContextMemoryDeleteMutation,
  copilotProjectContextDashboardGetQuery,
  copilotProjectContextSettingsUpdateMutation,
  copilotProjectMemoryConflictResolveMutation,
} from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { useService } from '@toeverything/infra';
import { useTheme } from 'next-themes';
import { useMemo, useState } from 'react';

export const ProjectShellSettings = ({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
}) => {
  const t = useI18n();
  const { theme, setTheme } = useTheme();
  const graphql = useService(GraphQLService);
  const confirm = useConfirmModal();
  const [pending, setPending] = useState(false);
  const [memberFilter, setMemberFilter] = useState('all');
  const dashboard = useQuery(
    open && projectId
      ? {
          query: copilotProjectContextDashboardGetQuery,
          variables: { projectId, includeDisabled: true },
        }
      : undefined,
    { suspense: false, shouldRetryOnError: false }
  );
  const currentUser = dashboard.data?.currentUser;
  const copilot = currentUser?.copilot;
  const project = copilot?.contextProject;
  const settings = copilot?.projectContextSettings;
  const members = project?.members ?? [];
  const memories = useMemo(
    () =>
      (copilot?.contextMemories ?? []).filter(
        memory =>
          memory.projectId === projectId &&
          (memberFilter === 'all'
            ? true
            : memberFilter === 'self'
              ? (memory.contributorUserIds ?? []).includes(
                  currentUser?.id ?? ''
                )
              : (memory.contributorUserIds ?? []).includes(memberFilter))
      ),
    [copilot?.contextMemories, currentUser?.id, memberFilter, projectId]
  );
  const conflicts = copilot?.projectMemoryConflicts ?? [];

  const updateAutomaticMemory = async (checked: boolean) => {
    if (!projectId || !settings || pending) return;
    setPending(true);
    try {
      await graphql.gql({
        query: copilotProjectContextSettingsUpdateMutation,
        variables: {
          input: {
            projectId,
            autoMemoryEnabled: checked,
            expectedRevision: settings.revision,
          },
        },
      });
      await dashboard.mutate();
    } catch (error) {
      reportProjectError(error);
    } finally {
      setPending(false);
    }
  };

  const deleteMemory = (memory: (typeof memories)[number]) => {
    confirm.openConfirmModal({
      title: t['com.affine.localmind.aiContext.deleteMemory.title'](),
      description: t['com.affine.localmind.project-memory.deleteDescription'](),
      confirmText: t['com.affine.localmind.aiContext.delete'](),
      cancelText: t['com.affine.localmind.aiContext.cancel'](),
      confirmButtonOptions: { variant: 'error' },
      onConfirm: async () => {
        setPending(true);
        try {
          await graphql.gql({
            query: copilotContextMemoryDeleteMutation,
            variables: {
              id: memory.id,
              expectedRevision: memory.revision,
            },
          });
          await dashboard.mutate();
        } catch (error) {
          reportProjectError(error);
        } finally {
          setPending(false);
        }
      },
    });
  };

  const performConflictResolution = async (
    conflictId: string,
    resolution: 'accept' | 'reject'
  ) => {
    if (!projectId || pending) return;
    setPending(true);
    try {
      await graphql.gql({
        query: copilotProjectMemoryConflictResolveMutation,
        variables: { input: { projectId, conflictId, resolution } },
      });
      await dashboard.mutate();
    } catch (error) {
      reportProjectError(error);
    } finally {
      setPending(false);
    }
  };

  const resolveConflict = (
    conflictId: string,
    resolution: 'accept' | 'reject'
  ) => {
    if (!projectId || pending) return;
    confirm.openConfirmModal({
      title: t['com.affine.localmind.project-memory.conflictConfirmTitle'](),
      description:
        resolution === 'accept'
          ? t['com.affine.localmind.project-memory.conflictAcceptConfirm']()
          : t['com.affine.localmind.project-memory.conflictRejectConfirm'](),
      confirmText:
        resolution === 'accept'
          ? t['com.affine.localmind.project-memory.conflictAccept']()
          : t['com.affine.localmind.project-memory.conflictReject'](),
      cancelText: t['com.affine.localmind.aiContext.cancel'](),
      onConfirm: () => performConflictResolution(conflictId, resolution),
    });
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t['com.affine.appearanceSettings.title']()}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 20,
          paddingBlock: 16,
        }}
      >
        <RadioGroup
          value={theme}
          onChange={setTheme}
          items={[
            { value: 'system', label: t['com.affine.themeSettings.system']() },
            { value: 'light', label: t['com.affine.themeSettings.light']() },
            { value: 'dark', label: t['com.affine.themeSettings.dark']() },
          ]}
        />
        <LanguageMenu />
        {projectId ? (
          <section
            aria-label={t['com.affine.localmind.project-memory.title']()}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <strong>{t['com.affine.localmind.project-memory.title']()}</strong>
            {dashboard.isLoading ? (
              <Loading size={20} />
            ) : dashboard.error ? (
              <div role="alert">
                {projectErrorMessage(dashboard.error)}
                <Button onClick={() => void dashboard.mutate()}>
                  {t['Retry']()}
                </Button>
              </div>
            ) : (
              <>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <span>
                    {t['com.affine.localmind.project-memory.automatic']()}
                  </span>
                  <Switch
                    checked={settings?.autoMemoryEnabled ?? false}
                    disabled={pending || !settings || !project?.canManage}
                    onChange={checked =>
                      void updateAutomaticMemory(Boolean(checked))
                    }
                  />
                </label>
                <small>
                  {t['com.affine.localmind.project-memory.explanation']()}
                </small>
                {!project?.canManage ? (
                  <small>
                    {t['com.affine.localmind.project-memory.ownerOnly']()}
                  </small>
                ) : null}
                <label>
                  {t['com.affine.localmind.project-memory.memberFilter']()}
                  <select
                    value={memberFilter}
                    disabled={pending}
                    onChange={event => setMemberFilter(event.target.value)}
                  >
                    <option value="all">
                      {t['com.affine.localmind.project-memory.allMembers']()}
                    </option>
                    <option value="self">
                      {t['com.affine.localmind.project-memory.mine']()}
                    </option>
                  </select>
                </label>
                {settings ? (
                  <small>
                    {t['com.affine.localmind.project-memory.version']({
                      revision: String(settings.projectMemoryRevision ?? 0),
                    })}
                  </small>
                ) : null}
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {memories.length ? (
                    memories.map(memory => (
                      <div
                        key={memory.id}
                        style={{
                          border: '1px solid var(--affine-border-color)',
                          borderRadius: 8,
                          padding: 10,
                        }}
                      >
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {memory.content}
                        </div>
                        <small>
                          {t[
                            'com.affine.localmind.project-memory.contributors'
                          ]({
                            count: String(memory.contributorCount ?? 0),
                            names:
                              (memory.contributorUserIds ?? [])
                                .map(
                                  userId =>
                                    members.find(
                                      member => member.userId === userId
                                    )?.name ?? userId
                                )
                                .join(', ') || '—',
                          })}
                          {' · '}
                          {memory.kind}
                          {' · '}
                          {memory.status}
                          {memory.pendingConflictCount
                            ? ` · ${t[
                                'com.affine.localmind.project-memory.conflicts'
                              ]({
                                count: String(memory.pendingConflictCount),
                              })}`
                            : ''}
                        </small>
                        {memory.canManage === true ? (
                          <div style={{ marginTop: 8 }}>
                            <Button
                              variant="error"
                              disabled={pending}
                              onClick={() => deleteMemory(memory)}
                            >
                              {t['com.affine.localmind.aiContext.delete']()}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <small>
                      {t['com.affine.localmind.project-memory.empty']()}
                    </small>
                  )}
                </div>
                {project?.canManage && conflicts.length ? (
                  <section
                    aria-label={t[
                      'com.affine.localmind.project-memory.conflictTitle'
                    ]()}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <strong>
                      {t['com.affine.localmind.project-memory.conflictTitle']()}
                    </strong>
                    <small>
                      {t[
                        'com.affine.localmind.project-memory.conflictExplanation'
                      ]()}
                    </small>
                    {conflicts.map(conflict => (
                      <div
                        key={conflict.id}
                        style={{
                          border: '1px solid var(--affine-border-color)',
                          borderRadius: 8,
                          padding: 10,
                        }}
                      >
                        <div style={{ whiteSpace: 'pre-wrap' }}>
                          {conflict.proposedContent}
                        </div>
                        <small>{conflict.factKey}</small>
                        <div
                          style={{
                            display: 'flex',
                            gap: 8,
                            marginTop: 8,
                          }}
                        >
                          <Button
                            variant="primary"
                            disabled={pending}
                            onClick={() =>
                              resolveConflict(conflict.id, 'accept')
                            }
                          >
                            {t[
                              'com.affine.localmind.project-memory.conflictAccept'
                            ]()}
                          </Button>
                          <Button
                            disabled={pending}
                            onClick={() =>
                              resolveConflict(conflict.id, 'reject')
                            }
                          >
                            {t[
                              'com.affine.localmind.project-memory.conflictReject'
                            ]()}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </section>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
};
