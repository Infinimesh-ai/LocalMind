import { Avatar, Button, type ButtonProps, Tooltip } from '@affine/component';
import { useCurrentServerService } from '@affine/core/components/providers/current-server-scope';
import { PublicUserService } from '@affine/core/modules/cloud/services/public-user';
import type {
  ResourceDisplayProperties,
  WorkspaceDocumentType,
} from '@affine/graphql';
import { useI18n, useTranslation } from '@affine/i18n';
import { PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData } from '@toeverything/infra';
import { forwardRef, type ReactNode, useContext, useEffect } from 'react';

import { DocExplorerContext } from '../explorer/context';
import { TagItem } from '../tags/tag';
import type { TagLike } from '../tags/types';
import * as styles from './resource-metadata.css';

export function ResourceActor({
  id,
  actor = 'user',
  compact = false,
}: {
  id?: string | null;
  actor?: string;
  compact?: boolean;
}) {
  const service = useCurrentServerService()?.scope.get(PublicUserService);
  const t = useI18n();
  const user = useLiveData(id ? service?.publicUser$(id) : undefined);
  const loading = useLiveData(id ? service?.isLoading$(id) : undefined);
  const error = useLiveData(id ? service?.error$(id) : undefined);
  useEffect(() => {
    if (id) service?.revalidate(id);
  }, [id, service]);
  if (actor === 'system')
    return <span>{t['com.affine.localmind.resource-display.system']()}</span>;
  if (!service && id)
    return (
      <span>{t['com.affine.localmind.resource-display.restrictedUser']()}</span>
    );
  if (!id)
    return (
      <span>
        {t['com.affine.page-properties.property-user-avatar-no-record']()}
      </span>
    );
  if (error)
    return (
      <Button size="default" onClick={() => service?.revalidate(id)}>
        {t['com.affine.error.retry']()}
      </Button>
    );
  if (loading || !user) return <span aria-busy="true">{t['Loading']()}</span>;
  const name = user.removed
    ? t['Unknown User']()
    : user.name || t['com.affine.localmind.resource-display.restrictedUser']();
  return (
    <span className={styles.actor} data-compact={compact}>
      <Avatar
        size={compact ? 16 : 20}
        name={name}
        url={user.removed ? undefined : (user.avatar ?? undefined)}
      />
      <span className={styles.name} title={name}>
        {name}
      </span>
    </span>
  );
}

