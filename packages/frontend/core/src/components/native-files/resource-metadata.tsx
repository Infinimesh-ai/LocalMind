import { Avatar, Button, Tooltip } from '@affine/component';
import { useCurrentServerService } from '@affine/core/components/providers/current-server-scope';
import { PublicUserService } from '@affine/core/modules/cloud/services/public-user';
import type {
  ResourceDisplayProperties,
  WorkspaceDocumentType,
} from '@affine/graphql';
import { useI18n, useTranslation } from '@affine/i18n';
import { useLiveData } from '@toeverything/infra';
import { type ReactNode, useEffect } from 'react';

import { TagItem } from '../tags/tag';
import type { TagLike } from '../tags/types';
import * as styles from './resource-metadata.css';

export function ResourceActor({
  id,
  actor = 'user',
}: {
  id?: string | null;
  actor?: string;
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
    <span className={styles.actor}>
      <Avatar
        size={20}
        name={name}
        url={user.removed ? undefined : (user.avatar ?? undefined)}
      />
      <span className={styles.name} title={name}>
        {name}
      </span>
    </span>
  );
}

export function ResourceTime({ value }: { value: number | null }) {
  const t = useI18n();
  const { i18n } = useTranslation();
  if (value === null)
    return (
      <span>
        {t['com.affine.page-properties.property-user-avatar-no-record']()}
      </span>
    );
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
        {new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(value)}
      </time>
    </Tooltip>
  );
}

export function ResourceTags({ tags }: { tags: TagLike[] }) {
  const t = useI18n();
  return tags.length ? (
    <div className={styles.tags}>
      {tags.slice(0, 2).map(tag => (
        <TagItem key={tag.id} tag={tag} mode="inline-tag" />
      ))}
      {tags.length > 2 && (
        <Tooltip
          content={tags
            .slice(2)
            .map(tag => tag.name)
            .join(', ')}
        >
          <span tabIndex={0}>+{tags.length - 2}</span>
        </Tooltip>
      )}
    </div>
  ) : (
    <span>{t['com.affine.localmind.resource-display.noTags']()}</span>
  );
}

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
  return (
    <div className={styles.root}>
      {properties.tags && (
        <div
          className={styles.group}
          aria-label={t[
            'com.affine.localmind.resource-display.property.tags'
          ]()}
        >
          {documentType === 'folder'
            ? t['com.affine.localmind.page-tree.notApplicable']()
            : (tagEditor ?? <ResourceTags tags={tags} />)}
        </div>
      )}
      {properties.created && (
        <div
          className={styles.group}
          aria-label={t['com.affine.localmind.resource-display.created.tip']()}
        >
          <ResourceActor id={createdBy} />
          <ResourceTime value={createdAt} />
        </div>
      )}
      {properties.updated && (
        <div
          className={styles.group}
          aria-label={t['com.affine.localmind.resource-display.updated.tip']()}
        >
          <ResourceActor id={updatedBy} actor={updateActor} />
          <ResourceTime value={updatedAt} />
        </div>
      )}
      {properties.documentType && (
        <div
          className={styles.group}
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
