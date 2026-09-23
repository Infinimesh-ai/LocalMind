import { Button, IconButton, Tooltip } from '@affine/component';
import type { OfficeArtifactKindValue } from '@affine/core/modules/office';
import { useI18n } from '@affine/i18n';
import {
  AiIcon,
  CommentIcon,
  DownloadIcon,
  ExportToPdfIcon,
  HistoryIcon,
  PageIcon,
  PresentationIcon,
  TableIcon,
} from '@blocksuite/icons/rc';
import type { ReactNode } from 'react';

import type { OfficeSurfaceCapabilities } from './resource-adapter';
import * as styles from './resource-header.css';

export type OfficeResourceHeaderProps = {
  capabilities?: OfficeSurfaceCapabilities;
  title: string;
  kind: OfficeArtifactKindValue;
  revisionSequence: number;
  latestSequence: number;
  historical: boolean;
  busy: boolean;
  returningLatest: boolean;
  actionsStart?: ReactNode;
  actionsEnd?: ReactNode;
  onAI?: () => void;
  onComments?: () => void;
  onDownload: () => void;
  onExportPdf?: () => void;
  onHistory: () => void;
  onLatest: () => void;
  onPrint: () => void;
};

export function OfficeResourceHeader({
  capabilities,
  title,
  kind,
  revisionSequence,
  latestSequence,
  historical,
  busy,
  returningLatest,
  actionsStart,
  actionsEnd,
  onAI,
  onComments,
  onDownload,
  onExportPdf,
  onHistory,
  onLatest,
  onPrint,
}: OfficeResourceHeaderProps) {
  const i18n = useI18n();
  const icon =
    kind === 'workbook' ? (
      <TableIcon />
    ) : kind === 'presentation' ? (
      <PresentationIcon />
    ) : kind === 'pdf' ? (
      <ExportToPdfIcon />
    ) : (
      <PageIcon />
    );
  return (
    <div className={styles.root}>
      <div className={styles.title}>
        {icon}
        <span>{title}</span>
        <span className={styles.revision}>v{revisionSequence}</span>
      </div>
      <div className={styles.actions}>
        {actionsStart}
        {onAI && capabilities?.canUseAI !== false ? (
          <Tooltip content={i18n['com.affine.office.open-localmind-ai']()}>
            <IconButton
              size="24"
              onClick={onAI}
              aria-label={i18n['com.affine.office.open-localmind-ai']()}
            >
              <AiIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        {historical ? (
          <Button
            variant="plain"
            disabled={returningLatest}
            loading={returningLatest}
            aria-label={i18n['com.affine.office.return-latest']({
              version: String(latestSequence),
            })}
            onClick={onLatest}
          >
            {i18n['com.affine.office.latest-version']({
              version: String(latestSequence),
            })}
          </Button>
        ) : null}
        {onExportPdf && capabilities?.canExportPdf !== false ? (
          <Tooltip content={i18n['com.affine.office.export-pdf']()}>
            <IconButton
              size="24"
              onClick={onExportPdf}
              disabled={busy}
              aria-label={i18n['com.affine.office.export-pdf']()}
            >
              <ExportToPdfIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        {capabilities?.canPrint !== false ? (
          <Button variant="plain" onClick={onPrint}>
            {i18n['com.affine.export.print']()}
          </Button>
        ) : null}
        {onComments && capabilities?.canComment !== false ? (
          <Tooltip
            content={i18n['com.affine.office.comments-and-collaborators']()}
          >
            <IconButton
              size="24"
              onClick={onComments}
              aria-label={i18n[
                'com.affine.office.comments-and-collaborators'
              ]()}
            >
              <CommentIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        {capabilities?.canViewHistory !== false ? (
          <Tooltip content={i18n['com.affine.office.revision-history']()}>
            <IconButton
              size="24"
              onClick={onHistory}
              aria-label={i18n['com.affine.office.revision-history']()}
            >
              <HistoryIcon />
            </IconButton>
          </Tooltip>
        ) : null}
        {capabilities?.canDownload !== false ? (
          <IconButton
            size="24"
            onClick={onDownload}
            disabled={busy}
            tooltip={i18n['com.affine.office.download-native-office-file']()}
            aria-label={i18n['com.affine.office.download-native-office-file']()}
          >
            <DownloadIcon />
          </IconButton>
        ) : null}
        {actionsEnd}
      </div>
    </div>
  );
}
