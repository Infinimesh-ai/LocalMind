import {
  Button,
  IconButton,
  Input,
  Loading,
  Menu,
  MenuItem,
} from '@affine/component';
import { useI18n } from '@affine/i18n';
import {
  AiIcon,
  DeleteTemporarilyIcon,
  EditIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PinedIcon,
  PlusIcon,
} from '@blocksuite/icons/rc';
import { useEffect, useMemo, useState } from 'react';

import * as styles from './project-tree.css';
import type { WorkbenchConversationCard, WorkbenchProject } from './types';

const EMPTY_CONVERSATIONS: WorkbenchConversationCard[] = [];
const NOOP = () => undefined;
const ASYNC_NOOP = async () => undefined;

type ProjectTreeProps = {
  projects: WorkbenchProject[];
  selectedProjectId: string | null;
  selectedSessionId?: string | null;
  conversations?: WorkbenchConversationCard[];
  loading: boolean;
  error?: string;
  conversationsLoading?: boolean;
  conversationsLoadingMore?: boolean;
  conversationsError?: string;
  conversationsHasMore?: boolean;
  mutationsPending: boolean;
  onRefresh: () => void;
  onRefreshConversations?: () => void;
  onLoadMoreConversations?: () => void;
  onSelectProject: (projectId: string | null) => void;
  onOpenConversation?: (card: WorkbenchConversationCard) => void;
  onNewConversation?: () => void;
  onRenameConversation?: (
    card: WorkbenchConversationCard,
    title: string
  ) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onRename: (project: WorkbenchProject, name: string) => Promise<void>;
  onArchive: (project: WorkbenchProject) => Promise<void>;
  onManageCollaboration: (project: WorkbenchProject) => void;
};

