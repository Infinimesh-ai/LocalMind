import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

import { affinePaletteBridge } from './recipes';
import { localmindShell } from './shell';
import { workbenchTokens as wb } from './tokens.css';

/** Explorer page body: stock list components pick up the workbench palette. */
export const explorerSurface = style({
  selectors: { [`${localmindShell} &`]: { vars: affinePaletteBridge } },
});

/** White container card around an explorer list (no grey canvas). */
export const explorerCard = style({
  selectors: {
    [`${localmindShell} &`]: {
      margin: '8px 24px 24px',
      paddingTop: 4,
      border: `1px solid ${wb.line}`,
      borderRadius: wb.radius,
      background: cssVarV2('layer/background/primary'),
      boxShadow: wb.shadow,
      overflow: 'hidden',
    },
  },
  '@container': {
    'docs-body (width <= 500px)': {
      selectors: { [`${localmindShell} &`]: { marginInline: 20 } },
    },
    'docs-body (width <= 393px)': {
      selectors: { [`${localmindShell} &`]: { marginInline: 16 } },
    },
  },
});
