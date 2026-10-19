import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

import { sectionLabel } from '../../localmind-theme/recipes';
import { localmindShell } from '../../localmind-theme/shell';
import { workbenchTokens as wb } from '../../localmind-theme/tokens.css';
export const collectionListHeader = style({
  height: 100,
  alignItems: 'center',
  padding: '48px 16px 20px 24px',
  overflow: 'hidden',
  display: 'flex',
  justifyContent: 'space-between',
  background: cssVar('backgroundPrimaryColor'),
  // Inside the explorer card the page hero already carries the title.
  selectors: {
    [`${localmindShell} &`]: { height: 56, padding: '12px 16px 12px 24px' },
  },
});
export const collectionListHeaderTitle = style({
  fontSize: cssVar('fontH5'),
  fontWeight: 500,
  color: cssVar('textSecondaryColor'),
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  userSelect: 'none',
  selectors: { [`${localmindShell} &`]: sectionLabel },
});
export const newCollectionButton = style({
  padding: '6px 10px',
  borderRadius: '8px',
  background: cssVar('backgroundPrimaryColor'),
  fontSize: cssVar('fontXs'),
  fontWeight: 500,
  height: '28px',
  selectors: {
    [`${localmindShell} &`]: {
      borderColor: wb.line,
      borderRadius: wb.radiusSmall,
    },
  },
});
