import { notify } from '@affine/component';
import {
  getReportDeckPath,
  getReportDecksPath,
} from '@affine/core/desktop/route-paths';
import {
  loadLastDeckConfig,
  saveLastDeckConfig,
  useDeck,
  useDeckAiOptions,
  useDeckCommand,
  useDeckList,
  useDeckPreflight,
} from '@affine/core/modules/report-decks/hooks';
import {
  useDeckLanguage,
  useDeckText,
} from '@affine/core/modules/report-decks/i18n';
import { readDeckSources } from '@affine/core/modules/report-decks/source-handoff';
import {
  ACTIVE_DECK_STATUSES,
  type DeckAiChoice,
  type DeckConfigInput,
  type DeckSourceRef,
  type DeckSourceView,
} from '@affine/core/modules/report-decks/types';
import {
  ArrowLeftSmallIcon,
  CloseIcon,
  PlusIcon,
  WarningIcon,
} from '@blocksuite/icons/rc';
import {
  DECK_LENGTH_SLIDES,
  DECK_SOURCE_LIMIT,
  DeckConfigSchema,
} from '@localmind/office/report-deck';
import { nanoid } from 'nanoid';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { aiBlockReason, AiPicker } from './ai-picker';
import {
  DeckSelect,
  dedupeSources,
  formatChars,
  sourceKey,
  SourceKindIcon,
  sourceViewToRef,
} from './deck-ui';
import * as styles from './report-decks.css';
import { SourcePicker } from './source-picker';
import { TemplatePicker, useGalleryTemplates } from './template-gallery';

const PURPOSES = [
  'periodic',
  'progress',
  'customer',
  'decision',
  'retrospective',
  'training',
  'other',
] as const;
const AUDIENCES = ['team', 'management', 'customer', 'public'] as const;
const LENGTHS = ['short', 'standard', 'long'] as const;
const LANGUAGES = ['zh-CN', 'en'] as const;
const TONES = ['formal', 'concise', 'vivid'] as const;
const STYLE_CHIPS = [
  'tech',
  'minimal',
  'editorial',
  'business',
  'vivid',
] as const;
const MAX_ACTIVE = 2;
const STYLE_LIMIT = 500;
const INSTRUCTIONS_LIMIT = 2000;

type FormState = {
  mode: 'template' | 'custom';
  designMode: 'fast' | 'refine';
  templateKey?: string;
  customStyle: string;
  accentColor?: string;
  purpose: (typeof PURPOSES)[number];
  audience: (typeof AUDIENCES)[number];
  length: (typeof LENGTHS)[number];
  language: (typeof LANGUAGES)[number];
  tone: (typeof TONES)[number];
  preferences: {
    charts: boolean;
    citations: boolean;
    conclusionFirst: boolean;
  };
  instructions: string;
  title: string;
};

function initialForm(
  language: FormState['language'],
  template: string | null
): FormState {
  const last = loadLastDeckConfig();
  return {
    mode: template ? 'template' : (last.mode ?? 'template'),
    designMode: 'fast',
    templateKey: template ?? last.templateKey,
    customStyle: last.customStyle ?? '',
    accentColor: last.accentColor,
    purpose: last.purpose ?? 'progress',
    audience: last.audience ?? 'team',
    length: last.length ?? 'standard',
    language: last.language ?? language,
    tone: last.tone ?? 'formal',
    preferences: {
      charts: last.preferences?.charts ?? true,
      citations: last.preferences?.citations ?? false,
      conclusionFirst: last.preferences?.conclusionFirst ?? true,
    },
    instructions: '',
    title: '',
  };
}

/** The request payload; template/custom-only fields are dropped. */
export function buildDeckConfig(
  form: FormState,
  ai: DeckAiChoice | null
): DeckConfigInput {
  const customStyle = form.customStyle.trim();
  const title = form.title.trim();
  return {
    mode: form.mode,
    ...(form.mode === 'custom' ? { designMode: form.designMode } : {}),
    ...(form.mode === 'template' && form.templateKey
      ? { templateKey: form.templateKey }
      : {}),
    ...(form.mode === 'custom' && customStyle ? { customStyle } : {}),
    ...(form.accentColor ? { accentColor: form.accentColor } : {}),
    purpose: form.purpose,
    audience: form.audience,
    length: form.length,
    language: form.language,
    tone: form.tone,
    preferences: { ...form.preferences },
    instructions: form.instructions.trim(),
    ...(title ? { title } : {}),
    ...(ai ? { ai } : {}),
  };
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className={styles.field}>
      {label}
      <DeckSelect
        value={value}
        onChange={event => onChange(event.target.value as T)}
      >
        {options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </DeckSelect>
    </label>
  );
}

