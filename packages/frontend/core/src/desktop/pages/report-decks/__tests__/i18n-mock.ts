import { deckText } from './test-utils';

export const DECK_TEXT_PREFIX = 'com.affine.localmind.reportDeck';
export const useDeckText = () => deckText;
export const useDeckLanguage = () => 'zh-CN' as const;
