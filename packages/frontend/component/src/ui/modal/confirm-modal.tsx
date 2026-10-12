import { UserFriendlyError } from '@affine/error';
import { useI18n } from '@affine/i18n';
import { DialogTrigger } from '@radix-ui/react-dialog';
import clsx from 'clsx';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import type { ButtonProps } from '../button';
import { Button } from '../button';
import { desktopStyles, mobileStyles } from './confirm-modal.css';
import type { ModalProps } from './modal';
import { Modal } from './modal';

const styles = BUILD_CONFIG.isMobileEdition ? mobileStyles : desktopStyles;

export interface ConfirmModalProps extends ModalProps {
  customConfirmButton?: () => React.ReactNode;
  confirmButtonOptions?: Omit<ButtonProps, 'children'>;
  childrenContentClassName?: string;
  onConfirm?: (() => void) | (() => Promise<void>);
  onCancel?: (() => void) | false;
  errorMessage?: React.ReactNode;
  confirmText?: React.ReactNode;
  cancelText?: React.ReactNode;
  cancelButtonOptions?: Omit<ButtonProps, 'children'>;
  reverseFooter?: boolean;
  /**
   * Whether to use row layout for mobile footer
   * @default false
   */
  rowFooter?: boolean;
  /**
   * Auto focus on confirm button when modal opened
   * @default true
   */
  autoFocusConfirm?: boolean;
}

export const ConfirmModal = ({
  children,
  confirmButtonOptions,
  customConfirmButton: CustomConfirmButton,
  confirmText,
  cancelText,
  cancelButtonOptions,
  reverseFooter,
  onConfirm,
  onCancel,
  errorMessage,
  width = 480,
  autoFocusConfirm = true,
  headerClassName,
  descriptionClassName,
  childrenContentClassName,
  contentOptions,
  rowFooter = false,
  ...props
}: ConfirmModalProps) => {
  const t = useI18n();
  const onConfirmClick = useCallback(() => {
    Promise.resolve()
      .then(() => onConfirm?.())
      .catch(err => {
        console.error(err);
      });
  }, [onConfirm]);
  const handleCancel = useCallback(() => {
    if (onCancel === false) {
      return;
    }
    onCancel?.();
  }, [onCancel]);
  return (
    <Modal
      contentOptions={{
        ...contentOptions,
        className: clsx(styles.container, contentOptions?.className),
        onPointerDownOutside: e => {
          e.stopPropagation();
          handleCancel();
        },
      }}
      width={width}
      closeButtonOptions={{
        onClick: handleCancel,
      }}
      headerClassName={clsx(styles.header, headerClassName)}
      descriptionClassName={clsx(styles.description, descriptionClassName)}
      {...props}
    >
      {children ? (
        <div className={clsx(styles.content, childrenContentClassName)}>
          {children}
        </div>
      ) : null}
      {errorMessage ? (
        <div role="alert" className={styles.error}>
          {errorMessage}
        </div>
      ) : null}
      <div
        className={clsx(styles.footer, {
          modalFooterWithChildren: !!children,
          reverse: reverseFooter && !rowFooter,
          row: rowFooter,
          rowReverse: reverseFooter && rowFooter,
        })}
      >
        {onCancel !== false ? (
          <DialogTrigger asChild>
            <Button
              className={clsx(styles.action, {
                row: rowFooter,
              })}
              onClick={handleCancel}
              data-testid="confirm-modal-cancel"
              {...cancelButtonOptions}
              variant={
                cancelButtonOptions?.variant
                  ? cancelButtonOptions.variant
                  : 'secondary'
              }
            >
              {cancelText ?? t['Cancel']()}
            </Button>
          </DialogTrigger>
        ) : null}
        {CustomConfirmButton ? (
          <CustomConfirmButton data-testid="confirm-modal-confirm" />
        ) : (
          <Button
            className={clsx(styles.action, {
              row: rowFooter,
            })}
            onClick={onConfirmClick}
            data-testid="confirm-modal-confirm"
            autoFocus={autoFocusConfirm}
            {...confirmButtonOptions}
          >
            {confirmText ?? t['Confirm']()}
          </Button>
        )}
      </div>
    </Modal>
  );
};

