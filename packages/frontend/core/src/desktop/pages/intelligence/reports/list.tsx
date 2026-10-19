import {
  Button,
  IconButton,
  Loading,
  Menu,
  MenuItem,
  Modal,
  useConfirmModal,
} from '@affine/component';
import { useLegacyProjectReportsEnabled } from '@affine/core/components/report-deck-entry';
import {
  getProjectPath,
  getProjectReportPath,
} from '@affine/core/desktop/route-paths';
import type {
  ProjectReportApi,
  ReportSelection,
  ReportState,
  ReportTemplateRecord,
} from '@affine/core/modules/project-reports/contracts';
import {
  useReportCommand,
  useReportState,
} from '@affine/core/modules/project-reports/hooks';
import {
  isProjectAccessError,
  projectErrorMessage,
} from '@affine/core/modules/project-resources/error';
import { UserFriendlyError } from '@affine/error';
import { MoreHorizontalIcon } from '@blocksuite/icons/rc';
import { formatReportPeriod } from '@localmind/office/report';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { ReportAccessDenied } from './access';
import { localDateTime, SourceSelection, zonedDateTime } from './configuration';
import { SelectField, TextField, useReportText } from './fields';
import * as styles from './reports.css';
import {
  TemplateCard,
  TemplateGallerySkeleton,
  TemplateImport,
} from './template-gallery';

