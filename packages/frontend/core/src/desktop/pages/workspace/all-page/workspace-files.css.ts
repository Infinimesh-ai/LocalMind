import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const panel = style({
  margin: '8px 24px',
  padding: '8px 12px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  fontSize: 14,
});
export const controls = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 8,
});
export const list = style({
  listStyle: 'none',
  padding: 0,
  margin: 0,
  maxHeight: 240,
  overflow: 'auto',
});
export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '4px 0',
});
export const name = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
