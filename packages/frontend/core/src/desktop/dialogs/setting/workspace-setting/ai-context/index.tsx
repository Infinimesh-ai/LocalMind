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
  createCopilotContextPolicyMutation,
  createCopilotContextRuleMutation,
  deleteCopilotContextPolicyMutation,
  deleteCopilotContextRuleMutation,
  rollbackCopilotContextPolicyMutation,
  rollbackCopilotContextRuleMutation,
  undoCopilotContextMemoryEventMutation,
  updateCopilotContextPolicyMutation,
  updateCopilotContextRuleMutation,
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
type ContextRule = DashboardCopilot['contextRules'][number];
type ContextPolicy = DashboardCopilot['contextPolicies'][number];
type ContextMemoryEvent = DashboardCopilot['contextMemoryEvents'][number];
type MemoryFilter = 'all' | 'automatic' | 'summaries';
type DirectiveMode = 'always' | 'relevant' | 'manual';
type RuleTarget = 'personal' | 'workspace' | 'project';
type ProjectDraft = {
  name: string;
  description: string;
  documentIds: string[];
};
type DirectiveDraft = {
  name: string;
  description: string;
  content: string;
  priority: string;
  keywords: string;
  documentIds: string[];
  projectIds: string[];
  match: 'any' | 'all';
};
type DirectiveConditionsDraft = Pick<
  DirectiveDraft,
  'description' | 'keywords' | 'documentIds' | 'projectIds' | 'match'
>;

const kindLabels: Record<string, string> = {
  rule: 'Rule',
  auto_memory: 'Automatic memory',
  project_summary: 'Project summary',
};

const targetLabels: Record<RuleTarget, string> = {
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
  automatic: 'Automatic',
  summaries: 'Summaries',
};

const memoryMatchesFilter = (memory: ContextMemory, filter: MemoryFilter) => {
  if (filter === 'automatic') return memory.kind === 'auto_memory';
  if (filter === 'summaries') return memory.kind === 'project_summary';
  return memory.kind !== 'rule';
};

const directiveModeLabels: Record<DirectiveMode, string> = {
  always: 'Always',
  relevant: 'When relevant',
  manual: 'Manual',
};

const parseKeywords = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map(keyword => keyword.trim())
      .filter(Boolean)
  ),
];

const getDirectiveContent = (directive: ContextRule | ContextPolicy) =>
  directive.revisions.find(
    revision => revision.revision === directive.activeRevision
  )?.content ?? '';

const getDirectiveConditionValues = (
  directive: ContextRule | ContextPolicy
) => {
  const conditions = directive.conditions as Record<string, unknown>;
  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  return {
    keywords: strings(conditions.keywords),
    documentIds: strings(conditions.docIds),
    projectIds: strings(conditions.projectIds),
    match: conditions.match === 'all' ? ('all' as const) : ('any' as const),
  };
};

const getDirectiveKeywords = (directive: ContextRule | ContextPolicy) =>
  getDirectiveConditionValues(directive).keywords;

const getDirectiveDraft = (
  directive: ContextRule | ContextPolicy
): DirectiveDraft => {
  const conditions = getDirectiveConditionValues(directive);
  return {
    name: directive.name,
    description: directive.description,
    content: getDirectiveContent(directive),
    priority: String(directive.priority),
    keywords: conditions.keywords.join(', '),
    documentIds: conditions.documentIds,
    projectIds: conditions.projectIds,
    match: conditions.match,
  };
};

export const getDirectiveConditionsInput = (
  directive: ContextRule | ContextPolicy,
  input: string | DirectiveConditionsDraft
) => {
  const conditions = getDirectiveConditionValues(directive);
  if (typeof input !== 'string') {
    return {
      keywords: parseKeywords(input.keywords),
      docIds: [...new Set(input.documentIds)],
      projectIds: [...new Set(input.projectIds)],
      match: input.match,
    };
  }
  return {
    keywords: parseKeywords(input),
    docIds: conditions.documentIds,
    projectIds: conditions.projectIds,
    match: conditions.match,
  };
};

const sameStringList = (left: string[], right: string[]) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index]);

