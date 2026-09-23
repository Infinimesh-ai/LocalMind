import { useI18n } from '@affine/i18n';
import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

import * as style from './style.css';

export type SettingSidebarItemProps = {
  isActive: boolean;
  icon: ReactNode;
  title: string;
  key: string;
  testId?: string;
  beta?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>;

export const SettingSidebarItem = ({
  isActive,
  icon,
  title,
  testId,
  beta,
  ...props
}: SettingSidebarItemProps) => {
  const i18n = useI18n();
  return (
    <button
      {...props}
      type="button"
      aria-current={isActive ? 'page' : undefined}
      title={title}
      data-testid={testId}
      className={clsx(style.sidebarSelectItem, {
        active: isActive,
      })}
    >
      <span className={style.sidebarSelectItemIcon}>{icon}</span>
      <span className={style.sidebarSelectItemName}>{title}</span>
      {beta ? (
        <span className={style.sidebarSelectItemBeta}>
          {i18n['com.affine.ui.beta']()}
        </span>
      ) : null}
    </button>
  );
};
