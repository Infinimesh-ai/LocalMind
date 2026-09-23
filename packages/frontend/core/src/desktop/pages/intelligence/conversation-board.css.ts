import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: cssVarV2('layer/background/primary'),
});
export const header = style({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  padding: '22px 24px 14px',
});
export const title = style({ margin: 0, fontSize: 22, lineHeight: '30px' });
export const subtitle = style({
  margin: '4px 0 0',
  color: cssVarV2('text/secondary'),
  fontSize: 13,
});
export const controls = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 24px 14px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});
export const segmented = style({
  display: 'inline-flex',
  gap: 2,
  padding: 2,
  borderRadius: 6,
  background: cssVarV2('layer/background/secondary'),
});
globalStyle(`${segmented} button`, {
  minHeight: 28,
  padding: '4px 10px',
  border: 0,
  borderRadius: 4,
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
  height: 30,
  padding: '0 26px 0 8px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 4,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
});
export const columns = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(220px, 1fr))',
  gap: 12,
  padding: 16,
  overflow: 'auto',
  '@media': {
    'screen and (max-width: 1040px)': {
      gridTemplateColumns: 'repeat(3, minmax(260px, 1fr))',
    },
    'screen and (max-width: 760px)': {
      gridTemplateColumns: 'minmax(260px, 1fr)',
      padding: 12,
    },
  },
});
export const column = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
  overflow: 'hidden',
});
export const columnTitle = style({
  margin: 0,
  minHeight: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '9px 12px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  fontSize: 13,
  fontWeight: 600,
});
export const count = style({
  minWidth: 20,
  padding: '1px 6px',
  borderRadius: 999,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'center',
});
export const cardList = style({
  minHeight: 120,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 8,
});
export const card = style({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 6,
  padding: 10,
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 6,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 1,
    },
  },
});
export const cardTitle = style({
  overflow: 'hidden',
  fontSize: 13,
  fontWeight: 600,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const cardMeta = style({
  color: cssVarV2('text/secondary'),
  fontSize: 11,
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
  justifyContent: 'space-between',
  gap: 8,
  color: cssVarV2('text/tertiary'),
  fontSize: 10,
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