export function ReportList({
  api,
  projectId,
  uploadImage,
}: {
  api: ProjectReportApi;
  projectId: string;
  uploadImage?: (file: File) => Promise<string>;
}) {
  const t = useReportText();
  const navigate = useNavigate();
  const { openConfirmModal } = useConfirmModal();
  const templateImport = useLegacyProjectReportsEnabled();
  const [search, setSearch] = useState('');
  const [composing, setComposing] = useState(false);
  const [filter, setFilter] = useState({
    search: '',
    lifecycle: 'active',
    cursor: undefined as string | undefined,
  });
  useEffect(() => {
    if (composing) return;
    const timer = setTimeout(() => {
      setFilter(previous =>
        previous.search === search.trim()
          ? previous
          : { ...previous, search: search.trim(), cursor: undefined }
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [search, composing]);
  const options = useReportState(
    api,
    {
      projectId,
      view: 'list_options',
    },
    { revalidate: false }
  );
  const {
    state: results,
    loading,
    error: searchError,
    refresh: refreshResults,
  } = useReportState(api, {
    projectId,
    view: 'list_results',
    ...filter,
    limit: 30,
  });
  const refreshOptions = options.refresh;
  const [retryingOptions, setRetryingOptions] = useState(false);
  const optionsBusy = options.loading || retryingOptions;
  const retryOptions = async () => {
    if (retryingOptions) return;
    setRetryingOptions(true);
    try {
      await refreshOptions();
    } catch {
      // The options state exposes the error and keeps the retry available.
    } finally {
      setRetryingOptions(false);
    }
  };
  const refresh = useCallback(async () => {
    return refreshResults();
  }, [refreshResults]);
  const optionFailure = options.error
    ? UserFriendlyError.fromAny(options.error)
    : undefined;
  const accessError =
    optionFailure?.isStatus(401) || optionFailure?.isStatus(403)
      ? options.error
      : undefined;
  const error = searchError ?? accessError;
  const state: ReportState =
    error && isProjectAccessError(error)
      ? {}
      : { ...options.state, ...results };
  const { lifecycle, cursor } = filter;
  const action = useReportCommand(api, { projectId }, refresh);
  const writable = !!state.capabilities?.canEdit;
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (creating) void refreshOptions().catch(() => {});
  }, [creating, refreshOptions]);
  const [templateId, setTemplate] = useState('');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState(
    localDateTime(new Date(Date.now() - 7 * 86400000))
  );
  const [end, setEnd] = useState(localDateTime(new Date()));
  const [zone, setZone] = useState(
    Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [instructions, setInstructions] = useState('');
  const [selection, setSelection] = useState<ReportSelection>({ kind: 'all' });
  const [responsible, setResponsible] = useState('');
  const [templateError, setTemplateError] = useState('');
  const [previous, setPrevious] = useState<{
    reportId: string;
    revisionId?: string;
  }>();
  const [audience, setAudience] = useState<
    'management' | 'customer' | 'team' | ''
  >('');
  const [language, setLanguage] = useState<'en' | 'zh-Hans' | 'zh-Hant' | ''>(
    ''
  );
  const [duration, setDuration] = useState('');
  const activeTemplates = (state.templates ?? []).filter(
    item => item.status === 'active'
  );
  const template =
    activeTemplates.find(item => item.current.id === templateId) ??
    activeTemplates[0];
  const create = async (generate: boolean) => {
    if (!template) return;
    setTemplateError('');
    try {
      const period = {
        start: zonedDateTime(start, zone),
        end: zonedDateTime(end, zone),
        timeZone: zone,
        weekStartsOn: 1,
      };
      if (period.start >= period.end) throw new Error('Invalid period');
      const member = state.members?.find(member => member.id === responsible);
      const result = await action.execute({
        operation: 'create',
        title: title || template.name,
        templateRevisionId: template.current.id,
        period,
        selection,
        generate,
        instructions,
        audience: audience || undefined,
        language: language || undefined,
        durationMinutes: duration ? Number(duration) : undefined,
        previousReportId: previous?.reportId,
        previousRevisionId: previous?.revisionId,
        ...(member
          ? {
              responsibility: {
                identity: {
                  kind: 'member',
                  actorId: member.id,
                  label: member.name,
                },
                origin: 'manual',
                sourceIds: [],
              },
            }
          : {}),
      });
      const reportId = result.reportId ?? result.report?.id;
      if (reportId) navigate(getProjectReportPath(projectId, reportId));
    } catch {
      setTemplateError(t('createFailed'));
    }
  };
  const changeLifecycle = (
    report: NonNullable<typeof state.reports>['items'][number],
    next: 'active' | 'archived' | 'trashed'
  ) => {
    const run = () =>
      action
        .execute(
          { operation: 'lifecycle', lifecycle: next },
          { reportId: report.id, expectedVersion: report.version }
        )
        .then(() => {});
    if (next === 'trashed')
      openConfirmModal({
        title: t('trashReport'),
        description: t('trashConsequences'),
        confirmText: t('trash'),
        onConfirm: run,
      });
    else void run().catch(() => {});
  };
  const themes = new Map(
    (state.templates ?? []).map(item => [
      item.current.id,
      item.current.content.theme,
    ])
  );
  const documentCount = (state.resources ?? []).filter(
    resource => resource.kind !== 'folder'
  ).length;
  if (error && isProjectAccessError(error) && !BUILD_CONFIG.isElectron)
    return <ReportAccessDenied />;
  return (
    <div className={`${styles.body} ${styles.homeBody}`}>
      <header className={styles.homeHeader}>
        <div>
          <h1 className={styles.homeTitle}>{t('reports')}</h1>
          <p className={styles.homeSubtitle}>{t('studio.listHint')}</p>
        </div>
        <Button
          variant="primary"
          disabled={
            optionsBusy ||
            !!options.error ||
            !activeTemplates.length ||
            action.pending ||
            !writable
          }
          onClick={() => {
            setPrevious(undefined);
            setCreating(true);
          }}
        >
          {t('createReport')}
        </Button>
      </header>
      <section className={styles.section} aria-busy={optionsBusy}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t('home.templatesTitle')}</h2>
          <p className={styles.sectionHint}>{t('home.templatesHint')}</p>
          {uploadImage && templateImport && (
            <TemplateImport
              disabled={optionsBusy || action.pending || !writable}
              uploadImage={uploadImage}
              onSave={content =>
                action
                  .execute({ operation: 'template.save', content })
                  .then(() => retryOptions())
              }
            />
          )}
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() =>
              navigate(`${getProjectPath(projectId)}/report-templates`)
            }
          >
            {t('home.manageTemplates')}
          </button>
        </div>
        {!!options.error && (
          <div className={styles.error} role="alert">
            <span>{t('home.optionsFailed')}</span>
            <Button disabled={optionsBusy} onClick={() => void retryOptions()}>
              {t('retry')}
            </Button>
          </div>
        )}
        {!optionsBusy && !options.error && !activeTemplates.length && (
          <p className={styles.muted}>{t('home.noTemplates')}</p>
        )}
        <div className={styles.templateMasonry}>
          {optionsBusy && !activeTemplates.length ? (
            <TemplateGallerySkeleton />
          ) : (
            activeTemplates.map(item => (
              <TemplateCard
                key={item.id}
                projectId={projectId}
                template={item}
                disabled={optionsBusy || action.pending || !writable}
                onSelect={() => {
                  setPrevious(undefined);
                  setTemplate(item.current.id);
                  setCreating(true);
                }}
              />
            ))
          )}
        </div>
      </section>
      <div className={styles.homeGrid}>
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle} style={{ marginRight: 'auto' }}>
              {t('home.myReports')}
            </h2>
            <input
              className={styles.search}
              aria-label={t('search')}
              placeholder={t('home.searchPlaceholder')}
              value={search}
              onChange={event => setSearch(event.target.value)}
              onCompositionStart={() => setComposing(true)}
              onCompositionEnd={() => setComposing(false)}
            />
            <div
              className={styles.viewSwitch}
              role="group"
              aria-label={t('lifecycle')}
            >
              {(['active', 'archived', 'trashed'] as const).map(value => (
                <button
                  key={value}
                  type="button"
                  className={styles.viewSwitchButton}
                  aria-pressed={lifecycle === value}
                  onClick={() =>
                    setFilter(previous => ({
                      ...previous,
                      lifecycle: value,
                      cursor: undefined,
                    }))
                  }
                >
                  {t(value)}
                </button>
              ))}
            </div>
          </div>
          {loading && <Loading />}
          {!!(error || action.error) && (
            <p role="alert">
              {projectErrorMessage(error ?? action.error)}
              <Button onClick={() => void refresh().catch(() => {})}>
                {t('retry')}
              </Button>
            </p>
          )}
          {!loading && !error && !state.reports?.items.length && (
            <div className={styles.listEmpty}>
              {filter.search || lifecycle !== 'active' ? (
                t('home.noMatches')
              ) : (
                <>
                  <strong>{t('emptyTitle')}</strong>
                  {t('home.emptyList')}
                </>
              )}
            </div>
          )}
          <ul className={styles.list}>
            {state.reports?.items.map(report => {
              const theme = themes.get(report.templateRevisionId);
              return (
                <li className={styles.listRow} key={report.id}>
                  <span
                    className={styles.reportThumb}
                    aria-hidden="true"
                    style={{ background: theme?.background ?? '#ffffff' }}
                  >
                    <i style={{ background: theme?.accent ?? '#556678' }} />
                  </span>
                  <div className={styles.reportSummary}>
                    <button
                      className={styles.link}
                      onClick={() =>
                        navigate(getProjectReportPath(projectId, report.id))
                      }
                    >
                      <strong>{report.title}</strong>
                    </button>
                    <p className={styles.muted}>
                      {formatReportPeriod({
                        start: report.periodStart,
                        end: report.periodEnd,
                        timeZone: report.timeZone,
                        weekStartsOn: 1,
                      })}{' '}
                      · {report.responsibility.identity.label}
                      {report.responsibility.origin === 'creator_fallback'
                        ? ` · ${t('default')}`
                        : ''}
                    </p>
                  </div>
                  <span
                    className={styles.pill}
                    data-tone={report.draftRevisionId ? 'warning' : 'success'}
                  >
                    {t(report.draftRevisionId ? 'draft' : 'final')}
                  </span>
                  <span className={styles.muted}>
                    {new Date(report.updatedAt).toLocaleString()}
                  </span>
                  <Button
                    onClick={() =>
                      navigate(getProjectReportPath(projectId, report.id))
                    }
                  >
                    {t('open')}
                  </Button>
                  <Menu
                    contentOptions={{ align: 'end' }}
                    items={
                      <>
                        <MenuItem
                          disabled={action.pending || !writable}
                          onClick={() => {
                            setPrevious({
                              reportId: report.id,
                              revisionId:
                                report.latestFinalRevisionId ??
                                report.draftRevisionId ??
                                undefined,
                            });
                            setSelection(report.selection);
                            setTemplate(report.templateRevisionId);
                            setTitle(`${report.title} · ${t('nextPeriod')}`);
                            setCreating(true);
                          }}
                        >
                          {t('fromPrevious')}
                        </MenuItem>
                        <MenuItem
                          disabled={action.pending || !writable}
                          onClick={() => {
                            const source =
                              report.draftRevisionId ??
                              report.latestFinalRevisionId;
                            if (!source) return;
                            void action
                              .execute({
                                operation: 'create',
                                title: `${report.title} · ${t('copy')}`,
                                templateRevisionId: report.templateRevisionId,
                                period: {
                                  start: report.periodStart,
                                  end: report.periodEnd,
                                  timeZone: report.timeZone,
                                  weekStartsOn: 1,
                                },
                                selection: report.selection,
                                generate: false,
                                previousReportId: report.id,
                                duplicateRevisionId: source,
                              })
                              .then(result => {
                                const id = result.reportId ?? result.report?.id;
                                if (id)
                                  navigate(getProjectReportPath(projectId, id));
                              })
                              .catch(() => {});
                          }}
                        >
                          {t('duplicate')}
                        </MenuItem>
                        <MenuItem
                          disabled={action.pending || !writable}
                          onClick={() =>
                            changeLifecycle(
                              report,
                              report.lifecycle === 'active'
                                ? 'archived'
                                : 'active'
                            )
                          }
                        >
                          {t(
                            report.lifecycle === 'active'
                              ? 'archive'
                              : 'restore'
                          )}
                        </MenuItem>
                        {report.lifecycle === 'trashed' ? (
                          <MenuItem
                            type="danger"
                            disabled={action.pending || !writable}
                            onClick={() =>
                              openConfirmModal({
                                title: t('permanentlyDelete'),
                                description: t('permanentlyDeleteDescription'),
                                confirmText: t('permanentlyDelete'),
                                onConfirm: () =>
                                  action
                                    .execute(
                                      { operation: 'permanentlyDelete' },
                                      {
                                        reportId: report.id,
                                        expectedVersion: report.version,
                                      }
                                    )
                                    .then(() => {}),
                              })
                            }
                          >
                            {t('permanentlyDelete')}
                          </MenuItem>
                        ) : (
                          <MenuItem
                            type="danger"
                            disabled={action.pending || !writable}
                            onClick={() => changeLifecycle(report, 'trashed')}
                          >
                            {t('trash')}
                          </MenuItem>
                        )}
                      </>
                    }
                  >
                    <IconButton
                      aria-label={t('moreActions')}
                      icon={<MoreHorizontalIcon />}
                    />
                  </Menu>
                </li>
              );
            })}
          </ul>
          {(cursor || state.reports?.nextCursor) && (
            <div className={styles.row}>
              {cursor && (
                <Button
                  onClick={() =>
                    setFilter(previous => ({ ...previous, cursor: undefined }))
                  }
                >
                  {t('firstPage')}
                </Button>
              )}
              {state.reports?.nextCursor && (
                <Button
                  disabled={loading}
                  onClick={() =>
                    setFilter(previous => ({
                      ...previous,
                      cursor: state.reports?.nextCursor ?? undefined,
                    }))
                  }
                >
                  {t('nextPage')}
                </Button>
              )}
            </div>
          )}
        </section>
        <aside className={styles.aside}>
          <h2 className={styles.sectionTitle}>{t('home.sourcesTitle')}</h2>
          <ul className={styles.sourceList}>
            <li className={styles.sourceRow}>
              {t('home.documents')}
              <strong>
                {optionsBusy || options.error || !state.resources
                  ? '—'
                  : `${documentCount}${state.resourcesLimited ? '+' : ''}`}
              </strong>
            </li>
            <li className={styles.sourceRow}>
              {t('home.members')}
              <strong>
                {optionsBusy || options.error || !state.members
                  ? '—'
                  : state.members.length}
              </strong>
            </li>
            <li className={styles.sourceRow}>
              {t('home.workOrders')}
              <strong>{t('home.included')}</strong>
            </li>
            <li className={styles.sourceRow}>
              {t('home.memory')}
              <strong>{t('home.included')}</strong>
            </li>
          </ul>
          <p className={styles.muted}>{t('home.sourcesHint')}</p>
        </aside>
      </div>
      <Modal
        open={creating}
        onOpenChange={setCreating}
        title={t('createReport')}
      >
        <div className={styles.stack}>
          <p className={styles.muted}>{t('draftVisibility')}</p>
          <SelectField
            label={t('template')}
            value={template?.current.id ?? ''}
            options={(state.templates ?? [])
              .filter(item => item.status === 'active')
              .map((item: ReportTemplateRecord) => ({
                value: item.current.id,
                label: item.name,
              }))}
            onChange={setTemplate}
          />
          <TextField label={t('title')} value={title} onChange={setTitle} />
          <div className={styles.formGrid}>
            <TextField
              label={t('periodStart')}
              type="datetime-local"
              value={start}
              onChange={setStart}
            />
            <TextField
              label={t('periodEndExclusive')}
              type="datetime-local"
              value={end}
              onChange={setEnd}
            />
          </div>
          <TextField
            label={t('instructions')}
            multiline
            value={instructions}
            onChange={setInstructions}
          />
          <details>
            <summary>{t('advanced')}</summary>
            <div className={styles.stack}>
              <SelectField
                label={t('audience')}
                value={audience}
                options={['', 'management', 'customer', 'team'].map(value => ({
                  value: value as typeof audience,
                  label: value ? t(value) : t('template'),
                }))}
                onChange={setAudience}
              />
              <SelectField
                label={t('language')}
                value={language}
                options={['', 'en', 'zh-Hans', 'zh-Hant'].map(value => ({
                  value: value as typeof language,
                  label: value || t('template'),
                }))}
                onChange={setLanguage}
              />
              <TextField
                label={t('durationMinutes')}
                type="number"
                value={duration}
                onChange={setDuration}
              />
              <TextField
                label={t('timeZone')}
                value={zone}
                onChange={setZone}
              />
              <SourceSelection
                value={selection}
                resources={state.resources ?? []}
                limited={state.resourcesLimited}
                onChange={setSelection}
              />
              <SelectField
                label={t('responsible')}
                value={responsible}
                options={[
                  { value: '', label: t('creatorDefault') },
                  ...(state.members ?? []).map(member => ({
                    value: member.id,
                    label: member.name,
                  })),
                ]}
                onChange={setResponsible}
              />
            </div>
          </details>
          {!!options.error && (
            <p role="alert">{projectErrorMessage(options.error)}</p>
          )}
          {!!options.error && (
            <Button disabled={optionsBusy} onClick={() => void retryOptions()}>
              {t('retry')}
            </Button>
          )}
          {templateError && <p role="alert">{templateError}</p>}
          <div className={styles.row}>
            <Button
              disabled={
                action.pending ||
                optionsBusy ||
                !!options.error ||
                !writable ||
                !template
              }
              onClick={() => void create(false)}
            >
              {t('createBlank')}
            </Button>
            <Button
              variant="primary"
              loading={action.pending}
              disabled={
                action.pending ||
                optionsBusy ||
                !!options.error ||
                !writable ||
                !template
              }
              onClick={() => void create(true)}
            >
              {t('generate')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
