import type { DeckText } from '@affine/core/modules/report-decks/i18n';
import { useDeckText } from '@affine/core/modules/report-decks/i18n';
import type {
  DeckAiChoice,
  DeckAiOption,
  DeckAiOptionsResult,
} from '@affine/core/modules/report-decks/types';
import { InformationIcon, WarningIcon } from '@blocksuite/icons/rc';

import { DeckSelect } from './deck-ui';
import * as styles from './report-decks.css';

const optionKey = (option: { scopeKind: string; scopeId: string }) =>
  `${option.scopeKind}:${option.scopeId}`;

const sameScope = (
  a: { scopeKind: string; scopeId: string } | null | undefined,
  b: { scopeKind: string; scopeId: string } | null | undefined
) => !!a && !!b && a.scopeKind === b.scopeKind && a.scopeId === b.scopeId;

/** The AI the server will use: the explicit choice, else the default. */
export function effectiveAiChoice(
  result: DeckAiOptionsResult | undefined,
  value: DeckAiChoice | null
): DeckAiChoice | null {
  return value ?? result?.defaultChoice ?? null;
}

/** Why generation cannot use the current AI selection, if it cannot. */
export function aiBlockReason(
  result: DeckAiOptionsResult | undefined,
  value: DeckAiChoice | null,
  state: { loading: boolean; error: unknown }
): string | null {
  if (!result) return state.error ? 'ai.loadFailed' : 'ai.loading';
  const choice = effectiveAiChoice(result, value);
  if (!choice) return 'ai.noneAvailable';
  const option = result.options.find(item => sameScope(item, choice));
  if (!option || !option.available) return 'ai.selectedUnavailable';
  return null;
}

function scopeName(option: DeckAiOption, t: DeckText) {
  return `${t(option.scopeKind === 'project' ? 'scope.project' : 'scope.workspace')} · ${option.label}`;
}

function optionText(option: DeckAiOption, isDefault: boolean, t: DeckText) {
  const parts = [scopeName(option, t)];
  if (option.available && option.providerName) parts.push(option.providerName);
  if (!option.available)
    parts.push(t(`ai.reason.${option.reason ?? 'not_configured'}`));
  return `${parts.join(' — ')}${isDefault ? ` ${t('ai.defaultMark')}` : ''}`;
}

export function AiPicker({
  result,
  loading,
  error,
  value,
  onChange,
  designMode,
}: {
  result: DeckAiOptionsResult | undefined;
  loading: boolean;
  error?: unknown;
  value: DeckAiChoice | null;
  designMode?: 'fast' | 'refine';
  onChange: (value: DeckAiChoice | null) => void;
}) {
  const t = useDeckText();
  if (!result)
    return (
      <p className={styles.muted} role="status">
        {t(error && !loading ? 'ai.loadFailed' : 'ai.loading')}
      </p>
    );
  const choice = effectiveAiChoice(result, value);
  const selected = result.options.find(option => sameScope(option, choice));
  const fromSources = result.options.filter(option => option.fromSources);
  const others = result.options.filter(option => !option.fromSources);
  const firstSource = fromSources[0];
  const otherSourceScopes = fromSources.filter(
    option => !sameScope(option, selected)
  );
  const fallbackFrom =
    !value && result.defaultFallbackFrom
      ? (result.options.find(option =>
          sameScope(option, result.defaultFallbackFrom)
        ) ?? null)
      : null;
  const modelId =
    choice?.modelId ??
    selected?.defaultModelId ??
    selected?.models[0]?.id ??
    '';
  const modelName =
    selected?.models.find(model => model.id === modelId)?.name ?? modelId;
  return (
    <div className={styles.aiPicker}>
      <label className={styles.field}>
        {t('ai.label')}
        <DeckSelect
          value={selected ? optionKey(selected) : ''}
          onChange={event => {
            const option = result.options.find(
              item => optionKey(item) === event.target.value
            );
            if (!option) return;
            onChange(
              sameScope(option, result.defaultChoice)
                ? null
                : { scopeKind: option.scopeKind, scopeId: option.scopeId }
            );
          }}
        >
          {!selected && <option value="">{t('ai.noneAvailable')}</option>}
          {fromSources.length > 0 && (
            <optgroup label={t('ai.groupSources')}>
              {fromSources.map(option => (
                <option
                  key={optionKey(option)}
                  value={optionKey(option)}
                  disabled={!option.available}
                >
                  {optionText(option, option === firstSource, t)}
                </option>
              ))}
            </optgroup>
          )}
          {others.length > 0 && (
            <optgroup label={t('ai.groupOther')}>
              {others.map(option => (
                <option
                  key={optionKey(option)}
                  value={optionKey(option)}
                  disabled={!option.available}
                >
                  {optionText(option, false, t)}
                </option>
              ))}
            </optgroup>
          )}
        </DeckSelect>
      </label>
      {selected?.available &&
        (selected.scopeKind === 'workspace' &&
        !selected.modelLocked &&
        selected.models.length > 0 ? (
          <label className={styles.field}>
            {t('ai.model')}
            <DeckSelect
              value={modelId}
              onChange={event =>
                onChange({
                  scopeKind: selected.scopeKind,
                  scopeId: selected.scopeId,
                  modelId: event.target.value,
                })
              }
            >
              {selected.models.map(model => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </DeckSelect>
          </label>
        ) : (
          <div className={styles.aiMeta}>
            <span className={styles.pill}>
              {t('ai.provider', { provider: selected.providerName ?? '—' })}
            </span>
            {modelName && (
              <span className={styles.pill}>
                {t('ai.modelValue', { model: modelName })}
              </span>
            )}
            {selected.modelLocked && (
              <span className={styles.muted}>{t('ai.modelLocked')}</span>
            )}
          </div>
        ))}
      {designMode === 'refine' && selected?.available && (
        <div
          className={styles.muted}
          role="status"
          data-testid="deck-vision-hint"
        >
          <p>
            {t(
              selected.models.find(model => model.id === modelId)?.vision ===
                'declared'
                ? 'designMode.visionDeclared'
                : 'designMode.visionUnknown'
            )}
          </p>
          <p>{t('designMode.visionFallback')}</p>
          {selected.modelLocked && <p>{t('designMode.visionLocked')}</p>}
        </div>
      )}
      {fallbackFrom && selected && (
        <p className={styles.notice} data-tone="warning" role="status">
          <WarningIcon />
          <span>
            {t('ai.fallback', {
              from: fallbackFrom.label,
              to: selected.label,
            })}
          </span>
        </p>
      )}
      {selected?.available && otherSourceScopes.length > 0 && (
        <p className={styles.notice} role="note" data-testid="ai-cross-scope">
          <InformationIcon />
          <span>
            {t('ai.crossScope', {
              sources: otherSourceScopes
                .map(option => option.label)
                .join(t('listSeparator')),
              target: selected.label,
              provider: selected.providerName ?? t('ai.unknownProvider'),
            })}
          </span>
        </p>
      )}
    </div>
  );
}
