import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, globalStyle, style } from '@vanilla-extract/css';

export const railWidthVar = createVar();
export const paneWidthVar = createVar();
export const treeWidthVar = createVar();

export const root = style({
  position: 'relative',
  width: '100vw',
  height: '100dvh',
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: `clamp(192px, ${railWidthVar}, min(420px, calc(100% - 760px))) minmax(0, 1fr)`,
  overflow: 'hidden',
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  letterSpacing: 0,
  '@media': {
    'screen and (max-width: 1040px)': {
      gridTemplateColumns: `clamp(192px, ${railWidthVar}, min(420px, calc(100% - 400px))) minmax(0, 1fr)`,
    },
    'screen and (max-width: 760px)': {
      display: 'block',
    },
  },
});

export const rail = style({
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRight: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
  '@media': {
    'screen and (max-width: 760px)': {
      position: 'absolute',
      zIndex: 4,
      insetBlock: 0,
      insetInlineStart: 0,
      width: 'min(86vw, 288px)',
      visibility: 'hidden',
      transform: 'translateX(-100%)',
      pointerEvents: 'none',
      transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      selectors: {
        '&:dir(rtl)': {
          transform: 'translateX(100%)',
        },
        '&[data-mobile-open="true"]': {
          visibility: 'visible',
          transform: 'translateX(0)',
          pointerEvents: 'auto',
        },
      },
    },
  },
});

export const railScrim = style({
  display: 'none',
  '@media': {
    'screen and (max-width: 760px)': {
      position: 'absolute',
      zIndex: 3,
      inset: 0,
      display: 'block',
      border: 0,
      opacity: 0,
      background: cssVarV2('layer/background/overlayPanel'),
      pointerEvents: 'none',
      transition: 'opacity 180ms cubic-bezier(0.16, 1, 0.3, 1)',
      selectors: {
        '&[data-mobile-open="true"]': {
          opacity: 0.52,
          pointerEvents: 'auto',
        },
      },
    },
  },
});

export const railHeader = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 58,
  padding: '0 16px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
});

export const brand = style({
  minWidth: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: cssVarV2('text/primary'),
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.07em',
  cursor: 'pointer',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 4,
    },
  },
});

export const workspaceAndAccount = style({
  width: '100%',
  minHeight: 38,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  paddingRight: 4,
});

export const mobileRailClose = style({
  display: 'none',
  '@media': {
    'screen and (max-width: 760px)': {
      display: 'inline-flex',
      flexShrink: 0,
    },
  },
});

export const workspaceSelector = style({
  minWidth: 0,
  flex: 1,
});

export const railUtilities = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});

export const tasksTrigger = style({
  selectors: {
    '&[aria-expanded="true"]': {
      background: cssVarV2('layer/background/hoverOverlay'),
      color: cssVarV2('text/primary'),
    },
  },
});

export const workArea = style({
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  '@media': {
    'screen and (max-width: 760px)': {
      width: '100%',
      height: '100%',
    },
  },
});

export const conversationAndPeek = style({
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  overflow: 'hidden',
  selectors: {
    '&[data-project="true"][data-fullscreen="false"]': {
      gridTemplateColumns: `minmax(320px, 1fr) clamp(220px, ${paneWidthVar}, calc(100% - 320px))`,
    },
    '&[data-project="true"][data-panel="projectTree"][data-fullscreen="false"]':
      {
        gridTemplateColumns: `minmax(320px, 1fr) clamp(260px, ${paneWidthVar}, calc(100% - 320px))`,
      },
    '&[data-project="true"][data-panel="resource"][data-fullscreen="false"]': {
      gridTemplateColumns: `minmax(320px, 1fr) clamp(420px, ${paneWidthVar}, calc(100% - 320px))`,
    },
    '&[data-work-order="true"]': {
      gridTemplateColumns: `minmax(320px, 1fr) clamp(380px, ${paneWidthVar}, calc(100% - 320px))`,
    },
    '&[data-work-order="true"][data-work-order-collapsed="true"]': {
      gridTemplateColumns: 'minmax(0, 1fr) 48px',
    },
  },
  '@media': {
    'screen and (max-width: 1040px)': {
      selectors: {
        '&[data-project="true"][data-fullscreen="false"]': {
          gridTemplateColumns: 'minmax(0, 1fr)',
        },
        '&[data-project="true"][data-panel="projectTree"][data-fullscreen="false"]':
          {
            gridTemplateColumns: 'minmax(0, 1fr)',
          },
        '&[data-project="true"][data-panel="resource"][data-fullscreen="false"]':
          {
            gridTemplateColumns: 'minmax(0, 1fr)',
          },
        '&[data-work-order="true"]': {
          gridTemplateColumns: 'minmax(0, 1fr)',
        },
        '&[data-work-order="true"][data-work-order-collapsed="true"]': {
          gridTemplateColumns: 'minmax(0, 1fr)',
        },
      },
    },
  },
});

export const conversationPane = style({
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  selectors: { '&[hidden]': { display: 'none' } },
  '@media': {
    'screen and (max-width: 1040px)': {
      selectors: {
        [`${conversationAndPeek}[data-view="files"] &`]: { display: 'none' },
      },
    },
  },
});

