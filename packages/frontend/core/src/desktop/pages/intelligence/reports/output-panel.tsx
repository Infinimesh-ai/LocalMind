import { Button, Modal, useConfirmModal } from '@affine/component';
import type {
  ProjectReportApi,
  ReportCommand,
  ReportCommandResult,
  ReportState,
} from '@affine/core/modules/project-reports/contracts';
import { useReportCollection } from '@affine/core/modules/project-reports/hooks';
import { paginateReport } from '@affine/core/modules/project-reports/presentation';
import {
  projectReportAudience,
  type ReportAudience,
  reportAudienceAssetBindings,
  type ReportDocument,
} from '@localmind/office/report';
import { useEffect, useMemo, useState } from 'react';

import { MemberRecipients } from './configuration';
import { SelectField, TextField, useReportText } from './fields';
import { ReportSlide } from './render';
import * as styles from './reports.css';

export function ReportOutputPanel({
  state,
  document,
  pending,
  execute,
  api,
}: {
  state: ReportState;
  document: ReportDocument;
  pending: boolean;
  execute: (command: ReportCommand) => Promise<ReportCommandResult>;
  api: ProjectReportApi;
}) {
  const t = useReportText();
  const exports = useReportCollection(
    api,
    state.report?.projectId ?? '',
    state.report?.id ?? '',
    'exports',
    state.exports,
    state.nextCursors?.exports
  );
  const shares = useReportCollection(
    api,
    state.report?.projectId ?? '',
    state.report?.id ?? '',
    'shares',
    state.shares,
    state.nextCursors?.shares
  );
  const revisions = useReportCollection(
    api,
    state.report?.projectId ?? '',
    state.report?.id ?? '',
    'revisions',
    state.revisions,
    state.nextCursors?.revisions
  );
  const { openConfirmModal } = useConfirmModal();
  const [revision, setRevision] = useState('');
  const [format, setFormat] = useState<'pdf' | 'pptx' | 'offline'>('pdf');
  const [includeNotes, setNotes] = useState(false);
  const [includeSources, setSources] = useState(false);
  const [selected, setSelected] = useState(
    document.chapters
      .filter(chapter => !chapter.hidden)
      .map(chapter => chapter.id)
  );
  const [mode, setMode] = useState<'accounts' | 'link'>('accounts');
  const [accounts, setAccounts] = useState<string[]>([]);
  const [accountEmails, setAccountEmails] = useState('');
  const [password, setPassword] = useState('');
  const [expires, setExpires] = useState('');
  const [allowDownload, setDownload] = useState(false);
  const [url, setUrl] = useState('');
  const [feedback, setFeedback] = useState('');
  const [targetDocument, setTargetDocument] = useState<ReportDocument>();
  const [preview, setPreview] = useState(false);
  const [targetAssets, setTargetAssets] = useState<Record<string, string>>({});
  const [updateShare, setUpdateShare] = useState<{
    id: string;
    version: number;
  }>();
  const [shareAudience, setShareAudience] = useState<ReportAudience>();
  const [resourceId, setResourceId] = useState('');
  const [updating, setUpdating] = useState(false);
  const target =
    revision ||
    state.report?.latestFinalRevisionId ||
    (state.revision?.kind === 'preview' ? state.revision.id : '');
  const targetProjectId = state.report?.projectId;
  const targetReportId = state.report?.id;
  useEffect(() => {
    setTargetDocument(undefined);
    if (!target || !targetProjectId || !targetReportId) return;
    const controller = new AbortController();
    api
      .query(
        {
          projectId: targetProjectId,
          reportId: targetReportId,
          revisionId: target,
        },
        controller.signal
      )
      .then(result => {
        if (!controller.signal.aborted && result.document) {
          setTargetDocument(result.document);
          setTargetAssets(result.assetUrls ?? {});
          setSelected(
            shareAudience?.chapterIds ??
              result.document.chapters
                .filter(chapter => !chapter.hidden)
                .map(chapter => chapter.id)
          );
        }
      })
      .catch(() => setFeedback(t('snapshotUnavailable')));
    return () => controller.abort();
  }, [api, target, targetProjectId, targetReportId, shareAudience, t]);
  const snapshot = targetDocument ?? document;
  const previewPages = useMemo(
    () =>
      targetDocument && selected.length
        ? paginateReport(
            projectReportAudience(targetDocument, {
              kind: 'external',
              chapterIds: selected,
              includeNotes: false,
              includeSources,
            })
          )
        : [],
    [targetDocument, selected, includeSources]
  );
  const previewAssets = useMemo(
    () =>
      targetDocument
        ? Object.fromEntries(
            reportAudienceAssetBindings(targetDocument, {
              kind: 'external',
              chapterIds: selected,
              includeNotes: false,
              includeSources,
            })
              .map(({ publicId, asset }) => [publicId, targetAssets[asset.id]])
              .filter((entry): entry is [string, string] => !!entry[1])
          )
        : {},
    [targetDocument, selected, includeSources, targetAssets]
  );
  const audience: ReportAudience = {
    kind: 'internal',
    chapterIds: selected,
    includeNotes,
    includeSources,
  };
  const final =
    revisions.items.find(item => item.id === target)?.kind === 'final' ||
    target === state.report?.latestFinalRevisionId;
  const run = (command: ReportCommand) => {
    void execute(command)
      .then(result => {
        if (result.shares?.[0]?.url) setUrl(result.shares[0].url);
        setFeedback(t('operationComplete'));
      })
      .catch(() => {});
  };
  return (
    <div className={styles.stack}>
      <h2>{t('outputs')}</h2>
      <SelectField
        label={t('fixedVersion')}
        value={target}
        options={[
          { value: '', label: t('chooseVersion') },
          ...revisions.items
            .filter(item => item.kind === 'final' || item.kind === 'preview')
            .map(item => ({
              value: item.id,
              label: `v${item.sequence} · ${t(item.kind)}`,
            })),
        ]}
        onChange={value => {
          setUpdateShare(undefined);
          setShareAudience(undefined);
          setRevision(value);
        }}
      />
      {revisions.hasMore && (
        <Button
          disabled={revisions.pending}
          onClick={() => void revisions.loadMore().catch(() => {})}
        >
          {t('moreVersions')}
        </Button>
      )}
      {!target && (
        <Button
          disabled={pending || !state.capabilities?.canEdit}
          onClick={() =>
            void execute({
              operation: 'save',
              document,
              kind: 'preview',
              reason: 'export_preview',
            })
              .then(result =>
                setRevision(result.revisionId ?? result.revision?.id ?? '')
              )
              .catch(() => {})
          }
        >
          {t('createSnapshot')}
        </Button>
      )}
      <fieldset>
        <legend>{t('visibleChapters')}</legend>
        {snapshot.chapters
          .filter(chapter => !chapter.hidden)
          .map(chapter => (
            <label className={styles.row} key={chapter.id}>
              <input
                type="checkbox"
                checked={selected.includes(chapter.id)}
                onChange={event =>
                  setSelected(
                    event.target.checked
                      ? [...selected, chapter.id]
                      : selected.filter(id => id !== chapter.id)
                  )
                }
              />
              {chapter.title}
            </label>
          ))}
      </fieldset>
      <SelectField
        label={t('format')}
        value={format}
        options={(['pdf', 'pptx', 'offline'] as const).map(value => ({
          value,
          label: t(value),
        }))}
        onChange={setFormat}
      />
      <label>
        <input
          type="checkbox"
          checked={includeNotes}
          onChange={event => setNotes(event.target.checked)}
        />{' '}
        {t('includeNotes')}
      </label>
      <label>
        <input
          type="checkbox"
          checked={includeSources}
          onChange={event => setSources(event.target.checked)}
        />{' '}
        {t('includeSources')}
      </label>
      <Button
        disabled={pending || !targetDocument || !selected.length}
        onClick={() =>
          run({ operation: 'export', revisionId: target, format, audience })
        }
      >
        {t('generateExport')}
      </Button>
      <p className={styles.muted}>{t('offlineBoundary')}</p>
      <SelectField
        label={t('updateExportTarget')}
        value={resourceId}
        options={[
          { value: '', label: t('choose') },
          ...(state.resources ?? [])
            .filter(
              resource =>
                resource.kind !== 'folder' && resource.kind !== 'document'
            )
            .map(resource => ({ value: resource.id, label: resource.title })),
        ]}
        onChange={setResourceId}
      />
      {exports.items.map(item => (
        <article key={item.id}>
          <strong>
            {t(item.format)} · {t(item.status)}
          </strong>
          {item.warnings?.map(warning => (
            <p key={warning}>{warning}</p>
          ))}
          <div className={styles.row}>
            {item.downloadUrl && (
              <Button
                onClick={() =>
                  void api
                    .download(
                      item.downloadUrl ?? '',
                      `${document.title}.${item.format === 'offline' ? 'zip' : item.format}`
                    )
                    .catch(() => setFeedback(t('downloadFailed')))
                }
              >
                {t('download')}
              </Button>
            )}
            <Button
              disabled={
                pending ||
                !state.capabilities?.canEdit ||
                (item.status !== 'completed' && item.status !== 'succeeded') ||
                !!item.resourceId
              }
              onClick={() =>
                run({ operation: 'export.save', exportId: item.id })
              }
            >
              {t(item.resourceId ? 'savedToProject' : 'saveToProject')}
            </Button>
            <Button
              disabled={
                pending ||
                !state.capabilities?.canEdit ||
                updating ||
                !resourceId ||
                !api.updateExportResource ||
                !state.report ||
                !['completed', 'succeeded'].includes(item.status)
              }
              onClick={() =>
                openConfirmModal({
                  title: t('updateExistingExport'),
                  description: t('updateExistingExportDescription'),
                  confirmText: t('update'),
                  onConfirm: async () => {
                    if (!api.updateExportResource || !state.report) return;
                    setUpdating(true);
                    try {
                      await api.updateExportResource(
                        {
                          projectId: state.report.projectId,
                          reportId: state.report.id,
                          requestKey: crypto.randomUUID(),
                          expectedVersion: state.report.version,
                          command: {
                            operation: 'export.save',
                            exportId: item.id,
                          },
                        },
                        resourceId
                      );
                      setFeedback(t('operationComplete'));
                    } catch {
                      setFeedback(t('updateExportFailed'));
                    } finally {
                      setUpdating(false);
                    }
                  },
                })
              }
            >
              {t('updateExistingExport')}
            </Button>
          </div>
        </article>
      ))}
      {exports.hasMore && (
        <Button
          disabled={exports.pending}
          onClick={() => void exports.loadMore().catch(() => {})}
        >
          {t('moreExports')}
        </Button>
      )}
      <hr />
      <h2>{t('share')}</h2>
      <p className={styles.muted}>{t('shareExplanation')}</p>
      <SelectField
        label={t('accessMode')}
        value={mode}
        options={[
          { value: 'accounts', label: t('specificAccounts') },
          ...(state.capabilities?.allowAnonymous
            ? [{ value: 'link' as const, label: t('passwordLink') }]
            : []),
        ]}
        onChange={setMode}
      />
      {mode === 'accounts' ? (
        <>
          <MemberRecipients
            value={accounts}
            members={state.members ?? []}
            onChange={setAccounts}
            disabled={pending || !state.capabilities?.canShare}
          />
          <TextField
            label={t('registeredAccountEmails')}
            multiline
            value={accountEmails}
            onChange={setAccountEmails}
            disabled={pending || !state.capabilities?.canShare}
          />
        </>
      ) : (
        <TextField
          label={t('password')}
          type="password"
          value={password}
          onChange={setPassword}
        />
      )}
      <TextField
        label={t('expiresAt')}
        type="datetime-local"
        value={expires}
        onChange={setExpires}
      />
      <label>
        <input
          type="checkbox"
          checked={allowDownload}
          onChange={event => setDownload(event.target.checked)}
        />{' '}
        {t('allowDownload')}
      </label>
      <Button
        disabled={!targetDocument || !selected.length}
        onClick={() => setPreview(true)}
      >
        {t('previewExternal')}
      </Button>
      <Modal
        open={preview}
        onOpenChange={setPreview}
        title={t('previewExternal')}
      >
        <div className={styles.stack}>
          {previewPages.map(page => (
            <ReportSlide
              key={page.id}
              page={page}
              theme={snapshot.theme}
              assetUrls={previewAssets}
            />
          ))}
        </div>
      </Modal>
      <Button
        disabled={
          pending ||
          !targetDocument ||
          !final ||
          !selected.length ||
          !state.capabilities?.canShare ||
          (mode === 'accounts' && !accounts.length && !accountEmails.trim())
        }
        onClick={() =>
          openConfirmModal({
            title: t('confirmShare'),
            description: `${t('shareExplanation')}\n${selected.map(id => snapshot.chapters.find(chapter => chapter.id === id)?.title ?? '').join('、')}`,
            confirmText: t('createShare'),
            onConfirm: () =>
              execute({
                operation: 'share.create',
                shareId: updateShare?.id,
                expectedShareVersion: updateShare?.version,
                revisionId: target,
                audience: {
                  kind: 'external',
                  chapterIds: selected,
                  includeNotes: false,
                  includeSources,
                },
                mode,
                accountIds: mode === 'accounts' ? accounts : [],
                accountEmails:
                  mode === 'accounts'
                    ? accountEmails.split(/[\s,]+/).filter(Boolean)
                    : undefined,
                password: password || undefined,
                expiresAt: expires
                  ? new Date(expires).toISOString()
                  : undefined,
                allowDownload,
              }).then(result => {
                setPassword('');
                setUpdateShare(undefined);
                setShareAudience(undefined);
                setUrl(
                  result.shares?.find(share => share.id === result.shareId)
                    ?.url ??
                    result.shares?.[0]?.url ??
                    ''
                );
              }),
          })
        }
      >
        {t(updateShare ? 'updateShare' : 'createShare')}
      </Button>
      {!final && <p>{t('finalRequired')}</p>}
      {url && (
        <div className={styles.stack}>
          <TextField label={t('shareUrl')} value={url} onChange={() => {}} />
          <Button
            onClick={() =>
              void navigator.clipboard
                .writeText(url)
                .then(() => setFeedback(t('copied')))
                .catch(() => setFeedback(t('copyFailed')))
            }
          >
            {t('copyLink')}
          </Button>
        </div>
      )}
      {shares.items.map(share => (
        <article key={share.id}>
          <p>
            {t(share.mode)} · {t(share.status)}{' '}
            {share.expiresAt ? new Date(share.expiresAt).toLocaleString() : ''}
          </p>
          <Button
            disabled={
              pending ||
              !state.capabilities?.canShare ||
              share.status === 'revoked'
            }
            onClick={() => {
              setUpdateShare({ id: share.id, version: share.version });
              setRevision(share.revisionId);
              setMode(share.mode);
              setAccounts(share.accountIds ?? []);
              setAccountEmails('');
              setSources(share.audience?.includeSources ?? false);
              setShareAudience(share.audience);
              setDownload(share.allowDownload);
              setFeedback(t('updateShareExplanation'));
            }}
          >
            {t('edit')}
          </Button>
          <Button
            disabled={
              pending ||
              !state.capabilities?.canShare ||
              share.status === 'revoked'
            }
            onClick={() =>
              openConfirmModal({
                title: t('revokeShare'),
                description: t('revokeExplanation'),
                confirmText: t('revoke'),
                onConfirm: () =>
                  execute({
                    operation: 'share.revoke',
                    shareId: share.id,
                    expectedShareVersion: share.version,
                  }).then(() => {}),
              })
            }
          >
            {t('revoke')}
          </Button>
        </article>
      ))}
      {shares.hasMore && (
        <Button
          disabled={shares.pending}
          onClick={() => void shares.loadMore().catch(() => {})}
        >
          {t('moreShares')}
        </Button>
      )}
      {!!(exports.error || shares.error || revisions.error) && (
        <p role="alert">{t('loadFailed')}</p>
      )}
      {feedback && <p role="status">{feedback}</p>}
    </div>
  );
}
