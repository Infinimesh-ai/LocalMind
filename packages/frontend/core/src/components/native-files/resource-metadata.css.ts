import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '8px 16px',
  width: '100%',
  minWidth: 0,
});
export const group = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});
export const actor = style({
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  minWidth: 0,
  color: cssVarV2('text/primary'),
});
export const name = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const time = style({
  fontVariantNumeric: 'tabular-nums',
  width: 'fit-content',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 2,
    },
  },
});
export const tags = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  overflow: 'hidden',
});
export const row = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 12px',
  height: '100%',
  minWidth: 0,
  borderRadius: 6,
  selectors: {
    '&:hover': { backgroundColor: cssVarV2('layer/background/hoverOverlay') },
    '&[data-selected="true"]': {
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    },
    '&[data-card="true"]': {
      border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
      padding: 16,
    },
  },
});
export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  minHeight: 32,
});
export const preview = style({
  height: 32,
  overflow: 'hidden',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});
export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
});
