import { Button, Divider, MenuItem, MenuSub, Tooltip } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { DoneIcon } from '@blocksuite/icons/rc';

import {
  defaultResourceProperties,
  resourceGroupFields,
  resourceSortFields,
} from '../resource-preferences';
import type { ExplorerDisplayPreference } from '../types';
import { QuickActionsConfig } from './quick-actions';
import * as styles from './styles.css';

export function ResourceDisplayMenu({
  displayPreference: preference,
  onDisplayPreferenceChange: change,
}: {
  displayPreference: ExplorerDisplayPreference;
  onDisplayPreferenceChange: (preference: ExplorerDisplayPreference) => void;
}) {
  const t = useI18n();
  const properties = preference.resourceProperties ?? defaultResourceProperties;
  const field =
    resourceSortFields.find(key => key === preference.orderBy?.key) ??
    'updatedAt';
  const desc = preference.orderBy?.desc ?? true;
  const direction = (descending: boolean) =>
    t[
      `com.affine.localmind.resource-display.sort.${field}.${descending ? 'desc' : 'asc'}`
    ]();
  return (
    <div className={styles.displayMenuContainer}>
      <MenuSub
        items={
          <>
            <MenuItem
              role="menuitemradio"
              aria-checked={!preference.groupBy}
              selected={!preference.groupBy}
              onSelect={() => change({ ...preference, groupBy: undefined })}
            >
              {t['com.affine.localmind.resource-display.noGroup']()}
            </MenuItem>
            {resourceGroupFields.map(key => (
              <MenuItem
                key={key}
                role="menuitemradio"
                aria-checked={preference.groupBy?.key === key}
                selected={preference.groupBy?.key === key}
                onSelect={() =>
                  change({ ...preference, groupBy: { type: 'system', key } })
                }
              >
                {t[`com.affine.localmind.resource-display.field.${key}`]()}
              </MenuItem>
            ))}
          </>
        }
      >
        <span>
          {t['com.affine.explorer.display-menu.grouping']()} ·{' '}
          {preference.groupBy
            ? t[
                `com.affine.localmind.resource-display.field.${preference.groupBy.key}`
              ]()
            : t['com.affine.localmind.resource-display.noGroup']()}
        </span>
      </MenuSub>
      <MenuSub
        items={
          <>
            <div
              role="group"
              aria-label={t[
                'com.affine.localmind.resource-display.sortField'
              ]()}
            >
              {resourceSortFields.map(key => (
                <MenuItem
                  key={key}
                  role="menuitemradio"
                  aria-checked={field === key}
                  selected={field === key}
                  onSelect={event => {
                    event.preventDefault();
                    change({
                      ...preference,
                      orderBy: {
                        type: 'system',
                        key,
                        desc:
                          key === field
                            ? desc
                            : key === 'createdAt' || key === 'updatedAt',
                      },
                    });
                  }}
                >
                  {t[`com.affine.localmind.resource-display.field.${key}`]()}
                </MenuItem>
              ))}
            </div>
            <Divider />
            <div
              role="group"
              aria-label={t[
                'com.affine.localmind.resource-display.sortDirection'
              ]()}
            >
              {[false, true].map(value => (
                <MenuItem
                  key={String(value)}
                  role="menuitemradio"
                  aria-checked={desc === value}
                  selected={desc === value}
                  onSelect={event => {
                    event.preventDefault();
                    change({
                      ...preference,
                      orderBy: { type: 'system', key: field, desc: value },
                    });
                  }}
                >
                  {direction(value)}
                </MenuItem>
              ))}
            </div>
          </>
        }
      >
        <span>
          {t[`com.affine.localmind.resource-display.field.${field}`]()} ·{' '}
          {direction(desc)}
        </span>
      </MenuSub>
      <Divider />
      <div
        role="group"
        aria-label={t['com.affine.all-docs.display.properties']()}
      >
        {(['tags', 'created', 'updated', 'documentType'] as const).map(key => (
          <Tooltip
            key={key}
            content={
              key === 'created' || key === 'updated'
                ? t[`com.affine.localmind.resource-display.${key}.tip`]()
                : undefined
            }
          >
            <Button
              aria-pressed={properties[key]}
              prefix={properties[key] ? <DoneIcon /> : undefined}
              onClick={() =>
                change({
                  ...preference,
                  resourceProperties: {
                    ...properties,
                    [key]: !properties[key],
                  },
                })
              }
            >
              {t[`com.affine.localmind.resource-display.property.${key}`]()}
            </Button>
          </Tooltip>
        ))}
      </div>
      <Divider />
      <Button
        aria-pressed={preference.showDocIcon ?? false}
        onClick={() =>
          change({ ...preference, showDocIcon: !preference.showDocIcon })
        }
      >
        {t['com.affine.all-docs.display.list-view.icon']()}
      </Button>
      <Button
        aria-pressed={preference.showDocPreview ?? false}
        onClick={() =>
          change({ ...preference, showDocPreview: !preference.showDocPreview })
        }
      >
        {t['com.affine.all-docs.display.list-view.body']()}
      </Button>
      <QuickActionsConfig
        displayPreference={preference}
        onDisplayPreferenceChange={change}
      />
    </div>
  );
}
