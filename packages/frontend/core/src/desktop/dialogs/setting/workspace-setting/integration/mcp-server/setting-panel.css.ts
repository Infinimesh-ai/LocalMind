import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  '@media': {
    '(max-width: 520px)': { gap: 16 },
  },
});
export const panel = style({
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  overflow: 'hidden',
  background: cssVarV2('layer/background/primary'),
});
export const panelHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 16px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    '(max-width: 520px)': {
      alignItems: 'stretch',
      flexDirection: 'column',
      padding: 12,
    },
  },
});
globalStyle(`${panelHeader} > button`, {
  '@media': {
    '(max-width: 520px)': { width: '100%' },
  },
});
export const title = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});
export const description = style({
  fontSize: cssVar('fontXs'),
  lineHeight: '20px',
  color: cssVarV2('text/secondary'),
  overflowWrap: 'anywhere',
});
export const empty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '28px 20px',
  textAlign: 'center',
});
export const skeletons = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 16,
});
export const rows = style({ display: 'flex', flexDirection: 'column' });
export const row = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  padding: '12px 16px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: { '&:last-child': { borderBottom: 0 } },
  '@media': {
    '(max-width: 640px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      alignItems: 'start',
      padding: 12,
    },
  },
});
export const rowDisabled = style({
  opacity: 0.55,
  background: cssVarV2('layer/background/secondary'),
});
export const rowMain = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});
export const rowTitle = style({
  display: 'flex',
  minWidth: 0,
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});
export const rowName = style({
  minWidth: 0,
  overflowWrap: 'anywhere',
});
export const tag = style({
  borderRadius: 999,
  padding: '2px 8px',
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 400,
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
});
export const rowActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  '@media': {
    '(max-width: 640px)': { width: '100%' },
  },
});
globalStyle(`${rowActions} > button`, {
  '@media': {
    '(max-width: 640px)': { minWidth: 0, flex: 1 },
  },
});
export const capabilities = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  '@media': {
    '(max-width: 640px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});
export const capability = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '14px 16px',
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  borderRight: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  overflowWrap: 'anywhere',
  '@media': {
    '(max-width: 640px)': { borderRight: 0 },
  },
});
export const modal = style({
  width: 560,
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'calc(100dvh - 20px)',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 20,
  overflowX: 'hidden',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  '@media': {
    '(max-width: 520px)': {
      maxWidth: 'calc(100vw - 16px)',
      gap: 12,
      padding: '16px 12px',
      borderRadius: 8,
    },
  },
});
export const modalTitle = style({
  fontSize: 18,
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});
export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
});
export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
});
export const capabilitySelector = style({
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  maxHeight: 'min(52vh, 440px)',
  overflowX: 'hidden',
  overflowY: 'auto',
});
export const capabilitySelectorRow = style({
  minHeight: 44,
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  padding: '8px 10px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: { '&:last-child': { borderBottom: 0 } },
  '@media': {
    '(max-width: 520px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      alignItems: 'start',
    },
  },
});
export const capabilitySelectorName = style({
  color: cssVarV2('text/primary'),
  fontWeight: 500,
  overflowWrap: 'anywhere',
});
export const capabilitySelectorChecks = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 82px)',
  alignItems: 'center',
  gap: 8,
  '@media': {
    '(max-width: 520px)': {
      width: '100%',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
});
export const fixedValue = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '8px 10px',
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
});
export const select = style({
  width: '100%',
  height: 32,
  borderRadius: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  padding: '0 10px',
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
});
export const warning = style({
  padding: 12,
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontXs'),
  overflowWrap: 'anywhere',
});
export const summary = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
  overflowWrap: 'anywhere',
});
export const codeHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
});
export const preArea = style({
  maxHeight: 180,
  overflow: 'auto',
  margin: 0,
  padding: 12,
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
});
export const modalActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
});
globalStyle(`${modalActions} > button`, {
  '@media': {
    '(max-width: 520px)': { minWidth: 0, flex: 1 },
  },
});