export const resourcePane = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  overflow: 'hidden',
  borderLeft: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 1040px)': {
      borderLeft: 0,
      selectors: {
        [`${conversationAndPeek}[data-view="chat"][data-fullscreen="false"] &`]:
          { display: 'none' },
      },
    },
  },
});
export const workOrderPane = style({
  background: cssVarV2('layer/background/primary'),
});
export const workOrderPanelContent = style({
  height: '100%',
  selectors: {
    [`${conversationAndPeek}[data-work-order-collapsed="true"] &`]: {
      display: 'none',
    },
  },
  '@media': {
    'screen and (max-width: 1040px)': {
      selectors: {
        [`${conversationAndPeek}[data-work-order-collapsed="true"] &`]: {
          display: 'block',
        },
      },
    },
  },
});
export const workOrderCollapsedRail = style({
  height: '100%',
  display: 'none',
  alignItems: 'flex-start',
  justifyContent: 'center',
  flexDirection: 'row',
  padding: '12px 8px',
  selectors: {
    [`${conversationAndPeek}[data-work-order-collapsed="true"] &`]: {
      display: 'flex',
    },
  },
  '@media': {
    'screen and (max-width: 1040px)': {
      selectors: {
        [`${conversationAndPeek}[data-work-order-collapsed="true"] &`]: {
          display: 'none',
        },
      },
    },
  },
});
export const resourceWorkspace = style({
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  overflow: 'hidden',
  selectors: {
    '&[data-tree-open="true"]': {
      gridTemplateColumns: `clamp(160px, ${treeWidthVar}, calc(100% - 240px)) minmax(0, 1fr)`,
    },
  },
});
export const narrowTree = style({
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  borderRight: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const paneResizeHandle = style({
  position: 'absolute',
  zIndex: 3,
  top: 0,
  right: -4,
  bottom: 0,
  width: 8,
  cursor: 'col-resize',
  touchAction: 'none',
  selectors: {
    [`${narrowTree} &`]: { right: 0 },
    '&::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 3,
      width: 2,
      background: cssVarV2('button/primary'),
      opacity: 0,
      transition: 'opacity 120ms ease-out',
    },
    '&:hover::after, &:focus-visible::after, &[data-dragging="true"]::after': {
      opacity: 1,
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: -2,
    },
  },
  '@media': {
    'screen and (max-width: 1040px)': {
      selectors: {
        [`${conversationPane} &`]: { display: 'none' },
        [`${narrowTree} &`]: { display: 'none' },
      },
    },
    'screen and (max-width: 760px)': {
      display: 'none',
    },
  },
});
export const filesPane = style({
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  selectors: { '&[hidden]': { display: 'none' } },
});
export const projectHeader = style({
  display: 'flex',
  minHeight: 58,
  flexShrink: 0,
  padding: '0 18px 0 24px',
  gap: 8,
  alignItems: 'center',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
});
export const projectBreadcrumbs = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  alignItems: 'center',
});
globalStyle(`${projectBreadcrumbs} button`, {
  maxWidth: '100%',
  overflowWrap: 'anywhere',
  textAlign: 'start',
  background: 'transparent',
  border: 0,
  padding: '4px 6px',
  color: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
});
globalStyle(`${projectBreadcrumbs} button + button::before`, {
  content: '"/"',
  marginRight: 8,
  color: cssVarV2('text/secondary'),
});
export const mobileViewTabs = style({
  display: 'none',
  '@media': { 'screen and (max-width: 1040px)': { display: 'flex', gap: 4 } },
});
export const rightPanelTrigger = style({
  flexShrink: 0,
  display: 'inline-flex',
});
export const taskArea = style({
  position: 'absolute',
  zIndex: 5,
  top: 58,
  right: 0,
  bottom: 0,
  width: 'min(520px, 100%)',
  minWidth: 0,
  overflow: 'auto',
  background: cssVarV2('layer/background/primary'),
  boxShadow: '-12px 0 32px rgba(25, 29, 34, 0.12)',
  selectors: {
    '&[data-open="false"], &[hidden]': { display: 'none' },
  },
});

export const taskScrim = style({
  position: 'absolute',
  zIndex: 4,
  inset: '58px 0 0',
  width: '100%',
  border: 0,
  background: 'rgba(25, 29, 34, 0.1)',
  cursor: 'default',
  selectors: {
    '&[hidden]': { display: 'none' },
  },
});

export const workOrderSenderState = style({
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

export const peekPane = style({
  minWidth: 0,
  minHeight: 0,
  borderLeft: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  overflow: 'hidden',
  '@media': {
    'screen and (max-width: 1040px)': {
      position: 'absolute',
      zIndex: 2,
      inset: 0,
      borderLeft: 0,
      background: cssVarV2('layer/background/primary'),
    },
  },
});

export const unavailableRoot = style({
  width: '100vw',
  height: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 24,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

globalStyle(`${root} ::selection`, {
  background: cssVarV2('button/primary'),
  color: cssVarV2('button/pureWhiteText'),
});

globalStyle(`${unavailableRoot} > svg`, {
  width: 28,
  height: 28,
  color: cssVarV2('icon/secondary'),
});

globalStyle(`${unavailableRoot} > h1`, {
  margin: '8px 0 0',
  color: cssVarV2('text/primary'),
  fontSize: 20,
  lineHeight: '28px',
  fontWeight: 600,
  letterSpacing: 0,
});

globalStyle(`${unavailableRoot} > p`, {
  maxWidth: 420,
  margin: 0,
  fontSize: 13,
  lineHeight: '20px',
});
