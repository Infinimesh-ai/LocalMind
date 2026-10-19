import type { DeckText } from '@affine/core/modules/report-decks/i18n';
import type {
  DeckErrorCode,
  DeckProgress,
  DeckSourceRef,
  DeckSourceView,
  DeckStatus,
} from '@affine/core/modules/report-decks/types';
import {
  AllDocsIcon,
  ArrowDownSmallIcon,
  FileIcon,
  FolderIcon,
  PageIcon,
} from '@blocksuite/icons/rc';
import type { SelectHTMLAttributes } from 'react';

import * as styles from './report-decks.css';

export function DeckSelect({
  children,
  ...props
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'>) {
  return (
    <span className={styles.selectControl}>
      <select {...props} className={styles.select}>
        {children}
      </select>
      <ArrowDownSmallIcon className={styles.selectIcon} aria-hidden="true" />
    </span>
  );
}

/** Overall progress, weighted by how long each phase usually takes. */
export function deckProgressPercent(
  status: DeckStatus,
  progress: DeckProgress
) {
  if (status === 'ready') return 100;
  if (status !== 'generating') return 0;
  const share =
    progress.total > 0 ? Math.min(1, progress.done / progress.total) : 0;
  switch (progress.phase) {
    case 'sources':
      return Math.round(4 + share * 11);
    case 'extract':
      return Math.round(15 + share * 40);
    case 'compose':
      return Math.round(55 + share * 35);
    case 'render':
      return Math.round(90 + share * 8);
    case 'done':
      return 99;
    default:
      return 2;
  }
}

const STATUS_TONE: Record<DeckStatus, string | undefined> = {
  queued: 'signal',
  generating: 'signal',
  ready: 'success',
  failed: 'danger',
  cancelled: undefined,
};

export function DeckStatusChip({
  status,
  progress,
  t,
}: {
  status: DeckStatus;
  progress: DeckProgress;
  t: DeckText;
}) {
  const active = status === 'queued' || status === 'generating';
  return (
    <span className={styles.pill} data-tone={STATUS_TONE[status]} role="status">
      {active && <span className={styles.pulseDot} aria-hidden="true" />}
      {status === 'generating'
        ? progress.subphase
          ? t(`viewer.subphase.${progress.subphase}`)
          : t('status.generatingPercent', {
              percent: deckProgressPercent(status, progress),
            })
        : t(`status.${status}`)}
    </span>
  );
}

export function deckErrorMessage(code: DeckErrorCode | null, t: DeckText) {
  return t(`error.${code ?? 'internal'}`);
}

export function formatDeckTime(
  value: string | null | undefined,
  language: string
) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(language, {
    ...(sameYear ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function SourceKindIcon({ kind }: { kind: DeckSourceRef['kind'] }) {
  return (
    <span className={styles.sourceIcon} aria-hidden="true">
      {kind === 'project_all' ? (
        <AllDocsIcon />
      ) : kind === 'folder' ? (
        <FolderIcon />
      ) : kind === 'file' ? (
        <FileIcon />
      ) : (
        <PageIcon />
      )}
    </span>
  );
}

export function sourceKey(
  source: Pick<DeckSourceRef, 'scopeKind' | 'scopeId' | 'kind'> & {
    resourceId?: string | null;
  }
) {
  return [
    source.scopeKind,
    source.scopeId,
    source.kind,
    source.resourceId ?? '',
  ].join('\u0000');
}

export function dedupeSources(sources: DeckSourceRef[]) {
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = sourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Back from views (preflight / deck detail) to request refs. */
export function sourceViewToRef(source: DeckSourceView): DeckSourceRef {
  return {
    scopeKind: source.scopeKind,
    scopeId: source.scopeId,
    kind: source.kind,
    ...(source.kind === 'project_all' || !source.resourceId
      ? {}
      : { resourceId: source.resourceId }),
    ...(source.title ? { title: source.title.slice(0, 512) } : {}),
  };
}

/** Distinct scope labels, in source order. */
export function sourceScopeLabels(
  sources: Pick<DeckSourceView, 'scopeKind' | 'scopeId' | 'scopeLabel'>[],
  t: DeckText
) {
  const labels = new Map<string, string>();
  for (const source of sources) {
    const key = `${source.scopeKind}:${source.scopeId}`;
    if (!labels.has(key))
      labels.set(
        key,
        source.scopeLabel ||
          t(
            source.scopeKind === 'project' ? 'scope.project' : 'scope.workspace'
          )
      );
  }
  return [...labels.values()];
}

export function formatChars(chars: number, t: DeckText, language?: string) {
  const count =
    chars >= 10000
      ? new Intl.NumberFormat(language, {
          notation: 'compact',
          maximumFractionDigits: 1,
        }).format(chars)
      : String(chars);
  return t('source.chars', { count });
}

export function EmptyGlyph({ children }: { children: React.ReactNode }) {
  return (
    <span className={styles.emptyGlyph} aria-hidden="true">
      {children}
    </span>
  );
}
