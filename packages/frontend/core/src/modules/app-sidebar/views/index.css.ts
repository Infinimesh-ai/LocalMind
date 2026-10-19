import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

import { affinePaletteBridge } from '../../../components/localmind-theme/recipes';
import { localmindShell } from '../../../components/localmind-theme/shell';
import { workbenchTokens as wb } from '../../../components/localmind-theme/tokens.css';

export const navWrapperStyle = style({
  '@media': {
    print: {
      display: 'none',
      zIndex: -1,
    },
  },
  paddingBottom: 8,
  selectors: {
    '&[data-has-border=true]': {
      borderRight: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
    '&[data-is-floating="true"], &[data-is-electron="false"]': {
      backgroundColor: cssVarV2('layer/background/primary'),
    },
    // Project hub sidebar: grey surface, workbench inks and a solid divider.
    [`${localmindShell} &`]: {
      vars: affinePaletteBridge,
      backgroundColor: wb.sidebar,
      borderRight: `1px solid ${wb.line}`,
      paddingBottom: 0,
    },
  },
});
export const hoverNavWrapperStyle = style({
  selectors: {
    '&[data-is-floating="true"]': {
      backgroundColor: cssVarV2('layer/background/primary'),
      height: 'calc(100% - 60px)',
      marginTop: '52px',
      marginLeft: '4px',
      boxShadow: cssVar('--affine-popover-shadow'),
      borderRadius: '6px',
    },
    [`${localmindShell} &[data-is-floating="true"]`]: {
      backgroundColor: wb.sidebar,
      borderRadius: wb.radius,
      boxShadow: wb.shadowRaised,
    },
    '&[data-is-floating="true"][data-is-electron="true"]': {
      height: '100%',
      marginTop: '-4px',
    },
    '&[data-is-floating="true"][data-client-border="true"]': {
      backgroundColor: cssVarV2('layer/background/overlayPanel'),
    },
    '&[data-is-floating="true"][data-client-border="true"]::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
      opacity: `var(--affine-noise-opacity, 0)`,
      backgroundRepeat: 'repeat',
      backgroundSize: '50px',
      // TODO(@Peng): figure out how to use vanilla-extract webpack plugin to inject img url
      backgroundImage: `var(--noise-background)`,
    },
  },
});
export const navHeaderButton = style({
  width: '32px',
  height: '32px',
  flexShrink: 0,
});
export const navHeaderNavigationButtons = style({
  display: 'flex',
  alignItems: 'center',
  columnGap: '32px',
});
export const navStyle = style({
  position: 'relative',
  width: '100%',
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
});
export const navBodyStyle = style({
  flex: '1 1 auto',
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  rowGap: '4px',
});
export const sidebarFloatMaskStyle = style({
  transition: 'opacity .15s',
  opacity: 0,
  pointerEvents: 'none',
  position: 'fixed',
  top: 0,
  left: 0,
  right: '100%',
  bottom: 0,
  background: cssVarV2('layer/background/modal'),
  selectors: {
    '&[data-open="true"][data-is-floating="true"]': {
      opacity: 1,
      pointerEvents: 'auto',
      right: '0',
      zIndex: 3,
    },
  },
  '@media': {
    print: {
      display: 'none',
    },
  },
});

export const resizeHandleShortcutStyle = style({
  alignItems: 'flex-end',
  marginBottom: '2px',
});
