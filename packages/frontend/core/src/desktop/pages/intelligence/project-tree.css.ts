import { globalStyle, style } from '@vanilla-extract/css';

import {
  sectionLabel,
  selectedItem,
} from '../../../components/localmind-theme/recipes';
import { workbenchTokens as wb } from './workbench-tokens.css';

const interactive = {
  border: 0,
  color: wb.ink,
  background: 'transparent',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: wb.sidebarHover,
    },
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
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
  padding: `16px ${wb.sidebarInset} 14px`,
});

export const overviewLabel = style({
  ...sectionLabel,
  lineHeight: 'normal',
  margin: '0 10px 6px',
});

export const headingRow = style({
  minHeight: 30,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginTop: 22,
  padding: '0 4px 4px 10px',
});

export const heading = style({
  ...sectionLabel,
  margin: 0,
});

export const newConversation = style({
  width: '100%',
  minHeight: 43,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: 10,
  marginBottom: 22,
  padding: '0 14px 0 10px',
  border: `1px solid ${wb.action}`,
  borderRadius: 14,
  background: wb.action,
  color: wb.onAction,
  fontSize: 13,
  fontWeight: 640,
  fontFamily: 'inherit',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(82, 92, 102, 0.07)',
  selectors: {
    '&:hover': { background: wb.actionHover },
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
      outlineOffset: 2,
    },
  },
});
export const newConversationPlus = style({
  width: 24,
  height: 24,
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 8,
  background: wb.brand,
  color: '#ffffff',
  boxShadow: '0 5px 12px rgba(234, 67, 53, 0.2)',
});
globalStyle(`${newConversationPlus} svg`, {
  width: 16,
  height: 16,
  color: '#ffffff',
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
  display: 'grid',
  gridTemplateColumns: '20px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  minHeight: wb.sidebarItemHeight,
  padding: '0 10px',
  borderRadius: wb.sidebarItemRadius,
  color: wb.ink2,
  textAlign: 'left',
  fontSize: wb.sidebarItemFontSize,
  lineHeight: wb.sidebarItemLineHeight,
  fontWeight: 400,
  selectors: {
    ...interactive.selectors,
    '&[data-selected="true"]': {
      ...selectedItem,
    },
  },
});
export const overviewIcon = style({
  position: 'relative',
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: `1.5px solid ${wb.ink3}`,
  selectors: {
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 4,
      borderRadius: '50%',
      background: wb.ink3,
    },
    [`${allProjects}[data-selected="true"] &`]: { borderColor: wb.brand },
    [`${allProjects}[data-selected="true"] &::after`]: {
      background: wb.brand,
    },
  },
});

export const treeScroll = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  overflowY: 'auto',
  scrollbarColor: `${wb.lineStrong} transparent`,
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
  minHeight: wb.sidebarItemHeight,
  display: 'flex',
  alignItems: 'center',
  marginTop: 3,
  borderRadius: wb.sidebarItemRadius,
  selectors: {
    '&[data-selected="true"]': {
      background: wb.paper,
      boxShadow: `inset 0 0 0 1px ${wb.line}, 0 1px 3px rgba(25, 29, 34, 0.04)`,
    },
    '&:not([data-selected="true"]):hover': {
      background: wb.sidebarHover,
    },
  },
});

