import { Button, Loading, Modal } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  OfficeResourceAdapter,
  OfficeRevisionCompare,
} from './resource-adapter';
import { CenterState } from './resource-state';
import type { OfficeRevision } from './shared';
import { officeErrorMessage } from './shared';
import * as surfaceStyles from './surface.css';
type RevisionCompareChange = {
  entity: string;
  id: string;
  change: 'added' | 'removed' | 'modified';
  label: string;
  changedFields?: string[];
  before?: string;
  after?: string;
};

export function revisionCompareChanges(
  value: unknown
): RevisionCompareChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is RevisionCompareChange => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as Record<string, unknown>;
    return (
      typeof candidate.entity === 'string' &&
      typeof candidate.id === 'string' &&
      ['added', 'removed', 'modified'].includes(String(candidate.change)) &&
      typeof candidate.label === 'string'
    );
  });
}

export function OfficeRevisionHistory({
  open,
  adapter,
  selectedRevision,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  adapter: OfficeResourceAdapter;
  selectedRevision: OfficeRevision;
  onOpenChange: (open: boolean) => void;
  onSelect: (revision: OfficeRevision) => void;
}) {
  const i18n = useI18n();
  const [compare, setCompare] = useState<OfficeRevisionCompare | null>(null);
  const [comparing, setComparing] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<OfficeRevision[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    setCompare(null);
    setCompareError(null);
    setComparing(null);
    if (!open) return;
    setLoading(true);
    setError(null);
    void adapter
      .listRevisions(100)
      .then(value => {
        if (request === generation.current) setRevisions(value);
      })
      .catch(caught => {
        if (request === generation.current)
          setError(officeErrorMessage(caught, adapter.owner));
      })
      .finally(() => {
        if (request === generation.current) setLoading(false);
      });
    const generationState = generation;
    return () => {
      generationState.current++;
    };
  }, [adapter, open, retry, selectedRevision.id]);
  const compareWithSelected = useCallback(
    async (revision: OfficeRevision) => {
      if (revision.id === selectedRevision.id) return;
      const request = generation.current;
      setComparing(revision.id);
      setCompareError(null);
      setCompare(null);
      try {
        const result = await adapter.compareRevisions(
          revision.id,
          selectedRevision.id
        );
        if (request === generation.current) setCompare(result);
      } catch (caught) {
        if (request === generation.current)
          setCompareError(officeErrorMessage(caught, adapter.owner));
      } finally {
        if (request === generation.current) setComparing(null);
      }
    },
    [adapter, selectedRevision.id]
  );

  const originLabel = (origin: OfficeRevision['origin']) =>
    origin === 'ai'
      ? i18n['com.affine.office.revision-origin-ai']()
      : origin === 'import'
        ? i18n['com.affine.office.revision-origin-import']()
        : i18n['com.affine.office.revision-origin-user']();
  const operationLabel = (revision: OfficeRevision) => {
    const operation = String(
      revision.operationSummary.operation ??
        revision.operationSummary.type ??
        ''
    );
    if (operation.startsWith('office.document.'))
      return i18n['com.affine.office.revision-operation-document']();
    if (operation.startsWith('office.workbook.'))
      return i18n['com.affine.office.revision-operation-workbook']();
    if (operation.startsWith('office.presentation.'))
      return i18n['com.affine.office.revision-operation-presentation']();
    if (operation.startsWith('office.pdf.'))
      return i18n['com.affine.office.revision-operation-pdf']();
    return originLabel(revision.origin);
  };
  const summary = (compare?.summary ?? {}) as Record<string, number>;
  const changes = revisionCompareChanges(compare?.changes);
  return (
    <Modal
      open={open}
      title={i18n['com.affine.office.revision-history']()}
      width={680}
      onOpenChange={onOpenChange}
    >
      <div className={surfaceStyles.historyPanel}>
        <div className={surfaceStyles.historyHeader}>
          <span>{i18n['com.affine.office.immutable-office-revisions']()}</span>
          <span>
            {i18n['com.affine.office.comparing-version']({
              version: String(selectedRevision.sequence),
            })}
          </span>
        </div>
        <div className={surfaceStyles.historyList}>
          {loading ? (
            <CenterState>
              <Loading />
              <span>{i18n['com.affine.office.loading-revisions']()}</span>
            </CenterState>
          ) : error ? (
            <CenterState>
              <span>{error}</span>
              <Button onClick={() => setRetry(value => value + 1)}>
                {i18n['com.affine.localmind.directoryPermissions.retry']()}
              </Button>
            </CenterState>
          ) : revisions.length ? (
            revisions.map(revision => (
              <div className={surfaceStyles.historyRow} key={revision.id}>
                <button
                  type="button"
                  className={surfaceStyles.historyItem}
                  data-active={revision.id === selectedRevision.id}
                  onClick={() => onSelect(revision)}
                >
                  <span className={surfaceStyles.historySequence}>
                    v{revision.sequence}
                  </span>
                  <span className={surfaceStyles.historyMeta}>
                    <strong>{operationLabel(revision)}</strong>
                    <span>
                      {new Date(revision.createdAt).toLocaleString()} ·{' '}
                      {originLabel(revision.origin)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="plain"
                  disabled={!!comparing || revision.id === selectedRevision.id}
                  loading={comparing === revision.id}
                  onClick={() => void compareWithSelected(revision)}
                >
                  {i18n['com.affine.office.compare']()}{' '}
                </Button>
              </div>
            ))
          ) : (
            <CenterState>
              <span>
                {i18n['com.affine.office.no-revisions-are-available']()}
              </span>
            </CenterState>
          )}
        </div>
        {compareError ? (
          <div className={surfaceStyles.historyCompareError}>
            {compareError}
          </div>
        ) : null}
        {compare ? (
          <section className={surfaceStyles.historyCompare}>
            <div className={surfaceStyles.historyCompareTitle}>
              {i18n['com.affine.office.compare-versions']({
                before: String(compare.beforeRevision.sequence),
                after: String(compare.afterRevision.sequence),
              })}
            </div>
            <div className={surfaceStyles.historyCompareSummary}>
              <span>
                {summary.added ?? 0} {i18n['com.affine.office.added']()}
              </span>
              <span>
                {summary.removed ?? 0} {i18n['com.affine.office.removed']()}
              </span>
              <span>
                {summary.modified ?? 0} {i18n['com.affine.office.modified']()}
              </span>
              <span>
                {summary.unchanged ?? 0} {i18n['com.affine.office.unchanged']()}
              </span>
            </div>
            {changes.length ? (
              <div className={surfaceStyles.historyCompareChanges}>
                {changes.map(change => (
                  <div
                    className={surfaceStyles.historyCompareChange}
                    data-change={change.change}
                    key={`${change.entity}:${change.id}`}
                  >
                    <strong>{change.label}</strong>
                    <span>
                      {i18n[
                        change.change === 'added'
                          ? 'com.affine.office.added'
                          : change.change === 'removed'
                            ? 'com.affine.office.removed'
                            : 'com.affine.office.modified'
                      ]()}
                    </span>
                    {change.before ? <del>{change.before}</del> : null}
                    {change.after ? <ins>{change.after}</ins> : null}
                  </div>
                ))}
                {compare.truncated ? (
                  <span className={surfaceStyles.historyCompareTruncated}>
                    {i18n[
                      'com.affine.office.more-changes-exist-beyond-the-bounded-comparison-result'
                    ]()}{' '}
                  </span>
                ) : null}
              </div>
            ) : (
              <span className={surfaceStyles.historyCompareEmpty}>
                {i18n[
                  'com.affine.office.these-revisions-have-the-same-native-semantic-state'
                ]()}{' '}
              </span>
            )}
          </section>
        ) : null}
      </div>
    </Modal>
  );
}
