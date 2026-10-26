import { Trans, useI18n } from '@affine/i18n';

import { ConfirmDialog } from '../../../components/shared/confirm-dialog';

export const SuspendAccountDialog = ({
  open,
  email,
  onClose,
  onConfirm,
  onOpenChange,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) => {
  const i18n = useI18n();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={i18n['com.affine.admin.suspend-account']()}
      description={
        <Trans
          i18nKey="com.affine.admin.suspend-account-description"
          values={{ email }}
          components={{ strong: <span className="font-bold" /> }}
        />
      }
      confirmText={i18n['com.affine.admin.suspend']()}
      confirmButtonVariant="destructive"
      onConfirm={onConfirm}
      onClose={onClose}
    />
  );
};