export const ProjectTree = ({
  projects,
  selectedProjectId,
  selectedSessionId,
  conversations = EMPTY_CONVERSATIONS,
  loading,
  error,
  conversationsLoading = false,
  conversationsLoadingMore = false,
  conversationsError,
  conversationsHasMore = false,
  mutationsPending,
  onRefresh,
  onRefreshConversations = NOOP,
  onLoadMoreConversations = NOOP,
  onSelectProject,
  onOpenConversation = NOOP,
  onNewConversation = NOOP,
  onRenameConversation = ASYNC_NOOP,
  onCreate,
  onRename,
  onArchive,
  onManageCollaboration,
}: ProjectTreeProps) => {
  const t = useI18n();
  const [creating, setCreating] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(
    null
  );
  const [renamedProjectName, setRenamedProjectName] = useState('');
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(selectedProjectId ? [selectedProjectId] : [])
  );
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(
    null
  );
  const [renamedSessionTitle, setRenamedSessionTitle] = useState('');

  useEffect(() => {
    if (
      renamingProjectId &&
      !projects.some(project => project.id === renamingProjectId)
    ) {
      setRenamingProjectId(null);
      setRenamedProjectName('');
    }
  }, [projects, renamingProjectId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    setExpandedProjectIds(current => new Set(current).add(selectedProjectId));
  }, [selectedProjectId]);

  const activeProjects = useMemo(
    () => projects.filter(project => project.status === 'active'),
    [projects]
  );

  const submitCreate = async () => {
    const name = newProjectName.trim();
    if (!name || mutationsPending) return;
    await onCreate(name);
    setNewProjectName('');
    setCreating(false);
  };

  const submitRename = async (project: WorkbenchProject) => {
    const name = renamedProjectName.trim();
    if (!name || name === project.name || mutationsPending) {
      setRenamingProjectId(null);
      setRenamedProjectName('');
      return;
    }
    await onRename(project, name);
    setRenamingProjectId(null);
    setRenamedProjectName('');
  };

  const submitSessionRename = async (card: WorkbenchConversationCard) => {
    const title = renamedSessionTitle.trim();
    if (!title || title === card.title || mutationsPending) {
      setRenamingSessionId(null);
      setRenamedSessionTitle('');
      return;
    }
    await onRenameConversation(card, title);
    setRenamingSessionId(null);
    setRenamedSessionTitle('');
  };

  const startSessionRename = (card: WorkbenchConversationCard) => {
    setRenamingSessionId(card.sessionId);
    setRenamedSessionTitle(card.title ?? '');
  };

  const personalWorkOrders = conversations.filter(
    card => card.scopeType === 'work_order'
  );

  return (
    <nav
      className={styles.root}
      aria-label={t['com.affine.localmind.workbench.projects']()}
    >
      <Button
        className={styles.newConversation}
        variant="primary"
        onClick={onNewConversation}
      >
        <PlusIcon />
        <span>{t['com.affine.localmind.workbench.v9.newConversation']()}</span>
      </Button>

      <div className={styles.overviewLabel}>
        {t['com.affine.localmind.workbench.v9.collaborationHub']()}
      </div>
      <button
        type="button"
        className={styles.allProjects}
        data-selected={selectedProjectId === null}
        onClick={() => onSelectProject(null)}
      >
        <AiIcon />
        <span>{t['com.affine.localmind.workbench.v9.overview']()}</span>
        <span className={styles.projectCount}>{activeProjects.length}</span>
      </button>

      <div className={styles.headingRow}>
        <h2 className={styles.heading}>
          {t['com.affine.localmind.workbench.projects']()}
        </h2>
        <IconButton
          size="16"
          tooltip={t['com.affine.localmind.workbench.project.create']()}
          aria-label={t['com.affine.localmind.workbench.project.create']()}
          icon={<PlusIcon />}
          disabled={mutationsPending}
          onClick={() => setCreating(true)}
        />
      </div>

      {creating ? (
        <div className={styles.inlineEditor}>
          <Input
            autoFocus
            autoSelect
            value={newProjectName}
            placeholder={t[
              'com.affine.localmind.workbench.project.namePlaceholder'
            ]()}
            disabled={mutationsPending}
            onChange={setNewProjectName}
            onEnter={() => void submitCreate()}
          />
          <div className={styles.inlineEditorActions}>
            <Button
              variant="primary"
              disabled={!newProjectName.trim() || mutationsPending}
              loading={mutationsPending}
              onClick={() => void submitCreate()}
            >
              {t['Create']()}
            </Button>
            <Button
              disabled={mutationsPending}
              onClick={() => {
                setCreating(false);
                setNewProjectName('');
              }}
            >
              {t['Cancel']()}
            </Button>
          </div>
        </div>
      ) : null}

      <div className={styles.treeScroll}>
        {loading ? (
          <div className={styles.centerState}>
            <Loading size={20} />
          </div>
        ) : error ? (
          <div className={styles.centerState} role="alert">
            <span>{error}</span>
            <Button onClick={onRefresh}>
              {t['com.affine.localmind.workbench.retry']()}
            </Button>
          </div>
        ) : activeProjects.length === 0 ? (
          <div className={styles.emptyState}>
            {t['com.affine.localmind.workbench.projects.empty']()}
          </div>
        ) : (
          <ul className={styles.projectList}>
            {activeProjects.map(project => (
              <li key={project.id} className={styles.projectItem}>
                <div
                  className={styles.projectRow}
                  data-selected={selectedProjectId === project.id}
                >
                  {renamingProjectId === project.id ? (
                    <Input
                      className={styles.renameInput}
                      autoFocus
                      autoSelect
                      value={renamedProjectName}
                      disabled={mutationsPending}
                      onChange={setRenamedProjectName}
                      onEnter={() => void submitRename(project)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') {
                          setRenamingProjectId(null);
                          setRenamedProjectName('');
                        }
                      }}
                      onBlur={() => void submitRename(project)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.projectButton}
                      aria-expanded={expandedProjectIds.has(project.id)}
                      onClick={() =>
                        setExpandedProjectIds(current => {
                          const next = new Set(current);
                          if (next.has(project.id)) next.delete(project.id);
                          else next.add(project.id);
                          return next;
                        })
                      }
                    >
                      <FolderIcon />
                      <span className={styles.projectName} title={project.name}>
                        {project.name}
                      </span>
                    </button>
                  )}

                  {renamingProjectId !== project.id ? (
                    <Menu
                      contentOptions={{ align: 'end' }}
                      items={
                        <>
                          <MenuItem
                            disabled={mutationsPending}
                            onClick={() => onManageCollaboration(project)}
                          >
                            {t[
                              'com.affine.localmind.workbench.project.collaboration'
                            ]()}
                          </MenuItem>
                          {project.canManage ? (
                            <>
                              <MenuItem
                                prefixIcon={<EditIcon />}
                                disabled={mutationsPending}
                                onClick={() => {
                                  setRenamingProjectId(project.id);
                                  setRenamedProjectName(project.name);
                                }}
                              >
                                {t['Rename']()}
                              </MenuItem>
                              <MenuItem
                                type="warning"
                                prefixIcon={<DeleteTemporarilyIcon />}
                                disabled={mutationsPending}
                                onClick={() => void onArchive(project)}
                              >
                                {t[
                                  'com.affine.localmind.workbench.project.archive'
                                ]()}
                              </MenuItem>
                            </>
                          ) : null}
                        </>
                      }
                    >
                      <IconButton
                        className={styles.projectMenuButton}
                        size="16"
                        tooltip={t[
                          'com.affine.localmind.workbench.project.actions'
                        ]()}
                        aria-label={t[
                          'com.affine.localmind.workbench.project.actions'
                        ]()}
                        icon={<MoreHorizontalIcon />}
                      />
                    </Menu>
                  ) : null}
                </div>
                {expandedProjectIds.has(project.id) ? (
                  <ul className={styles.documents}>
                    {conversations
                      .filter(card => card.project?.id === project.id)
                      .toSorted((a, b) => Number(b.pinned) - Number(a.pinned))
                      .map(card => (
                        <li key={card.sessionId} className={styles.documentRow}>
                          {renamingSessionId === card.sessionId ? (
                            <Input
                              className={styles.renameInput}
                              autoFocus
                              autoSelect
                              value={renamedSessionTitle}
                              maxLength={80}
                              disabled={mutationsPending}
                              onChange={setRenamedSessionTitle}
                              onEnter={() => void submitSessionRename(card)}
                              onKeyDown={event => {
                                if (event.key === 'Escape') {
                                  setRenamingSessionId(null);
                                  setRenamedSessionTitle('');
                                }
                              }}
                              onBlur={() => void submitSessionRename(card)}
                            />
                          ) : (
                            <button
                              type="button"
                              className={styles.documentButton}
                              data-pinned={card.pinned}
                              aria-current={
                                selectedSessionId === card.sessionId
                                  ? 'page'
                                  : undefined
                              }
                              onClick={() => onOpenConversation(card)}
                              onDoubleClick={() => startSessionRename(card)}
                              onKeyDown={event => {
                                if (event.key === 'F2') {
                                  event.preventDefault();
                                  startSessionRename(card);
                                }
                              }}
                            >
                              {card.pinned ? <PinedIcon /> : <AiIcon />}
                              <span title={card.title ?? undefined}>
                                {card.title ||
                                  t[
                                    'com.affine.localmind.workbench.v9.untitled'
                                  ]()}
                              </span>
                            </button>
                          )}
                        </li>
                      ))}
                    {conversations.every(
                      card => card.project?.id !== project.id
                    ) ? (
                      <li className={styles.groupLabel}>
                        {t[
                          'com.affine.localmind.workbench.v9.noConversations'
                        ]()}
                      </li>
                    ) : null}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {personalWorkOrders.length ? (
          <section className={styles.personalSection}>
            <h3>
              {t['com.affine.localmind.workbench.v9.personalWorkOrder']()}
            </h3>
            <ul className={styles.documents}>
              {personalWorkOrders.map(card => (
                <li key={card.sessionId} className={styles.documentRow}>
                  {renamingSessionId === card.sessionId ? (
                    <Input
                      className={styles.renameInput}
                      autoFocus
                      autoSelect
                      value={renamedSessionTitle}
                      maxLength={80}
                      disabled={mutationsPending}
                      onChange={setRenamedSessionTitle}
                      onEnter={() => void submitSessionRename(card)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') {
                          setRenamingSessionId(null);
                          setRenamedSessionTitle('');
                        }
                      }}
                      onBlur={() => void submitSessionRename(card)}
                    />
                  ) : (
                    <button
                      type="button"
                      className={styles.documentButton}
                      aria-current={
                        selectedSessionId === card.sessionId
                          ? 'page'
                          : undefined
                      }
                      onClick={() => onOpenConversation(card)}
                      onDoubleClick={() => startSessionRename(card)}
                      onKeyDown={event => {
                        if (event.key === 'F2') {
                          event.preventDefault();
                          startSessionRename(card);
                        }
                      }}
                    >
                      <AiIcon />
                      <span title={card.title ?? undefined}>
                        {card.title ||
                          t['com.affine.localmind.workbench.v9.untitled']()}
                      </span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {conversationsLoading ? (
          <div className={styles.conversationPageState} aria-live="polite">
            <Loading size={18} />
            <span>
              {t['com.affine.localmind.workbench.v9.loadingConversations']()}
            </span>
          </div>
        ) : conversationsError ? (
          <div className={styles.conversationPageState} role="alert">
            <span>{conversationsError}</span>
            <Button onClick={onRefreshConversations}>
              {t['com.affine.localmind.workbench.retry']()}
            </Button>
          </div>
        ) : conversationsHasMore ? (
          <Button
            className={styles.loadMoreConversations}
            loading={conversationsLoadingMore}
            disabled={conversationsLoadingMore}
            onClick={onLoadMoreConversations}
          >
            {t['com.affine.localmind.workbench.v9.loadMoreConversations']()}
          </Button>
        ) : null}
      </div>
    </nav>
  );
};