function Card({
  step,
  title,
  hint,
  children,
}: {
  step: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.card} aria-label={title}>
      <div className={styles.cardAside}>
        <span className={styles.stepNumber}>
          {String(step).padStart(2, '0')}
        </span>
        <h2 className={styles.cardTitle}>{title}</h2>
        {hint && <p className={styles.muted}>{hint}</p>}
      </div>
      <div className={styles.cardMain}>{children}</div>
    </section>
  );
}

function SourceRow({
  source,
  view,
  checking,
  onRemove,
}: {
  source: DeckSourceRef;
  view: DeckSourceView | undefined;
  checking: boolean;
  onRemove: () => void;
}) {
  const t = useDeckText();
  const language = useDeckLanguage();
  const excluded = view?.status === 'excluded';
  const title =
    view?.title ||
    source.title ||
    (source.kind === 'project_all' ? t('source.wholeProject') : t('untitled'));
  const scope =
    view?.scopeLabel ||
    t(source.scopeKind === 'project' ? 'scope.project' : 'scope.workspace');
  return (
    <li
      className={styles.sourceRow}
      data-excluded={excluded || undefined}
      data-testid="deck-source"
    >
      <SourceKindIcon kind={source.kind} />
      <span className={styles.sourceTitle}>
        <strong>
          {source.kind === 'project_all'
            ? t('source.wholeProjectNamed', { name: title })
            : title}
        </strong>
        <span>
          {t(
            source.scopeKind === 'project' ? 'scope.project' : 'scope.workspace'
          )}{' '}
          · {scope}
        </span>
      </span>
      {view ? (
        view.status === 'excluded' ? (
          <span className={styles.pill} data-tone="danger">
            {t(`source.reason.${view.reason ?? 'unsupported'}`)}
          </span>
        ) : view.status === 'truncated' ? (
          <span className={styles.pill} data-tone="warning">
            {t('source.truncated')}
          </span>
        ) : (
          <span className={styles.pill} data-tone="success">
            {view.chars
              ? formatChars(view.chars, t, language)
              : t('source.included')}
          </span>
        )
      ) : (
        <span className={styles.pill}>
          {t(checking ? 'source.checking' : 'source.pending')}
        </span>
      )}
      <button
        type="button"
        className={styles.iconButton}
        aria-label={t('source.remove', { title })}
        title={t('action.remove')}
        onClick={onRemove}
      >
        <CloseIcon />
      </button>
    </li>
  );
}

