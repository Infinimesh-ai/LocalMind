import { style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from '../../localmind-theme/tokens.css';

// Mirrors the Project hub board header (conversation-board.css.ts).
export const hero = style({
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: '26px 24px 10px',
  '@container': {
    'docs-body (width <= 500px)': { padding: '18px 20px 6px' },
    'docs-body (width <= 393px)': { padding: '18px 16px 6px' },
  },
});
export const path = style({
  minWidth: 0,
  color: wb.ink3,
  fontFamily: wb.fontMono,
  fontSize: 11.5,
  letterSpacing: '0.03em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const titleRow = style({
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 16,
});
export const title = style({
  margin: 0,
  color: wb.ink,
  fontSize: 'clamp(28px, 2.6vw, 36px)',
  fontWeight: 650,
  letterSpacing: '-0.04em',
  lineHeight: 1.1,
});
export const subtitle = style({
  maxWidth: 720,
  margin: '10px 0 0',
  color: wb.ink3,
  fontSize: 13,
  lineHeight: '20px',
});
export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});
