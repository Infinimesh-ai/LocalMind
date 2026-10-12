import { cssVar } from '@toeverything/theme';
import { createVar, style } from '@vanilla-extract/css';

import { controlTokens } from '../../theme/controls.css';

const focusColor = createVar();

export const inputWrapper = style({
  vars: { [focusColor]: controlTokens.focus },
  width: '100%',
  height: 28,
  lineHeight: '22px',
  gap: '10px',
  color: controlTokens.text,
  border: '1px solid',
  borderColor: controlTokens.fieldBorder,
  backgroundColor: controlTokens.surface,
  borderRadius: 7,
  transition: 'border-color 140ms ease-out, background-color 140ms ease-out',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  fontSize: cssVar('fontBase'),
  boxSizing: 'border-box',
  overflow: 'hidden',
  selectors: {
    '&.no-border': {
      border: 'unset',
    },
    // size
    '&.large': {
      height: 32,
    },
    '&.extra-large': {
      height: 40,
      fontWeight: 600,
    },
    // color
    '&.disabled': {
      background: controlTokens.disabledSurface,
      cursor: 'not-allowed',
    },
    '&.error': {
      borderColor: controlTokens.danger,
      vars: { [focusColor]: controlTokens.danger },
    },
    '&.success': {
      borderColor: controlTokens.success,
      vars: { [focusColor]: controlTokens.success },
    },
    '&.warning': {
      borderColor: controlTokens.warning,
      vars: { [focusColor]: controlTokens.warning },
    },
    '&.default:not(.disabled):not(:focus-within):hover': {
      borderColor: controlTokens.muted,
    },
    '&:not(.disabled):is(:focus-within, :focus-visible)': {
      borderColor: focusColor,
      outline: `2px solid ${focusColor}`,
      outlineOffset: 2,
    },
  },
});

export const mobileInputWrapper = style([
  inputWrapper,
  {
    height: 30,
  },
]);

export const input = style({
  height: '100%',
  width: '0',
  flex: 1,
  boxSizing: 'border-box',
  padding: '0 12px',
  // prevent default style
  WebkitAppearance: 'none',
  WebkitTapHighlightColor: 'transparent',
  outline: 'none',
  border: 'none',
  background: 'transparent',
  color: 'inherit',
  caretColor: controlTokens.text,
  selectors: {
    '&::placeholder': {
      color: controlTokens.muted,
      opacity: 1,
    },
    '&:disabled': {
      color: controlTokens.muted,
      WebkitTextFillColor: controlTokens.muted,
      cursor: 'not-allowed',
    },
    '&:-webkit-autofill': {
      WebkitBoxShadow: `0 0 0 1000px ${controlTokens.surface} inset`,
      WebkitTextFillColor: controlTokens.text,
    },
  },
});