export function DeckConfigPage() {
  const t = useDeckText();
  const uiLanguage = useDeckLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const handoff = params.get('handoff');
  const fromDeckId = params.get('from');
  const templateParam = params.get('template');
  const { templates } = useGalleryTemplates();
  const [sources, setSources] = useState<DeckSourceRef[]>(() =>
    dedupeSources(readDeckSources(handoff))
  );
  const [form, setForm] = useState<FormState>(() =>
    initialForm(uiLanguage, templateParam)
  );
  useEffect(() => {
    setForm(current => ({ ...current, designMode: 'fast' }));
  }, [handoff, fromDeckId, templateParam]);
  const [ai, setAi] = useState<DeckAiChoice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const requestKey = useRef<{ fingerprint: string; key: string } | null>(null);

  // "重新配置": start from a previous deck's sources and configuration.
  const previous = useDeck(fromDeckId);
  const prefilled = useRef(false);
  useEffect(() => {
    const deck = previous.deck;
    if (!deck || prefilled.current) return;
    prefilled.current = true;
    if (!handoff) setSources(dedupeSources(deck.sources.map(sourceViewToRef)));
    const config = deck.config;
    setForm(current => ({
      ...current,
      mode: config.mode ?? current.mode,
      designMode: 'fast',
      templateKey: config.templateKey ?? current.templateKey,
      customStyle: config.customStyle ?? '',
      accentColor: config.accentColor,
      purpose: config.purpose ?? current.purpose,
      audience: config.audience ?? current.audience,
      length: config.length ?? current.length,
      language: config.language ?? current.language,
      tone: config.tone ?? current.tone,
      preferences: { ...current.preferences, ...config.preferences },
      instructions: config.instructions ?? '',
      title: config.title ?? '',
    }));
    if (config.ai) setAi(config.ai);
  }, [previous.deck, handoff]);

  // Template mode always has a template; default to the first one.
  useEffect(() => {
    if (form.mode !== 'template' || !templates.length) return;
    if (
      form.templateKey &&
      templates.some(item => item.key === form.templateKey)
    )
      return;
    setForm(current => ({ ...current, templateKey: templates[0]?.key }));
  }, [form.mode, form.templateKey, templates]);

  const preflight = useDeckPreflight(sources);
  const aiOptions = useDeckAiOptions(sources);
  const active = useDeckList(10);
  const activeCount = active.items.filter(item =>
    ACTIVE_DECK_STATUSES.has(item.status)
  ).length;
  const command = useDeckCommand();

  const views = useMemo(() => {
    const map = new Map<string, DeckSourceView>();
    for (const view of preflight.preflight?.sources ?? [])
      if (!map.has(sourceKey(view))) map.set(sourceKey(view), view);
    return map;
  }, [preflight.preflight]);
  const included = preflight.preflight?.includedCount ?? 0;
  const config = buildDeckConfig(form, ai);
  const valid = DeckConfigSchema.safeParse(config).success;
  const aiReason = aiBlockReason(aiOptions.options, ai, {
    loading: aiOptions.loading,
    error: aiOptions.error,
  });
  const blockReason = !sources.length
    ? 'block.noSources'
    : preflight.loading && !preflight.preflight
      ? 'block.checking'
      : preflight.error && !preflight.preflight
        ? 'block.preflightFailed'
        : included === 0
          ? 'block.noIncluded'
          : aiReason
            ? `block.${aiReason}`
            : form.mode === 'template' && !form.templateKey
              ? 'block.noTemplate'
              : !valid
                ? 'block.invalid'
                : activeCount >= MAX_ACTIVE
                  ? 'block.tooManyActive'
                  : null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(current => ({ ...current, [key]: value }));

  const submit = async () => {
    if (blockReason || command.pending) return;
    const payload = { sources, config };
    const fingerprint = JSON.stringify(payload);
    // Retries of the same submission reuse the key, so the server dedupes them.
    if (requestKey.current?.fingerprint !== fingerprint)
      requestKey.current = { fingerprint, key: nanoid() };
    setSubmitError(false);
    try {
      const result = await command.run({
        operation: 'create',
        requestKey: requestKey.current.key,
        sources,
        config,
      });
      saveLastDeckConfig(config);
      if (result.deck) navigate(getReportDeckPath(result.deck.id));
      else navigate(getReportDecksPath());
    } catch {
      setSubmitError(true);
      notify.error({ title: t('error.createFailed') });
    }
  };

  const minutes = preflight.preflight?.estimatedMinutes ?? 0;
  const excluded = preflight.preflight?.excludedCount ?? 0;
  const [minSlides, maxSlides] = DECK_LENGTH_SLIDES[form.length];

  return (
    <>
      <div className={styles.scroll}>
        <div className={`${styles.container} ${styles.narrow}`}>
          <header className={styles.configHeader}>
            <button
              type="button"
              className={styles.backLink}
              onClick={() => navigate(getReportDecksPath())}
            >
              <ArrowLeftSmallIcon />
              {t('home.title')}
            </button>
            <h1 className={styles.pageTitle}>{t('config.title')}</h1>
            <p className={styles.pageLead}>{t('config.subtitle')}</p>
          </header>

          <Card
            step={1}
            title={t('config.sources')}
            hint={t('config.sourcesHint')}
          >
            {sources.length ? (
              <ul
                className={styles.sourceList}
                aria-label={t('config.sources')}
              >
                {sources.map(source => (
                  <SourceRow
                    key={sourceKey(source)}
                    source={source}
                    view={views.get(sourceKey(source))}
                    checking={preflight.loading}
                    onRemove={() =>
                      setSources(current =>
                        current.filter(
                          item => sourceKey(item) !== sourceKey(source)
                        )
                      )
                    }
                  />
                ))}
              </ul>
            ) : (
              <p className={styles.notice}>{t('config.noSources')}</p>
            )}
            <div className={styles.row}>
              <button
                type="button"
                className={styles.button}
                disabled={sources.length >= DECK_SOURCE_LIMIT}
                onClick={() => setPickerOpen(true)}
              >
                <PlusIcon />
                {t('config.addSource')}
              </button>
              {preflight.preflight && (
                <span className={styles.muted}>
                  {t('config.sourceSummary', {
                    included,
                    excluded,
                    chars: formatChars(
                      preflight.preflight.totalChars,
                      t,
                      uiLanguage
                    ),
                  })}
                </span>
              )}
            </div>
          </Card>

          <Card step={2} title={t('config.mode')} hint={t('config.modeHint')}>
            <div
              className={styles.segmented}
              role="group"
              aria-label={t('config.mode')}
            >
              {(['template', 'custom'] as const).map(mode => (
                <button
                  key={mode}
                  type="button"
                  className={styles.segment}
                  aria-pressed={form.mode === mode}
                  onClick={() => update('mode', mode)}
                >
                  <strong>{t(`mode.${mode}`)}</strong>
                  <span>{t(`mode.${mode}Hint`)}</span>
                </button>
              ))}
            </div>
            {form.mode === 'template' ? (
              <TemplatePicker
                value={form.templateKey}
                accentColor={form.accentColor}
                onChange={key => update('templateKey', key)}
              />
            ) : (
              <>
                <fieldset className={styles.designModes}>
                  <legend>{t('designMode.label')}</legend>
                  <div className={styles.designModeOptions}>
                    {(['fast', 'refine'] as const).map(mode => (
                      <label
                        key={mode}
                        className={styles.designModeOption}
                        data-selected={form.designMode === mode}
                      >
                        <input
                          type="radio"
                          name="report-design-mode"
                          value={mode}
                          checked={form.designMode === mode}
                          onChange={() => update('designMode', mode)}
                        />
                        <span>
                          <strong>{t(`designMode.${mode}`)}</strong>
                          <span>{t(`designMode.${mode}Hint`)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className={styles.muted}>{t('designMode.hint')}</p>
                </fieldset>
                <label className={styles.field}>
                  {t('config.customStyle')}
                  <textarea
                    className={styles.textarea}
                    value={form.customStyle}
                    maxLength={STYLE_LIMIT}
                    placeholder={t('config.customStylePlaceholder')}
                    onChange={event =>
                      update('customStyle', event.target.value)
                    }
                  />
                  <span className={styles.fieldFoot}>
                    <span>{t('config.customStyleHint')}</span>
                    <span>
                      {form.customStyle.length}/{STYLE_LIMIT}
                    </span>
                  </span>
                </label>
                <div
                  className={styles.row}
                  role="group"
                  aria-label={t('config.styleChips')}
                >
                  {STYLE_CHIPS.map(chip => {
                    const value = t(`styleChip.${chip}.text`);
                    return (
                      <button
                        key={chip}
                        type="button"
                        className={styles.chip}
                        aria-pressed={form.customStyle === value}
                        onClick={() =>
                          update('customStyle', value.slice(0, STYLE_LIMIT))
                        }
                      >
                        {t(`styleChip.${chip}.label`)}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className={styles.field}>
              {t(
                form.mode === 'template'
                  ? 'config.accentOverride'
                  : 'config.accent'
              )}
              <div className={styles.colorRow}>
                <input
                  type="color"
                  className={styles.colorInput}
                  aria-label={t('config.accent')}
                  value={form.accentColor ?? '#556678'}
                  onChange={event => update('accentColor', event.target.value)}
                />
                <span className={styles.muted}>
                  {form.accentColor ?? t('config.accentDefault')}
                </span>
                {form.accentColor && (
                  <button
                    type="button"
                    className={styles.ghostButton}
                    onClick={() => update('accentColor', undefined)}
                  >
                    {t('config.accentReset')}
                  </button>
                )}
              </div>
            </div>
          </Card>

          <Card
            step={3}
            title={t('config.content')}
            hint={t('config.contentHint')}
          >
            <div className={styles.grid3}>
              <Select
                label={t('config.purpose')}
                value={form.purpose}
                options={PURPOSES.map(value => ({
                  value,
                  label: t(`purpose.${value}`),
                }))}
                onChange={value => update('purpose', value)}
              />
              <Select
                label={t('config.audience')}
                value={form.audience}
                options={AUDIENCES.map(value => ({
                  value,
                  label: t(`audience.${value}`),
                }))}
                onChange={value => update('audience', value)}
              />
              <Select
                label={t('config.length')}
                value={form.length}
                options={LENGTHS.map(value => ({
                  value,
                  label: t('length.option', {
                    name: t(`length.${value}`),
                    min: DECK_LENGTH_SLIDES[value][0],
                    max: DECK_LENGTH_SLIDES[value][1],
                  }),
                }))}
                onChange={value => update('length', value)}
              />
              <Select
                label={t('config.language')}
                value={form.language}
                options={LANGUAGES.map(value => ({
                  value,
                  label: t(`language.${value}`),
                }))}
                onChange={value => update('language', value)}
              />
              <Select
                label={t('config.tone')}
                value={form.tone}
                options={TONES.map(value => ({
                  value,
                  label: t(`tone.${value}`),
                }))}
                onChange={value => update('tone', value)}
              />
            </div>
            <div className={styles.grid3}>
              {(['charts', 'citations', 'conclusionFirst'] as const).map(
                key => (
                  <label key={key} className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={form.preferences[key]}
                      onChange={event =>
                        update('preferences', {
                          ...form.preferences,
                          [key]: event.target.checked,
                        })
                      }
                    />
                    <span>
                      <strong>{t(`preference.${key}`)}</strong>
                      <span>{t(`preference.${key}Hint`)}</span>
                    </span>
                  </label>
                )
              )}
            </div>
            <label className={styles.field}>
              {t('config.instructions')}
              <textarea
                className={styles.textarea}
                value={form.instructions}
                maxLength={INSTRUCTIONS_LIMIT}
                placeholder={t('config.instructionsPlaceholder')}
                onChange={event => update('instructions', event.target.value)}
              />
              <span className={styles.fieldFoot}>
                <span>{t('config.instructionsHint')}</span>
                <span>
                  {form.instructions.length}/{INSTRUCTIONS_LIMIT}
                </span>
              </span>
            </label>
            <label className={styles.field}>
              {t('config.deckTitle')}
              <input
                className={styles.input}
                value={form.title}
                maxLength={120}
                placeholder={t('config.deckTitlePlaceholder')}
                onChange={event => update('title', event.target.value)}
              />
            </label>
          </Card>

          <Card step={4} title={t('config.ai')} hint={t('config.aiHint')}>
            <AiPicker
              result={aiOptions.options}
              loading={aiOptions.loading}
              error={aiOptions.error}
              value={ai}
              onChange={setAi}
              designMode={form.mode === 'custom' ? form.designMode : undefined}
            />
          </Card>
          {activeCount > 0 && (
            <p className={styles.notice} data-tone="warning" role="status">
              <WarningIcon />
              <span>
                {t('config.activeNotice', {
                  count: activeCount,
                  max: MAX_ACTIVE,
                })}
              </span>
            </p>
          )}
          {submitError && (
            <p className={styles.error} role="alert">
              {t('error.createFailed')}
            </p>
          )}
        </div>
      </div>
      <footer className={styles.footer}>
        <div className={styles.footerSummary}>
          <strong data-testid="deck-config-summary">
            {t(
              form.mode === 'custom' ? 'designMode.summary' : 'config.summary',
              {
                count: preflight.preflight ? included : sources.length,
                ...(form.mode === 'custom'
                  ? { mode: t(`designMode.${form.designMode}`) }
                  : { minutes: Math.max(1, minutes) }),
              }
            )}
          </strong>
          <span
            className={styles.muted}
            id="deck-config-reason"
            data-testid="deck-config-reason"
          >
            {blockReason
              ? t(blockReason, { max: MAX_ACTIVE })
              : t('config.summaryDetail', {
                  mode: t(`mode.${form.mode}`),
                  min: minSlides,
                  max: maxSlides,
                })}
          </span>
        </div>
        <button
          type="button"
          className={`${styles.primaryButton} ${styles.largeButton}`}
          disabled={!!blockReason || command.pending}
          aria-describedby="deck-config-reason"
          onClick={() => void submit()}
        >
          {t(
            command.pending
              ? 'config.submitting'
              : form.mode === 'custom'
                ? `designMode.${form.designMode}`
                : 'config.submit'
          )}
        </button>
      </footer>
      <SourcePicker
        open={pickerOpen}
        existing={sources}
        onClose={() => setPickerOpen(false)}
        onConfirm={added => {
          setSources(current =>
            dedupeSources([...current, ...added]).slice(0, DECK_SOURCE_LIMIT)
          );
          setPickerOpen(false);
        }}
      />
    </>
  );
}
