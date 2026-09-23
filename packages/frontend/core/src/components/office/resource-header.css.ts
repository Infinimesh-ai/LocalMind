import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 8px',
  '@media': { print: { display: 'none' } },
});

export const title = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: cssVarV2('text/primary'),
  fontSize: 14,
  fontWeight: 600,
});

globalStyle(`${title} > svg`, {
  width: 18,
  height: 18,
  flexShrink: 0,
  color: cssVarV2('icon/primary'),
});

globalStyle(`${title} > span:first-of-type`, {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const revision = style({
  flexShrink: 0,
  padding: '1px 5px',
  borderRadius: 4,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
});

export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  maxWidth: '65%',
  overflowX: 'auto',
});
