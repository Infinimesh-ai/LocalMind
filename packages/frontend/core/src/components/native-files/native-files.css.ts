import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minWidth: 0,
});
export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
});
export const editor = style({
  width: '100%',
  minHeight: 280,
  resize: 'vertical',
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  padding: 12,
  borderRadius: 8,
  fontFamily: 'monospace',
  lineHeight: 1.6,
});
export const list = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 320,
  overflow: 'auto',
});
export const row = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 0',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
export const label = style({ flex: 1, minWidth: 0, overflowWrap: 'anywhere' });

export const media = style({
  maxWidth: '100%',
  maxHeight: 480,
  objectFit: 'contain',
});

export const hint = style({
  padding: '6px 12px',
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  overflowWrap: 'anywhere',
});
