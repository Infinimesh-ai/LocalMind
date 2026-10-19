import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './tokens.css';

/** Project hub brand row; its 58px height lines up with the page header. */
export const brandRow = style({
  flexShrink: 0,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  height: 58,
  marginBottom: 6,
  padding: '0 12px 0 20px',
  borderBottom: `1px solid ${wb.line}`,
  // Same surface as the page header it lines up with.
  background: cssVarV2('layer/background/primary'),
});
export const brand = style({
  minWidth: 0,
  color: wb.ink,
  fontSize: 12,
  fontWeight: 760,
  letterSpacing: '0.09em',
  userSelect: 'none',
});
