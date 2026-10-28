import { Button, Progress } from '@affine/component';
import { useI18n } from '@affine/i18n';
import { cssVarV2 } from '@toeverything/theme/v2';

import { embeddingProgress, embeddingProgressTitle } from './styles-css';

interface EmbeddingProgressProps {
  status: {
    embedded: number;
    total: number;
    failed?: number;
    retryable?: number;
    available?: boolean;
  } | null;
  onRetry?: () => void;
  retrying?: boolean;
  disabled?: boolean;
}

const EmbeddingProgress: React.FC<EmbeddingProgressProps> = ({
  status,
  onRetry,
  retrying,
  disabled,
}) => {
  const t = useI18n();

  const loading = status === null;

  const percent = loading
    ? 0
    : status.total === 0
      ? 1
      : status.embedded / status.total;
  const progress = Math.round(percent * 100);
  const failed = status?.failed ?? 0;
  const unavailable = status?.available === false;
  const synced = percent === 1 && !failed && !unavailable;

  return (
    <div className={embeddingProgress} data-testid="embedding-progress-wrapper">
      <div
        className={embeddingProgressTitle}
        data-testid="embedding-progress-title"
        data-progress={
          loading
            ? 'loading'
            : unavailable
              ? 'unavailable'
              : failed
                ? 'failed'
                : synced
                  ? 'synced'
                  : 'syncing'
        }
      >
        <div>
          {loading
            ? t[
                'com.affine.settings.workspace.indexer-embedding.embedding.progress.loading-sync-status'
              ]()
            : unavailable
              ? t['com.affine.embedding.unavailable']()
              : failed
                ? t['com.affine.embedding.failed']({ count: String(failed) })
                : synced
                  ? t[
                      'com.affine.settings.workspace.indexer-embedding.embedding.progress.synced'
                    ]()
                  : t[
                      'com.affine.settings.workspace.indexer-embedding.embedding.progress.syncing'
                    ]()}
        </div>
        {loading ? null : (
          <div data-testid="embedding-progress-count">{`${status.embedded}/${status.total}`}</div>
        )}
      </div>
      {failed > (status?.retryable ?? 0) ? (
        <p role="status">{t['com.affine.embedding.reupload']()}</p>
      ) : null}
      {(status?.retryable ?? 0) > 0 && onRetry ? (
        <Button
          onClick={onRetry}
          disabled={disabled || retrying || unavailable}
          loading={retrying}
          data-testid="embedding-retry"
        >
          {t['com.affine.embedding.retry']()}
        </Button>
      ) : null}
      <Progress
        testId="embedding-progress"
        value={progress}
        readonly
        style={{
          visibility: loading ? 'hidden' : 'visible',
          color: cssVarV2('text/primary'),
        }}
      />
    </div>
  );
};

export default EmbeddingProgress;
