import { IconButton } from '@affine/component';
import { useI18n } from '@affine/i18n';
import type { ReactElement, SVGAttributes } from 'react';

import * as style from './styles.css';

export const ImportOptionItem = ({
  label,
  labelText,
  prefixIcon,
  suffixIcon,
  suffixTooltip,
  onImport,
  disabled,
  ...props
}: {
  label: string;
  labelText?: string;
  prefixIcon: ReactElement<SVGAttributes<SVGElement>>;
  suffixIcon?: ReactElement<SVGAttributes<SVGElement>>;
  suffixTooltip?: string;
  onImport: () => void;
  disabled?: boolean;
}) => {
  const t = useI18n();
  return (
    <div className={disabled ? style.importItemDisabled : style.importItem}>
      <button
        {...props}
        type="button"
        className={style.importItemAction}
        onClick={onImport}
        disabled={disabled}
      >
        {prefixIcon}
        <span className={style.importItemLabel}>{labelText ?? t[label]()}</span>
      </button>
      {suffixIcon && (
        <IconButton
          className={style.importItemSuffix}
          icon={suffixIcon}
          aria-label={
            suffixTooltip ? t[suffixTooltip]() : (labelText ?? t[label]())
          }
          tooltip={suffixTooltip ? t[suffixTooltip]() : undefined}
        />
      )}
    </div>
  );
};
