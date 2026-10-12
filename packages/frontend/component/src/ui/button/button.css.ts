import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, globalStyle, style } from '@vanilla-extract/css';

import { controlTokens } from '../../theme/controls.css';

// Using variables can override externally, without considering the priority of selectors.
// size vars
export const hVar = createVar('height');
export const wVar = createVar('width');
export const iconSizeVar = createVar('iconSize');
const gapVar = createVar('gap');
const paddingVar = createVar('padding');
const fontSizeVar = createVar('fontSize');
const fontWeightVar = createVar('fontWeight');
const lineHeightVar = createVar('lineHeight');
const shadowVar = createVar('shadow');

// style vars
const bgVar = createVar('bg');
const textVar = createVar('fg');
const iconColorVar = createVar('icon');
const borderColorVar = createVar('border');
const borderWidthVar = createVar('borderWidth');

export const button = style({
  vars: {
    // default vars
    [gapVar]: '4px',
    [wVar]: 'unset',
    [hVar]: 'unset',
    [borderWidthVar]: '1px',
  },

  flexShrink: 0,
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  userSelect: 'none',
  outline: 0,
  borderRadius: 7,
  transition:
    'background-color 140ms ease-out, border-color 140ms ease-out, color 140ms ease-out',
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
  ['WebkitAppRegion' as string]: 'no-drag',

  // hover layer
  ':before': {
    content: '""',
    position: 'absolute',
    width: '100%',
    height: '100%',
    transition: 'inherit',
    borderRadius: 'inherit',
    opacity: 0,
    left: '50%',
    top: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    borderColor: 'transparent',
    pointerEvents: 'none',
    borderWidth: 'inherit',
    borderStyle: 'inherit',
  },

  // style
  backgroundColor: bgVar,
  color: textVar,
  boxShadow: shadowVar,
  borderWidth: borderWidthVar,
  borderStyle: 'solid',
  borderColor: borderColorVar,

  // size
  width: wVar,
  height: hVar,
  gap: gapVar,
  padding: paddingVar,
  fontSize: fontSizeVar,
  fontWeight: fontWeightVar,
  lineHeight: lineHeightVar,

  selectors: {
    // hover layer
    '&[data-no-hover]:before, &[data-disabled]:before, &[data-loading]:before, &:not([data-variant="custom"]):before':
      {
        display: 'none',
      },
    '&:hover:before': { opacity: 1 },
    '&[data-block]': { display: 'flex' },

    // size
    '&[data-size="default"]': {
      vars: {
        [hVar]: '28px', // line-height + paddingY * 2 (to ignore border width)
        [paddingVar]: '0px 8px',
        [iconSizeVar]: '16px',
        [paddingVar]: '4px 12px',
        [fontSizeVar]: cssVar('fontXs'),
        [fontWeightVar]: '500',
        [lineHeightVar]: '20px',
      },
    },
    '&[data-size="large"]': {
      vars: {
        [hVar]: '32px',
        [paddingVar]: '0px 8px',
        [iconSizeVar]: '20px',
        [paddingVar]: '4px 12px',
        [fontSizeVar]: '15px',
        [fontWeightVar]: '500',
        [lineHeightVar]: '24px',
      },
    },
    '&[data-size="extraLarge"]': {
      vars: {
        [hVar]: '40px',
        [paddingVar]: '0px 8px',
        [iconSizeVar]: '24px',
        [paddingVar]: '8px 18px',
        [fontSizeVar]: '15px',
        [fontWeightVar]: '600',
        [lineHeightVar]: '24px',
      },
    },

    // type
    '&[data-variant="primary"]': {
      vars: {
        [bgVar]: controlTokens.action,
        [textVar]: controlTokens.onAction,
        [iconColorVar]: controlTokens.onAction,
        [borderColorVar]: 'transparent',
      },
    },
    '&[data-variant="secondary"]': {
      vars: {
        [bgVar]: controlTokens.surface,
        [textVar]: controlTokens.text,
        [iconColorVar]: controlTokens.text,
        [borderColorVar]: controlTokens.border,
      },
    },
    '&[data-variant="plain"]': {
      vars: {
        [bgVar]: 'transparent',
        [textVar]: controlTokens.text,
        [iconColorVar]: controlTokens.text,
        [borderColorVar]: 'transparent',
        [borderWidthVar]: '0px',
      },
    },
    '&[data-variant="error"]': {
      vars: {
        [bgVar]: controlTokens.dangerSurface,
        [textVar]: controlTokens.danger,
        [iconColorVar]: controlTokens.danger,
        [borderColorVar]: 'transparent',
      },
    },
    '&[data-variant="success"]': {
      vars: {
        [bgVar]: controlTokens.successSurface,
        [textVar]: controlTokens.success,
        [iconColorVar]: controlTokens.success,
        [borderColorVar]: 'transparent',
      },
    },

    '&[data-variant="primary"]:not([data-disabled]):not([data-loading]):not([data-no-hover]):hover':
      {
        vars: { [bgVar]: controlTokens.actionHover },
      },
    '&[data-variant="secondary"]:not([data-disabled]):not([data-loading]):not([data-no-hover]):hover':
      {
        vars: {
          [bgVar]: controlTokens.surfaceHover,
          [borderColorVar]: controlTokens.borderHover,
        },
      },
    '&[data-variant="plain"]:not([data-disabled]):not([data-loading]):not([data-no-hover]):hover':
      {
        vars: { [bgVar]: controlTokens.surfaceHover },
      },
    '&[data-variant="error"]:not([data-disabled]):not([data-loading]):not([data-no-hover]):hover':
      {
        vars: { [borderColorVar]: controlTokens.danger },
      },
    '&[data-variant="success"]:not([data-disabled]):not([data-loading]):not([data-no-hover]):hover':
      {
        vars: { [borderColorVar]: controlTokens.success },
      },

    // disabled
    '&[data-disabled]': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },

    '&:not([data-disabled])': {
      cursor: 'pointer',
    },
    '&[data-loading]:not([data-disabled])': { cursor: 'progress' },

    // default keyboard focus style
    '&:focus-visible': {
      outline: `2px solid ${controlTokens.focus}`,
      outlineOffset: 2,
    },
  },
});
export const content = style({
  // in case that width is specified by parent and text is too long
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
});

