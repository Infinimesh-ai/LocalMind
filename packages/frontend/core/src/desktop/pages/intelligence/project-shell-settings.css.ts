import { globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './workbench-tokens.css';

export const dialogContent = style({
  maxHeight: 'calc(100dvh - 32px)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
});

export const contributionList = style({
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const contributionItem = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  paddingBlock: 8,
  color: wb.ink,
  selectors: {
    '& + &': { borderTop: `1px solid ${wb.line}` },
  },
});
globalStyle(`${contributionItem} time`, {
  color: wb.ink3,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
});

export const settingsSection = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
});
export const settingsHint = style({
  color: wb.ink3,
  fontSize: 12,
  lineHeight: '18px',
});
