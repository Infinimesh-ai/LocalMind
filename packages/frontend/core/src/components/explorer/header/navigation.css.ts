import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

import { localmindShell } from '../../localmind-theme/shell';
import { workbenchTokens as wb } from '../../localmind-theme/tokens.css';

export const container = style({
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  fontSize: 18,
  lineHeight: '26px',
  fontWeight: 600,
  paddingLeft: 8,
  selectors: {
    // Project hub segmented control (same as its Items / Relations switch).
    [`${localmindShell} &`]: {
      gap: 2,
      height: 34,
      boxSizing: 'border-box',
      padding: 3,
      borderRadius: 11,
      background: wb.panelStrong,
      boxShadow: `inset 0 0 0 1px ${wb.line}`,
      fontSize: 12.5,
      lineHeight: '20px',
      fontWeight: 560,
    },
  },
});

export const item = style({
  color: cssVarV2.text.secondary,
  selectors: {
    '&[data-active="true"]': {
      color: cssVarV2.text.primary,
    },
    [`${localmindShell} &`]: {
      display: 'inline-flex',
      alignItems: 'center',
      height: 28,
      padding: '0 12px',
      borderRadius: 8,
      color: wb.ink3,
      transition: 'background .15s ease, color .15s ease',
    },
    [`${localmindShell} &:hover`]: { color: wb.ink },
    [`${localmindShell} &[data-active="true"]`]: {
      background: wb.paper,
      color: wb.ink,
      boxShadow: `0 1px 3px rgba(24, 27, 31, 0.11), inset 0 0 0 1px ${wb.line}`,
    },
    [`${localmindShell} &:focus-visible`]: {
      outline: `2px solid ${wb.signal}`,
      outlineOffset: 2,
    },
  },
});
