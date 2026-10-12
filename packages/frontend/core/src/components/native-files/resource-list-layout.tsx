import { useI18n } from '@affine/i18n';
import { useLiveData } from '@toeverything/infra';
import { type ReactNode, useContext } from 'react';

import { DocExplorerContext } from '../explorer/context';
import { quickActions } from '../explorer/quick-actions.constants';
import { defaultResourceProperties } from '../explorer/resource-preferences';
import type { ExplorerDisplayPreference } from '../explorer/types';
import * as styles from './resource-metadata.css';
import { ResourceSelectionModeContext } from './resource-selection-context';

export function resourceListColumns(
  preference: ExplorerDisplayPreference,
  selectMode = false
) {
  const properties = preference.resourceProperties ?? defaultResourceProperties;
  const titleMinWidth = properties.tags ? 200 : 120;
  const columns = [
    ...(selectMode ? [{ key: 'selection', width: '20px', min: 20 }] : []),
    {
      key: 'title',
      width: `minmax(${titleMinWidth}px, 1fr)`,
      min: titleMinWidth,
    },
  ];
  for (const key of ['created', 'updated'] as const) {
    if (properties[key]) {
      columns.push(
        {
          key: `${key}By`,
          width: 'var(--resource-person-width, 64px)',
          min: 64,
        },
        { key: `${key}At`, width: '108px', min: 108 }
      );
    }
  }
  if (properties.documentType && !preference.showDocIcon) {
    columns.push({ key: 'documentType', width: '64px', min: 64 });
  }
  const actionCount =
    Number(!!preference.showMoreOperation) +
    quickActions.filter(
      action => action.key !== 'quickSelect' && preference[action.key]
    ).length;
  const actionWidth = Math.max(24, actionCount * 28 - 4);
  if (!selectMode)
    columns.push({
      key: 'actions',
      width: `${actionWidth}px`,
      min: actionWidth,
    });
  const personCount = Number(properties.created) + Number(properties.updated);
  const fixedWidth =
    columns.reduce((sum, column) => sum + column.min, 0) +
    (columns.length - 1) * 8 +
    48 -
    personCount * 64;
  return {
    template:
      columns.map(column => `[${column.key}] ${column.width}`).join(' ') +
      ' [end]',
    minWidth: `calc(${fixedWidth}px + ${personCount} * var(--resource-person-width, 64px))`,
  };
}

export function ResourceListLayout({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const preference = useLiveData(
    useContext(DocExplorerContext).displayPreference$
  );
  const t = useI18n();
  const selectMode = !!useLiveData(useContext(DocExplorerContext).selectMode$);
  const explicitSelection = useContext(ResourceSelectionModeContext);
  if (!enabled) return children;
  const properties = preference.resourceProperties ?? defaultResourceProperties;
  const columns = resourceListColumns(
    preference,
    !explicitSelection || selectMode
  );
  return (
    <div className={styles.listViewport}>
      <div
        className={styles.listSurface}
        style={{ minWidth: columns.minWidth }}
      >
        <div className={styles.columnHeaderInset}>
          <div
            className={styles.columnHeader}
            style={{ gridTemplateColumns: columns.template }}
          >
            <span
              style={{
                gridColumn: 'title',
                paddingLeft: preference.showDocIcon ? 28 : 0,
              }}
            >
              {t['com.affine.localmind.resource-display.field.title']()}
            </span>
            {properties.created && (
              <>
                <span
                  className={styles.columnHeaderField}
                  style={{ gridColumn: 'createdBy' }}
                >
                  {t['com.affine.page-properties.property.createdBy']()}
                </span>
                <span
                  className={styles.columnHeaderField}
                  style={{ gridColumn: 'createdAt' }}
                >
                  {t['Created']()}
                </span>
              </>
            )}
            {properties.updated && (
              <>
                <span
                  className={styles.columnHeaderField}
                  style={{ gridColumn: 'updatedBy' }}
                >
                  {t['com.affine.page-properties.property.updatedBy']()}
                </span>
                <span
                  className={styles.columnHeaderField}
                  style={{ gridColumn: 'updatedAt' }}
                >
                  {t['Updated']()}
                </span>
              </>
            )}
            {properties.documentType && !preference.showDocIcon && (
              <span
                className={styles.columnHeaderField}
                style={{ gridColumn: 'documentType' }}
              >
                {t[
                  'com.affine.localmind.resource-display.property.documentType'
                ]()}
              </span>
            )}
          </div>
        </div>
        <div className={styles.listBody}>{children}</div>
      </div>
    </div>
  );
}
