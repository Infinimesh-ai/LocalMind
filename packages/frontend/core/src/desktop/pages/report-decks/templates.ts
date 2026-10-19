import {
  DECK_TEMPLATES,
  type DeckSpec,
  type DeckTemplate,
  renderDeckCover,
  renderDeckHtml,
} from '@localmind/office/report-deck';

export type DeckLanguage = 'zh-CN' | 'en';

/** Display data for one renderer template. */
export type GalleryTemplate = {
  key: string;
  name: string;
  description: string;
  purposes: string[];
  swatches: string[];
  template: DeckTemplate;
  sample: DeckSpec | null;
};

export function galleryTemplates(): GalleryTemplate[] {
  return DECK_TEMPLATES.map(template => ({
    key: template.key,
    name: template.name || template.key,
    description: template.description ?? '',
    purposes: [...(template.purposes ?? [])],
    swatches: [
      ...new Set(
        [
          template.theme.background,
          template.theme.accent,
          template.theme.accent2,
        ].filter(Boolean)
      ),
    ],
    template,
    sample: template.sample ?? null,
  }));
}

export function coverHtml(
  item: GalleryTemplate,
  options: { accentColor?: string; language: DeckLanguage }
): string | null {
  if (!item.sample) return null;
  try {
    return renderDeckCover(item.sample, item.template, options);
  } catch {
    return null;
  }
}

export function previewHtml(
  item: GalleryTemplate,
  options: { accentColor?: string; language: DeckLanguage }
): string | null {
  if (!item.sample) return null;
  try {
    return renderDeckHtml({
      spec: item.sample,
      template: item.template,
      language: options.language,
      accentColor: options.accentColor,
    }).html;
  } catch {
    return null;
  }
}