export const icon = style({
  flexShrink: 0,
  // There are two kinds of icon size:
  // 1. control by props: width and height
  width: iconSizeVar,
  height: iconSizeVar,
  // 2. width/height is set to `1em`
  fontSize: iconSizeVar,
  color: iconColorVar,
  display: 'flex',
  alignItems: 'center',
});
globalStyle(`${icon} > svg`, {
  width: '100%',
  height: '100%',
  display: 'block',
});

export const iconButton = style({
  vars: {
    [paddingVar]: '2px',
  },
  borderRadius: 6,
  selectors: {
    '&[data-icon-variant="plain"]': {
      vars: {
        [bgVar]: 'transparent',
        [iconColorVar]: controlTokens.text,
        [borderColorVar]: 'transparent',
        [borderWidthVar]: '0px',
      },
    },
    '&[data-icon-variant="danger"]': {
      vars: {
        [bgVar]: 'transparent',
        [iconColorVar]: controlTokens.text,
        [borderColorVar]: 'transparent',
        [borderWidthVar]: '0px',
      },
    },
    '&[data-icon-variant="danger"]:not([data-disabled]):not([data-loading]):not([data-no-hover]):hover':
      {
        vars: {
          [bgVar]: controlTokens.dangerSurface,
          [iconColorVar]: controlTokens.danger,
        },
      },
    // disable hover layer for danger type
    '&[data-icon-variant="danger"]:hover:before': {
      opacity: 0,
    },
    '&[data-icon-variant="solid"]': {
      vars: {
        [bgVar]: controlTokens.surface,
        [iconColorVar]: controlTokens.text,
        [borderColorVar]: controlTokens.border,
        [shadowVar]: 'none',
      },
    },

    '&[data-icon-size="24"]': {
      vars: { [paddingVar]: '4px' },
    },
  },
});
