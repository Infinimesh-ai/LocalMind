import { Menu, MenuItem, notify } from '@affine/component';
import { GraphQLService } from '@affine/core/modules/cloud';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import { renameConversationMutation } from '@affine/graphql';
import { useI18n } from '@affine/i18n';
import { ArrowUpSmallIcon, FolderIcon } from '@blocksuite/icons/rc';
import { useService } from '@toeverything/infra';
import { useCallback, useEffect, useRef, useState } from 'react';

import * as styles from './new-conversation.css';
import type { WorkbenchProject } from './types';
import { WorkbenchConversation } from './workbench-conversation';

type NewConversationProps = {
  projects: WorkbenchProject[];
  initialProjectId?: string;
  onCreated: (projectId: string, sessionId: string) => void;
  onChanged: () => Promise<unknown>;
};

export function NewConversation({
  projects,
  initialProjectId,
  onCreated,
  onChanged,
}: NewConversationProps) {
  const t = useI18n();
  const graphql = useService(GraphQLService);
  const [projectId, setProjectId] = useState(
    projects.some(project => project.id === initialProjectId)
      ? (initialProjectId ?? '')
      : ''
  );
  const [title, setTitle] = useState('');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const projectTriggerRef = useRef<HTMLButtonElement>(null);
  const selectedProject = projects.find(project => project.id === projectId);
  useEffect(() => {
    if (
      !projectId &&
      initialProjectId &&
      projects.some(project => project.id === initialProjectId)
    ) {
      setProjectId(initialProjectId);
    }
  }, [initialProjectId, projectId, projects]);

  const start = () => {
    if (!projectId) {
      setError(true);
      projectTriggerRef.current?.focus();
      return;
    }
    if (!draft.trim()) return;
    setError(false);
    setStarted(true);
  };
  const sessionCreated = useCallback(
    async (sessionId: string) => {
      if (!selectedProject) return;
      if (title.trim()) {
        try {
          await graphql.gql({
            query: renameConversationMutation,
            variables: {
              sessionId,
              title: title.trim(),
              expectedRevision: 1,
            },
          });
        } catch (caught) {
          notify.error({
            title: t['com.affine.localmind.workbench.v9.renameFailed'](),
            message: projectErrorMessage(caught),
          });
        }
      }
      await onChanged();
      onCreated(selectedProject.id, sessionId);
    },
    [graphql, onChanged, onCreated, selectedProject, t, title]
  );

  if (started && selectedProject) {
    return (
      <div className={styles.started}>
        <WorkbenchConversation
          key={selectedProject.id}
          selectedProjectId={selectedProject.id}
          selectedProjectName={selectedProject.name}
          onOpenResource={() => {}}
          startEmpty
          initialDraftText={draft.trim()}
          autoSendInitialDraft
          onSessionCreated={sessionCreated}
          onDocumentsChanged={onChanged}
        />
      </div>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="new-conversation-title">
      <div className={styles.empty}>
        <h1 id="new-conversation-title">
          <input
            className={styles.titleInput}
            aria-label={t['com.affine.localmind.workbench.v9.optionalTitle']()}
            value={title}
            maxLength={80}
            placeholder={t[
              'com.affine.localmind.workbench.v9.newConversation'
            ]()}
            onChange={event => setTitle(event.currentTarget.value)}
          />
        </h1>
        <p>{t['com.affine.localmind.workbench.v9.newConversationHelp']()}</p>
      </div>
      <div className={styles.composerGroup}>
        <div className={styles.projectBar}>
          <Menu
            contentOptions={{
              align: 'start',
              side: 'top',
              sideOffset: 6,
              style: { minWidth: 260, maxWidth: 'calc(100vw - 32px)' },
            }}
            items={
              projects.length ? (
                projects.map(project => (
                  <MenuItem
                    key={project.id}
                    prefixIcon={<FolderIcon />}
                    selected={project.id === projectId}
                    onSelect={() => {
                      setProjectId(project.id);
                      setError(false);
                    }}
                  >
                    {project.name}
                  </MenuItem>
                ))
              ) : (
                <MenuItem disabled>
                  {t[
                    'com.affine.localmind.workbench.v9.chooseProjectPlaceholder'
                  ]()}
                </MenuItem>
              )
            }
          >
            <button
              ref={projectTriggerRef}
              className={styles.projectTrigger}
              type="button"
              aria-label={t[
                'com.affine.localmind.workbench.v9.chooseProject'
              ]()}
              aria-invalid={error || undefined}
              aria-describedby={error ? 'project-selection-error' : undefined}
            >
              <FolderIcon />
              <span>
                {selectedProject?.name ??
                  t[
                    'com.affine.localmind.workbench.v9.chooseProjectPlaceholder'
                  ]()}
              </span>
            </button>
          </Menu>
        </div>
        <div className={styles.composer}>
          <textarea
            rows={3}
            value={draft}
            placeholder={t[
              'com.affine.localmind.workbench.v9.taskPlaceholder'
            ]()}
            onChange={event => setDraft(event.currentTarget.value)}
            onKeyDown={event => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                start();
              }
            }}
          />
          {error ? (
            <span
              id="project-selection-error"
              className={styles.error}
              role="alert"
            >
              {t['com.affine.localmind.workbench.v9.chooseProjectError']()}
            </span>
          ) : null}
          <div className={styles.footer}>
            <span>
              {t['com.affine.localmind.workbench.v9.draftLifetime']()}
            </span>
            <button
              className={styles.sendButton}
              type="button"
              aria-label={t['Send']()}
              disabled={!draft.trim()}
              onClick={start}
            >
              <ArrowUpSmallIcon />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
