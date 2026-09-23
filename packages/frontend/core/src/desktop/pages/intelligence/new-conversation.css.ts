import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 238px',
  background: cssVarV2('layer/background/primary'),
  '@media': {
    'screen and (max-width: 1040px)': { gridTemplateColumns: '1fr' },
  },
});
export const main = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  padding: '32px 32px 24px',
  '@media': {
    'screen and (max-width: 600px)': { padding: '20px 16px 12px' },
  },
});
export const breadcrumb = style({
  color: cssVarV2('text/tertiary'),
  fontSize: 12,
});
export const empty = style({
  width: 'min(100%, 880px)',
  marginTop: 17,
  padding: '0 0 22px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
globalStyle(`${empty} h1`, { width: '100%', margin: 0 });
globalStyle(`${empty} p`, {
  maxWidth: 720,
  margin: '7px 0 0',
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '20px',
});
export const titleInput = style({
  width: '100%',
  padding: 0,
  border: 0,
  borderRadius: 6,
  outline: 'none',
  background: 'transparent',
  color: cssVarV2('text/primary'),
  font: 'inherit',
  fontSize: 26,
  fontWeight: 600,
  lineHeight: '30px',
  textAlign: 'left',
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
  margin: 'auto auto 0',
  '@media': {
    'screen and (max-width: 600px)': {
      width: 'calc(100% - 24px)',
      marginBottom: 0,
    },
  },
});
export const projectBar = style({
  position: 'relative',
  zIndex: 0,
  width: '100%',
  minHeight: 40,
  display: 'flex',
  alignItems: 'center',
  margin: '0 0 10px',
  padding: 0,
  borderRadius: 0,
  background: 'transparent',
  '@media': {
    'screen and (max-width: 600px)': {
      width: '100%',
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
  gap: 8,
  padding: '12px 16px 10px',
  borderRadius: 11,
  background: cssVarV2('layer/background/primary'),
  boxShadow: `0 14px 36px rgba(25, 29, 34, 0.1), inset 0 0 0 1px ${cssVarV2('layer/insideBorder/border')}`,
  selectors: {
    '&:focus-within': {
      boxShadow: '0 16px 38px rgba(25, 29, 34, 0.12), inset 0 0 0 1px #9ba4ae',
    },
  },
});
globalStyle(`${composer} textarea`, {
  width: '100%',
  minHeight: 42,
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
export const context = style({
  minWidth: 0,
  padding: '32px 20px',
  borderLeft: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  color: cssVarV2('text/secondary'),
  '@media': {
    'screen and (max-width: 1040px)': { display: 'none' },
  },
});
globalStyle(`${context} h2`, {
  margin: '0 0 20px',
  color: cssVarV2('text/primary'),
  fontSize: 13,
  fontWeight: 650,
});
globalStyle(`${context} section`, {
  padding: '16px 0',
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
globalStyle(`${context} h3`, {
  margin: '0 0 8px',
  color: cssVarV2('text/primary'),
  fontSize: 12,
  fontWeight: 600,
});
globalStyle(`${context} p`, {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
});
