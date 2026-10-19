import { Button, Modal } from '@affine/component';
import type { ReportTemplateRecord } from '@affine/core/modules/project-reports/contracts';
import {
  type ReportTemplate,
  ReportTemplateSchema,
} from '@localmind/office/report';
import type { ImportedReportTemplate } from '@localmind/office/report-import';
import { useEffect, useMemo, useState } from 'react';

import { SelectField, TextField, useReportText } from './fields';
import { ReportSlide } from './render';
import * as styles from './reports.css';

const projectBlobUrl = (projectId: string, key: string) =>
  `/api/projects/${encodeURIComponent(projectId)}/blobs/${encodeURIComponent(key)}`;

export function templateAssetUrls(projectId: string, content: ReportTemplate) {
  return Object.fromEntries(
    content.assets.map(asset => [
      asset.id,
      projectBlobUrl(projectId, asset.blobKey),
    ])
  );
}

/**
 * The most representative image of a template: an imported cover thumbnail
 * when one exists, otherwise its real cover and first chapters rendered with
 * the template's own theme and background images.
 */
export function TemplatePreview({
  content,
  assetUrls,
}: {
  content: ReportTemplate;
  assetUrls: Record<string, string>;
}) {
  const preview = content.previewAssetId
    ? assetUrls[content.previewAssetId]
    : undefined;
  // Pages carry the template's own words: its description on the cover and
  // each chapter's writing brief, laid out with the chapter's real layout.
  const page = (index: number) => {
    const chapter = content.chapters[index];
    const text = index === 0 ? content.description : chapter.question;
    return {
      id: chapter.key,
      chapterId: chapter.key,
      title: index === 0 ? content.name : chapter.title,
      notes: '',
      nodes: text
        ? [
            {
              id: `${chapter.key}-brief`,
              type: 'paragraph' as const,
              text,
              claimKind: 'manual' as const,
              sources: [],
            },
          ]
        : [],
      layout: index === 0 ? ('cover' as const) : chapter.layout,
    };
  };
  return (
    <span className={styles.templatePreview} aria-hidden="true">
      {preview ? (
        <img src={preview} alt="" />
      ) : (
        <ReportSlide
          page={page(0)}
          theme={content.theme}
          assetUrls={assetUrls}
          kicker={content.chapters[0]?.title}
        />
      )}
      {content.chapters.length > 1 && (
        <span className={styles.templateStrip}>
          {content.chapters.slice(1, 4).map((_, index) => (
            <ReportSlide
              key={index}
              page={page(index + 1)}
              theme={content.theme}
              assetUrls={assetUrls}
            />
          ))}
        </span>
      )}
    </span>
  );
}

