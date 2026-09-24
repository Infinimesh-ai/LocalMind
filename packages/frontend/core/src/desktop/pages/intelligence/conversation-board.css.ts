import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  overflow: 'auto',
  background: cssVarV2('layer/background/primary'),
});
export const shell = style({
  width: 'min(100%, 1244px)',
  margin: '0 auto',
  padding: '32px 32px 56px',
  '@media': {
    'screen and (max-width: 760px)': { padding: '20px 16px 40px' },
  },
});
export const topline = style({
  minHeight: 36,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 16,
  marginBottom: 24,
  '@media': {
    'screen and (max-width: 760px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
      marginBottom: 20,
    },
  },
});
export const header = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  marginBottom: 22,
});
export const title = style({
  margin: 0,
  fontSize: 'clamp(30px, 2.7vw, 38px)',
  fontWeight: 650,
  letterSpacing: '-0.035em',
  lineHeight: 1.2,
});
export const subtitle = style({
  maxWidth: 720,
  margin: '9px 0 0',
  color: cssVarV2('text/secondary'),
  fontSize: 13,
  lineHeight: '20px',
});
export const mobileNewConversation = style({
  display: 'none',
  minHeight: 36,
  alignItems: 'center',
  gap: 5,
  padding: '0 10px',
  border: 0,
  borderRadius: 7,
  background: '#20242a',
  color: '#fff',
  font: 'inherit',
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  '@media': { 'screen and (max-width: 760px)': { display: 'inline-flex' } },
});
globalStyle(`${mobileNewConversation} svg`, {
  width: 14,
  height: 14,
  color: '#ff786c',
});
export const controls = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 12,
});
export const segmented = style({
  display: 'inline-flex',
  gap: 2,
  padding: 2,
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
});
globalStyle(`${segmented} button`, {
  minHeight: 30,
  padding: '4px 10px',
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: cssVarV2('text/secondary'),
  cursor: 'pointer',
});
globalStyle(`${segmented} button[aria-selected="true"]`, {
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  boxShadow: `0 0 0 0.5px ${cssVarV2('layer/insideBorder/border')}`,
});
export const filter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
});
globalStyle(`${filter} select`, {
  minWidth: 150,
  height: 34,
  padding: '0 26px 0 8px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 7,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
});
export const columns = style({
  minWidth: 0,
  minHeight: 520,
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  overflow: 'hidden',
  borderRadius: 18,
  background: cssVarV2('layer/background/secondary'),
  boxShadow: `inset 0 0 0 1px ${cssVarV2('layer/insideBorder/border')}, 0 20px 54px rgba(25, 29, 34, 0.055)`,
  '@media': {
    'screen and (max-width: 1080px)': { gridTemplateColumns: '1fr' },
  },
});
export const column = style({
  minWidth: 0,
  padding: '0 16px 20px',
  background: cssVarV2('layer/background/primary'),
  selectors: {
    '& + &': {
      borderLeft: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
  '@media': {
    'screen and (max-width: 1080px)': {
      minHeight: 160,
      selectors: {
        '& + &': {
          borderLeft: 0,
          borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
        },
      },
    },
  },
});
export const columnTitle = style({
  margin: 0,
  minHeight: 57,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '14px 0',
  fontSize: 13,
  fontWeight: 600,
});
export const count = style({
  minWidth: 23,
  height: 23,
  display: 'grid',
  placeItems: 'center',
  padding: '1px 6px',
  borderRadius: 999,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'center',
});
export const columnHint = style({
  margin: '0 0 14px',
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  lineHeight: '16px',
});
export const cardList = style({
  minHeight: 120,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});
export const card = style({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 6,
  padding: '14px 14px 13px',
  border: 0,
  borderRadius: 12,
  background: cssVarV2('layer/background/primary'),
  boxShadow: `0 7px 20px rgba(25, 29, 34, 0.045), inset 0 0 0 1px ${cssVarV2('layer/insideBorder/border')}`,
  color: cssVarV2('text/primary'),
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      boxShadow: `0 10px 24px rgba(25, 29, 34, 0.08), inset 0 0 0 1px ${cssVarV2('layer/insideBorder/border')}`,
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 1,
    },
  },
});
export const cardTop = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});
export const cardType = style({
  color: cssVarV2('text/tertiary'),
  fontSize: 10,
  fontWeight: 650,
  letterSpacing: '0.04em',
});
export const cardStatus = style({
  padding: '3px 7px',
  borderRadius: 999,
  background: '#eef3fc',
  color: '#3f73cb',
  fontSize: 10,
  selectors: {
    '&[data-column="todo"]': { background: '#fbf2e5', color: '#a56b24' },
    '&[data-column="done"]': { background: '#eaf5f0', color: '#33896b' },
  },
});
export const cardTitle = style({
  overflow: 'hidden',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: '19px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const cardMeta = style({
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  lineHeight: '17px',
});
export const reasons = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
export const reason = style({
  padding: '2px 5px',
  borderRadius: 3,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/secondary'),
  fontSize: 10,
});
export const cardFooter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  marginTop: 5,
  color: cssVarV2('text/tertiary'),
  fontSize: 10,
});
export const cardAvatar = style({
  width: 20,
  height: 20,
  display: 'grid',
  placeItems: 'center',
  borderRadius: '50%',
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/secondary'),
  fontSize: 8,
  fontWeight: 700,
});
export const state = style({
  minHeight: 96,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 12,
  color: cssVarV2('text/tertiary'),
  fontSize: 12,
  textAlign: 'center',
});
