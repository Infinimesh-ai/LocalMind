import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

import { localmindShell } from '../../../../components/localmind-theme/shell';
import { workbenchTokens as wb } from '../../../../components/localmind-theme/tokens.css';

export const header = style({
  display: 'flex',
  height: '52px',
  width: '100%',
  alignItems: 'center',
  flexShrink: 0,
  padding: '0 16px',
  zIndex: 1,
  gap: '12px',
  background: cssVar('backgroundPrimaryColor'),
  selectors: {
    [`${localmindShell} &`]: {
      height: 58,
      borderBottom: `1px solid ${wb.line}`,
    },
  },
  '@media': {
    print: {
      display: 'none',
    },
  },
});

export const spacer = style({
  flexGrow: 1,
  minWidth: 12,
});

export const standaloneExtensionSwitcherWrapper = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  height: '52px',
  position: 'relative',
});
