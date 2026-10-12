import { Button, RowInput } from '@affine/component';
import { useI18n } from '@affine/i18n';
import clsx from 'clsx';
import { useCallback, useState } from 'react';

import * as styles from './content.css';
import type { RenameContentProps } from './type';

export const RenameContent = ({
  initialName = '',
  inputProps,
  confirmButtonProps,
  inputPrefixRenderer: InputPrefixRenderer,
  inputBelowRenderer: InputBelowRenderer,
  descRenderer: DescRenderer,
  confirmText,
  onConfirm,
}: RenameContentProps) => {
  const t = useI18n();
  const [value, setValue] = useState(initialName);

  const { className: inputClassName, ...restInputProps } = inputProps ?? {};
  const { className: confirmButtonClassName, ...restConfirmButtonProps } =
    confirmButtonProps ?? {};

  const handleDone = useCallback(
    (name = value) => {
      if (
        !name.trim() ||
        inputProps?.disabled ||
        confirmButtonProps?.disabled ||
        confirmButtonProps?.loading
      )
        return;
      onConfirm?.(name);
    },
    [onConfirm, value, inputProps?.disabled, confirmButtonProps]
  );

  return (
    <div>
      <div className={styles.inputWrapper}>
        {InputPrefixRenderer ? <InputPrefixRenderer input={value} /> : null}
        <RowInput
          autoFocus
          className={clsx(styles.input, inputClassName)}
          value={value}
          onChange={setValue}
          onEnter={handleDone}
          data-testid="rename-input"
          {...restInputProps}
        />
      </div>
      {}
      {InputBelowRenderer ? <InputBelowRenderer input={value} /> : null}
      <div className={styles.desc}>
        {DescRenderer ? (
          <DescRenderer input={value} />
        ) : (
          t['com.affine.m.rename-to']({ name: value })
        )}
      </div>
      <div className={styles.doneWrapper}>
        <Button
          className={clsx(styles.done, confirmButtonClassName)}
          onClick={() => handleDone()}
          variant="primary"
          size="extraLarge"
          data-testid="rename-confirm"
          {...restConfirmButtonProps}
          disabled={
            !value.trim() ||
            inputProps?.disabled ||
            confirmButtonProps?.disabled
          }
        >
          {confirmText ?? t['Done']()}
        </Button>
      </div>
    </div>
  );
};