export const getDirectiveContentUpdate = (
  currentContent: string,
  draftContent?: string
) => {
  if (draftContent === undefined) return {};
  const content = draftContent.trim();
  return content === currentContent ? {} : { content };
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

const DirectiveConditionControls = ({
  value,
  projects,
  disabled,
  scopeConditionsEnabled,
  onChange,
  onSelectDocuments,
}: {
  value: DirectiveConditionsDraft;
  projects: ContextProject[];
  disabled: boolean;
  scopeConditionsEnabled: boolean;
  onChange: (value: DirectiveConditionsDraft) => void;
  onSelectDocuments: (ids: string[]) => void;
}) => {
  const toggleProject = (projectId: string) => {
    const projectIds = value.projectIds.includes(projectId)
      ? value.projectIds.filter(id => id !== projectId)
      : [...value.projectIds, projectId].slice(0, 100);
    onChange({ ...value, projectIds });
  };

  return (
    <div className={styles.directiveConditionControls}>
      <Input
        value={value.description}
        onChange={description => onChange({ ...value, description })}
        placeholder="Description"
        maxLength={2000}
        disabled={disabled}
      />
      <Input
        value={value.keywords}
        onChange={keywords => onChange({ ...value, keywords })}
        placeholder="Keywords, comma separated"
        disabled={disabled}
      />
      <Menu
        items={(['any', 'all'] as const).map(match => (
          <MenuItem
            key={match}
            selected={value.match === match}
            onSelect={() => onChange({ ...value, match })}
          >
            {match === 'all' ? 'Match all groups' : 'Match any group'}
          </MenuItem>
        ))}
      >
        <Button variant="secondary" disabled={disabled}>
          {value.match === 'all' ? 'Match all groups' : 'Match any group'}
        </Button>
      </Menu>
      <Button
        variant="secondary"
        disabled={disabled || !scopeConditionsEnabled}
        onClick={() => onSelectDocuments(value.documentIds)}
      >
        Documents {value.documentIds.length}
      </Button>
      <Menu
        items={[
          ...(value.projectIds.length
            ? [
                <MenuItem
                  key="clear-projects"
                  onSelect={() => onChange({ ...value, projectIds: [] })}
                >
                  Clear projects
                </MenuItem>,
              ]
            : []),
          ...projects.map(project => (
            <MenuItem
              key={project.id}
              selected={value.projectIds.includes(project.id)}
              onSelect={() => toggleProject(project.id)}
            >
              {project.name}
            </MenuItem>
          )),
        ]}
      >
        <Button
          variant="secondary"
          disabled={
            disabled ||
            !scopeConditionsEnabled ||
            (!projects.length && !value.projectIds.length)
          }
        >
          Projects {value.projectIds.length}
        </Button>
      </Menu>
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
  const [target, setTarget] = useState<RuleTarget>('personal');
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleDescription, setNewRuleDescription] = useState('');
  const [newRuleContent, setNewRuleContent] = useState('');
  const [newRuleMode, setNewRuleMode] = useState<DirectiveMode>('relevant');
  const [newRulePriority, setNewRulePriority] = useState('0');
  const [newRuleKeywords, setNewRuleKeywords] = useState('');
  const [newRuleDocumentIds, setNewRuleDocumentIds] = useState<string[]>([]);
  const [newRuleProjectIds, setNewRuleProjectIds] = useState<string[]>([]);
  const [newRuleMatch, setNewRuleMatch] = useState<'any' | 'all'>('any');
  const [newPolicyName, setNewPolicyName] = useState('');
  const [newPolicyDescription, setNewPolicyDescription] = useState('');
  const [newPolicyContent, setNewPolicyContent] = useState('');
  const [newPolicyMode, setNewPolicyMode] =
    useState<Exclude<DirectiveMode, 'manual'>>('always');
  const [newPolicyPriority, setNewPolicyPriority] = useState('0');
  const [newPolicyKeywords, setNewPolicyKeywords] = useState('');
  const [newPolicyDocumentIds, setNewPolicyDocumentIds] = useState<string[]>(
    []
  );
  const [newPolicyProjectIds, setNewPolicyProjectIds] = useState<string[]>([]);
  const [newPolicyMatch, setNewPolicyMatch] = useState<'any' | 'all'>('any');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [directiveDrafts, setDirectiveDrafts] = useState<
    Record<string, DirectiveDraft>
  >({});
  const [directiveModes, setDirectiveModes] = useState<
    Record<string, DirectiveMode>
  >({});
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
  const rules = useMemo(
    () => copilot?.contextRules ?? [],
    [copilot?.contextRules]
  );
  const policies = useMemo(
    () => copilot?.contextPolicies ?? [],
    [copilot?.contextPolicies]
  );
  const memoryEvents = useMemo(
    () => copilot?.contextMemoryEvents ?? [],
    [copilot?.contextMemoryEvents]
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

  const targetOptions = useMemo<RuleTarget[]>(() => {
    if (isLocal) return ['personal'];
    return [
      'personal',
      'workspace',
      ...(activeProjects.length ? (['project'] as const) : []),
    ];
  }, [activeProjects.length, isLocal]);

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
    setDirectiveDrafts(current => {
      const next = { ...current };
      for (const directive of [...rules, ...policies]) {
        if (!next[directive.id]) {
          next[directive.id] = getDirectiveDraft(directive);
        }
      }
      return next;
    });
    setDirectiveModes(current => {
      const next = { ...current };
      for (const directive of [...rules, ...policies]) {
        if (!next[directive.id]) {
          next[directive.id] = directive.applicationMode as DirectiveMode;
        }
      }
      return next;
    });
  }, [policies, rules]);

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
    (
      initial: string[],
      onSelect: (ids: string[]) => void,
      allowEmpty = false
    ) => {
      workspaceDialogService.open(
        'doc-selector',
        {
          init: initial,
          onBeforeConfirm: (ids, confirm) => {
            if ((!allowEmpty && ids.length < 1) || ids.length > 100) {
              notify.error({
                title: allowEmpty
                  ? 'Select up to 100 documents'
                  : 'Select between 1 and 100 documents',
              });
              return;
            }
            confirm();
          },
        },
        ids => {
          if (ids) onSelect([...new Set(ids)]);
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
    if (!content || !selectedProjectId) return;
    setCreating(true);
    try {
      await graphqlService.gql({
        query: copilotContextMemoryCreateMutation,
        variables: {
          input: {
            workspaceId,
            projectId: selectedProjectId,
            scope: 'project',
            kind: 'project_summary',
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
    mutate,
    newContent,
    reportError,
    selectedProjectId,
    workspaceId,
  ]);

  const createRule = useCallback(async () => {
    const name = newRuleName.trim();
    const content = newRuleContent.trim();
    const priority = Number(newRulePriority);
    if (
      !name ||
      !content ||
      !Number.isInteger(priority) ||
      (target === 'project' && !selectedProjectId)
    ) {
      return;
    }
    setCreating(true);
    try {
      await graphqlService.gql({
        query: createCopilotContextRuleMutation,
        variables: {
          input: {
            ...(target === 'personal' ? {} : { workspaceId }),
            ...(target === 'project' ? { projectId: selectedProjectId } : {}),
            scope:
              target === 'personal'
                ? 'user'
                : target === 'project'
                  ? 'project'
                  : 'workspace',
            name,
            description: newRuleDescription.trim(),
            applicationMode: newRuleMode,
            priority,
            conditions: {
              keywords: parseKeywords(newRuleKeywords),
              docIds: target === 'personal' ? [] : newRuleDocumentIds,
              projectIds: target === 'personal' ? [] : newRuleProjectIds,
              match: newRuleMatch,
            },
            content,
          },
        },
      });
      setNewRuleName('');
      setNewRuleDescription('');
      setNewRuleContent('');
      setNewRuleKeywords('');
      setNewRuleDocumentIds([]);
      setNewRuleProjectIds([]);
      setNewRuleMatch('any');
      setNewRulePriority('0');
      await mutate();
    } catch (caught) {
      reportError(caught);
    } finally {
      setCreating(false);
    }
  }, [
    graphqlService,
    mutate,
    newRuleContent,
    newRuleDescription,
    newRuleDocumentIds,
    newRuleKeywords,
    newRuleMatch,
    newRuleMode,
    newRuleName,
    newRulePriority,
    newRuleProjectIds,
    reportError,
    selectedProjectId,
    target,
    workspaceId,
  ]);

  const createPolicy = useCallback(async () => {
    const name = newPolicyName.trim();
    const content = newPolicyContent.trim();
    const priority = Number(newPolicyPriority);
    if (!name || !content || !Number.isInteger(priority)) return;
    setCreating(true);
    try {
      await graphqlService.gql({
        query: createCopilotContextPolicyMutation,
        variables: {
          input: {
            workspaceId,
            name,
            description: newPolicyDescription.trim(),
            applicationMode: newPolicyMode,
            priority,
            conditions: {
              keywords: parseKeywords(newPolicyKeywords),
              docIds: newPolicyDocumentIds,
              projectIds: newPolicyProjectIds,
              match: newPolicyMatch,
            },
            content,
          },
        },
      });
      setNewPolicyName('');
      setNewPolicyDescription('');
      setNewPolicyContent('');
      setNewPolicyKeywords('');
      setNewPolicyDocumentIds([]);
      setNewPolicyProjectIds([]);
      setNewPolicyMatch('any');
      setNewPolicyPriority('0');
      await mutate();
    } catch (caught) {
      reportError(caught);
    } finally {
      setCreating(false);
    }
  }, [
    graphqlService,
    mutate,
    newPolicyContent,
    newPolicyDescription,
    newPolicyDocumentIds,
    newPolicyKeywords,
    newPolicyMatch,
    newPolicyMode,
    newPolicyName,
    newPolicyPriority,
    newPolicyProjectIds,
    reportError,
    workspaceId,
  ]);

  const updateRule = useCallback(
    async (
      rule: ContextRule,
      update?: { status?: string; applicationMode?: DirectiveMode }
    ) => {
      const draft = directiveDrafts[rule.id];
      const priority = Number(draft?.priority ?? rule.priority);
      const currentContent = getDirectiveContent(rule);
      if (!Number.isInteger(priority)) return;
      markPending(rule.id, true);
      try {
        await graphqlService.gql({
          query: updateCopilotContextRuleMutation,
          variables: {
            input: {
              id: rule.id,
              ...(update ?? {
                name: draft?.name.trim() || rule.name,
                description: draft?.description.trim() ?? rule.description,
                ...getDirectiveContentUpdate(currentContent, draft?.content),
                priority,
                applicationMode:
                  directiveModes[rule.id] ??
                  (rule.applicationMode as DirectiveMode),
                conditions: getDirectiveConditionsInput(
                  rule,
                  draft ?? getDirectiveDraft(rule)
                ),
              }),
            },
          },
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        markPending(rule.id, false);
      }
    },
    [
      directiveDrafts,
      directiveModes,
      graphqlService,
      markPending,
      mutate,
      reportError,
    ]
  );

  const updatePolicy = useCallback(
    async (
      policy: ContextPolicy,
      update?: { status?: string; applicationMode?: 'always' | 'relevant' }
    ) => {
      const draft = directiveDrafts[policy.id];
      const priority = Number(draft?.priority ?? policy.priority);
      const currentContent = getDirectiveContent(policy);
      if (!Number.isInteger(priority)) return;
      markPending(policy.id, true);
      try {
        await graphqlService.gql({
          query: updateCopilotContextPolicyMutation,
          variables: {
            input: {
              id: policy.id,
              workspaceId,
              ...(update ?? {
                name: draft?.name.trim() || policy.name,
                description: draft?.description.trim() ?? policy.description,
                ...getDirectiveContentUpdate(currentContent, draft?.content),
                priority,
                applicationMode:
                  directiveModes[policy.id] === 'relevant'
                    ? 'relevant'
                    : 'always',
                conditions: getDirectiveConditionsInput(
                  policy,
                  draft ?? getDirectiveDraft(policy)
                ),
              }),
            },
          },
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        markPending(policy.id, false);
      }
    },
    [
      directiveDrafts,
      directiveModes,
      graphqlService,
      markPending,
      mutate,
      reportError,
      workspaceId,
    ]
  );

  const rollbackRule = useCallback(
    async (rule: ContextRule, revision: number) => {
      markPending(rule.id, true);
      try {
        await graphqlService.gql({
          query: rollbackCopilotContextRuleMutation,
          variables: { id: rule.id, revision },
        });
        setDirectiveDrafts(current => {
          const next = { ...current };
          delete next[rule.id];
          return next;
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        markPending(rule.id, false);
      }
    },
    [graphqlService, markPending, mutate, reportError]
  );

  const rollbackPolicy = useCallback(
    async (policy: ContextPolicy, revision: number) => {
      markPending(policy.id, true);
      try {
        await graphqlService.gql({
          query: rollbackCopilotContextPolicyMutation,
          variables: { id: policy.id, workspaceId, revision },
        });
        setDirectiveDrafts(current => {
          const next = { ...current };
          delete next[policy.id];
          return next;
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        markPending(policy.id, false);
      }
    },
    [graphqlService, markPending, mutate, reportError, workspaceId]
  );

  const deleteRule = useCallback(
    (rule: ContextRule) => {
      openConfirmModal({
        title: 'Delete rule?',
        description: rule.name,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          markPending(rule.id, true);
          try {
            await graphqlService.gql({
              query: deleteCopilotContextRuleMutation,
              variables: { id: rule.id },
            });
            await mutate();
          } catch (caught) {
            reportError(caught);
          } finally {
            markPending(rule.id, false);
          }
        },
      });
    },
    [graphqlService, markPending, mutate, openConfirmModal, reportError]
  );

  const deletePolicy = useCallback(
    (policy: ContextPolicy) => {
      openConfirmModal({
        title: 'Delete workspace policy?',
        description: policy.name,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmButtonOptions: { variant: 'error' },
        onConfirm: async () => {
          markPending(policy.id, true);
          try {
            await graphqlService.gql({
              query: deleteCopilotContextPolicyMutation,
              variables: { id: policy.id, workspaceId },
            });
            await mutate();
          } catch (caught) {
            reportError(caught);
          } finally {
            markPending(policy.id, false);
          }
        },
      });
    },
    [
      graphqlService,
      markPending,
      mutate,
      openConfirmModal,
      reportError,
      workspaceId,
    ]
  );

  const undoMemoryEvent = useCallback(
    async (event: ContextMemoryEvent) => {
      markPending(event.id, true);
      try {
        await graphqlService.gql({
          query: undoCopilotContextMemoryEventMutation,
          variables: { workspaceId, eventId: event.id },
        });
        await mutate();
      } catch (caught) {
        reportError(caught);
      } finally {
        markPending(event.id, false);
      }
    },
    [graphqlService, markPending, mutate, reportError, workspaceId]
  );

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
  const createDisabled = !newContent.trim() || creating || !selectedProjectId;
  const createRuleDisabled =
    !newRuleName.trim() ||
    !newRuleContent.trim() ||
    !Number.isInteger(Number(newRulePriority)) ||
    creating ||
    (isProjectTarget && !selectedProjectId);
  const createPolicyDisabled =
    !newPolicyName.trim() ||
    !newPolicyContent.trim() ||
    !Number.isInteger(Number(newPolicyPriority)) ||
    creating;
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
              {activeStrategy
                ? ` · ${activeStrategy.traceCount} plans traced`
                : ''}
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

      <SettingWrapper title="Your rules">
        <div className={styles.createArea}>
          <div className={styles.directiveControls}>
            <Input
              value={newRuleName}
              onChange={setNewRuleName}
              placeholder="Rule name"
              maxLength={120}
              disabled={creating}
            />
            <Menu
              items={targetOptions.map(value => (
                <MenuItem key={value} onSelect={() => setTarget(value)}>
                  {targetLabels[value]}
                </MenuItem>
              ))}
            >
              <Button className={styles.targetButton} variant="secondary">
                {targetLabels[target]}
              </Button>
            </Menu>
            <Menu
              items={(Object.keys(directiveModeLabels) as DirectiveMode[]).map(
                value => (
                  <MenuItem key={value} onSelect={() => setNewRuleMode(value)}>
                    {directiveModeLabels[value]}
                  </MenuItem>
                )
              )}
            >
              <Button className={styles.kindButton} variant="secondary">
                {directiveModeLabels[newRuleMode]}
              </Button>
            </Menu>
            <input
              className={styles.compactInput}
              type="number"
              min={-1000}
              max={1000}
              step={1}
              value={newRulePriority}
              aria-label="Rule priority"
              disabled={creating}
              onChange={event => setNewRulePriority(event.target.value)}
            />
          </div>
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
          <DirectiveConditionControls
            value={{
              description: newRuleDescription,
              keywords: newRuleKeywords,
              documentIds: newRuleDocumentIds,
              projectIds: newRuleProjectIds,
              match: newRuleMatch,
            }}
            projects={activeProjects}
            disabled={creating}
            scopeConditionsEnabled={target !== 'personal'}
            onChange={value => {
              setNewRuleDescription(value.description);
              setNewRuleKeywords(value.keywords);
              setNewRuleDocumentIds(value.documentIds);
              setNewRuleProjectIds(value.projectIds);
              setNewRuleMatch(value.match);
            }}
            onSelectDocuments={documentIds =>
              selectDocuments(documentIds, setNewRuleDocumentIds, true)
            }
          />
          <div className={styles.createInputRow}>
            <Input
              value={newRuleContent}
              onChange={setNewRuleContent}
              onEnter={() => void createRule()}
              placeholder="Rule instruction"
              maxLength={8000}
              disabled={creating}
            />
            <IconButton
              size="24"
              title="Create rule"
              icon={<PlusIcon />}
              disabled={createRuleDisabled}
              onClick={() => void createRule()}
            />
          </div>
        </div>

        <div className={styles.memoryList}>
          {rules.length ? (
            rules.map(rule => {
              const pending = pendingIds.has(rule.id);
              const draft = directiveDrafts[rule.id] ?? getDirectiveDraft(rule);
              const conditionValues = getDirectiveConditionValues(rule);
              const mode =
                directiveModes[rule.id] ??
                (rule.applicationMode as DirectiveMode);
              const changed =
                draft.name.trim() !== rule.name ||
                draft.content.trim() !== getDirectiveContent(rule) ||
                Number(draft.priority) !== rule.priority ||
                draft.keywords !== getDirectiveKeywords(rule).join(', ') ||
                draft.description.trim() !== rule.description ||
                !sameStringList(
                  draft.documentIds,
                  conditionValues.documentIds
                ) ||
                !sameStringList(draft.projectIds, conditionValues.projectIds) ||
                draft.match !== conditionValues.match ||
                mode !== rule.applicationMode;
              return (
                <div
                  className={
                    rule.status === 'active'
                      ? styles.memoryRow
                      : `${styles.memoryRow} ${styles.disabledRow}`
                  }
                  key={rule.id}
                >
                  <div className={styles.memoryMain}>
                    <div className={styles.directiveControls}>
                      <Input
                        value={draft.name}
                        onChange={name =>
                          setDirectiveDrafts(current => ({
                            ...current,
                            [rule.id]: { ...draft, name },
                          }))
                        }
                        maxLength={120}
                        disabled={pending}
                      />
                      <Menu
                        items={(
                          Object.keys(directiveModeLabels) as DirectiveMode[]
                        ).map(value => (
                          <MenuItem
                            key={value}
                            onSelect={() =>
                              setDirectiveModes(current => ({
                                ...current,
                                [rule.id]: value,
                              }))
                            }
                          >
                            {directiveModeLabels[value]}
                          </MenuItem>
                        ))}
                      >
                        <Button variant="secondary" disabled={pending}>
                          {directiveModeLabels[mode]}
                        </Button>
                      </Menu>
                      <input
                        className={styles.compactInput}
                        type="number"
                        min={-1000}
                        max={1000}
                        step={1}
                        value={draft.priority}
                        aria-label={`${rule.name} priority`}
                        disabled={pending}
                        onChange={event =>
                          setDirectiveDrafts(current => ({
                            ...current,
                            [rule.id]: {
                              ...draft,
                              priority: event.target.value,
                            },
                          }))
                        }
                      />
                    </div>
                    <DirectiveConditionControls
                      value={draft}
                      projects={activeProjects}
                      disabled={pending}
                      scopeConditionsEnabled={rule.scope !== 'user'}
                      onChange={value =>
                        setDirectiveDrafts(current => ({
                          ...current,
                          [rule.id]: { ...draft, ...value },
                        }))
                      }
                      onSelectDocuments={documentIds =>
                        selectDocuments(
                          documentIds,
                          nextDocumentIds =>
                            setDirectiveDrafts(current => ({
                              ...current,
                              [rule.id]: {
                                ...draft,
                                documentIds: nextDocumentIds,
                              },
                            })),
                          true
                        )
                      }
                    />
                    <textarea
                      className={styles.memoryInput}
                      value={draft.content}
                      maxLength={8000}
                      rows={2}
                      disabled={pending}
                      aria-label={`${rule.name} content`}
                      onChange={event =>
                        setDirectiveDrafts(current => ({
                          ...current,
                          [rule.id]: {
                            ...draft,
                            content: event.target.value,
                          },
                        }))
                      }
                    />
                    <div className={styles.metadata}>
                      <span className={styles.tag}>
                        {scopeLabels[rule.scope] ?? rule.scope}
                      </span>
                      <span className={styles.privateBadge}>Only you</span>
                      {rule.projectId ? (
                        <span className={styles.projectTag}>
                          {projectById.get(rule.projectId)?.name ?? 'Project'}
                        </span>
                      ) : null}
                      <span className={styles.tag}>
                        {rule.hits.length} recent hits
                      </span>
                    </div>
                  </div>
                  <div className={styles.directiveActions}>
                    <Switch
                      aria-label={`${rule.name} enabled`}
                      checked={rule.status === 'active'}
                      disabled={pending}
                      onChange={active =>
                        void updateRule(rule, {
                          status: active ? 'active' : 'disabled',
                        })
                      }
                    />
                    <Menu
                      items={rule.revisions
                        .filter(
                          revision => revision.revision !== rule.activeRevision
                        )
                        .map(revision => (
                          <MenuItem
                            key={revision.id}
                            onSelect={() =>
                              void rollbackRule(rule, revision.revision)
                            }
                          >
                            Revision {revision.revision}
                          </MenuItem>
                        ))}
                    >
                      <Button variant="secondary" disabled={pending}>
                        Revision {rule.activeRevision}
                      </Button>
                    </Menu>
                    <IconButton
                      size="20"
                      title="Save rule"
                      icon={<SaveIcon />}
                      disabled={
                        !changed ||
                        !draft.name.trim() ||
                        !draft.content.trim() ||
                        !Number.isInteger(Number(draft.priority)) ||
                        pending
                      }
                      onClick={() => void updateRule(rule)}
                    />
                    <IconButton
                      size="20"
                      title="Delete rule"
                      icon={<DeleteIcon />}
                      disabled={pending}
                      onClick={() => deleteRule(rule)}
                    />
                  </div>
                </div>
              );
            })
          ) : (
            <div className={styles.empty}>No rules</div>
          )}
        </div>
      </SettingWrapper>

      {!isLocal ? (
        <SettingWrapper title="Workspace policies">
          {canManageProjects ? (
            <div className={styles.createArea}>
              <div className={styles.directiveControls}>
                <Input
                  value={newPolicyName}
                  onChange={setNewPolicyName}
                  placeholder="Policy name"
                  maxLength={120}
                  disabled={creating}
                />
                <Menu
                  items={(['always', 'relevant'] as const).map(value => (
                    <MenuItem
                      key={value}
                      onSelect={() => setNewPolicyMode(value)}
                    >
                      {directiveModeLabels[value]}
                    </MenuItem>
                  ))}
                >
                  <Button variant="secondary">
                    {directiveModeLabels[newPolicyMode]}
                  </Button>
                </Menu>
                <input
                  className={styles.compactInput}
                  type="number"
                  min={-1000}
                  max={1000}
                  step={1}
                  value={newPolicyPriority}
                  aria-label="Policy priority"
                  disabled={creating}
                  onChange={event => setNewPolicyPriority(event.target.value)}
                />
              </div>
              <DirectiveConditionControls
                value={{
                  description: newPolicyDescription,
                  keywords: newPolicyKeywords,
                  documentIds: newPolicyDocumentIds,
                  projectIds: newPolicyProjectIds,
                  match: newPolicyMatch,
                }}
                projects={activeProjects}
                disabled={creating}
                scopeConditionsEnabled
                onChange={value => {
                  setNewPolicyDescription(value.description);
                  setNewPolicyKeywords(value.keywords);
                  setNewPolicyDocumentIds(value.documentIds);
                  setNewPolicyProjectIds(value.projectIds);
                  setNewPolicyMatch(value.match);
                }}
                onSelectDocuments={documentIds =>
                  selectDocuments(documentIds, setNewPolicyDocumentIds, true)
                }
              />
              <div className={styles.createInputRow}>
                <Input
                  value={newPolicyContent}
                  onChange={setNewPolicyContent}
                  onEnter={() => void createPolicy()}
                  placeholder="Enforced policy instruction"
                  maxLength={8000}
                  disabled={creating}
                />
                <IconButton
                  size="24"
                  title="Create policy"
                  icon={<PlusIcon />}
                  disabled={createPolicyDisabled}
                  onClick={() => void createPolicy()}
                />
              </div>
            </div>
          ) : null}
          <div className={styles.memoryList}>
            {policies.length ? (
              policies.map(policy => {
                const pending = pendingIds.has(policy.id);
                const draft =
                  directiveDrafts[policy.id] ?? getDirectiveDraft(policy);
                const conditionValues = getDirectiveConditionValues(policy);
                const mode =
                  directiveModes[policy.id] === 'relevant'
                    ? 'relevant'
                    : 'always';
                const changed =
                  draft.name.trim() !== policy.name ||
                  draft.content.trim() !== getDirectiveContent(policy) ||
                  Number(draft.priority) !== policy.priority ||
                  draft.keywords !== getDirectiveKeywords(policy).join(', ') ||
                  draft.description.trim() !== policy.description ||
                  !sameStringList(
                    draft.documentIds,
                    conditionValues.documentIds
                  ) ||
                  !sameStringList(
                    draft.projectIds,
                    conditionValues.projectIds
                  ) ||
                  draft.match !== conditionValues.match ||
                  mode !== policy.applicationMode;
                return (
                  <div
                    className={
                      policy.status === 'active'
                        ? styles.memoryRow
                        : `${styles.memoryRow} ${styles.disabledRow}`
                    }
                    key={policy.id}
                  >
                    <div className={styles.memoryMain}>
                      <div className={styles.directiveControls}>
                        <Input
                          value={draft.name}
                          onChange={name =>
                            setDirectiveDrafts(current => ({
                              ...current,
                              [policy.id]: { ...draft, name },
                            }))
                          }
                          disabled={pending || !policy.canManage}
                        />
                        <Menu
                          items={(['always', 'relevant'] as const).map(
                            value => (
                              <MenuItem
                                key={value}
                                onSelect={() =>
                                  setDirectiveModes(current => ({
                                    ...current,
                                    [policy.id]: value,
                                  }))
                                }
                              >
                                {directiveModeLabels[value]}
                              </MenuItem>
                            )
                          )}
                        >
                          <Button
                            variant="secondary"
                            disabled={pending || !policy.canManage}
                          >
                            {directiveModeLabels[mode]}
                          </Button>
                        </Menu>
                        <input
                          className={styles.compactInput}
                          type="number"
                          min={-1000}
                          max={1000}
                          step={1}
                          value={draft.priority}
                          aria-label={`${policy.name} priority`}
                          disabled={pending || !policy.canManage}
                          onChange={event =>
                            setDirectiveDrafts(current => ({
                              ...current,
                              [policy.id]: {
                                ...draft,
                                priority: event.target.value,
                              },
                            }))
                          }
                        />
                      </div>
                      <DirectiveConditionControls
                        value={draft}
                        projects={activeProjects}
                        disabled={pending || !policy.canManage}
                        scopeConditionsEnabled
                        onChange={value =>
                          setDirectiveDrafts(current => ({
                            ...current,
                            [policy.id]: { ...draft, ...value },
                          }))
                        }
                        onSelectDocuments={documentIds =>
                          selectDocuments(
                            documentIds,
                            nextDocumentIds =>
                              setDirectiveDrafts(current => ({
                                ...current,
                                [policy.id]: {
                                  ...draft,
                                  documentIds: nextDocumentIds,
                                },
                              })),
                            true
                          )
                        }
                      />
                      <textarea
                        className={styles.memoryInput}
                        value={draft.content}
                        maxLength={8000}
                        rows={2}
                        disabled={pending || !policy.canManage}
                        aria-label={`${policy.name} content`}
                        onChange={event =>
                          setDirectiveDrafts(current => ({
                            ...current,
                            [policy.id]: {
                              ...draft,
                              content: event.target.value,
                            },
                          }))
                        }
                      />
                      <div className={styles.metadata}>
                        <span className={styles.tag}>Workspace policy</span>
                        <span className={styles.tag}>
                          {policy.hits.length} recent hits
                        </span>
                      </div>
                    </div>
                    <div className={styles.directiveActions}>
                      <Switch
                        aria-label={`${policy.name} enabled`}
                        checked={policy.status === 'active'}
                        disabled={pending || !policy.canManage}
                        onChange={active =>
                          void updatePolicy(policy, {
                            status: active ? 'active' : 'disabled',
                          })
                        }
                      />
                      <Menu
                        items={policy.revisions
                          .filter(
                            revision =>
                              revision.revision !== policy.activeRevision
                          )
                          .map(revision => (
                            <MenuItem
                              key={revision.id}
                              onSelect={() =>
                                void rollbackPolicy(policy, revision.revision)
                              }
                            >
                              Revision {revision.revision}
                            </MenuItem>
                          ))}
                      >
                        <Button
                          variant="secondary"
                          disabled={pending || !policy.canManage}
                        >
                          Revision {policy.activeRevision}
                        </Button>
                      </Menu>
                      <IconButton
                        size="20"
                        title="Save policy"
                        icon={<SaveIcon />}
                        disabled={
                          !changed ||
                          !draft.name.trim() ||
                          !draft.content.trim() ||
                          !Number.isInteger(Number(draft.priority)) ||
                          pending ||
                          !policy.canManage
                        }
                        onClick={() => void updatePolicy(policy)}
                      />
                      <IconButton
                        size="20"
                        title="Delete policy"
                        icon={<DeleteIcon />}
                        disabled={pending || !policy.canManage}
                        onClick={() => deletePolicy(policy)}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className={styles.empty}>No workspace policies</div>
            )}
          </div>
        </SettingWrapper>
      ) : null}

      <SettingWrapper title="Memories and project summaries">
        {!isLocal && activeProjects.length ? (
          <div className={styles.createArea}>
            <div className={styles.createControls}>
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
                <Button className={styles.projectButton} variant="secondary">
                  {selectedProjectId
                    ? (projectById.get(selectedProjectId)?.name ?? 'Project')
                    : 'Select project'}
                </Button>
              </Menu>
            </div>
            <div className={styles.createInputRow}>
              <Input
                value={newContent}
                onChange={setNewContent}
                onEnter={() => void createMemory()}
                placeholder="Project summary"
                maxLength={8000}
                disabled={creating}
              />
              <IconButton
                size="24"
                title="Add project summary"
                icon={<PlusIcon />}
                disabled={createDisabled}
                onClick={() => void createMemory()}
              />
            </div>
          </div>
        ) : null}

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
                            {memory.factKey ? (
                              <span className={styles.tag}>
                                {memory.factKey}
                              </span>
                            ) : null}
                            <span className={styles.tag}>
                              {memory.captureMode}
                            </span>
                            <span className={styles.tag}>
                              Confidence {Math.round(memory.confidence * 100)}%
                            </span>
                            {memory.expiresAt ? (
                              <span className={styles.tag}>
                                Expires{' '}
                                {new Date(
                                  memory.expiresAt
                                ).toLocaleDateString()}
                              </span>
                            ) : null}
                            {memory.useCount ? (
                              <span className={styles.tag}>
                                Used {memory.useCount} times
                              </span>
                            ) : null}
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

      <SettingWrapper title="Automatic memory history">
        <div className={styles.memoryList}>
          {memoryEvents.filter(event => event.operation !== 'NOOP').length ? (
            memoryEvents
              .filter(event => event.operation !== 'NOOP')
              .slice(0, 20)
              .map(event => (
                <div className={styles.eventRow} key={event.id}>
                  <div className={styles.metadata}>
                    <span className={styles.tag}>{event.operation}</span>
                    {event.factKey ? (
                      <span className={styles.tag}>{event.factKey}</span>
                    ) : null}
                    <span className={styles.tag}>{event.reasonCode}</span>
                    <span className={styles.updatedAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {event.canUndo ? (
                    <Button
                      variant="secondary"
                      disabled={pendingIds.has(event.id)}
                      onClick={() => void undoMemoryEvent(event)}
                    >
                      Undo
                    </Button>
                  ) : null}
                </div>
              ))
          ) : (
            <div className={styles.empty}>No automatic memory changes</div>
          )}
        </div>
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
