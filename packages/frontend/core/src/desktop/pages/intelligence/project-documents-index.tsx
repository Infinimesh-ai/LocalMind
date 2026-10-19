import { Button, Loading } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { ArrowRightSmallIcon, FolderIcon } from '@blocksuite/icons/rc';

import * as styles from './project-files.css';
import type { WorkbenchProject } from './types';

export function ProjectDocumentsIndex({
  projects,
  loading,
  error,
  onRetry,
  onSelectProject,
}: {
  projects: WorkbenchProject[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onSelectProject: (id: string) => void;
}) {
  const t = useI18n();
  return (
    <section
      className={styles.root}
      aria-label={t['com.affine.localmind.workbench.systemRail.docs']()}
    >
      <header className={styles.toolbar}>
        <h1 className={styles.heading}>
          {t['com.affine.localmind.workbench.systemRail.docs']()}
        </h1>
      </header>
      <div className={styles.fileScroll}>
        {error ? (
          <div className={styles.state} role="alert">
            <span>{error}</span>
            <Button disabled={loading} loading={loading} onClick={onRetry}>
              {t['com.affine.localmind.project-files.retry']()}
            </Button>
          </div>
        ) : loading ? (
          <div className={styles.state} role="status">
            <Loading />
          </div>
        ) : projects.length ? (
          <>
            <p className={styles.batchMessage}>
              {t['com.affine.localmind.aiContext.selectProject']()}
            </p>
            <ul className={styles.list}>
              {projects.map(project => (
                <li key={project.id} className={styles.row}>
                  <button
                    type="button"
                    className={styles.open}
                    onClick={() => onSelectProject(project.id)}
                  >
                    <FolderIcon />
                    <span className={styles.title} title={project.name}>
                      {project.name}
                    </span>
                    <ArrowRightSmallIcon />
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className={styles.state}>
            {t['com.affine.localmind.workbench.projects.emptyTitle']()}
          </p>
        )}
      </div>
    </section>
  );
}
