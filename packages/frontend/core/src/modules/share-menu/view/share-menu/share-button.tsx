import { Tooltip } from '@affine/component';
import { Button, type ButtonProps } from '@affine/component/ui/button';
import { ShareInfoService } from '@affine/core/modules/share-doc';
import { useI18n } from '@affine/i18n';
import { LockIcon, PublishIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import clsx from 'clsx';
import { forwardRef, type Ref, useEffect } from 'react';

import * as styles from './index.css';

export const DefaultShareButton = forwardRef(function DefaultShareButton(
  { tooltip: tooltipOverride, className, ...props }: ButtonProps,
  ref: Ref<HTMLButtonElement>
) {
  const t = useI18n();
  const shareInfoService = useService(ShareInfoService);
  const shared = useLiveData(shareInfoService.shareInfo.isShared$);
  useEffect(() => {
    if (!props.disabled) shareInfoService.shareInfo.revalidate();
  }, [props.disabled, shareInfoService]);
  const tooltip =
    tooltipOverride ??
    (shared
      ? t['com.affine.share-menu.option.link.readonly.description']()
      : t['com.affine.share-menu.option.link.no-access.description']());
  return (
    <Tooltip content={tooltip}>
      <Button
        {...props}
        ref={ref}
        className={clsx(styles.button, className)}
        variant="primary"
      >
        <div className={styles.buttonContainer}>
          {shared ? <PublishIcon fontSize={16} /> : <LockIcon fontSize={16} />}
          {t['com.affine.share-menu.shareButton']()}
        </div>
      </Button>
    </Tooltip>
  );
});
