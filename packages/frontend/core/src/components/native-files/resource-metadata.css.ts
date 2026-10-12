import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
  gap: '8px 16px',
  width: '100%',
  minWidth: 0,
  selectors: {
    '&[data-compact="true"]': { display: 'contents' },
  },
});
export const group = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  minWidth: 0,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  selectors: {
    [`${root}[data-compact="true"] &`]: { display: 'contents' },
  },
});
export const actor = style({
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  minWidth: 0,
  color: cssVarV2('text/primary'),
  selectors: {
    '&[data-compact="true"]': { color: 'inherit', maxWidth: 120 },
  },
});
export const name = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const time = style({
  fontVariantNumeric: 'tabular-nums',
  width: 'fit-content',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 2,
    },
  },
});
export const tags = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  overflow: 'hidden',
});
export const row = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 12px',
  height: '100%',
  minWidth: 0,
  borderRadius: 6,
  selectors: {
    '&:hover': { backgroundColor: cssVarV2('layer/background/hoverOverlay') },
    '&[data-selected="true"]': {
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    },
    '&[data-card="true"]': {
      border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
      padding: 16,
    },
    '&[data-card="false"]': {
      display: 'grid',
      columnGap: 8,
      rowGap: 0,
      alignItems: 'center',
      height: 'auto',
      minHeight: 44,
      padding: '0 8px',
    },
  },
});
export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  minHeight: 32,
  selectors: { [`${row}[data-card="false"] &`]: { display: 'contents' } },
});
export const selection = style({
  display: 'flex',
  alignItems: 'center',
  gridColumn: 'selection',
  gridRow: 1,
});
export const titleCell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: 1,
  position: 'relative',
  selectors: {
    [`${row}[data-card="false"] &`]: {
      gridColumn: 'title',
      gridRow: 1,
      minHeight: 44,
    },
  },
});
export const title = style({
  selectors: {
    [`${row}[data-card="false"] &`]: {
      minHeight: 28,
      padding: 0,
      fontSize: 14,
      lineHeight: '20px',
    },
  },
});
export const details = style({
  minWidth: 0,
  selectors: {
    '&:empty': { display: 'none' },
    [`${row}[data-card="false"] &`]: { display: 'contents' },
  },
});
export const cell = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  lineHeight: '20px',
  color: cssVarV2('text/secondary'),
  selectors: {
    [`${root}[data-compact="true"] &`]: {
      gridRow: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
  },
});
export const preview = style({
  height: 32,
  overflow: 'hidden',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  selectors: {
    '&:empty': { display: 'none' },
    [`${row}[data-card="false"] &`]: {
      gridColumn: 'title / end',
      gridRow: 2,
      height: 'auto',
      paddingBottom: 8,
      lineHeight: '20px',
      whiteSpace: 'nowrap',
      textOverflow: 'ellipsis',
    },
    [`${row}[data-card="false"][data-show-icon="true"] &`]: { paddingLeft: 28 },
  },
});
export const actions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  selectors: {
    [`${row}[data-card="false"] &`]: {
      gridColumn: 'actions',
      gridRow: 1,
      justifyContent: 'flex-end',
    },
  },
});
export const inlineTags = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  maxWidth: 96,
  flexShrink: 1,
  selectors: {
    '&[data-empty="true"]': {
      maxWidth: 'none',
      flexShrink: 0,
    },
  },
});
export const listViewport = style({
  height: '100%',
  overflowX: 'auto',
  overflowY: 'hidden',
});
export const listSurface = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  vars: { '--resource-person-width': '64px' },
  '@container': {
    'resource-results (min-width: 800px)': {
      vars: { '--resource-person-width': '112px' },
    },
  },
});
export const listBody = style({ flex: 1, minHeight: 0, position: 'relative' });
export const columnHeaderInset = style({ padding: '0 16px', flexShrink: 0 });
export const columnHeader = style({
  display: 'grid',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  height: 32,
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
export const columnHeaderField = style({ textAlign: 'center' });

export const typeIcon = style({
  width: 20,
  height: 20,
  fontSize: 20,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: cssVarV2('icon/primary'),
});

globalStyle(`${row}[data-card="false"] ${actions} button`, {
  width: 24,
  height: 28,
  flexShrink: 0,
});
globalStyle(`${inlineTags} > div`, { minWidth: 0, maxWidth: '100%' });
globalStyle(
  `${row}[data-card="false"] ${actions} button:not([data-favorite="true"]):not([data-resource-operation="true"])`,
  {
    '@media': { '(hover: hover)': { opacity: 0 } },
  }
);
globalStyle(
  `${row}[data-card="false"]:hover ${actions} button, ${row}[data-card="false"]:focus-within ${actions} button, ${row}[data-card="false"] ${actions} button[data-state="open"]`,
  { opacity: 1 }
);
