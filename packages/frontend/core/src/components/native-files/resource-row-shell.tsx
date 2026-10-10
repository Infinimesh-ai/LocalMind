import { Checkbox } from '@affine/component';
import { useLiveData } from '@toeverything/infra';
import { type ReactNode, useContext } from 'react';

import { DocExplorerContext } from '../explorer/context';
import * as explorerStyles from './resource-explorer.css';
import * as styles from './resource-metadata.css';

export function ResourceRowShell({
  id,
  title,
  icon,
  onOpen,
  actions,
  children,
  preview,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  onOpen: () => void;
  actions: ReactNode;
  children: ReactNode;
  preview?: ReactNode;
}) {
  const context = useContext(DocExplorerContext);
  const preference = useLiveData(context.displayPreference$);
  const selected = useLiveData(context.selectedDocIds$);
  return (
    <div
      className={styles.row}
      data-card={preference.view !== 'list'}
      data-selected={selected.includes(id)}
    >
      <div className={styles.header}>
        <Checkbox
          aria-label={title}
          checked={selected.includes(id)}
          onChange={(_event, checked) => {
            context.selectMode$?.next(true);
            context.selectedDocIds$.next(
              checked
                ? [...new Set([...context.selectedDocIds$.value, id])]
                : context.selectedDocIds$.value.filter(value => value !== id)
            );
          }}
        />
        <button className={explorerStyles.open} onClick={onOpen}>
          {preference.showDocIcon && icon}
          <span className={explorerStyles.name} title={title}>
            {title}
          </span>
        </button>
        <div className={styles.actions}>{actions}</div>
      </div>
      {preference.showDocPreview && preview && (
        <div className={styles.preview}>{preview}</div>
      )}
      {children}
    </div>
  );
}
