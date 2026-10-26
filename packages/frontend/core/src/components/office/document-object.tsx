import { Button } from '@affine/component';
import type { DocxRunContent } from '@affine/core/modules/office';
import { useI18n } from '@affine/i18n';
import { docxObjectPreview } from '@localmind/office/docx';

import * as styles from './document.css';

export function DocumentObject({
  content,
  disabled,
  onEdit,
}: {
  content: Extract<DocxRunContent, { type: 'object' }>;
  disabled: boolean;
  onEdit?: () => void;
}) {
  const i18n = useI18n();
  const object = content.objectData;
  const preview = object ? docxObjectPreview(object) : undefined;
  const label =
    object?.type === 'shape'
      ? i18n['com.affine.settings.editorSettings.edgeless.shape']()
      : object?.type === 'equation'
        ? i18n['com.affine.office.equation']()
        : i18n['com.affine.office.chart']();
  return (
    <span contentEditable={false} className={styles.inlineObject}>
      {preview ? (
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${preview.width} ${preview.height}`}
          style={{
            width: `${content.widthPt ?? preview.width}pt`,
            height: content.heightPt ? `${content.heightPt}pt` : 'auto',
            maxWidth: '100%',
            background: '#fff',
          }}
        >
          <title>
            {object?.type === 'shape'
              ? object.text
              : object?.type === 'equation'
                ? object.linearText
                : object?.title}
          </title>
          {preview.shapes.map((shape, index) =>
            shape.type === 'text' ? (
              <text
                key={index}
                x={shape.x}
                y={shape.y}
                fontSize={shape.size}
                fill={shape.fill}
              >
                {shape.text}
              </text>
            ) : shape.type === 'rect' ? (
              <rect
                key={index}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
                fill={shape.fill}
              />
            ) : (
              <path
                key={index}
                d={shape.d}
                fill={shape.fill ?? 'none'}
                stroke={shape.stroke}
                strokeWidth={shape.strokeWidth}
              />
            )
          )}
        </svg>
      ) : (
        <span className={styles.inlineObjectPlaceholder}>
          {i18n['com.affine.office.unsupported-document-object']()} ·{' '}
          {content.objectType}
        </span>
      )}
      <span className={styles.objectCaption}>
        {object?.type === 'equation'
          ? i18n['com.affine.office.object-linear-equation']()
          : null}
        {object?.type === 'chart' &&
        object.chartType === 'pie' &&
        object.series.length > 1
          ? i18n['com.affine.office.object-pie-first-series']()
          : null}
        {!content.editableObject
          ? i18n['com.affine.office.object-preserved-readonly']()
          : null}
        {content.editableObject && onEdit ? (
          <Button disabled={disabled} onClick={onEdit}>
            {i18n['com.affine.office.edit-object']()}
          </Button>
        ) : null}
      </span>
    </span>
  );
}
