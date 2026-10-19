import type { PropsWithChildren } from 'react';

import * as styles from './reports.css';

export { useReportText } from '@affine/core/modules/project-reports/i18n';
export function Field({
  label,
  children,
}: PropsWithChildren<{ label: string }>) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
  onCompositionChange,
  disabled,
  multiline = false,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCompositionChange?: (composing: boolean) => void;
  disabled?: boolean;
  multiline?: boolean;
  type?: string;
}) {
  return (
    <Field label={label}>
      {multiline ? (
        <textarea
          className={styles.textarea}
          value={value}
          onChange={event => onChange(event.target.value)}
          onCompositionStart={() => onCompositionChange?.(true)}
          onCompositionEnd={() => onCompositionChange?.(false)}
          disabled={disabled}
        />
      ) : (
        <input
          className={styles.input}
          type={type}
          value={value}
          onChange={event => onChange(event.target.value)}
          onCompositionStart={() => onCompositionChange?.(true)}
          onCompositionEnd={() => onCompositionChange?.(false)}
          disabled={disabled}
        />
      )}
    </Field>
  );
}
export function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string; disabled?: boolean }[];
  disabled?: boolean;
}) {
  return (
    <Field label={label}>
      <select
        className={styles.input}
        value={value}
        onChange={event => onChange(event.target.value as T)}
        disabled={disabled}
      >
        {options.map(option => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}
