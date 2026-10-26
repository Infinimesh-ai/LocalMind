import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

import { sectionLabel, selectedItem } from '../localmind-theme/recipes';
import { localmindShell } from '../localmind-theme/shell';
import { workbenchTokens as wb } from '../localmind-theme/tokens.css';

const shell = `${localmindShell} &`;

export const workspaceAndUserWrapper = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  width: 'calc(100% + 12px)',
  height: 42,
  paddingRight: 6,
  alignSelf: 'center',
  selectors: { [shell]: { width: '100%', paddingRight: 0 } },
});
export const shortcuts = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 2,
  padding: '4px 0',
});
export const shortcut = style({
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 32,
  height: 32,
  flexShrink: 0,
  borderRadius: 4,
  fontSize: 20,
  color: cssVarV2('icon/primary'),
  selectors: {
    '&:hover, &[aria-current="page"], &[data-active="true"]': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 2,
    },
    [shell]: {
      width: 34,
      height: 34,
      borderRadius: wb.radiusSmall,
      color: wb.ink3,
    },
    [`${localmindShell} &:hover, ${localmindShell} &[aria-current="page"], ${localmindShell} &[data-active="true"]`]:
      { background: wb.sidebarHover, color: wb.ink },
  },
});

export const moreContent = style({
  width: 280,
  maxWidth: 'calc(100vw - 24px)',
  maxHeight: 'min(640px, var(--radix-popover-content-available-height))',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  padding: '8px 16px',
});

export const workspacesHeading = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 6px 4px',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  selectors: {
    [shell]: {
      ...sectionLabel,
      minHeight: 30,
      marginTop: 10,
      padding: '0 4px 4px 10px',
    },
  },
});

export const workspaceRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  borderRadius: 4,
  selectors: {
    '&[data-active="true"]': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    [shell]: {
      borderRadius: wb.sidebarItemRadius,
      color: wb.ink2,
      fontWeight: 400,
    },
    [`${localmindShell} &:hover`]: { background: wb.sidebarHover },
    [`${localmindShell} &[data-active="true"]`]: selectedItem,
  },
});

export const workspaceButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flex: 1,
  minWidth: 0,
  minHeight: 36,
  padding: '4px 6px',
  border: 0,
  borderRadius: 4,
  background: 'transparent',
  color: cssVarV2('text/primary'),
  font: 'inherit',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  textAlign: 'left',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&:focus-visible': { outline: `2px solid ${cssVarV2('button/primary')}` },
    '&:disabled': { cursor: 'wait' },
    [shell]: {
      minHeight: wb.sidebarItemHeight,
      padding: '0 6px 0 10px',
      borderRadius: wb.sidebarItemRadius,
      color: 'inherit',
      fontSize: wb.sidebarItemFontSize,
      lineHeight: wb.sidebarItemLineHeight,
      fontWeight: 'inherit',
    },
    [`${localmindShell} &:hover`]: { background: 'transparent' },
  },
});

export const workspaceName = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const workspaceSwitchStatus = style({
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 400,
  color: cssVarV2('text/secondary'),
});

export const createDoc = style({
  flexShrink: 0,
  height: 28,
  marginRight: 4,
  boxShadow: 'none',
  background: 'transparent',
});

export const workspaceChevron = style({
  flexShrink: 0,
  color: cssVarV2('icon/secondary'),
  selectors: { '&[data-expanded="false"]': { transform: 'rotate(-90deg)' } },
});

export const workspaceFiles = style({ paddingLeft: 12, paddingBottom: 8 });
export const treeRoot = style({ position: 'relative' });
// Keep row spacing inside its drop target rather than leaving dead gaps.
export const treeNode = style({ paddingTop: 2 });
export const treeRootDropZone = style({
  height: 24,
  position: 'relative',
  borderRadius: 4,
  fontSize: 12,
  color: cssVarV2('text/primary'),
  selectors: {
    '&[data-active="true"]': {
      background: `color-mix(in srgb, ${cssVar('primaryColor')} 12%, transparent)`,
    },
  },
});
export const treeRootDropLabel = style({
  position: 'absolute',
  inset: 0,
  padding: '2px 8px',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  pointerEvents: 'none',
});
export const treeMessage = style({
  padding: '10px 8px',
  fontSize: 12,
  color: cssVarV2('text/secondary'),
});

export const workspaceWrapper = style({
  width: 0,
  flex: 1,
});

export const bottomContainer = style({
  gap: 8,
});

export const menuItemWithHint = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const menuItemHint = style({
  fontSize: cssVar('fontXs'),
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
  whiteSpace: 'normal',
  maxWidth: 260,
});