export function TemplateCard({
  projectId,
  template,
  disabled,
  onSelect,
}: {
  projectId: string;
  template: ReportTemplateRecord;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const t = useReportText();
  const content = template.current.content;
  const assetUrls = useMemo(
    () => templateAssetUrls(projectId, content),
    [projectId, content]
  );
  return (
    <button
      type="button"
      className={styles.templateCard}
      disabled={disabled}
      onClick={onSelect}
    >
      <TemplatePreview content={content} assetUrls={assetUrls} />
      <span className={styles.templateInfo}>
        <span className={styles.templateName}>
          {template.name}
          {!template.builtinKey && (
            <span className={styles.pill}>{t('home.customTemplate')}</span>
          )}
        </span>
        <span className={styles.row}>
          <span className={styles.pill} data-tone="signal">
            {t(content.audience)}
          </span>
          <span className={styles.muted}>
            {content.durationMinutes} {t('minutes')} · {content.chapters.length}{' '}
            {t('home.chapterUnit')}
          </span>
        </span>
        {content.description && (
          <span className={styles.templateDescription}>
            {content.description}
          </span>
        )}
        <span className={styles.templateChapters}>
          {content.chapters.map((chapter, index) => (
            <span key={chapter.key}>
              {index + 1} {chapter.title}
            </span>
          ))}
        </span>
        {content.source && (
          <span className={styles.templateSource}>
            {t('home.templateSource')}: {content.source.name}
            {content.source.license ? ` · ${content.source.license}` : ''}
          </span>
        )}
      </span>
    </button>
  );
}

export function TemplateGallerySkeleton() {
  return (
    <>
      {[220, 300, 260].map(height => (
        <span
          key={height}
          className={styles.templateSkeleton}
          style={{ height }}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

type ImportedImageKey = 'cover' | 'background' | 'preview';
type Draft = {
  fileName: string;
  imported: ImportedReportTemplate;
  name: string;
  description: string;
  audience: ReportTemplate['audience'];
  duration: string;
  chapters: ImportedReportTemplate['chapters'];
  source: string;
  license: string;
  confirmed: boolean;
};

const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
// Web APIs need bytes backed by a plain ArrayBuffer.
const copy = (bytes: Uint8Array) => new Uint8Array(bytes);

/** Imports a .pptx/.potx as a report template: theme, background art, outline. */
export function TemplateImport({
  disabled,
  uploadImage,
  onSave,
}: {
  disabled?: boolean;
  uploadImage: (file: File) => Promise<string>;
  onSave: (content: ReportTemplate) => Promise<unknown>;
}) {
  const t = useReportText();
  const [draft, setDraft] = useState<Draft>();
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const importedImages = draft?.imported;
  const urls = useMemo(() => {
    const output: Partial<Record<ImportedImageKey, string>> = {};
    if (!importedImages) return output;
    for (const key of ['cover', 'background', 'preview'] as const) {
      const image = importedImages[key];
      if (image)
        output[key] = URL.createObjectURL(
          new Blob([copy(image.bytes)], { type: image.mimeType })
        );
    }
    return output;
  }, [importedImages]);
  useEffect(
    () => () => Object.values(urls).forEach(url => URL.revokeObjectURL(url)),
    [urls]
  );
  const read = async (file: File) => {
    setError('');
    if (file.size > MAX_IMPORT_BYTES) {
      setError(t('import.tooLarge'));
      return;
    }
    setReading(true);
    try {
      const { importReportTemplateFromPptx } =
        await import('@localmind/office/report-import');
      const imported = importReportTemplateFromPptx(
        new Uint8Array(await file.arrayBuffer())
      );
      const baseName = file.name.replace(/\.(pptx|potx)$/i, '');
      setDraft({
        fileName: file.name,
        imported,
        name: (imported.name ?? baseName).slice(0, 120),
        description: '',
        audience: 'team',
        duration: '10',
        chapters: imported.chapters.length
          ? imported.chapters
          : [{ title: t('import.defaultChapter'), layout: 'cover' }],
        source: file.name,
        license: '',
        confirmed: false,
      });
    } catch {
      setError(t('import.unreadable'));
    } finally {
      setReading(false);
    }
  };
  const preview = useMemo((): ReportTemplate | undefined => {
    if (!draft) return;
    const ids: Partial<Record<ImportedImageKey, string>> = {};
    for (const key of ['cover', 'background', 'preview'] as const)
      if (urls[key]) ids[key] = key;
    return {
      ...content(draft, ids),
      assets: [],
    };
  }, [draft, urls]);
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError('');
    try {
      const assets: ReportTemplate['assets'] = [];
      const ids: Partial<Record<ImportedImageKey, string>> = {};
      // Cover and background are often the same picture; upload it once.
      const uploaded = new Map<string, string>();
      for (const key of ['cover', 'background', 'preview'] as const) {
        const image = draft.imported[key];
        if (!image) continue;
        const digest = [
          ...new Uint8Array(
            await crypto.subtle.digest('SHA-256', copy(image.bytes))
          ),
        ]
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join('');
        let id = uploaded.get(digest);
        if (!id) {
          const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
          const blobKey = await uploadImage(
            new File([copy(image.bytes)], `${key}.${extension}`, {
              type: image.mimeType,
            })
          );
          id = crypto.randomUUID();
          uploaded.set(digest, id);
          assets.push({
            id,
            blobKey,
            mimeType: image.mimeType,
            alt: `${draft.name} · ${key}`,
          });
        }
        ids[key] = id;
      }
      await onSave(
        ReportTemplateSchema.parse({ ...content(draft, ids), assets })
      );
      setDraft(undefined);
    } catch {
      setError(t('import.saveFailed'));
    } finally {
      setSaving(false);
    }
  };
  const update = (patch: Partial<Draft>) =>
    setDraft(current => (current ? { ...current, ...patch } : current));
  const valid =
    !!draft &&
    draft.confirmed &&
    !!draft.name.trim() &&
    draft.chapters.some(chapter => chapter.title.trim()) &&
    Number(draft.duration) >= 1 &&
    Number(draft.duration) <= 120;
  return (
    <>
      <label className={styles.ghostButton} aria-disabled={disabled || reading}>
        {reading ? t('import.reading') : t('import.action')}
        <input
          type="file"
          style={{ display: 'none' }}
          accept=".pptx,.potx,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.openxmlformats-officedocument.presentationml.template"
          disabled={disabled || reading}
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) read(file).catch(() => setError(t('import.unreadable')));
          }}
        />
      </label>
      {error && !draft && (
        <span className={styles.muted} role="alert">
          {error}
        </span>
      )}
      <Modal
        open={!!draft}
        onOpenChange={open => {
          if (!open && !saving) setDraft(undefined);
        }}
        title={t('import.title')}
        width={880}
      >
        {draft && preview && (
          <div className={styles.importLayout}>
            <div className={styles.stack}>
              <TemplatePreview
                content={preview}
                assetUrls={{
                  ...(urls.cover ? { cover: urls.cover } : {}),
                  ...(urls.background ? { background: urls.background } : {}),
                  ...(urls.preview ? { preview: urls.preview } : {}),
                }}
              />
              <p className={styles.muted}>{t('import.extracted')}</p>
            </div>
            <div className={styles.stack}>
              <TextField
                label={t('title')}
                value={draft.name}
                onChange={name => update({ name })}
              />
              <TextField
                label={t('import.description')}
                value={draft.description}
                onChange={description => update({ description })}
              />
              <div className={styles.formGrid}>
                <SelectField
                  label={t('audience')}
                  value={draft.audience}
                  options={(['team', 'management', 'customer'] as const).map(
                    value => ({ value, label: t(value) })
                  )}
                  onChange={audience => update({ audience })}
                />
                <TextField
                  label={t('durationMinutes')}
                  type="number"
                  value={draft.duration}
                  onChange={duration => update({ duration })}
                />
              </div>
              <div className={styles.field}>
                <span>{t('chapters')}</span>
                {draft.chapters.map((chapter, index) => (
                  <div className={styles.importChapter} key={index}>
                    <input
                      className={styles.input}
                      aria-label={`${t('chapters')} ${index + 1}`}
                      value={chapter.title}
                      onChange={event =>
                        update({
                          chapters: draft.chapters.map((item, position) =>
                            position === index
                              ? { ...item, title: event.target.value }
                              : item
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className={styles.ghostButton}
                      disabled={draft.chapters.length <= 1}
                      onClick={() =>
                        update({
                          chapters: draft.chapters.filter(
                            (_, position) => position !== index
                          ),
                        })
                      }
                    >
                      {t('import.removeChapter')}
                    </button>
                  </div>
                ))}
              </div>
              <div className={styles.formGrid}>
                <TextField
                  label={t('import.source')}
                  value={draft.source}
                  onChange={source => update({ source })}
                />
                <TextField
                  label={t('import.license')}
                  value={draft.license}
                  onChange={license => update({ license })}
                />
              </div>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={draft.confirmed}
                  onChange={event =>
                    update({ confirmed: event.target.checked })
                  }
                />
                {t('import.rights')}
              </label>
              {error && <p role="alert">{error}</p>}
              <div className={styles.row}>
                <Button disabled={saving} onClick={() => setDraft(undefined)}>
                  {t('cancel')}
                </Button>
                <Button
                  variant="primary"
                  loading={saving}
                  disabled={!valid || saving}
                  onClick={() => void save()}
                >
                  {t('import.save')}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

function content(
  draft: Draft,
  ids: Partial<Record<ImportedImageKey, string>>
): Omit<ReportTemplate, 'assets'> {
  const chapters = draft.chapters
    .map(chapter => ({ ...chapter, title: chapter.title.trim() }))
    .filter(chapter => chapter.title);
  return {
    name: draft.name.trim(),
    audience: draft.audience,
    language: 'zh-Hans',
    durationMinutes: Math.min(120, Math.max(1, Number(draft.duration) || 10)),
    prompt: '',
    description: draft.description.trim() || undefined,
    previewAssetId: ids.preview,
    source: draft.source.trim()
      ? {
          name: draft.source.trim(),
          license: draft.license.trim() || undefined,
        }
      : undefined,
    theme: {
      name: draft.name.trim(),
      fontFamily: 'sans',
      ...draft.imported.theme,
      coverAssetId: ids.cover,
      backgroundAssetId: ids.background,
    },
    chapters: chapters.map((chapter, index) => ({
      key: `imported-${index + 1}`,
      title: chapter.title,
      question: `根据项目文档说明${chapter.title}，保留依据；未记录的事实明确说明。`,
      layout: index === 0 ? 'cover' : chapter.layout,
    })),
  };
}
