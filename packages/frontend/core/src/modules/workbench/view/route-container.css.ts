import { cssVar } from '@toeverything/theme';
import { globalStyle, style } from '@vanilla-extract/css';

import {
  toolButton,
  toolButtonHover,
} from '../../../components/localmind-theme/recipes';
import { localmindShell } from '../../../components/localmind-theme/shell';
import { workbenchTokens as wb } from '../../../components/localmind-theme/tokens.css';

export const root = style({
  display: 'flex',
  height: '100%',
  overflow: 'clip',
  width: '100%',
  position: 'relative',
  flexDirection: 'column',
  minWidth: 0,
  background: cssVar('backgroundPrimaryColor'),
});

export const header = style({
  display: 'flex',
  height: '52px',
  width: '100%',
  alignItems: 'center',
  flexShrink: 0,
  background: cssVar('backgroundPrimaryColor'),
  padding: '0 16px',
  contain: 'strict',
  '@media': {
    print: {
      display: 'none',
    },
  },
  selectors: {
    '&[data-show-switch=true]': {
      paddingLeft: 8,
    },
    // Same 58px header and divider as the Project hub and the sidebar brand.
    [`${localmindShell} &`]: {
      height: 58,
      padding: '0 18px 0 24px',
      borderBottom: `1px solid ${wb.line}`,
    },
    [`${localmindShell} &[data-show-switch=true]`]: {
      paddingLeft: 12,
    },
  },
});

// Project hub header tools: 34px bordered icon squares and 34px buttons.
const shellHeader = `${localmindShell} ${header}`;
const shellIconTool = `${shellHeader} button[data-icon-variant]:not([data-variant="primary"])`;
globalStyle(shellIconTool, toolButton);
globalStyle(`${shellIconTool}:hover`, toolButtonHover);
const shellTextTool = `${shellHeader} button[data-variant="secondary"]:not([data-icon-variant])`;
globalStyle(shellTextTool, {
  ...toolButton,
  width: 'auto',
  padding: '0 12px',
  fontSize: 12.5,
  fontWeight: 560,
});
globalStyle(`${shellTextTool}:hover`, toolButtonHover);
globalStyle(`${shellHeader} button[data-variant="primary"]`, {
  height: 34,
  padding: '0 12px',
  borderRadius: 11,
});

export const viewBodyContainer = style({
  display: 'flex',
  flex: 1,
  overflow: 'hidden',
  contain: 'strict',
});

export const leftSidebarButton = style({
  margin: '0 16px 0 0',
});

export const rightSidebarButton = style({
  transition: 'all 0.2s ease-in-out',
  selectors: {
    '&[data-show=true]': {
      opacity: 1,
      width: 32,
      maxWidth: 32,
      marginLeft: 16,
    },
    [`${localmindShell} &[data-show=true]`]: {
      width: 34,
      maxWidth: 34,
      marginLeft: 8,
    },
    '&[data-show=false]': {
      opacity: 0,
      maxWidth: 0,
      marginLeft: 0,
      // prevent click event from being triggered
      pointerEvents: 'none',
    },
  },
});

export const viewHeaderContainer = style({
  display: 'flex',
  height: '100%',
  width: 0,
  flexGrow: 1,
  minWidth: 12,
});
