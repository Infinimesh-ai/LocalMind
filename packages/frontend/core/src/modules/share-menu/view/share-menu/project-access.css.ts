import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  paddingTop: 12,
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  letterSpacing: 0,
});

export const heading = style({
  margin: 0,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 500,
});

export const group = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});

globalStyle(`${group} > h4`, {
  margin: 0,
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  lineHeight: '16px',
  fontWeight: 500,
});

export const item = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '7px 0',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const identity = style({
  minWidth: 0,
  display: 'flex',
  flex: 1,
  flexDirection: 'column',
  gap: 2,
});

globalStyle(`${identity} > strong`, {
  overflow: 'hidden',
  fontSize: 12,
  lineHeight: '18px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

globalStyle(`${identity} > span`, {
  overflowWrap: 'anywhere',
  color: cssVarV2('text/tertiary'),
  fontSize: 10,
  lineHeight: '15px',
});

export const actions = style({
  flexShrink: 0,
  display: 'flex',
  gap: 6,
});

export const centerState = style({
  minHeight: 72,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  textAlign: 'center',
});

export const empty = style({
  padding: '6px 0',
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
});
