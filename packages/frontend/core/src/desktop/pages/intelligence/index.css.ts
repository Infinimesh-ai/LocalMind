import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, globalStyle, style } from '@vanilla-extract/css';

import {
  toolButton,
  toolButtonHover,
} from '../../../components/localmind-theme/recipes';
import { workbenchTokens as wb } from './workbench-tokens.css';

export const railWidthVar = createVar();
export const paneWidthVar = createVar();
export const treeWidthVar = createVar();

export const shell = style({
  width: '100%',
  height: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  background: wb.sidebar,
  selectors: {
    // Desktop client only: the workspace floats as one rounded window; the web
    // build fills the viewport edge to edge.
    '&[data-framed="true"]': {
      padding: '0 14px 14px',
      background: wb.canvas,
    },
  },
  '@media': {
    'screen and (max-width: 760px)': {
      selectors: { '&[data-framed="true"]': { padding: 0 } },
    },
  },
});

export const desktopTitlebar = style({
  height: 40,
  flexShrink: 0,
});

export const root = style({
  position: 'relative',
  width: '100vw',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: `56px clamp(192px, ${railWidthVar}, min(420px, calc(100% - 816px))) minmax(0, 1fr)`,
  overflow: 'hidden',
  background: wb.paper,
  color: wb.ink,
  letterSpacing: 0,
  selectors: {
    '&[data-workspace-expanded="true"]': {
      gridTemplateColumns: '56px minmax(0, 1fr)',
    },
    [`${shell}[data-framed="true"] &`]: {
      width: '100%',
      borderRadius: 22,
      border: '1px solid rgba(255, 255, 255, 0.78)',
      boxShadow:
        '0 28px 70px rgba(71, 78, 85, 0.16), inset 0 0 0 1px rgba(96, 106, 116, 0.07)',
    },
  },
  '@media': {
    'screen and (max-width: 1040px)': {
      gridTemplateColumns: `56px clamp(192px, ${railWidthVar}, min(420px, calc(100% - 456px))) minmax(0, 1fr)`,
    },
    'screen and (max-width: 760px)': {
      display: 'block',
    },
  },
});

export const rail = style({
  selectors: { '&[hidden]': { display: 'none' } },
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  borderRight: `1px solid ${wb.line}`,
  background: wb.sidebar,
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
  borderBottom: `1px solid ${wb.line}`,
  background: wb.paper,
});