export function ResourceTime({
  value,
  compact = false,
}: {
  value: number | null;
  compact?: boolean;
}) {
  const t = useI18n();
  const { i18n } = useTranslation();
  if (value === null)
    return (
      <span>
        {t['com.affine.page-properties.property-user-avatar-no-record']()}
      </span>
    );
  const date = new Date(value);
  const compactDate = `${date.getFullYear() === new Date().getFullYear() ? '' : `${date.getFullYear()}-`}${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const full = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'full',
    timeStyle: 'long',
  }).format(value);
  return (
    <Tooltip content={full}>
      <time
        tabIndex={0}
        className={styles.time}
        dateTime={new Date(value).toISOString()}
        aria-label={full}
      >
        {compact
          ? compactDate
          : new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(value)}
      </time>
    </Tooltip>
  );
}

export function ResourceTags({
  tags,
  hideEmpty = false,
  limit = 2,
}: {
  tags: TagLike[];
  hideEmpty?: boolean;
  limit?: number;
}) {
  const t = useI18n();
  return tags.length ? (
    <div className={styles.tags}>
      {tags.slice(0, limit).map(tag => (
        <TagItem
          key={tag.id}
          tag={tag}
          mode="inline-tag"
          maxWidth={limit === 1 ? (tags.length > 1 ? 64 : 96) : undefined}
        />
      ))}
      {tags.length > limit && (
        <Tooltip
          content={tags
            .slice(limit)
            .map(tag => tag.name)
            .join(', ')}
        >
          <span tabIndex={0} style={{ flexShrink: 0 }}>
            +{tags.length - limit}
          </span>
        </Tooltip>
      )}
    </div>
  ) : hideEmpty ? null : (
    <span>{t['com.affine.localmind.resource-display.noTags']()}</span>
  );
}

export const ResourceAddTagButton = forwardRef<HTMLButtonElement, ButtonProps>(
  function ResourceAddTagButton(props, ref) {
    const t = useI18n();
    return (
      <Button
        {...props}
        ref={ref}
        variant="secondary"
        size="default"
        prefix={<PlusIcon />}
      >
        {t['com.affine.header.option.add-tag']()}
      </Button>
    );
  }
);

export function ResourceMetadata({
  properties,
  tags,
  tagEditor,
  createdAt,
  createdBy,
  updatedAt,
  updatedBy,
  updateActor,
  documentType,
  mimeType,
}: {
  properties: ResourceDisplayProperties;
  tags: TagLike[];
  tagEditor?: ReactNode;
  createdAt: number | null;
  createdBy?: string | null;
  updatedAt: number | null;
  updatedBy?: string | null;
  updateActor?: string;
  documentType: WorkspaceDocumentType;
  mimeType?: string;
}) {
  const t = useI18n();
  const preference = useLiveData(
    useContext(DocExplorerContext).displayPreference$
  );
  const compact = preference?.view === 'list';
  const showType =
    properties.documentType && (!compact || !preference.showDocIcon);
  const showTags = properties.tags && !compact;
  if (
    compact &&
    !properties.created &&
    !properties.updated &&
    !showType &&
    !showTags
  )
    return null;
  return (
    <div className={styles.root} data-compact={compact}>
      {showTags && (
        <div
          className={styles.group}
          aria-label={t[
            'com.affine.localmind.resource-display.property.tags'
          ]()}
        >
          {documentType === 'folder'
            ? t['com.affine.localmind.page-tree.notApplicable']()
            : (tagEditor ?? <ResourceTags tags={tags} hideEmpty={compact} />)}
        </div>
      )}
      {properties.created && (
        <div
          className={styles.group}
          aria-label={t['com.affine.localmind.resource-display.created.tip']()}
        >
          <div
            className={styles.cell}
            style={compact ? { gridColumn: 'createdBy' } : undefined}
          >
            <ResourceActor id={createdBy} compact={compact} />
          </div>
          <div
            className={styles.cell}
            style={compact ? { gridColumn: 'createdAt' } : undefined}
          >
            <ResourceTime value={createdAt} compact={compact} />
          </div>
        </div>
      )}
      {properties.updated && (
        <div
          className={styles.group}
          aria-label={t['com.affine.localmind.resource-display.updated.tip']()}
        >
          <div
            className={styles.cell}
            style={compact ? { gridColumn: 'updatedBy' } : undefined}
          >
            <ResourceActor
              id={updatedBy}
              actor={updateActor}
              compact={compact}
            />
          </div>
          <div
            className={styles.cell}
            style={compact ? { gridColumn: 'updatedAt' } : undefined}
          >
            <ResourceTime value={updatedAt} compact={compact} />
          </div>
        </div>
      )}
      {showType && (
        <div
          className={styles.cell}
          style={compact ? { gridColumn: 'documentType' } : undefined}
          aria-label={t[
            'com.affine.localmind.resource-display.property.documentType'
          ]()}
        >
          {documentType === 'other' && mimeType === 'application/zip'
            ? 'ZIP'
            : t[`com.affine.localmind.resource-display.type.${documentType}`]()}
        </div>
      )}
    </div>
  );
}

export function ResourceInlineTags({
  empty,
  children,
}: {
  empty: boolean;
  children: ReactNode;
}) {
  const preference = useLiveData(
    useContext(DocExplorerContext).displayPreference$
  );
  const t = useI18n();
  if (!preference.resourceProperties?.tags || preference.view !== 'list')
    return null;
  return (
    <div
      className={styles.inlineTags}
      data-empty={empty}
      aria-label={t['com.affine.localmind.resource-display.property.tags']()}
    >
      {children}
    </div>
  );
}
