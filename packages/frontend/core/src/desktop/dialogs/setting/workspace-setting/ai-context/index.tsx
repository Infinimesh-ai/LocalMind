import {
  Button,
  IconButton,
  Input,
  Loading,
  Menu,
  MenuItem,
  notify,
  Switch,
  Tabs,
  useConfirmModal,
} from '@affine/component';
import {
  SettingHeader,
  SettingRow,
  SettingWrapper,
} from '@affine/component/setting-components';
import { useQuery } from '@affine/core/components/hooks/use-query';
import { AuthService, GraphQLService } from '@affine/core/modules/cloud';
import {
  GlobalDialogService,
  WorkspaceDialogService,
} from '@affine/core/modules/dialogs';
import { DocDisplayMetaService } from '@affine/core/modules/doc-display-meta';
import { WorkspacePermissionService } from '@affine/core/modules/permissions';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { UserFriendlyError } from '@affine/error';
import {
  type CopilotContextDashboardGetQuery,
  copilotContextDashboardGetQuery,
  copilotContextMemoryCreateMutation,
  copilotContextMemoryDeleteMutation,
  copilotContextMemoryUpdateMutation,
  copilotContextProjectCreateMutation,
  copilotContextProjectDeleteMutation,
  copilotContextProjectUpdateMutation,
  copilotContextSettingsUpdateMutation,
} from '@affine/graphql';
import { DeleteIcon, PlusIcon, SaveIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './style.css';

type DashboardCopilot = NonNullable<
  NonNullable<CopilotContextDashboardGetQuery['currentUser']>['copilot']
>;
type ContextMemory = DashboardCopilot['contextMemories'][number];
type ContextProject = DashboardCopilot['contextProjects'][number];
type MemoryKind = 'rule' | 'project_summary';
type MemoryTarget = 'personal' | 'workspace' | 'project';
type MemoryFilter = 'all' | 'rules' | 'automatic' | 'summaries';
type ProjectDraft = {
  name: string;
  description: string;
  documentIds: string[];
};

const kindLabels: Record<string, string> = {
  rule: 'Rule',
  auto_memory: 'Automatic memory',
  project_summary: 'Project summary',
};

const targetLabels: Record<MemoryTarget, string> = {
  personal: 'Every workspace',
  workspace: 'This team',
  project: 'Project',
};

const scopeLabels: Record<string, string> = {
  user: 'Every workspace',
  workspace: 'This team',
  document: 'Document',
  project: 'Project',
};

const filterLabels: Record<MemoryFilter, string> = {
  all: 'All',
  rules: 'Rules',
  automatic: 'Automatic',
  summaries: 'Summaries',
};

const memoryMatchesFilter = (memory: ContextMemory, filter: MemoryFilter) => {
  if (filter === 'rules') return memory.kind === 'rule';
  if (filter === 'automatic') return memory.kind === 'auto_memory';
  if (filter === 'summaries') return memory.kind === 'project_summary';
  return true;
};

const DocumentName = ({ docId }: { docId: string }) => {
  const docDisplayService = useService(DocDisplayMetaService);
  const title = useLiveData(docDisplayService.title$(docId));
  return title || 'Untitled';
};

const ProjectDocumentNames = ({ documentIds }: { documentIds: string[] }) => {
  const visible = documentIds.slice(0, 3);
  return (
    <div className={styles.documentNames}>
      {visible.map(docId => (
        <span className={styles.documentName} key={docId} title={docId}>
          <DocumentName docId={docId} />
        </span>
      ))}
      {documentIds.length > visible.length ? (
        <span className={styles.documentMore}>
          +{documentIds.length - visible.length}
        </span>
      ) : null}
    </div>
  );
};

const AIContextDashboard = ({
  onOpenMembers,
}: {
  onOpenMembers: () => void;
}) => {
  const { openConfirmModal } = useConfirmModal();
  const graphqlService = useService(GraphQLService);
  const permissionService = useService(WorkspacePermissionService);
  const workspaceDialogService = useService(WorkspaceDialogService);
  const workspace = useService(WorkspaceService).workspace;
  const workspaceId = workspace.id;
  const isLocal = workspace.flavour === 'local';
  const canManageProjects = useLiveData(
    permissionService.permission.isOwnerOrAdmin$
  );

  const [newContent, setNewContent] = useState('');
  const [kind, setKind] = useState<MemoryKind>('rule');
  const [target, setTarget] = useState<MemoryTarget>('personal');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [settingsPending, setSettingsPending] = useState(false);

  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDescription, setNewProjectDescription] = useState('');
  const [newProjectDocumentIds, setNewProjectDocumentIds] = useState<string[]>(
    []
  );
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectDrafts, setProjectDrafts] = useState<
    Record<string, ProjectDraft>
  >({});
  const [pendingProjectIds, setPendingProjectIds] = useState<Set<string>>(
    new Set()
  );

  const { data, error, isLoading, mutate } = useQuery(
    {
      query: copilotContextDashboardGetQuery,
      variables: {
        workspaceId,
        includeDisabled: true,
      },
    },
    {
      suspense: false,
      shouldRetryOnError: false,
    }
  );
  const copilot = data?.currentUser?.copilot;
  const memories = useMemo(
    () => copilot?.contextMemories ?? [],
    [copilot?.contextMemories]
  );
  const projects = useMemo(
    () => copilot?.contextProjects ?? [],
    [copilot?.contextProjects]
  );
  const activeProjects = useMemo(
    () => projects.filter(project => project.status === 'active'),
    [projects]
  );
  const strategies = copilot?.contextPlannerStrategies ?? [];
  const settings = copilot?.contextSettings;
  const activeStrategy = strategies.find(
    strategy => strategy.status === 'active'
  );
  const previousStrategyCount = strategies.filter(
    strategy => strategy.status !== 'active'
  ).length;

  const projectById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects]
  );

  const targetOptions = useMemo<MemoryTarget[]>(() => {
    if (isLocal) return kind === 'rule' ? ['personal'] : [];
    if (kind === 'project_summary') {
      return activeProjects.length ? ['project'] : [];
    }
    return [
      'personal',
      'workspace',
      ...(activeProjects.length ? (['project'] as const) : []),
    ];
  }, [activeProjects.length, isLocal, kind]);

  useEffect(() => {
    if (!targetOptions.includes(target) && targetOptions[0]) {
      setTarget(targetOptions[0]);
    }
  }, [target, targetOptions]);

  useEffect(() => {
    if (
      !selectedProjectId ||
      !activeProjects.some(project => project.id === selectedProjectId)
    ) {
      setSelectedProjectId(activeProjects[0]?.id ?? null);
    }
  }, [activeProjects, selectedProjectId]);

  useEffect(() => {
    setDrafts(current => {
      const next = { ...current };
      for (const memory of memories) {
        if (next[memory.id] === undefined) next[memory.id] = memory.content;
      }
      return next;
    });
  }, [memories]);

  useEffect(() => {
    setProjectDrafts(current => {
      const next = { ...current };
      for (const project of projects) {
        if (!next[project.id]) {
          next[project.id] = {
            name: project.name,
            description: project.description,
            documentIds: [...project.documentIds],
          };
        }
      }
      return next;
    });
  }, [projects]);

  const reportError = useCallback((caught: unknown) => {
    const error = UserFriendlyError.fromAny(caught);
    notify.error({
      title: 'AI context update failed',
      message: error.message,
    });
  }, []);

  const markPending = useCallback((id: string, pending: boolean) => {
    setPendingIds(current => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const markProjectPending = useCallback((id: string, pending: boolean) => {
    setPendingProjectIds(current => {
      const next = new Set(current);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectDocuments = useCallback(
    (initial: string[], onSelect: (ids: string[]) => void) => {
      workspaceDialogService.open(
        'doc-selector',
        {
          init: initial,
          onBeforeConfirm: (ids, confirm) => {
            if (ids.length < 1 || ids.length > 100) {
              notify.error({
                title: 'Select between 1 and 100 documents',
              });
              return;
            }
            confirm();
          },
        },
        ids => {
          if (ids?.length) onSelect([...new Set(ids)]);
        }
      );
    },
    [workspaceDialogService]
  );

  const createProject = useCallback(async () => {
    const name = newProjectName.trim();
    const description = newProjectDescription.trim();
    if (!name || !newProjectDocumentIds.length) return;
    setCreatingProject(true);
    try {
      await graphqlService.gql({
        query: copilotContextProjectCreateMutation,
        variables: {
          input: {
            workspaceId,
            name,
            description,
            documentIds: newProjectDocumentIds,
          },
        },
      });
      setNewProjectName('');
      setNewProjectDescription('');
      setNewProjectDocumentIds([]);
      await mutate();
    } catch (caught) {
      reportError(caught);
    } finally {
      setCreatingProject(false);
    }
  }, [
    graphqlService,
    mutate,
    newProjectDescription,
    newProjectDocumentIds,
    newProjectName,
    reportError,
    workspaceId,
  ]);

  const updateProject = useCallback(
    async (
      project: ContextProject,
      update: {
        name?: string;
        description?: string;
        status?: string;
        documentIds?: string[];
      }
    ) => {
      markProjectPending(project.id, true);
      try {
        await graphqlService.gql({
          query: copilotContextProjectUpdateMutation,
          variables: {
            input: {
              id: project.id,
              ...update,
            },
          },
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        markProjectPending(project.id, false);
      }
    },
    [graphqlService, markProjectPending, mutate, reportError]
  );

  const deleteProject = useCallback(
    (project: ContextProject) => {
      openConfirmModal({
        title: 'Delete context project?',
        description:
          'The project must be empty of personal memories. This cannot be undone.',
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          markProjectPending(project.id, true);
          try {
            await graphqlService.gql({
              query: copilotContextProjectDeleteMutation,
              variables: { id: project.id },
            });
            setProjectDrafts(current => {
              const next = { ...current };
              delete next[project.id];
              return next;
            });
            await mutate();
          } catch (caught) {
            reportError(caught);
          } finally {
            markProjectPending(project.id, false);
          }
        },
      });
    },
    [graphqlService, markProjectPending, mutate, openConfirmModal, reportError]
  );

  const createMemory = useCallback(async () => {
    const content = newContent.trim();
    const isProject = target === 'project';
    if (!content || (isProject && !selectedProjectId)) return;
    setCreating(true);
    try {
      await graphqlService.gql({
        query: copilotContextMemoryCreateMutation,
        variables: {
          input:
            target === 'personal'
              ? {
                  scope: 'user',
                  kind: 'rule',
                  content,
                }
              : {
                  workspaceId,
                  ...(isProject ? { projectId: selectedProjectId } : {}),
                  scope: isProject ? 'project' : 'workspace',
                  kind,
                  content,
                },
        },
      });
      setNewContent('');
      await mutate();
    } catch (caught) {
      reportError(caught);
    } finally {
      setCreating(false);
    }
  }, [
    graphqlService,
    kind,
    mutate,
    newContent,
    reportError,
    selectedProjectId,
    target,
    workspaceId,
  ]);

  const updateMemory = useCallback(
    async (
      memory: ContextMemory,
      update: { content?: string; status?: string }
    ) => {
      markPending(memory.id, true);
      try {
        await graphqlService.gql({
          query: copilotContextMemoryUpdateMutation,
          variables: {
            input: {
              id: memory.id,
              ...update,
            },
          },
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        markPending(memory.id, false);
      }
    },
    [graphqlService, markPending, mutate, reportError]
  );

  const deleteMemory = useCallback(
    (memory: ContextMemory) => {
      openConfirmModal({
        title: 'Delete AI memory?',
        description: memory.content,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          markPending(memory.id, true);
          try {
            await graphqlService.gql({
              query: copilotContextMemoryDeleteMutation,
              variables: { id: memory.id },
            });
            setDrafts(current => {
              const next = { ...current };
              delete next[memory.id];
              return next;
            });
            await mutate();
          } catch (caught) {
            reportError(caught);
          } finally {
            markPending(memory.id, false);
          }
        },
      });
    },
    [graphqlService, markPending, mutate, openConfirmModal, reportError]
  );

  const setAutoMemoryEnabled = useCallback(
    async (autoMemoryEnabled: boolean) => {
      setSettingsPending(true);
      try {
        await graphqlService.gql({
          query: copilotContextSettingsUpdateMutation,
          variables: {
            input: {
              workspaceId,
              autoMemoryEnabled,
            },
          },
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        setSettingsPending(false);
      }
    },
    [graphqlService, mutate, reportError, workspaceId]
  );

  const filteredMemories = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return memories.filter(memory => {
      if (!memoryMatchesFilter(memory, filter)) return false;
      if (!query) return true;
      const projectName = memory.projectId
        ? projectById.get(memory.projectId)?.name
        : '';
      return (
        memory.content.toLocaleLowerCase().includes(query) ||
        (scopeLabels[memory.scope] ?? memory.scope)
          .toLocaleLowerCase()
          .includes(query) ||
        (kindLabels[memory.kind] ?? memory.kind)
          .toLocaleLowerCase()
          .includes(query) ||
        projectName?.toLocaleLowerCase().includes(query)
      );
    });
  }, [filter, memories, projectById, search]);

  const isProjectTarget = target === 'project';
  const createDisabled =
    !newContent.trim() ||
    creating ||
    targetOptions.length === 0 ||
    (isProjectTarget && !selectedProjectId);
  const createProjectDisabled =
    !newProjectName.trim() || !newProjectDocumentIds.length || creatingProject;

  if (error) {
    return (
      <div className={styles.errorState} role="alert">
        <div>
          <div className={styles.errorTitle}>AI context did not load</div>
          <div className={styles.errorDescription}>
            Check the server connection and your workspace permission.
          </div>
        </div>
        <Button variant="secondary" onClick={() => void mutate()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <>
      <SettingWrapper title="Ownership and scope">
        <SettingRow
          name="Memory ownership"
          desc="Rules, summaries, and automatic memories belong only to your account."
        >
          <span className={styles.privateBadge}>Only you</span>
        </SettingRow>
        <SettingRow
          name="Team boundary"
          desc="Team-scoped memories are used only inside this workspace."
        >
          <Button variant="secondary" onClick={onOpenMembers}>
            Manage members
          </Button>
        </SettingRow>
        <SettingRow
          name="Automatic memory"
          desc={
            isLocal
              ? 'Sync this workspace before using automatic memory.'
              : 'Save durable preferences and decisions from AI conversations.'
          }
        >
          <Switch
            aria-label="Automatic memory enabled"
            checked={!isLocal && (settings?.autoMemoryEnabled ?? false)}
            disabled={isLoading || settingsPending || isLocal}
            onChange={value => void setAutoMemoryEnabled(value)}
          />
        </SettingRow>
        <SettingRow
          name="Context engine"
          desc="Rolling summaries and scoped memory selection"
        >
          {isLoading ? (
            <Loading />
          ) : (
            <span className={styles.engineStatus}>
              {activeStrategy?.version ?? 'Unavailable'}
              {activeStrategy ? ' · Active' : ''}
              {previousStrategyCount
                ? ` · ${previousStrategyCount} previous retained`
                : ''}
            </span>
          )}
        </SettingRow>
      </SettingWrapper>

      <SettingWrapper title="Context projects">
        {!isLocal && canManageProjects ? (
          <div className={styles.projectCreateArea}>
            <div className={styles.projectCreateFields}>
              <Input
                value={newProjectName}
                onChange={setNewProjectName}
                placeholder="Project name"
                maxLength={120}
                disabled={creatingProject}
              />
              <Input
                value={newProjectDescription}
                onChange={setNewProjectDescription}
                placeholder="Description"
                maxLength={2000}
                disabled={creatingProject}
              />
            </div>
            <div className={styles.projectCreateActions}>
              <Button
                variant="secondary"
                disabled={creatingProject}
                onClick={() =>
                  selectDocuments(
                    newProjectDocumentIds,
                    setNewProjectDocumentIds
                  )
                }
              >
                {newProjectDocumentIds.length
                  ? `${newProjectDocumentIds.length} documents`
                  : 'Select documents'}
              </Button>
              <IconButton
                size="24"
                title="Create project"
                icon={<PlusIcon />}
                disabled={createProjectDisabled}
                onClick={() => void createProject()}
              />
            </div>
          </div>
        ) : null}

        <div className={styles.projectList}>
          {isLoading ? (
            <div className={styles.loading}>
              <Loading />
            </div>
          ) : projects.length ? (
            projects.map(project => {
              const pending = pendingProjectIds.has(project.id);
              const draft = projectDrafts[project.id] ?? {
                name: project.name,
                description: project.description,
                documentIds: project.documentIds,
              };
              const changed =
                draft.name.trim() !== project.name ||
                draft.description.trim() !== project.description ||
                draft.documentIds.join('\0') !== project.documentIds.join('\0');
              return (
                <div
                  className={
                    project.status === 'active'
                      ? styles.projectRow
                      : `${styles.projectRow} ${styles.disabledRow}`
                  }
                  key={project.id}
                >
                  <div className={styles.projectMain}>
                    <div className={styles.projectFields}>
                      <Input
                        value={draft.name}
                        onChange={name =>
                          setProjectDrafts(current => ({
                            ...current,
                            [project.id]: { ...draft, name },
                          }))
                        }
                        maxLength={120}
                        disabled={pending || !project.canManage}
                      />
                      <Input
                        value={draft.description}
                        onChange={description =>
                          setProjectDrafts(current => ({
                            ...current,
                            [project.id]: { ...draft, description },
                          }))
                        }
                        placeholder="Description"
                        maxLength={2000}
                        disabled={pending || !project.canManage}
                      />
                    </div>
                    <div className={styles.projectMetadata}>
                      <span className={styles.tag}>
                        {project.status === 'active' ? 'Active' : 'Archived'}
                      </span>
                      <span className={styles.tag}>
                        {project.documentCount} documents
                      </span>
                      <ProjectDocumentNames documentIds={project.documentIds} />
                    </div>
                  </div>
                  <div className={styles.projectActions}>
                    <Switch
                      aria-label={`${project.name} active`}
                      checked={project.status === 'active'}
                      disabled={pending || !project.canManage}
                      onChange={active =>
                        void updateProject(project, {
                          status: active ? 'active' : 'archived',
                        })
                      }
                    />
                    <Button
                      variant="secondary"
                      disabled={pending || !project.canManage}
                      onClick={() =>
                        selectDocuments(draft.documentIds, documentIds =>
                          setProjectDrafts(current => ({
                            ...current,
                            [project.id]: { ...draft, documentIds },
                          }))
                        )
                      }
                    >
                      Documents
                    </Button>
                    <IconButton
                      size="20"
                      title="Save project"
                      icon={<SaveIcon />}
                      disabled={
                        !changed ||
                        !draft.name.trim() ||
                        !draft.documentIds.length ||
                        pending ||
                        !project.canManage
                      }
                      onClick={() =>
                        void updateProject(project, {
                          name: draft.name.trim(),
                          description: draft.description.trim(),
                          documentIds: draft.documentIds,
                        })
                      }
                    />
                    {project.status === 'archived' ? (
                      <IconButton
                        size="20"
                        title="Delete project"
                        icon={<DeleteIcon />}
                        disabled={pending || !project.canManage}
                        onClick={() => deleteProject(project)}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.empty}>
              {isLocal
                ? 'Sync this workspace to create context projects'
                : canManageProjects
                  ? 'No context projects'
                  : 'No accessible context projects'}
            </div>
          )}
        </div>
      </SettingWrapper>

      <SettingWrapper title="Your rules and memories">
        <div className={styles.createArea}>
          <div className={styles.createControls}>
            <Menu
              items={(isLocal
                ? (['rule'] as const)
                : (['rule', 'project_summary'] as const)
              ).map(value => (
                <MenuItem key={value} onSelect={() => setKind(value)}>
                  {kindLabels[value]}
                </MenuItem>
              ))}
            >
              <Button className={styles.kindButton} variant="secondary">
                {kindLabels[kind]}
              </Button>
            </Menu>
            <Menu
              items={targetOptions.map(value => (
                <MenuItem key={value} onSelect={() => setTarget(value)}>
                  {targetLabels[value]}
                </MenuItem>
              ))}
            >
              <Button
                className={styles.targetButton}
                variant="secondary"
                disabled={targetOptions.length === 0}
              >
                {targetOptions.length ? targetLabels[target] : 'Unavailable'}
              </Button>
            </Menu>
            {isProjectTarget ? (
              <Menu
                items={activeProjects.map(project => (
                  <MenuItem
                    key={project.id}
                    onSelect={() => setSelectedProjectId(project.id)}
                  >
                    {project.name}
                  </MenuItem>
                ))}
              >
                <Button
                  className={styles.projectButton}
                  variant="secondary"
                  disabled={!activeProjects.length}
                >
                  {selectedProjectId
                    ? (projectById.get(selectedProjectId)?.name ?? 'Project')
                    : 'Select project'}
                </Button>
              </Menu>
            ) : null}
          </div>
          <div className={styles.createInputRow}>
            <Input
              value={newContent}
              onChange={setNewContent}
              onEnter={() => void createMemory()}
              placeholder={
                kind === 'project_summary'
                  ? 'Add your project summary'
                  : 'Add a rule'
              }
              maxLength={8000}
              disabled={creating || targetOptions.length === 0}
            />
            <IconButton
              size="24"
              title="Add"
              icon={<PlusIcon />}
              disabled={createDisabled}
              onClick={() => void createMemory()}
            />
          </div>
        </div>

        <Tabs.Root
          value={filter}
          onValueChange={value => setFilter(value as MemoryFilter)}
        >
          <div className={styles.filterBar}>
            <Tabs.List className={styles.tabList}>
              {(Object.keys(filterLabels) as MemoryFilter[]).map(value => (
                <Tabs.Trigger key={value} value={value}>
                  {filterLabels[value]}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            <Input
              className={styles.searchInput}
              value={search}
              onChange={setSearch}
              placeholder="Search"
            />
          </div>
          {(Object.keys(filterLabels) as MemoryFilter[]).map(value => (
            <Tabs.Content key={value} value={value}>
              <div className={styles.memoryList}>
                {isLoading ? (
                  <div className={styles.loading}>
                    <Loading />
                  </div>
                ) : filteredMemories.length ? (
                  filteredMemories.map(memory => {
                    const pending = pendingIds.has(memory.id);
                    const draft = drafts[memory.id] ?? memory.content;
                    const changed = draft.trim() !== memory.content;
                    return (
                      <div
                        className={
                          memory.status === 'active'
                            ? styles.memoryRow
                            : `${styles.memoryRow} ${styles.disabledRow}`
                        }
                        key={memory.id}
                      >
                        <div className={styles.memoryMain}>
                          <textarea
                            className={styles.memoryInput}
                            value={draft}
                            maxLength={8000}
                            rows={2}
                            disabled={pending}
                            aria-label={`${kindLabels[memory.kind] ?? memory.kind} content`}
                            onChange={event =>
                              setDrafts(current => ({
                                ...current,
                                [memory.id]: event.target.value,
                              }))
                            }
                          />
                          <div className={styles.metadata}>
                            <span className={styles.tag}>
                              {kindLabels[memory.kind] ?? memory.kind}
                            </span>
                            <span className={styles.tag}>
                              {scopeLabels[memory.scope] ?? memory.scope}
                            </span>
                            <span className={styles.privateBadge}>
                              Only you
                            </span>
                            {memory.projectId ? (
                              <span className={styles.projectTag}>
                                {projectById.get(memory.projectId)?.name ??
                                  'Archived project'}
                              </span>
                            ) : null}
                            {memory.docId ? (
                              <span
                                className={styles.projectTag}
                                title={memory.docId}
                              >
                                <DocumentName docId={memory.docId} />
                              </span>
                            ) : null}
                            <span className={styles.updatedAt}>
                              Updated{' '}
                              {new Date(memory.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className={styles.actions}>
                          <Switch
                            aria-label={`${kindLabels[memory.kind] ?? memory.kind} enabled: ${memory.content.slice(0, 80)}`}
                            checked={memory.status === 'active'}
                            disabled={pending}
                            onChange={active =>
                              void updateMemory(memory, {
                                status: active ? 'active' : 'disabled',
                              })
                            }
                          />
                          <IconButton
                            size="20"
                            title="Save"
                            icon={<SaveIcon />}
                            disabled={!changed || !draft.trim() || pending}
                            onClick={() =>
                              void updateMemory(memory, {
                                content: draft.trim(),
                              })
                            }
                          />
                          <IconButton
                            size="20"
                            title="Delete"
                            icon={<DeleteIcon />}
                            disabled={pending}
                            onClick={() => deleteMemory(memory)}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className={styles.empty}>
                    {search ? 'No matching memories' : 'No saved memories'}
                  </div>
                )}
              </div>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </SettingWrapper>
    </>
  );
};

export const AIContextSettings = ({
  onOpenMembers,
}: {
  onOpenMembers: () => void;
}) => {
  const authService = useService(AuthService);
  const globalDialogService = useService(GlobalDialogService);
  const status = useLiveData(authService.session.status$);

  return (
    <>
      <SettingHeader
        title="AI context"
        subtitle="Manage your private AI memory and where it can be used."
      />
      {status === 'authenticated' ? (
        <AIContextDashboard onOpenMembers={onOpenMembers} />
      ) : (
        <SettingWrapper title="">
          <SettingRow
            name="Sign in to manage AI context"
            desc="Memory controls are tied to your account and workspace permissions."
          >
            <Button
              variant="primary"
              onClick={() => globalDialogService.open('sign-in', {})}
            >
              Sign in
            </Button>
          </SettingRow>
        </SettingWrapper>
      )}
    </>
  );
};