export const brand = style({
  minWidth: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  padding: '0 4px',
  border: 0,
  background: 'transparent',
  color: wb.ink,
  fontSize: 12,
  fontWeight: 760,
  letterSpacing: '0.09em',
  cursor: 'default',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
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
  gap: 8,
});
export const tasksTrigger = style({
  selectors: {
    '&[aria-expanded="true"]': {
      background: wb.sidebarHover,
      color: wb.ink,
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
    '&[data-project="true"][data-panel="context"][data-fullscreen="false"]': {
      gridTemplateColumns: `minmax(320px, 1fr) clamp(380px, ${paneWidthVar}, calc(100% - 320px))`,
    },
    '&[data-project="true"][data-panel="projectTree"][data-fullscreen="false"]':
      {
        gridTemplateColumns: `minmax(320px, 1fr) clamp(260px, ${paneWidthVar}, calc(100% - 320px))`,
      },
    '&[data-project="true"][data-panel="resource"][data-fullscreen="false"]': {
      gridTemplateColumns: `minmax(320px, 1fr) clamp(420px, ${paneWidthVar}, calc(100% - 320px))`,
    },
    '&[data-project="true"][data-work-order="false"][data-panel="none"]': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
    '&[data-work-order="true"]': {
      gridTemplateColumns: `minmax(320px, 1fr) clamp(380px, ${paneWidthVar}, calc(100% - 320px))`,
    },
    '&[data-work-order="true"][data-work-order-collapsed="true"]': {
      gridTemplateColumns: 'minmax(0, 1fr)',
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
        '&[data-project="true"][data-panel="context"][data-fullscreen="false"]':
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
  borderLeft: `1px solid ${wb.line}`,
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
  borderLeft: 0,
  background: wb.panel,
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
export const resourceWorkspace = style({
  containerType: 'inline-size',
  containerName: 'project-editor',
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
  borderRight: `1px solid ${wb.line}`,
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
      background: wb.lineStrong,
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
  borderBottom: `1px solid ${wb.line}`,
  background: wb.paper,
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
  color: wb.ink3,
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 7,
});
globalStyle(`${projectBreadcrumbs} button:first-child`, {
  color: wb.ink,
  fontSize: 14,
  fontWeight: 660,
});
globalStyle(`${projectBreadcrumbs} button:hover`, {
  background: wb.panel,
});
globalStyle(`${projectBreadcrumbs} button + button::before`, {
  content: '"/"',
  marginRight: 8,
  color: wb.ink3,
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
  background: wb.paper,
  boxShadow: wb.shadowRaised,
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
  color: wb.ink2,
  textAlign: 'center',
});

export const peekPane = style({
  minWidth: 0,
  minHeight: 0,
  borderLeft: `1px solid ${wb.line}`,
  overflow: 'hidden',
  '@media': {
    'screen and (max-width: 1040px)': {
      position: 'absolute',
      zIndex: 2,
      inset: 0,
      borderLeft: 0,
      background: wb.paper,
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
  background: wb.canvas,
  color: wb.ink2,
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
  color: wb.ink,
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

// v10 header tools: bordered 34px squares; the account avatar is a dark tile.
const headerTool = `${projectHeader} > button, ${projectHeader} > div > button, ${projectHeader} > div > div > button`;
globalStyle(headerTool, toolButton);
globalStyle(
  `${projectHeader} > button:hover, ${projectHeader} > div > button:hover, ${projectHeader} > div > div > button:hover`,
  toolButtonHover
);
globalStyle(`${railUtilities} > button:last-child`, {
  background: wb.action,
  borderColor: wb.action,
});
globalStyle(`${railUtilities} > button:last-child span`, {
  borderRadius: 8,
});

// v10: context and project files float as cards beside the stream.
globalStyle(
  `${conversationAndPeek}[data-panel="context"] ${resourcePane}, ${conversationAndPeek}[data-panel="projectTree"] ${resourcePane}`,
  { borderLeft: 0, background: wb.panel }
);
globalStyle(`${conversationAndPeek}[data-panel="projectTree"] ${filesPane}`, {
  height: 'auto',
  maxHeight: 'calc(100% - 40px)',
  margin: '20px 16px 20px 4px',
  overflow: 'hidden',
  border: `1px solid ${wb.line}`,
  borderRadius: 17,
  background: wb.paper,
  boxShadow: '0 1px 2px rgba(75, 84, 93, 0.05)',
});
// The documents view is a full-bleed file browser, not a floating card.
globalStyle(
  `${conversationAndPeek}[data-view="files"][data-panel="projectTree"] ${filesPane}`,
  {
    height: '100%',
    maxHeight: 'none',
    margin: 0,
    border: 0,
    borderRadius: 0,
    boxShadow: 'none',
  }
);

// v10 task-context card: the work order panel floats beside the stream.
globalStyle(`${workOrderPanelContent}`, {
  padding: '20px 16px 20px 4px',
  boxSizing: 'border-box',
});

// Collapsing a work order card removes the column; the title card holds the toggle.
globalStyle(
  `${conversationAndPeek}[data-work-order-collapsed="true"] ${workOrderPane}`,
  {
    '@media': { 'screen and (min-width: 1041px)': { display: 'none' } },
  }
);
export const orderCard = style({
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '20px 16px 20px 4px',
  boxSizing: 'border-box',
  background: wb.panel,
});
export const orderSwitch = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  padding: 4,
  borderRadius: 12,
  background: wb.panelStrong,
});
globalStyle(`${orderSwitch} button`, {
  flex: '1 1 auto',
  minWidth: 0,
  maxWidth: '100%',
  minHeight: 28,
  padding: '6px 10px',
  overflowWrap: 'anywhere',
  border: 0,
  borderRadius: 9,
  background: 'transparent',
  color: wb.ink3,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
});
globalStyle(`${orderSwitch} button[aria-selected="true"]`, {
  background: wb.paper,
  color: wb.ink,
  boxShadow: '0 1px 3px rgba(24, 27, 31, 0.1)',
});
export const orderCardBody = style({ flex: 1, minHeight: 0 });
