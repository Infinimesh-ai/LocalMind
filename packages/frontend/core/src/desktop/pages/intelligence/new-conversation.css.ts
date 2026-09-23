import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
  background: cssVarV2('layer/background/primary'),
});
export const empty = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  textAlign: 'center',
  '@media': {
    'screen and (max-width: 600px)': {
      padding: 16,
    },
  },
});
globalStyle(`${empty} h1`, { width: 'min(520px, 100%)', margin: 0 });
globalStyle(`${empty} p`, {
  maxWidth: 480,
  margin: '8px 0 0',
  color: cssVarV2('text/secondary'),
  fontSize: 13,
  lineHeight: '20px',
});
export const titleInput = style({
  width: '100%',
  padding: '4px 8px',
  border: 0,
  borderRadius: 6,
  outline: 'none',
  background: 'transparent',
  color: cssVarV2('text/primary'),
  font: 'inherit',
  fontSize: 22,
  fontWeight: 600,
  lineHeight: '30px',
  textAlign: 'center',
  selectors: {
    '&::placeholder': {
      color: cssVarV2('text/primary'),
      opacity: 1,
    },
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${cssVarV2('button/primary')}`,
    },
  },
});
export const composerGroup = style({
  width: 'min(680px, calc(100% - 32px))',
  margin: '0 auto 24px',
  '@media': {
    'screen and (max-width: 600px)': {
      width: 'calc(100% - 24px)',
      marginBottom: 12,
    },
  },
});
export const projectBar = style({
  position: 'relative',
  zIndex: 0,
  width: 'calc(100% - 48px)',
  minHeight: 66,
  display: 'flex',
  alignItems: 'center',
  margin: '0 auto -18px',
  padding: '0 20px 18px',
  borderRadius: '16px 16px 0 0',
  background: cssVarV2('layer/background/secondary'),
  '@media': {
    'screen and (max-width: 600px)': {
      width: 'calc(100% - 28px)',
      paddingInline: 12,
    },
  },
});
export const projectTrigger = style({
  minWidth: 0,
  maxWidth: '100%',
  height: 36,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 9,
  padding: '0 8px',
  border: 0,
  borderRadius: 6,
  outline: 'none',
  background: 'transparent',
  color: cssVarV2('text/primary'),
  font: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  lineHeight: '20px',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${cssVarV2('button/primary')}`,
    },
    '&[aria-invalid="true"]': {
      color: cssVarV2('status/error'),
    },
  },
});
globalStyle(`${projectTrigger} svg`, {
  width: 20,
  height: 20,
  flex: '0 0 auto',
});
globalStyle(`${projectTrigger} span`, {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const composer = style({
  position: 'relative',
  zIndex: 1,
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '16px 16px 12px',
  borderRadius: 16,
  background: cssVarV2('layer/background/primary'),
  boxShadow: '0 2px 7px rgba(0, 0, 0, 0.08), 0 18px 44px rgba(0, 0, 0, 0.07)',
  selectors: {
    '&:focus-within': {
      boxShadow:
        '0 2px 8px rgba(0, 0, 0, 0.1), 0 20px 48px rgba(0, 0, 0, 0.09)',
    },
  },
});
globalStyle(`${composer} textarea`, {
  width: '100%',
  minHeight: 76,
  maxHeight: 200,
  padding: 0,
  border: 0,
  outline: 'none',
  resize: 'none',
  background: 'transparent',
  color: cssVarV2('text/primary'),
  font: 'inherit',
  fontSize: 14,
  lineHeight: '21px',
  caretColor: cssVarV2('button/primary'),
});
globalStyle(`${composer} textarea::placeholder`, {
  color: cssVarV2('text/tertiary'),
  opacity: 1,
});
export const error = style({
  color: cssVarV2('status/error'),
  fontSize: 11,
  lineHeight: '16px',
});
export const footer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  color: cssVarV2('text/tertiary'),
  fontSize: 10,
});
export const sendButton = style({
  width: 32,
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: '0 0 auto',
  padding: 0,
  border: 0,
  borderRadius: 9,
  outline: 'none',
  background: cssVarV2('button/primary'),
  color: cssVarV2('button/pureWhiteText'),
  cursor: 'pointer',
  transition: 'transform 140ms ease-out, background-color 140ms ease-out',
  selectors: {
    '&:hover:not(:disabled)': {
      transform: 'translateY(-1px)',
    },
    '&:active:not(:disabled)': {
      transform: 'translateY(0)',
    },
    '&:focus-visible': {
      boxShadow: `0 0 0 2px ${cssVarV2('layer/background/primary')}, 0 0 0 4px ${cssVarV2('button/primary')}`,
    },
    '&:disabled': {
      background: cssVarV2('button/disable'),
      color: cssVarV2('icon/disable'),
      cursor: 'default',
    },
  },
});
globalStyle(`${sendButton} svg`, { width: 18, height: 18 });
export const started = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  gridColumn: '1 / -1',
});
