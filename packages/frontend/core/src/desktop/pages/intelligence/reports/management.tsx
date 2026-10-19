import { Button, Loading, useConfirmModal } from '@affine/component';
import { useLegacyProjectReportsEnabled } from '@affine/core/components/report-deck-entry';
import type {
  ProjectReportApi,
  ReportSchedule,
  ReportScheduleConfig,
  ReportTemplateRecord,
} from '@affine/core/modules/project-reports/contracts';
import {
  useReportCollection,
  useReportCommand,
  useReportState,
} from '@affine/core/modules/project-reports/hooks';
import { projectErrorMessage } from '@affine/core/modules/project-resources/error';
import {
  BUILTIN_REPORT_TEMPLATES,
  type ReportTemplate,
  ReportTemplateSchema,
} from '@localmind/office/report';
import { useState } from 'react';

import {
  MemberRecipients,
  reportRecipientLabels,
  SourceSelection,
  TemplateContentEditor,
  zonedDateTime,
} from './configuration';
import { SelectField, TextField, useReportText } from './fields';
import * as styles from './reports.css';
import { TemplateImport } from './template-gallery';

export function ReportTemplates({
  api,
  projectId,
  uploadImage,
}: {
  api: ProjectReportApi;
  projectId: string;
  uploadImage?: (file: File) => Promise<string>;
}) {
  const t = useReportText();
  const templateImport = useLegacyProjectReportsEnabled();
  const { state, loading, error, refresh } = useReportState(api, {
    projectId,
    view: 'templates',
  });
  const templates = useReportCollection(
    api,
    projectId,
    '',
    'templates',
    state.templates,
    state.nextCursors?.templates
  );
  const action = useReportCommand(api, { projectId }, refresh);
  const [selected, setSelected] = useState<ReportTemplateRecord>();
  const [content, setContent] = useState<ReportTemplate>();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(false);
  const writable = !!state.capabilities?.canEdit;
  if (loading) return <Loading />;
  return (
    <div className={styles.body}>
      {!!(error || action.error) && (
        <p role="alert">{projectErrorMessage(error ?? action.error)}</p>
      )}
      <div className={styles.formGrid}>
        <section>
          <div className={styles.row}>
            <h1>{t('templates')}</h1>
            <Button
              disabled={action.pending || !writable}
              onClick={() => {
                setSelected(undefined);
                setContent({
                  ...structuredClone(BUILTIN_REPORT_TEMPLATES[0].content),
                  name: t('customTemplate'),
                });
              }}
            >
              {t('newTemplate')}
            </Button>
            {uploadImage && templateImport && (
              <TemplateImport
                disabled={action.pending || !writable}
                uploadImage={uploadImage}
                onSave={content =>
                  action.execute({ operation: 'template.save', content })
                }
              />
            )}
          </div>
          <ul className={styles.list}>
            {templates.items.map(template => (
              <li key={template.id} className={styles.listRow}>
                <div style={{ flex: 1 }}>
                  <strong>{template.name}</strong>
                  <p className={styles.muted}>
                    {template.builtinKey ? t('builtin') : t('custom')} ·{' '}
                    {t(template.status)}
                  </p>
                </div>
                <Button
                  onClick={() => {
                    setSelected(template);
                    setContent(structuredClone(template.current.content));
                  }}
                >
                  {t('open')}
                </Button>
                <Button
                  disabled={action.pending || !writable}
                  onClick={() => {
                    setSelected(undefined);
                    setContent({
                      ...structuredClone(template.current.content),
                      name: `${template.name} · ${t('copy')}`,
                    });
                  }}
                >
                  {t('duplicate')}
                </Button>
              </li>
            ))}
          </ul>
          {!!templates.error && (
            <p role="alert">{projectErrorMessage(templates.error)}</p>
          )}
          {templates.hasMore && (
            <Button
              disabled={templates.pending}
              onClick={() => void templates.loadMore()}
            >
              {t('loadMore')}
            </Button>
          )}
        </section>
        <section>
          {content ? (
            <div className={styles.stack}>
              <TemplateContentEditor
                value={content}
                onChange={setContent}
                disabled={
                  action.pending ||
                  !writable ||
                  uploading ||
                  !!selected?.builtinKey
                }
              />
              <SelectField
                label={t('logo')}
                value={content.theme.logoAssetId ?? ''}
                disabled={
                  action.pending ||
                  !writable ||
                  uploading ||
                  !!selected?.builtinKey
                }
                options={[
                  { value: '', label: t('none') },
                  ...content.assets.map(asset => ({
                    value: asset.id,
                    label: asset.alt,
                  })),
                ]}
                onChange={logoAssetId =>
                  setContent({
                    ...content,
                    theme: {
                      ...content.theme,
                      logoAssetId: logoAssetId || undefined,
                    },
                  })
                }
              />
              {uploadImage && (
                <label className={styles.field}>
                  {t('uploadImage')}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    disabled={
                      action.pending ||
                      !writable ||
                      uploading ||
                      !!selected?.builtinKey
                    }
                    onChange={event => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setUploading(true);
                      setUploadError(false);
                      void uploadImage(file)
                        .then(blobKey =>
                          setContent(current =>
                            current
                              ? {
                                  ...current,
                                  assets: [
                                    ...current.assets,
                                    {
                                      id: crypto.randomUUID(),
                                      blobKey,
                                      mimeType:
                                        file.type as ReportTemplate['assets'][number]['mimeType'],
                                      alt: file.name,
                                    },
                                  ],
                                }
                              : current
                          )
                        )
                        .catch(() => setUploadError(true))
                        .finally(() => setUploading(false));
                    }}
                  />
                </label>
              )}
              {uploadError && <p role="alert">{t('uploadFailed')}</p>}
              <div className={styles.row}>
                <Button
                  disabled={
                    action.pending ||
                    !writable ||
                    uploading ||
                    !!selected?.builtinKey ||
                    !ReportTemplateSchema.safeParse(content).success
                  }
                  onClick={() =>
                    void action
                      .execute({
                        operation: 'template.save',
                        templateId: selected?.id,
                        expectedVersion: selected?.version,
                        content,
                      })
                      .then(() => {
                        setContent(undefined);
                        setSelected(undefined);
                      })
                      .catch(() => {})
                  }
                >
                  {t('publishTemplate')}
                </Button>
                {selected && !selected.builtinKey && (
                  <Button
                    disabled={action.pending || !writable}
                    onClick={() =>
                      void action
                        .execute({
                          operation: 'template.save',
                          templateId: selected.id,
                          expectedVersion: selected.version,
                          content,
                          status:
                            selected.status === 'archived'
                              ? 'active'
                              : 'archived',
                        })
                        .then(() => {
                          setContent(undefined);
                          setSelected(undefined);
                        })
                        .catch(() => {})
                    }
                  >
                    {t(selected.status === 'archived' ? 'restore' : 'archive')}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p>{t('selectTemplate')}</p>
          )}
        </section>
      </div>
    </div>
  );
}

function emptySchedule(templateRevisionId = ''): ReportScheduleConfig {
  return {
    title: '',
    templateRevisionId,
    selection: { kind: 'all' },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    frequency: 'weekly',
    day: 1,
    time: '09:00',
    period: 'previous_week',
    autoFinalize: false,
    delivery: {
      enabled: false,
      channel: 'notification',
      recipients: [],
      includeAttachment: false,
      expiresDays: 7,
      audience: {
        kind: 'external',
        chapterIds: [],
        includeNotes: false,
        includeSources: false,
      },
    },
  };
}

export function ReportSchedules({
  api,
  projectId,
}: {
  api: ProjectReportApi;
  projectId: string;
}) {
  const t = useReportText();
  const { openConfirmModal } = useConfirmModal();
  const { state, loading, error, refresh } = useReportState(api, {
    projectId,
    view: 'schedules',
  });
  const schedules = useReportCollection(
    api,
    projectId,
    '',
    'schedules',
    state.schedules,
    state.nextCursors?.schedules
  );
  const action = useReportCommand(api, { projectId }, refresh);
  const [selected, setSelected] = useState<ReportSchedule>();
  const [config, setConfig] = useState<ReportScheduleConfig>();
  const [rebind, setRebind] = useState(false);
  const [deliveryEmails, setDeliveryEmails] = useState('');
  const writable = !!state.capabilities?.canSchedule;
  const save = async () => {
    if (!config) return;
    await action
      .execute({
        operation: 'schedule.save',
        scheduleId: selected?.id,
        expectedScheduleVersion: selected?.version,
        config,
        rebind,
      })
      .then(() => {
        setConfig(undefined);
        setSelected(undefined);
        setRebind(false);
      })
      .catch(() => {});
  };
  if (loading) return <Loading />;
  return (
    <div className={styles.body}>
      {!!(error || action.error) && (
        <p role="alert">{projectErrorMessage(error ?? action.error)}</p>
      )}
      <div className={styles.row}>
        <h1 className={styles.title}>{t('schedules')}</h1>
        <Button
          disabled={action.pending || !writable || !state.templates?.length}
          onClick={() => {
            setSelected(undefined);
            setDeliveryEmails('');
            setRebind(false);
            setConfig(emptySchedule(state.templates?.[0]?.current.id));
          }}
        >
          {t('newSchedule')}
        </Button>
      </div>
      <p className={styles.muted}>{t('scheduleExplanation')}</p>
      <div className={styles.formGrid}>
        <section>
          <ul className={styles.list}>
            {schedules.items.map(schedule => (
              <li key={schedule.id} className={styles.listRow}>
                <div className={styles.stack} style={{ width: '100%' }}>
                  <strong>{schedule.config.title}</strong>
                  <span>
                    {t(schedule.status)} · {schedule.config.time} ·{' '}
                    {schedule.config.timeZone}
                  </span>
                  <div className={styles.row}>
                    <Button
                      onClick={() => {
                        setSelected(schedule);
                        setDeliveryEmails(
                          schedule.config.delivery.recipients
                            .filter(value => value.includes('@'))
                            .join('\n')
                        );
                        setRebind(false);
                        setConfig(structuredClone(schedule.config));
                      }}
                    >
                      {t('edit')}
                    </Button>
                    <Button
                      disabled={action.pending || !writable}
                      onClick={() =>
                        void action
                          .execute({
                            operation: 'schedule.pause',
                            scheduleId: schedule.id,
                            expectedScheduleVersion: schedule.version,
                            paused: schedule.status === 'active',
                          })
                          .catch(() => {})
                      }
                    >
                      {t(schedule.status === 'active' ? 'pause' : 'resume')}
                    </Button>
                    <Button
                      disabled={
                        action.pending ||
                        !writable ||
                        schedule.status !== 'active'
                      }
                      onClick={() =>
                        void action
                          .execute({
                            operation: 'schedule.run',
                            scheduleId: schedule.id,
                            expectedScheduleVersion: schedule.version,
                          })
                          .catch(() => {})
                      }
                    >
                      {t('runNow')}
                    </Button>
                    <Button
                      disabled={action.pending || !writable}
                      onClick={() =>
                        openConfirmModal({
                          title: t('removeSchedule'),
                          description: t('keepDeliveryHistory'),
                          confirmText: t('remove'),
                          onConfirm: () =>
                            action
                              .execute({
                                operation: 'schedule.remove',
                                scheduleId: schedule.id,
                                expectedScheduleVersion: schedule.version,
                              })
                              .then(() => {}),
                        })
                      }
                    >
                      {t('remove')}
                    </Button>
                  </div>
                  <ScheduleHistory
                    api={api}
                    projectId={projectId}
                    schedule={schedule}
                    action={action}
                    members={state.members ?? []}
                    disabled={!writable}
                  />
                </div>
              </li>
            ))}
          </ul>
          {!!schedules.error && (
            <p role="alert">{projectErrorMessage(schedules.error)}</p>
          )}
          {schedules.hasMore && (
            <Button
              disabled={schedules.pending}
              onClick={() => void schedules.loadMore()}
            >
              {t('loadMore')}
            </Button>
          )}
        </section>
        <section>
          {config && (
            <fieldset
              className={styles.stack}
              disabled={action.pending || !writable}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              <TextField
                label={t('title')}
                value={config.title}
                onChange={title => setConfig({ ...config, title })}
              />
              <SelectField
                label={t('template')}
                value={config.templateRevisionId}
                options={(state.templates ?? [])
                  .filter(
                    template =>
                      template.status === 'active' ||
                      template.current.id === config.templateRevisionId
                  )
                  .map(template => ({
                    value: template.current.id,
                    label: template.name,
                  }))}
                onChange={templateRevisionId =>
                  setConfig({
                    ...config,
                    templateRevisionId,
                    delivery: {
                      ...config.delivery,
                      audience: { ...config.delivery.audience, chapterIds: [] },
                    },
                  })
                }
              />
              <SourceSelection
                value={config.selection}
                resources={state.resources ?? []}
                limited={state.resourcesLimited}
                onChange={selection => setConfig({ ...config, selection })}
              />
              <div className={styles.formGrid}>
                <SelectField
                  label={t('frequency')}
                  value={config.frequency}
                  options={(['weekly', 'monthly'] as const).map(value => ({
                    value,
                    label: t(value),
                  }))}
                  onChange={frequency =>
                    setConfig({
                      ...config,
                      frequency,
                      period:
                        frequency === 'weekly'
                          ? 'previous_week'
                          : 'previous_month',
                      day: 1,
                    })
                  }
                />
                <TextField
                  label={t(
                    config.frequency === 'weekly' ? 'weekDay' : 'monthDay'
                  )}
                  type="number"
                  value={String(config.day)}
                  onChange={day => setConfig({ ...config, day: Number(day) })}
                />
                <TextField
                  label={t('runTime')}
                  type="time"
                  value={config.time}
                  onChange={time => setConfig({ ...config, time })}
                />
                <TextField
                  label={t('timeZone')}
                  value={config.timeZone}
                  onChange={timeZone => setConfig({ ...config, timeZone })}
                />
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={config.autoFinalize}
                  onChange={event =>
                    setConfig({ ...config, autoFinalize: event.target.checked })
                  }
                />{' '}
                {t('autoFinalize')}
              </label>
              <p className={styles.muted}>{t('autoFinalizeGate')}</p>
              <label>
                <input
                  type="checkbox"
                  checked={config.delivery.enabled}
                  onChange={event =>
                    setConfig({
                      ...config,
                      delivery: {
                        ...config.delivery,
                        enabled: event.target.checked,
                      },
                    })
                  }
                />{' '}
                {t('automaticDelivery')}
              </label>
              {config.delivery.enabled && (
                <>
                  <SelectField
                    label={t('channel')}
                    value={config.delivery.channel}
                    options={[
                      { value: 'notification', label: t('notification') },
                      ...(state.capabilities?.emailConfigured
                        ? [{ value: 'email' as const, label: t('email') }]
                        : []),
                    ]}
                    onChange={channel =>
                      setConfig({
                        ...config,
                        delivery: {
                          ...config.delivery,
                          channel,
                          recipients:
                            channel === 'notification'
                              ? config.delivery.recipients.filter(
                                  id => !id.includes('@')
                                )
                              : config.delivery.recipients,
                        },
                      })
                    }
                  />
                  <MemberRecipients
                    value={config.delivery.recipients.filter(
                      id => !id.includes('@')
                    )}
                    members={state.members ?? []}
                    onChange={recipients =>
                      setConfig({
                        ...config,
                        delivery: {
                          ...config.delivery,
                          recipients: [
                            ...recipients,
                            ...config.delivery.recipients.filter(id =>
                              id.includes('@')
                            ),
                          ],
                        },
                      })
                    }
                  />
                  {config.delivery.channel === 'email' && (
                    <TextField
                      label={t('recipientEmails')}
                      multiline
                      value={deliveryEmails}
                      onChange={value => {
                        setDeliveryEmails(value);
                        setConfig({
                          ...config,
                          delivery: {
                            ...config.delivery,
                            recipients: [
                              ...config.delivery.recipients.filter(
                                id =>
                                  !id.includes('@') &&
                                  !deliveryEmails.split(/[\s,]+/).includes(id)
                              ),
                              ...value.split(/[\s,]+/).filter(Boolean),
                            ],
                          },
                        });
                      }}
                    />
                  )}
                  <TextField
                    label={t('expiresDays')}
                    type="number"
                    value={String(config.delivery.expiresDays)}
                    onChange={value =>
                      setConfig({
                        ...config,
                        delivery: {
                          ...config.delivery,
                          expiresDays: Number(value),
                        },
                      })
                    }
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={config.delivery.includeAttachment}
                      onChange={event =>
                        setConfig({
                          ...config,
                          delivery: {
                            ...config.delivery,
                            includeAttachment: event.target.checked,
                          },
                        })
                      }
                    />{' '}
                    {t('includeAttachment')}
                  </label>
                  <fieldset>
                    <legend>{t('visibleChapters')}</legend>
                    {state.templates
                      ?.find(
                        template =>
                          template.current.id === config.templateRevisionId
                      )
                      ?.current.content.chapters.map(chapter => (
                        <label className={styles.row} key={chapter.key}>
                          <input
                            type="checkbox"
                            checked={config.delivery.audience.chapterIds.includes(
                              chapter.key
                            )}
                            onChange={event =>
                              setConfig({
                                ...config,
                                delivery: {
                                  ...config.delivery,
                                  audience: {
                                    ...config.delivery.audience,
                                    chapterIds: event.target.checked
                                      ? [
                                          ...config.delivery.audience
                                            .chapterIds,
                                          chapter.key,
                                        ]
                                      : config.delivery.audience.chapterIds.filter(
                                          id => id !== chapter.key
                                        ),
                                  },
                                },
                              })
                            }
                          />
                          {chapter.title}
                        </label>
                      ))}
                  </fieldset>
                </>
              )}
              {selected && (
                <label>
                  <input
                    type="checkbox"
                    checked={rebind}
                    onChange={event => setRebind(event.target.checked)}
                  />{' '}
                  {t('rebindToMe')}
                </label>
              )}
              <Button
                disabled={
                  action.pending ||
                  !config.title ||
                  !config.templateRevisionId ||
                  (config.delivery.enabled &&
                    (!config.delivery.recipients.length ||
                      !config.delivery.audience.chapterIds.length))
                }
                onClick={() => {
                  if (config.delivery.enabled || rebind)
                    openConfirmModal({
                      title: t('confirmAuthorization'),
                      description: `${t('deliveryAuthorization')} ${reportRecipientLabels(config.delivery.recipients, state.members ?? [], t('externalAccount')).join(', ')}`,
                      confirmText: t('confirmAndSave'),
                      onConfirm: () => save(),
                    });
                  else void save().catch(() => {});
                }}
              >
                {t('saveSchedule')}
              </Button>
            </fieldset>
          )}
        </section>
      </div>
    </div>
  );
}

function ScheduleHistory({
  api,
  projectId,
  schedule,
  action,
  members,
  disabled,
}: {
  api: ProjectReportApi;
  projectId: string;
  schedule: ReportSchedule;
  action: ReturnType<typeof useReportCommand>;
  members: { id: string; name: string }[];
  disabled: boolean;
}) {
  const t = useReportText();
  const { openConfirmModal } = useConfirmModal();
  const occurrences = useReportCollection(
    api,
    projectId,
    '',
    'occurrences',
    schedule.occurrences,
    schedule.nextCursors?.occurrences,
    schedule.id
  );
  const revisions = useReportCollection(
    api,
    projectId,
    '',
    'scheduleRevisions',
    schedule.revisions,
    schedule.nextCursors?.revisions,
    schedule.id
  );
  const [deliveryNotes, setDeliveryNotes] = useState<Record<string, string>>(
    {}
  );
  const [backfillStart, setBackfillStart] = useState('');
  const [backfillEnd, setBackfillEnd] = useState('');
  const [backfillError, setBackfillError] = useState<unknown>();
  const backfill = async () => {
    setBackfillError(undefined);
    try {
      const periodStart = zonedDateTime(
        `${backfillStart}T00:00`,
        schedule.config.timeZone
      );
      const periodEnd = zonedDateTime(
        `${backfillEnd}T00:00`,
        schedule.config.timeZone
      );
      if (periodStart >= periodEnd) throw new Error('Invalid report period');
      await action.execute({
        operation: 'schedule.run',
        scheduleId: schedule.id,
        expectedScheduleVersion: schedule.version,
        periodStart,
        periodEnd,
      });
    } catch (error) {
      setBackfillError(error);
    }
  };

  return (
    <details>
      <summary>{t('runHistory')}</summary>
      {occurrences.items.map(occurrence => (
        <article key={occurrence.id}>
          <p>
            {new Date(occurrence.scheduledAt).toLocaleString()} ·{' '}
            {t(occurrence.status)}
          </p>
          {occurrence.deliveries?.map(delivery => (
            <div key={delivery.id}>
              <p>
                {
                  reportRecipientLabels(
                    [delivery.recipientKey],
                    members,
                    t('externalAccount')
                  )[0]
                }{' '}
                · {t(delivery.channel)} · {t(delivery.status)}
              </p>
              {delivery.resultNote && <p>{delivery.resultNote}</p>}
              {delivery.status === 'unknown' && (
                <>
                  <TextField
                    label={t('deliveryResolutionNote')}
                    multiline
                    value={deliveryNotes[delivery.id] ?? ''}
                    onChange={note =>
                      setDeliveryNotes({
                        ...deliveryNotes,
                        [delivery.id]: note,
                      })
                    }
                  />
                  {(['sent', 'not_sent'] as const).map(result => (
                    <Button
                      key={result}
                      disabled={
                        action.pending ||
                        disabled ||
                        !deliveryNotes[delivery.id]?.trim()
                      }
                      onClick={() =>
                        openConfirmModal({
                          title: t(
                            result === 'sent'
                              ? 'confirmSent'
                              : 'confirmNotSentRetry'
                          ),
                          description: t('deliveryResolutionDescription'),
                          confirmText: t('confirm'),
                          onConfirm: () =>
                            action
                              .execute({
                                operation: 'schedule.delivery.resolve',
                                deliveryId: delivery.id,
                                expectedDeliveryVersion: delivery.version,
                                result,
                                note: deliveryNotes[delivery.id],
                              })
                              .then(() => {}),
                        })
                      }
                    >
                      {t(
                        result === 'sent'
                          ? 'confirmSent'
                          : 'confirmNotSentRetry'
                      )}
                    </Button>
                  ))}
                </>
              )}
            </div>
          ))}
        </article>
      ))}
      {!!occurrences.error && (
        <p role="alert">{projectErrorMessage(occurrences.error)}</p>
      )}
      {occurrences.hasMore && (
        <Button
          disabled={occurrences.pending}
          onClick={() => void occurrences.loadMore()}
        >
          {t('loadMore')}
        </Button>
      )}
      <details>
        <summary>{t('configurationHistory')}</summary>
        {revisions.items.map(revision => (
          <article key={revision.id}>
            <h3>
              {t('version')} {revision.version} ·{' '}
              {new Date(revision.createdAt).toLocaleString()}
            </h3>
            <p>
              {revision.config.title} · {t(revision.status)}
            </p>
            <p>
              {t(revision.config.frequency)} · {revision.config.day} ·{' '}
              {revision.config.time} · {revision.config.timeZone}
            </p>
            <p>
              {t(revision.config.period)} ·{' '}
              {t(revision.config.autoFinalize ? 'autoFinalize' : 'draft')}
            </p>
            <p>
              {t('sourceScope')}: {t(revision.config.selection.kind)}
              {revision.config.selection.kind === 'all'
                ? ''
                : ` · ${revision.config.selection.kind === 'folders' ? revision.config.selection.folderIds.length : revision.config.selection.resourceIds.length}`}
            </p>
            <p>
              {t('delivery')}:{' '}
              {revision.config.delivery.enabled
                ? `${t(revision.config.delivery.channel)} · ${reportRecipientLabels(revision.config.delivery.recipients, members, t('externalAccount')).join(', ')}`
                : t('none')}
            </p>
          </article>
        ))}
        {!!revisions.error && (
          <p role="alert">{projectErrorMessage(revisions.error)}</p>
        )}
        {revisions.hasMore && (
          <Button
            disabled={revisions.pending}
            onClick={() => void revisions.loadMore()}
          >
            {t('loadMore')}
          </Button>
        )}
      </details>
      <TextField
        label={t('periodStart')}
        type="date"
        value={backfillStart}
        onChange={setBackfillStart}
      />
      <p className={styles.muted}>{schedule.config.timeZone}</p>
      <TextField
        label={t('periodEndExclusive')}
        type="date"
        value={backfillEnd}
        onChange={setBackfillEnd}
      />
      {!!backfillError && (
        <p role="alert">{projectErrorMessage(backfillError)}</p>
      )}
      <Button
        disabled={action.pending || disabled || !backfillStart || !backfillEnd}
        onClick={() => void backfill()}
      >
        {t('backfill')}
      </Button>
    </details>
  );
}
