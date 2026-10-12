import { Button } from '@affine/component';
import { useI18n } from '@affine/i18n';

export function PageTreeLoadError({
  retry,
  rateLimited = false,
  loading = false,
}: {
  retry: () => void;
  rateLimited?: boolean;
  loading?: boolean;
}) {
  const t = useI18n();
  return (
    <div role="alert">
      <span>
        {rateLimited
          ? t['com.affine.localmind.page-tree.rate-limited']()
          : t['com.affine.localmind.page-tree.load-error']()}
      </span>
      <Button variant="plain" disabled={loading || rateLimited} onClick={retry}>
        {t['com.affine.error.retry']()}
      </Button>
    </div>
  );
}
