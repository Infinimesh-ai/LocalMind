import { UserFriendlyError } from '@affine/error';
import { useI18n } from '@affine/i18n';
import { DialogTrigger } from '@radix-ui/react-dialog';
import clsx from 'clsx';
import type { PropsWithChildren } from 'react';
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
import Input, { type InputProps } from '../input';
import type { ModalProps } from './modal';
import { Modal } from './modal';
import { desktopStyles, mobileStyles } from './prompt-modal.css';

const styles = BUILD_CONFIG.isMobileEdition ? mobileStyles : desktopStyles;

export interface PromptModalProps extends ModalProps {
  confirmButtonOptions?: Omit<ButtonProps, 'children'>;
  onConfirm?: ((text: string) => void) | ((text: string) => Promise<void>);
  onCancel?: () => void;
  confirmText?: React.ReactNode;
  cancelText?: React.ReactNode;

  label?: React.ReactNode;
  errorMessage?: React.ReactNode;
  defaultValue?: string;
  required?: boolean;
  cancelButtonOptions?: Omit<ButtonProps, 'children'>;

  inputOptions?: Omit<InputProps, 'value' | 'onChange'>;
  reverseFooter?: boolean;
  /**
   * Auto focus on confirm button when modal opened
   * @default true
   */
  autoFocusConfirm?: boolean;
}

export const PromptModal = ({
  children,
  confirmButtonOptions,
  confirmText,
  cancelText,
  cancelButtonOptions,
  reverseFooter,
  onConfirm,
  onCancel,
  label,
  errorMessage,
  required = true,
  inputOptions,
  defaultValue,
  width = 480,
  autoFocusConfirm = true,
  headerClassName,
  descriptionClassName,
  ...props
}: PromptModalProps) => {
  const t = useI18n();
  const [value, setValue] = useState(defaultValue ?? '');
  const onConfirmClick = useCallback(
    (text = value) => {
      if (
        (required && !text.trim()) ||
        confirmButtonOptions?.disabled ||
        confirmButtonOptions?.loading ||
        inputOptions?.disabled
      )
        return;
      Promise.resolve()
        .then(() => onConfirm?.(text))
        .catch(err => {
          console.error(err);
        });
    },
    [confirmButtonOptions, inputOptions?.disabled, onConfirm, required, value]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        if (value) {
          e.preventDefault();
          return;
        } else {
          e.currentTarget.blur();
        }
      }
    },
    [value]
  );

  return (
    <Modal
      preserveEditingFocusOnAction={BUILD_CONFIG.isMobileEdition}
      contentOptions={{
        className: styles.container,
        onPointerDownOutside: e => {
          e.stopPropagation();
          onCancel?.();
        },
      }}
      width={width}
      closeButtonOptions={{
        onClick: onCancel,
      }}
      headerClassName={clsx(styles.header, headerClassName)}
      descriptionClassName={clsx(styles.description, descriptionClassName)}
      {...props}
    >
      <div className={styles.label}>{label}</div>
      <div className={styles.inputContainer}>
        <Input
          value={value}
          onChange={setValue}
          autoFocus
          className={styles.input}
          onKeyDown={onKeyDown}
          onEnter={onConfirmClick}
          data-testid="prompt-modal-input"
          {...inputOptions}
        />
      </div>
      {children ? <div className={styles.content}>{children}</div> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      <div
        className={clsx(styles.footer, {
          modalFooterWithChildren: !!children,
          reverse: reverseFooter,
        })}
      >
        <DialogTrigger asChild>
          <Button
            className={styles.action}
            onClick={onCancel}
            data-testid="prompt-modal-cancel"
            {...cancelButtonOptions}
          >
            {cancelText ?? t['Cancel']()}
          </Button>
        </DialogTrigger>
        <Button
          className={styles.action}
          onClick={() => onConfirmClick()}
          data-testid="prompt-modal-confirm"
          autoFocus={autoFocusConfirm}
          {...confirmButtonOptions}
          disabled={
            (required && !value.trim()) ||
            confirmButtonOptions?.disabled ||
            inputOptions?.disabled
          }
        >
          {confirmText ?? t['Confirm']()}
        </Button>
      </div>
    </Modal>
  );
};

interface OpenPromptModalOptions {
  autoClose?: boolean;
  onSuccess?: () => void;
}
interface PromptModalContextProps {
  modalProps: PromptModalProps;
  openPromptModal: (
    props?: PromptModalProps,
    options?: OpenPromptModalOptions
  ) => void;
  closePromptModal: () => void;
}
const PromptModalContext = createContext<PromptModalContextProps>({
  modalProps: { open: false },
  openPromptModal: () => {},
  closePromptModal: () => {},
});
export const PromptModalProvider = ({ children }: PropsWithChildren) => {
  const t = useI18n();
  const generation = useRef(0);
  const [modalProps, setModalProps] = useState<PromptModalProps>({
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

  const closePromptModal = useCallback(() => {
    generation.current++;
    setModalProps({ open: false });
  }, []);

  const openPromptModal = useCallback(
    (props?: PromptModalProps, options?: OpenPromptModalOptions) => {
      const current = ++generation.current;
      const { autoClose = true, onSuccess } = options ?? {};
      if (!props) {
        setModalProps({ open: true });
        return;
      }

      const { onConfirm: _onConfirm, ...otherProps } = props;

      let pending = false;
      const onConfirm = async (text: string) => {
        if (pending || current !== generation.current) return;
        pending = true;
        setModalProps(prev => ({ ...prev, errorMessage: undefined }));
        setLoading(true);
        try {
          await _onConfirm?.(text);
          if (current !== generation.current) return;
          onSuccess?.();
          if (autoClose && current === generation.current) closePromptModal();
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
    [closePromptModal, setLoading, t]
  );

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) generation.current++;
      modalProps.onOpenChange?.(open);
      setModalProps(props => ({ ...props, open }));
    },
    [modalProps]
  );
  const promptModalContextValue = useMemo(
    () => ({
      openPromptModal,
      closePromptModal,
      modalProps,
    }),
    [closePromptModal, modalProps, openPromptModal]
  );

  return (
    <PromptModalContext.Provider value={promptModalContextValue}>
      {children}
      {/* TODO(@catsjuice): multi-instance support(unnecessary for now) */}
      {modalProps.open && (
        <PromptModal
          key={generation.current}
          {...modalProps}
          onOpenChange={onOpenChange}
        />
      )}
    </PromptModalContext.Provider>
  );
};

export const usePromptModal = () => {
  const context = useContext(PromptModalContext);
  if (!context) {
    throw new Error(
      'useConfirmModal must be used within a ConfirmModalProvider'
    );
  }
  return {
    openPromptModal: context.openPromptModal,
    closePromptModal: context.closePromptModal,
  };
};