export const projectButton = style({
  ...interactive,
  minWidth: 0,
  minHeight: wb.sidebarItemHeight,
  flex: 1,
  display: 'grid',
  gridTemplateColumns: '16px minmax(0, 1fr) 12px',
  alignItems: 'center',
  gap: 8,
  padding: '0 6px 0 10px',
  borderRadius: wb.sidebarItemRadius,
  color: wb.ink2,
  textAlign: 'left',
  fontSize: wb.sidebarItemFontSize,
  lineHeight: wb.sidebarItemLineHeight,
  fontWeight: 400,
  selectors: {
    ...interactive.selectors,
    '&:hover': { background: 'transparent' },
    [`${projectRow}[data-selected="true"] &`]: {
      color: wb.ink,
      fontWeight: 600,
    },
  },
});
export const projectDot = style({
  justifySelf: 'center',
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: '#687484',
  boxShadow: `0 0 0 3px ${wb.signalSoft}`,
  selectors: {
    [`${projectRow}[data-selected="true"] &`]: {
      background: wb.brand,
      boxShadow: `0 0 0 3px ${wb.brandSoft}`,
    },
  },
});
export const projectChevron = style({
  color: wb.ink3,
  fontSize: 15,
  lineHeight: 1,
  textAlign: 'center',
  transition: 'transform .15s ease',
  selectors: {
    '[aria-expanded="true"] > &': { transform: 'rotate(90deg)' },
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
  color: wb.ink3,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
});

export const projectMenuButton = style({
  flexShrink: 0,
  marginRight: 2,
  opacity: 0,
  selectors: {
    [`${projectRow}:hover &, ${projectRow}:focus-within &`]: {
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
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  margin: 0,
  padding: '4px 0 8px 22px',
  listStyle: 'none',
  selectors: {
    '&::before': {
      content: '""',
      position: 'absolute',
      left: 13,
      top: 0,
      bottom: 12,
      width: 1,
      background: wb.line,
    },
  },
});

export const personalSection = style({
  marginTop: 10,
  paddingTop: 8,
  borderTop: `1px solid ${wb.line}`,
});
globalStyle(`${personalSection} h3`, {
  margin: 0,
  padding: '4px 8px 4px 16px',
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 600,
});

export const groupLabel = style({
  padding: '5px 8px 2px 16px',
  overflow: 'hidden',
  color: wb.ink3,
  fontSize: 11,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const documentButton = style({
  ...interactive,
  flex: 1,
  minWidth: 0,
  minHeight: wb.sidebarItemHeight,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 10px 0 12px',
  borderRadius: wb.sidebarItemRadius,
  color: wb.ink2,
  textAlign: 'left',
  fontSize: wb.sidebarItemFontSize,
  lineHeight: wb.sidebarItemLineHeight,
  fontWeight: 400,
  selectors: {
    ...interactive.selectors,
    '&:disabled': {
      cursor: 'default',
      opacity: 1,
      color: wb.ink3,
    },
    '&[aria-current="page"]': {
      background: wb.paper,
      color: wb.ink,
      fontWeight: 600,
      boxShadow: 'inset 0 0 0 1px rgba(234, 67, 53, 0.24)',
    },
    '&[data-pinned="true"]': {
      fontWeight: 600,
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
  borderRadius: wb.sidebarItemRadius,
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
  color: wb.ink2,
  fontSize: 12,
  textAlign: 'center',
});

export const emptyState = style({
  padding: '18px 10px',
  color: wb.ink3,
  fontSize: 12,
  lineHeight: '18px',
  textAlign: 'center',
});

export const conversationPageState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '12px 8px',
  color: wb.ink2,
  fontSize: 12,
  textAlign: 'center',
});

export const loadMoreConversations = style({
  width: 'calc(100% - 16px)',
  margin: '10px 8px 4px',
  justifyContent: 'center',
});

globalStyle(`${projectButton} > svg`, {
  width: 18,
  height: 18,
  color: wb.ink2,
});

globalStyle(`${documentButton} > svg`, {
  width: 16,
  height: 16,
  color: wb.ink3,
});

globalStyle(`${documentButton}[data-pinned="true"] > svg`, {
  color: wb.signal,
});

globalStyle(`${documentButton} > span:not(:last-child)`, {
  flex: 1,
  minWidth: 0,
});
globalStyle(`${documentButton} > span`, {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const conversationState = style({
  width: 16,
  height: 16,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: wb.success,
  selectors: {
    '&:not([data-column="done"])::before': {
      content: '""',
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: wb.warning,
    },
  },
});

globalStyle(`${conversationState} > svg`, {
  width: 16,
  height: 16,
  stroke: 'currentColor',
  strokeWidth: 0.5,
});
