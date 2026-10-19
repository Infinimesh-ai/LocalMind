import { useWorkspaceName } from '@affine/core/components/hooks/use-workspace-info';
import { useLocalmindShell } from '@affine/core/components/localmind-theme';
import { WorkspaceService } from '@affine/core/modules/workspace';
import { UNTITLED_WORKSPACE_NAME } from '@affine/env/constant';
import { useService } from '@toeverything/infra';
import type { ReactNode } from 'react';

import * as styles from './page-hero.css';

/**
 * Project hub style page title (mono path, large title, subtitle) for the
 * workspace explorer pages. Renders nothing unless the LocalMind shell is on.
 */
export const ExplorerPageHero = ({
  section,
  title,
  subtitle,
  actions,
}: {
  section: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) => {
  const shell = useLocalmindShell();
  const { workspace } = useService(WorkspaceService);
  const name = useWorkspaceName(workspace.meta) ?? UNTITLED_WORKSPACE_NAME;
  if (!shell) return null;
  return (
    <header className={styles.hero} data-testid="explorer-page-hero">
      <div className={styles.path}>
        {name} / {section}
      </div>
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </header>
  );
};
