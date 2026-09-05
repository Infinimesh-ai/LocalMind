import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const root = style({
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
});

export const header = style({
  minHeight: 44,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  padding: '6px 10px 6px 12px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const title = style({
  minWidth: 0,
  flex: '1 1 160px',
  margin: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13,
  lineHeight: '20px',
  fontWeight: 600,
});

export const actions = style({
  minWidth: 0,
  marginInlineStart: 'auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 4,
});

export const openButton = style({
  flexShrink: 0,
  whiteSpace: 'nowrap',
});

export const content = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  overflow: 'hidden',
});
