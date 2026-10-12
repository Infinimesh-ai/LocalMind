import { Button, type ButtonProps } from '@affine/admin/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@affine/admin/components/ui/dialog';
import { useI18n } from '@affine/i18n';
import type { ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  cancelText?: string;
  confirmText?: string;
  confirmButtonVariant?: ButtonProps['variant'];
  onConfirm: () => void;
  onClose?: () => void;
}

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  cancelText,
  confirmText,
  confirmButtonVariant = 'default',
  onConfirm,
  onClose,
}: ConfirmDialogProps) => {
  const i18n = useI18n();
  const handleClose = () => {
    onOpenChange(false);
    onClose?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="leading-7">{title}</DialogTitle>
          <DialogDescription className="leading-6">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="mt-6">
          <div className="flex justify-end gap-2 items-center w-full">
            <Button
              type="button"
              onClick={handleClose}
              variant="outline"
              size="sm"
            >
              <span>{cancelText ?? i18n['Cancel']()}</span>
            </Button>
            <Button
              type="button"
              onClick={onConfirm}
              variant={confirmButtonVariant}
              size="sm"
            >
              <span>{confirmText ?? i18n['Confirm']()}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
