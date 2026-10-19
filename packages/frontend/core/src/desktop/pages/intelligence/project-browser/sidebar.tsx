import { Button, Loading } from '@affine/component';
import { useI18n } from '@affine/i18n';
import {
  DeleteTemporarilyIcon,
  FolderIcon,
  GridIcon,
} from '@blocksuite/icons/rc';
import { useState } from 'react';

import { ProjectResourceIcon } from '../project-resource-icon';
import type { WorkbenchProject } from '../types';
import type { RecentProjectFile } from './recent';
import * as styles from './sidebar.css';

const RECENT_PREVIEW = 6;

/** Finder-style "Locations" sidebar for the project documents view. */
export function ProjectBrowserSidebar({
  projects,
  selectedProjectId,
  loading,
  error,
  onRetry,
  onSelectProject,
  recent,
  onOpenRecent,
  trash,
  onOpenTrash,
  onRestoreProject,
}: {
  projects: readonly WorkbenchProject[];
  selectedProjectId: string | null;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSelectProject: (projectId: string | null) => void;
  recent: readonly RecentProjectFile[];
  onOpenRecent: (entry: RecentProjectFile) => void;
  trash: boolean;
  onOpenTrash: () => void;
  onRestoreProject?: (project: WorkbenchProject) => void;
}) {
  const t = useI18n();
  const [showAllRecent, setShowAllRecent] = useState(false);
  const active = projects.filter(project => project.status === 'active');
  const archived = projects.filter(project => project.status === 'archived');
  const visibleRecent = showAllRecent
    ? recent
    : recent.slice(0, RECENT_PREVIEW);
  const projectName = (id: string, fallback: string) =>
    projects.find(project => project.id === id)?.name ?? fallback;
  return (
    <nav
      className={styles.sidebar}
      aria-label={t['com.affine.localmind.project-browser.sidebar.label']()}
    >
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t['com.affine.localmind.project-browser.sidebar.recent']()}
        </h2>
        {recent.length ? (
          <ul
            className={styles.list}
            aria-label={t[
              'com.affine.localmind.project-browser.sidebar.recent'
            ]()}
          >
            {visibleRecent.map(entry => {
              const where = projectName(entry.projectId, entry.projectName);
              return (
                <li key={`${entry.projectId}:${entry.resourceId}`}>
                  <button
                    type="button"
                    className={styles.item}
                    title={where ? `${where} / ${entry.title}` : entry.title}
                    onClick={() => onOpenRecent(entry)}
                  >
                    <ProjectResourceIcon
                      kind={entry.kind}
                      title={entry.title}
                    />
                    <span className={styles.itemLabel}>{entry.title}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={styles.hint}>
            {t['com.affine.localmind.project-browser.sidebar.recentEmpty']()}
          </p>
        )}
        {recent.length > RECENT_PREVIEW ? (
          <button
            type="button"
            className={styles.more}
            aria-expanded={showAllRecent}
            onClick={() => setShowAllRecent(value => !value)}
          >
            {showAllRecent
              ? t['com.affine.localmind.project-browser.sidebar.showLess']()
              : t['com.affine.localmind.project-browser.sidebar.showAll']({
                  count: String(recent.length),
                })}
          </button>
        ) : null}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          {t['com.affine.localmind.project-browser.sidebar.projects']()}
        </h2>
        <button
          type="button"
          className={styles.item}
          aria-current={!selectedProjectId && !trash}
          onClick={() => onSelectProject(null)}
        >
          <GridIcon />
          <span className={styles.itemLabel}>
            {t['com.affine.localmind.project-browser.allProjects']()}
          </span>
        </button>
        {error ? (
          <div className={styles.hint} role="alert">
            <span>{error}</span>{' '}
            <Button disabled={loading} onClick={onRetry}>
              {t['com.affine.localmind.project-files.retry']()}
            </Button>
          </div>
        ) : loading ? (
          <div className={styles.hint} role="status">
            <Loading size={14} />
          </div>
        ) : active.length ? (
          <ul
            className={styles.list}
            aria-label={t[
              'com.affine.localmind.project-browser.sidebar.projects'
            ]()}
          >
            {active.map(project => (
              <li key={project.id}>
                <button
                  type="button"
                  className={styles.item}
                  aria-current={project.id === selectedProjectId && !trash}
                  title={project.name}
                  onClick={() => onSelectProject(project.id)}
                >
                  <FolderIcon />
                  <span className={styles.itemLabel}>{project.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>
            {t['com.affine.localmind.workbench.projects.emptyTitle']()}
          </p>
        )}
        {archived.length ? (
          <details>
            <summary className={styles.hint}>
              {t['com.affine.localmind.project-browser.sidebar.archived']()} ·{' '}
              {archived.length}
            </summary>
            <ul className={styles.list}>
              {archived.map(project => (
                <li key={project.id} className={styles.archived}>
                  <FolderIcon />
                  <span className={styles.itemLabel} title={project.name}>
                    {project.name}
                  </span>
                  {onRestoreProject ? (
                    <button
                      type="button"
                      className={styles.restore}
                      onClick={() => onRestoreProject(project)}
                    >
                      {t['com.affine.localmind.project-files.restore']()}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className={styles.section}>
        <button
          type="button"
          className={styles.item}
          aria-current={trash}
          onClick={onOpenTrash}
        >
          <DeleteTemporarilyIcon />
          <span className={styles.itemLabel}>
            {t['com.affine.localmind.project-browser.sidebar.trash']()}
          </span>
        </button>
        {trash && !selectedProjectId ? (
          <p className={styles.hint} role="note">
            {t['com.affine.localmind.project-browser.sidebar.trashHint']()}
          </p>
        ) : null}
      </section>
    </nav>
  );
}
