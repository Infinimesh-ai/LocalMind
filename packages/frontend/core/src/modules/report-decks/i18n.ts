import { useTranslation } from '@affine/i18n';
import { useCallback } from 'react';

export const DECK_TEXT_PREFIX = 'com.affine.localmind.reportDeck';

export type DeckText = (
  key: string,
  params?: Record<string, string | number>
) => string;

/** Dynamic keys keep typecheck independent of the generated i18n file. */
export function useDeckText(): DeckText {
  const { t } = useTranslation();
  return useCallback(
    (key: string, params?: Record<string, string | number>) =>
      t(`${DECK_TEXT_PREFIX}.${key}`, params),
    [t]
  );
}

/** Deck content language matching the UI language. */
export function useDeckLanguage(): 'zh-CN' | 'en' {
  const { i18n } = useTranslation();
  return (i18n.language ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}
