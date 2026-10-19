import { Modal } from '@affine/component';
import {
  useDeckLanguage,
  useDeckText,
} from '@affine/core/modules/report-decks/i18n';
import { ViewIcon } from '@blocksuite/icons/rc';
import { useEffect, useMemo, useRef, useState } from 'react';

import * as styles from './report-decks.css';
import {
  coverHtml,
  type DeckLanguage,
  type GalleryTemplate,
  galleryTemplates,
  previewHtml,
} from './templates';

const STAGE_WIDTH = 1280;

function useVisible(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined'
  );
  useEffect(() => {
    if (visible || !ref.current) return;
    const observer = new IntersectionObserver(
      entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '240px' }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, visible]);
  return visible;
}

function useScale(ref: React.RefObject<HTMLElement | null>) {
  const [scale, setScale] = useState(0.2);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setScale(width / STAGE_WIDTH);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return scale;
}

/**
 * A real rendered cover: the template's sample deck, drawn by the renderer at
 * stage size inside a sandboxed, non-interactive iframe and scaled to fit.
 */
export function DeckCover({
  item,
  language,
  accentColor,
  title,
}: {
  item: GalleryTemplate;
  language: DeckLanguage;
  accentColor?: string;
  title: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useVisible(ref);
  const scale = useScale(ref);
  const html = useMemo(
    () => (visible ? coverHtml(item, { language, accentColor }) : null),
    [visible, item, language, accentColor]
  );
  const [loaded, setLoaded] = useState(false);
  return (
    <div className={styles.cover} ref={ref} data-testid="deck-cover">
      {(!html || !loaded) && (
        <span className={styles.coverPlaceholder} aria-hidden="true" />
      )}
      {html && (
        <iframe
          className={styles.coverFrame}
          title={title}
          sandbox="allow-scripts"
          srcDoc={html}
          tabIndex={-1}
          aria-hidden="true"
          loading="lazy"
          onLoad={() => setLoaded(true)}
          style={{ transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}

export function useGalleryTemplates() {
  const language = useDeckLanguage();
  const templates = useMemo(() => galleryTemplates(), []);
  return { templates, language };
}

export function TemplatePreviewDialog({
  item,
  language,
  onClose,
  onUse,
}: {
  item: GalleryTemplate | null;
  language: DeckLanguage;
  onClose: () => void;
  onUse: (key: string) => void;
}) {
  const t = useDeckText();
  const html = useMemo(
    () => (item ? previewHtml(item, { language }) : null),
    [item, language]
  );
  return (
    <Modal
      open={!!item}
      onOpenChange={open => !open && onClose()}
      title={item?.name}
      description={item?.description}
      width="min(1040px, 92vw)"
    >
      <div className={styles.stack}>
        <div className={styles.previewStage}>
          {html && (
            <iframe
              className={styles.frame}
              title={t('gallery.previewTitle', { name: item?.name ?? '' })}
              sandbox="allow-scripts"
              allow="fullscreen"
              srcDoc={html}
            />
          )}
        </div>
        <div className={styles.row}>
          <p className={styles.muted}>{t('gallery.previewHint')}</p>
          <span className={styles.spacer} />
          <button type="button" className={styles.button} onClick={onClose}>
            {t('action.close')}
          </button>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => item && onUse(item.key)}
          >
            {t('gallery.use')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Home page masonry: every template with its real cover. */
export function TemplateGallery({ onUse }: { onUse: (key: string) => void }) {
  const t = useDeckText();
  const { templates, language } = useGalleryTemplates();
  const [preview, setPreview] = useState<GalleryTemplate | null>(null);
  return (
    <>
      <div className={styles.masonry} data-testid="template-gallery">
        {templates.map(item => (
          <article key={item.key} className={styles.templateCard}>
            <DeckCover item={item} language={language} title={item.name} />
            <div className={styles.templateBody}>
              <h3 className={styles.templateName}>
                {item.name}
                {item.swatches.length > 0 && (
                  <span className={styles.swatches} aria-hidden="true">
                    {item.swatches.map(color => (
                      <span
                        key={color}
                        className={styles.swatch}
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                )}
              </h3>
              {item.description && (
                <p className={styles.templateDescription}>{item.description}</p>
              )}
              {item.purposes.length > 0 && (
                <div className={styles.templateTags}>
                  {item.purposes.map(purpose => (
                    <span key={purpose} className={styles.pill}>
                      {t(`purpose.${purpose}`)}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className={styles.templateHit}
              aria-label={t('gallery.useNamed', { name: item.name })}
              onClick={() => onUse(item.key)}
            />
            <button
              type="button"
              className={styles.previewButton}
              onClick={() => setPreview(item)}
            >
              <ViewIcon />
              {t('gallery.preview')}
            </button>
          </article>
        ))}
      </div>
      <TemplatePreviewDialog
        item={preview}
        language={language}
        onClose={() => setPreview(null)}
        onUse={key => {
          setPreview(null);
          onUse(key);
        }}
      />
    </>
  );
}

/** Compact picker for the configuration page. */
export function TemplatePicker({
  value,
  accentColor,
  onChange,
}: {
  value: string | undefined;
  accentColor?: string;
  onChange: (key: string) => void;
}) {
  const t = useDeckText();
  const { templates, language } = useGalleryTemplates();
  const [preview, setPreview] = useState<GalleryTemplate | null>(null);
  const selected = templates.find(item => item.key === value);
  return (
    <>
      <div
        className={styles.pickerGrid}
        role="group"
        aria-label={t('config.template')}
      >
        {templates.map(item => (
          <button
            key={item.key}
            type="button"
            className={styles.pickerCard}
            aria-pressed={value === item.key}
            onClick={() => onChange(item.key)}
          >
            <DeckCover
              item={item}
              language={language}
              accentColor={value === item.key ? accentColor : undefined}
              title={item.name}
            />
            <span className={styles.pickerLabel}>{item.name}</span>
          </button>
        ))}
      </div>
      {selected && (
        <div className={styles.row}>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => setPreview(selected)}
          >
            <ViewIcon />
            {t('gallery.previewNamed', { name: selected.name })}
          </button>
        </div>
      )}
      <TemplatePreviewDialog
        item={preview}
        language={language}
        onClose={() => setPreview(null)}
        onUse={key => {
          setPreview(null);
          onChange(key);
        }}
      />
    </>
  );
}
