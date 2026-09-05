import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

const interactive = {
  border: 0,
  color: cssVarV2('text/primary'),
  background: 'transparent',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: -2,
    },
  },
} as const;

export const root = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  padding: '14px 8px 8px',
});

export const headingRow = style({
  minHeight: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 6px 6px 8px',
});

export const heading = style({
  margin: 0,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 600,
  letterSpacing: 0,
});

export const inlineEditor = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '6px 4px 12px',
});

export const inlineEditorActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 6,
});

export const allProjects = style({
  ...interactive,
  width: '100%',
  minHeight: 34,
  display: 'grid',
  gridTemplateColumns: '20px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  borderRadius: 4,
  textAlign: 'left',
  fontSize: 13,
  selectors: {
    ...interactive.selectors,
    '&[data-selected="true"]': {
      background: cssVarV2('layer/background/secondary'),
      fontWeight: 600,
    },
  },
});

export const treeScroll = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  overflowY: 'auto',
  scrollbarColor: `${cssVarV2('layer/insideBorder/border')} transparent`,
  scrollbarWidth: 'thin',
});

export const projectList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  margin: '4px 0 0',
  padding: 0,
  listStyle: 'none',
});

export const projectItem = style({
  minWidth: 0,
});

export const projectRow = style({
  minWidth: 0,
  minHeight: 34,
  display: 'flex',
  alignItems: 'center',
  borderRadius: 4,
  selectors: {
    '&[data-selected="true"]': {
      background: cssVarV2('layer/background/secondary'),
    },
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const projectButton = style({
  ...interactive,
  minWidth: 0,
  minHeight: 34,
  flex: 1,
  display: 'grid',
  gridTemplateColumns: '20px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  padding: '6px 4px 6px 8px',
  borderRadius: 4,
  textAlign: 'left',
  fontSize: 13,
  selectors: {
    ...interactive.selectors,
  },
});

export const projectName = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const projectCount = style({
  minWidth: 16,
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
});

export const projectMenuButton = style({
  flexShrink: 0,
  marginRight: 2,
  opacity: 0,
  selectors: {
    [`${projectRow}:hover &`]: {
      opacity: 1,
    },
    '&:focus-visible': {
      opacity: 1,
    },
  },
});

export const renameInput = style({
  minWidth: 0,
  flex: 1,
  margin: '2px 4px',
});

export const documents = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  padding: '1px 0 5px 20px',
});

export const groupLabel = style({
  padding: '5px 8px 2px 16px',
  overflow: 'hidden',
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const documentButton = style({
  ...interactive,
  minWidth: 0,
  minHeight: 30,
  display: 'grid',
  gridTemplateColumns: '18px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 7,
  padding: '5px 8px',
  borderRadius: 4,
  color: cssVarV2('text/secondary'),
  textAlign: 'left',
  fontSize: 12,
  selectors: {
    ...interactive.selectors,
    '&:disabled': {
      cursor: 'default',
      opacity: 1,
      color: cssVarV2('text/tertiary'),
    },
    '&[data-placeholder="true"]:hover': {
      background: 'transparent',
    },
  },
});

export const documentRow = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});

export const documentRemoveButton = style({
  flexShrink: 0,
  opacity: 0,
  selectors: {
    [`${documentRow}:hover &`]: { opacity: 1 },
    '&:focus-visible': { opacity: 1 },
  },
});

export const centerState = style({
  minHeight: 112,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 16,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  textAlign: 'center',
});

export const emptyState = style({
  padding: '18px 10px',
  color: cssVarV2('text/tertiary'),
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'center',
});

globalStyle(`${allProjects} > svg, ${projectButton} > svg`, {
  width: 18,
  height: 18,
  color: cssVarV2('icon/primary'),
});

globalStyle(`${documentButton} > svg`, {
  width: 16,
  height: 16,
  color: cssVarV2('icon/secondary'),
});

globalStyle(`${documentButton} > span`, {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
