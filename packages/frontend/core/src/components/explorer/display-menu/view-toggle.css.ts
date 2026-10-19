import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

import { localmindShell } from '../../localmind-theme/shell';
import { workbenchTokens as wb } from '../../localmind-theme/tokens.css';

export const viewToggle = style({
  backgroundColor: 'transparent',
  selectors: {
    [`${localmindShell} &`]: {
      boxSizing: 'border-box',
      border: `1px solid ${wb.line}`,
      backgroundColor: wb.paper,
      boxShadow: '0 1px 2px rgba(82, 92, 102, 0.07)',
    },
  },
});
export const viewToggleItem = style({
  padding: 0,
  fontSize: 16,
  width: 24,
  color: cssVarV2.icon.primary,
  selectors: {
    [`${localmindShell} &`]: { width: 28, borderRadius: 8, color: wb.ink3 },
    [`${localmindShell} &[data-state=checked]`]: { color: wb.ink },
    '&[data-state=checked]': {
      color: cssVarV2.icon.primary,
    },
  },
});
export const viewToggleIndicator = style({
  backgroundColor: cssVarV2.layer.background.hoverOverlay,
  boxShadow: 'none',
  selectors: {
    [`${localmindShell} &`]: {
      borderRadius: 8,
      backgroundColor: wb.panelStrong,
    },
  },
});
