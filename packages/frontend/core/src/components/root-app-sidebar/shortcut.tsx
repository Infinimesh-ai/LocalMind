import { Tooltip } from '@affine/component';
import { WorkbenchLink } from '@affine/core/modules/workbench';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import * as styles from './index.css';

export function SidebarShortcutLink({
  label,
  icon,
  to,
  active,
  global,
  testId,
}: {
  label: string;
  icon: ReactNode;
  to: string;
  active?: boolean;
  global?: boolean;
  testId?: string;
}) {
  const LinkComponent = global ? Link : WorkbenchLink;
  return (
    <Tooltip content={label}>
      <LinkComponent
        to={to}
        className={styles.shortcut}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        data-testid={testId}
      >
        {icon}
      </LinkComponent>
    </Tooltip>
  );
}
