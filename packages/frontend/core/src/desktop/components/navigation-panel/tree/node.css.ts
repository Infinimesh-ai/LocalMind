import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, keyframes, style } from '@vanilla-extract/css';

import { selectedItem } from '../../../../components/localmind-theme/recipes';
import { localmindShell } from '../../../../components/localmind-theme/shell';
import { workbenchTokens as wb } from '../../../../components/localmind-theme/tokens.css';

// Workspace sidebar rows follow the Project hub item metrics.
const shellSidebar = `${localmindShell} [data-testid="app-sidebar"]`;
export const levelIndent = createVar();
export const linkItemRoot = style({
  color: 'inherit',
});
export const itemRoot = style({
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: '4px',
  textAlign: 'left',
  color: 'inherit',
  width: '100%',
  minHeight: '30px',
  userSelect: 'none',
  cursor: 'pointer',
  padding: '0 6px',
  fontSize: cssVar('fontSm'),
  position: 'relative',
  marginTop: '0px',
  selectors: {
    '&:hover': {
      background: cssVar('hoverColor'),
    },
    '&[data-active="true"]': {
      background: cssVar('hoverColor'),
    },
    '&[data-disabled="true"]': {
      cursor: 'default',
      color: cssVar('textSecondaryColor'),
      pointerEvents: 'none',
    },
    '&[data-dragging="true"]': {
      opacity: 0.5,
    },
    [`${shellSidebar} &`]: {
      minHeight: wb.sidebarItemHeight,
      borderRadius: wb.sidebarItemRadius,
      fontSize: wb.sidebarItemFontSize,
      lineHeight: wb.sidebarItemLineHeight,
    },
    [`${shellSidebar} &[data-active="true"]`]: selectedItem,
  },
});
export const itemMain = style({
  display: 'flex',
  alignItems: 'center',
  width: 0,
  flex: 1,
  position: 'relative',
  gap: 8,
});
export const toggleIcon = style({
  width: 20,
  height: 20,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 12,
});
export const itemRenameAnchor = style({
  pointerEvents: 'none',
  position: 'absolute',
  left: 0,
  top: -10,
  width: 10,
  height: 10,
});
export const itemContent = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  alignItems: 'center',
  flex: 1,
  minWidth: 0,
  color: cssVarV2('text/primary'),
  lineHeight: cssVar('lineHeight'),
});
export const postfix = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  // Reserve the same create/sort/more slots for every row, including leaves.
  flex: '0 0 64px',
  minHeight: 20,
});
export const operation = style({
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
  opacity: 0,
  pointerEvents: 'none',
  selectors: {
    [`${itemRoot}:hover &, ${itemRoot}:focus-within &`]: {
      opacity: 1,
      pointerEvents: 'initial',
    },
    '&:has([data-folder-sort-visible="true"])': {
      opacity: 1,
      pointerEvents: 'initial',
    },
  },
  '@media': {
    '(hover: none)': {
      opacity: 1,
      pointerEvents: 'initial',
    },
  },
});
export const iconContainer = style({
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  width: 20,
  height: 20,
  color: cssVarV2('icon/primary'),
  fontSize: 20,
  position: 'absolute',
  selectors: {
    [`${itemRoot}[data-collapsible="true"]:hover &`]: {
      opacity: 0,
      pointerEvents: 'none',
    },
  },
});
export const collapsedIconContainer = style({
  width: '20px',
  height: '20px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '2px',
  transition: 'transform 0.2s',
  color: cssVarV2('icon/primary'),
  position: 'absolute',
  opacity: 0,
  pointerEvents: 'none',
  selectors: {
    '&[data-collapsed="true"]': {
      transform: 'rotate(-90deg)',
    },
    '&[data-disabled="true"]': {
      opacity: 0.3,
      pointerEvents: 'none',
    },
    '&:hover': {
      background: cssVar('hoverColor'),
    },
    [`${itemRoot}[data-collapsible="true"]:hover &`]: {
      opacity: 1,
      pointerEvents: 'initial',
    },
  },
});
export const collapsedIcon = style({
  transition: 'transform 0.2s ease-in-out',
  fontSize: 16,
  selectors: {
    '&[data-collapsed="true"]': {
      transform: 'rotate(-90deg)',
    },
  },
});

export const collapseContentPlaceholder = style({
  display: 'none',
  selectors: {
    '&:only-child': {
      display: 'initial',
    },
  },
});

const draggedOverAnimation = keyframes({
  '0%': {
    opacity: 1,
  },
  '60%': {
    opacity: 1,
  },
  '70%': {
    opacity: 0,
  },
  '80%': {
    opacity: 1,
  },
  '90%': {
    opacity: 0,
  },
  '100%': {
    opacity: 1,
  },
});

export const contentContainer = style({
  marginTop: 2,
  paddingLeft: levelIndent,
  position: 'relative',
});

export const draggingContainer = style({
  background: cssVar('--affine-background-primary-color'),
  width: '200px',
  borderRadius: '6px',
});

export const draggedOverEffect = style({
  position: 'relative',
  selectors: {
    '&[data-tree-instruction="make-child"][data-self-dragged-over="false"]:after':
      {
        display: 'block',
        content: '""',
        position: 'absolute',
        zIndex: 1,
        background: cssVar('--affine-hover-color'),
        left: levelIndent,
        top: 0,
        width: `calc(100% - ${levelIndent})`,
        height: '100%',
      },
    '&[data-tree-instruction="make-child"][data-self-dragged-over="false"][data-open="false"]:after':
      {
        animation: `${draggedOverAnimation} 1s infinite linear`,
      },
  },
});
