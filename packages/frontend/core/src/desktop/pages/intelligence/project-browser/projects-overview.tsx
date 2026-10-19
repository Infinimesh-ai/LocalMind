import { Button, Loading } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { FolderIcon } from '@blocksuite/icons/rc';
import { useState } from 'react';

import type { WorkbenchProject } from '../types';
import * as styles from './browser.css';

/** All projects as large folders; double click or Enter opens one. */
export function ProjectsOverview({
  projects,
  loading,
  error,
  onRetry,
  onOpenProject,
}: {
  projects: readonly WorkbenchProject[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onOpenProject: (projectId: string) => void;
}) {
  const t = useI18n();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (error)
    return (
      <div className={styles.state} role="alert">
        <span>{error}</span>
        <Button disabled={loading} loading={loading} onClick={onRetry}>
          {t['com.affine.localmind.project-files.retry']()}
        </Button>
      </div>
    );
  if (loading)
    return (
      <div className={styles.state} role="status">
        <Loading />
      </div>
    );
  if (!projects.length)
    return (
      <p className={styles.state}>
        {t['com.affine.localmind.workbench.projects.emptyTitle']()}
      </p>
    );
  const focusTile = (index: number) => {
    const project = projects[Math.max(0, Math.min(projects.length - 1, index))];
    setSelectedId(project.id);
    document
      .querySelector<HTMLElement>(
        `[data-browser-project-id="${CSS.escape(project.id)}"]`
      )
      ?.focus();
  };
  return (
    <div
      role="listbox"
      aria-label={t['com.affine.localmind.project-browser.sidebar.projects']()}
      aria-orientation="horizontal"
      className={styles.projectGrid}
    >
      {projects.map((project, index) => (
        <div
          key={project.id}
          role="option"
          aria-selected={project.id === selectedId}
          tabIndex={
            project.id === selectedId || (!selectedId && index === 0) ? 0 : -1
          }
          className={styles.projectTile}
          title={project.name}
          data-browser-project-id={project.id}
          onClick={() => setSelectedId(project.id)}
          onDoubleClick={() => onOpenProject(project.id)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              onOpenProject(project.id);
            } else if (
              event.key === 'ArrowRight' ||
              event.key === 'ArrowDown'
            ) {
              event.preventDefault();
              focusTile(index + 1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
              event.preventDefault();
              focusTile(index - 1);
            }
          }}
        >
          <span className={styles.projectTileIcon}>
            <FolderIcon />
          </span>
          <span className={styles.tileLabel}>{project.name}</span>
        </div>
      ))}
    </div>
  );
}
