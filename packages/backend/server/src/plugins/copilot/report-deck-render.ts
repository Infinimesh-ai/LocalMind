/**
 * The only place the server touches the `@localmind/office/report-deck`
 * renderer. Keeping the surface here makes renderer API changes a one-file fix.
 */
import {
  DECK_FONT_SANS,
  type DeckConfig,
  type DeckSpec,
  getDeckTemplate,
  renderCustomDeckHtml,
  renderDeckHtml,
  sanitizeDeckCss,
  sanitizeDeckFragment,
} from '@localmind/office/report-deck';

export { DECK_FONT_SANS };

export type DeckTemplateBrief = {
  key: string;
  name: string;
  description: string;
};

export function deckTemplateBrief(
  key: string | undefined
): DeckTemplateBrief | null {
  const template = key ? getDeckTemplate(key) : undefined;
  if (!template) return null;
  return {
    key: template.key,
    name: template.name,
    description: template.description,
  };
}

export function hasDeckTemplate(key: string | undefined) {
  return !!key && !!getDeckTemplate(key);
}

export function renderTemplateDeck(input: {
  spec: DeckSpec;
  config: DeckConfig;
}) {
  const template = getDeckTemplate(input.config.templateKey ?? '');
  if (!template) throw new Error('Report deck template is unavailable');
  return renderDeckHtml({
    spec: input.spec,
    template,
    accentColor: input.config.accentColor,
    language: input.config.language,
    citations: input.config.preferences.citations,
  });
}

export function sanitizeCustomSlide(html: string) {
  const result = sanitizeDeckFragment(html);
  return { html: result.html, slideCount: result.slideCount };
}

export function sanitizeCustomCss(css: string) {
  return sanitizeDeckCss(css);
}

export function wrapCustomDeck(input: {
  title: string;
  language: DeckConfig['language'];
  accentColor?: string;
  css: string;
  slidesHtml: string;
}) {
  // Adds the theme variables and intent motion the custom prompt relies on.
  return renderCustomDeckHtml({
    title: input.title,
    language: input.language,
    accentColor: input.accentColor,
    css: input.css,
    html: input.slidesHtml,
  }).html;
}