interface OpenConfirmModalOptions {
  autoClose?: boolean;
  onSuccess?: () => void;
}
interface ConfirmModalContextProps {
  modalProps: ConfirmModalProps;
  openConfirmModal: (
    props?: ConfirmModalProps,
    options?: OpenConfirmModalOptions
  ) => void;
  closeConfirmModal: () => void;
}
const ConfirmModalContext = createContext<ConfirmModalContextProps>({
  modalProps: { open: false },
  openConfirmModal: () => {},
  closeConfirmModal: () => {},
});
export const ConfirmModalProvider = ({ children }: React.PropsWithChildren) => {
  const t = useI18n();
  const generation = useRef(0);
  const [modalProps, setModalProps] = useState<ConfirmModalProps>({
    open: false,
  });

  const setLoading = useCallback((value: boolean) => {
    setModalProps(prev => ({
      ...prev,
      confirmButtonOptions: {
        ...prev.confirmButtonOptions,
        loading: value,
      },
    }));
  }, []);

  const closeConfirmModal = useCallback(() => {
    generation.current++;
    setModalProps({ open: false });
  }, []);

  const openConfirmModal = useCallback(
    (props?: ConfirmModalProps, options?: OpenConfirmModalOptions) => {
      const current = ++generation.current;
      const { autoClose = true, onSuccess } = options ?? {};
      if (!props) {
        setModalProps({ open: true });
        return;
      }

      const { onConfirm: _onConfirm, ...otherProps } = props;

      let pending = false;
      const onConfirm = async () => {
        if (pending || current !== generation.current) return;
        pending = true;
        setModalProps(prev => ({ ...prev, errorMessage: undefined }));
        setLoading(true);
        try {
          await _onConfirm?.();
          if (current !== generation.current) return;
          onSuccess?.();
          if (autoClose && current === generation.current) closeConfirmModal();
        } catch (error) {
          if (current !== generation.current) return;
          const status = UserFriendlyError.fromAny(error).status;
          const key =
            status === 409
              ? 'conflict'
              : status === 401 || status === 403
                ? 'permission'
                : status === 404
                  ? 'unavailable'
                  : status === 499 || status === 504
                    ? 'network'
                    : 'failed';
          setModalProps(prev => ({
            ...prev,
            errorMessage: t[`com.affine.confirmModal.error.${key}`](),
          }));
        } finally {
          pending = false;
          if (current === generation.current) setLoading(false);
        }
      };
      setModalProps({ ...otherProps, onConfirm, open: true });
    },
    [closeConfirmModal, setLoading, t]
  );

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) generation.current++;
      modalProps.onOpenChange?.(open);
      setModalProps(props => ({ ...props, open }));
    },
    [modalProps]
  );
  const confirmModalContextValue = useMemo(
    () => ({ openConfirmModal, closeConfirmModal, modalProps }),
    [closeConfirmModal, modalProps, openConfirmModal]
  );

  return (
    <ConfirmModalContext.Provider value={confirmModalContextValue}>
      {children}
      {/* TODO(@catsjuice): multi-instance support(unnecessary for now) */}
      <ConfirmModal {...modalProps} onOpenChange={onOpenChange} />
    </ConfirmModalContext.Provider>
  );
};

export const useConfirmModal = () => {
  const context = useContext(ConfirmModalContext);
  if (!context) {
    throw new Error(
      'useConfirmModal must be used within a ConfirmModalProvider'
    );
  }
  return {
    openConfirmModal: context.openConfirmModal,
    closeConfirmModal: context.closeConfirmModal,
  };
};
