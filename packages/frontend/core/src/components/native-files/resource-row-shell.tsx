import { Checkbox } from '@affine/component';
import { useLiveData } from '@toeverything/infra';
import clsx from 'clsx';
import { type ReactNode, useContext } from 'react';

import { DocExplorerContext } from '../explorer/context';
import * as explorerStyles from './resource-explorer.css';
import { resourceListColumns } from './resource-list-layout';
import * as styles from './resource-metadata.css';
import { ResourceSelectionModeContext } from './resource-selection-context';

export function ResourceRowShell({
  id,
  title,
  icon,
  onOpen,
  actions,
  children,
  preview,
  tags,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  onOpen: () => void;
  actions: ReactNode;
  children: ReactNode;
  preview?: ReactNode;
  tags?: ReactNode;
}) {
  const context = useContext(DocExplorerContext);
  const preference = useLiveData(context.displayPreference$);
  const selected = useLiveData(context.selectedDocIds$);
  const selectMode = !!useLiveData(context.selectMode$);
  const explicitSelection = useContext(ResourceSelectionModeContext);
  const showSelection = !explicitSelection || selectMode;
  const toggle = (checked = !context.selectedDocIds$.value.includes(id)) => {
    context.selectMode$?.next(true);
    context.selectedDocIds$.next(
      checked
        ? [...new Set([...context.selectedDocIds$.value, id])]
        : context.selectedDocIds$.value.filter(value => value !== id)
    );
  };
  return (
    <div
      className={styles.row}
      style={
        preference.view === 'list'
          ? {
              gridTemplateColumns: resourceListColumns(
                preference,
                showSelection
              ).template,
            }
          : undefined
      }
      data-card={preference.view !== 'list'}
      data-selected={selected.includes(id)}
      data-show-icon={!!preference.showDocIcon}
      data-select-mode={selectMode}
    >
      <div className={styles.header}>
        {showSelection && (
          <div className={styles.selection}>
            <Checkbox
              aria-label={title}
              checked={selected.includes(id)}
              onChange={(_event, checked) => {
                toggle(checked);
              }}
            />
          </div>
        )}
        <div className={styles.titleCell}>
          <button
            className={clsx(explorerStyles.open, styles.title)}
            aria-label={title}
            onClick={() =>
              explicitSelection && selectMode ? toggle() : onOpen()
            }
          >
            {preference.showDocIcon && icon}
            <span className={explorerStyles.name} title={title}>
              {title}
            </span>
          </button>
          {preference.view === 'list' && tags}
        </div>
        {(!explicitSelection || !selectMode) && (
          <div className={styles.actions}>{actions}</div>
        )}
      </div>
      <div className={styles.details}>{children}</div>
      {preference.showDocPreview && preview && (
        <div className={styles.preview}>{preview}</div>
      )}
    </div>
  );
}
