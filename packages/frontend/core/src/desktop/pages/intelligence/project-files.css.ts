import { globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './workbench-tokens.css';

export const selectionCheckbox = style({
  appearance: 'auto',
  width: 16,
  height: 16,
  flex: '0 0 16px',
});

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  padding: 0,
  background: wb.sidebar,
});
export const fileScroll = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '14px 12px 22px',
});
export const uploads = style({
  margin: 0,
  padding: 0,
  listStyle: 'none',
  maxHeight: 160,
  overflow: 'auto',
});

export const searchToolbar = style({ padding: '10px 16px' });
export const selectionToolbar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  fontSize: 12,
  background: wb.paper,
});
export const batchMessage = style({
  margin: 0,
  padding: '8px 16px',
  fontSize: 12,
  color: wb.ink2,
});
export const searchCopy = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  gap: 4,
  overflowWrap: 'anywhere',
});
globalStyle(searchCopy + ' strong', {
  fontSize: 13,
  fontWeight: 500,
  lineHeight: 1.5,
});
globalStyle(searchCopy + ' small', {
  fontSize: 12,
  lineHeight: 1.5,
  color: wb.ink3,
});
export const uploadRow = style({
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  minHeight: 36,
  fontSize: 12,
  padding: '4px 8px',
});
globalStyle(`${uploadRow} progress`, { width: 80, height: 5 });
export const toolbar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
  minHeight: 64,
  padding: '10px 18px',
  borderBottom: `1px solid ${wb.line}`,
  background: wb.paper,
  '@media': { print: { display: 'none' } },
});
export const heading = style({
  flex: '1 0 auto',
  minWidth: 0,
  margin: 0,
  color: wb.ink,
  fontSize: 14,
  fontWeight: 650,
  whiteSpace: 'nowrap',
});
export const resourceHeading = style([
  heading,
  {
    flex: 1,
    whiteSpace: 'normal',
    overflowWrap: 'anywhere',
    '@container': {
      'project-editor (max-width: 700px)': { flexBasis: '100%' },
    },
  },
]);
export const list = style({
  margin: 0,
  padding: 0,
  listStyle: 'none',
  minWidth: 0,
});
export const nested = style({ marginLeft: 12, minWidth: 0 });
export const row = style({
  display: 'flex',
  alignItems: 'center',
  minWidth: 0,
  minHeight: 44,
  borderRadius: 7,
  selectors: {
    '&:hover': { background: wb.sidebarHover },
    '&[data-dragging="true"]': { opacity: 0.45 },
    '&[data-drop="make-child"]': {
      background: wb.sidebarHover,
      outline: `1px solid ${wb.signal}`,
    },
    '&[data-drop="reorder-above"]': {
      boxShadow: `inset 0 2px ${wb.signal}`,
    },
    '&[data-drop="reorder-below"]': {
      boxShadow: `inset 0 -2px ${wb.signal}`,
    },
  },
});
export const open = style({
  flex: 1,
  display: 'flex',
  gap: 6,
  alignItems: 'center',
  minWidth: 0,
  minHeight: 44,
  padding: '7px 8px',
  border: 0,
  borderRadius: 7,
  textAlign: 'left',
  background: 'transparent',
  color: wb.ink,
  cursor: 'pointer',
  fontSize: 12,
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
      outlineOffset: -2,
    },
    '&[aria-current="true"]': {
      background: wb.paper,
      boxShadow: `inset 0 0 0 1px ${wb.line}`,
    },
  },
});
globalStyle(`${open} > svg`, { flexShrink: 0, width: 16, height: 16 });
export const title = style({
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const state = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '16px 8px',
  color: wb.ink2,
  fontSize: 12,
  overflowWrap: 'anywhere',
});
export const form = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
});
export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
});
export const breadcrumbs = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
});
export const picker = style({
  height: 280,
  overflow: 'auto',
  border: `1px solid ${wb.line}`,
  borderRadius: 4,
});
export const preview = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  overflow: 'hidden',
  background: wb.paper,
});
export const content = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  overflow: 'auto',
  position: 'relative',
});
export const editor = style({
  width: '100%',
  minHeight: '100%',
  position: 'relative',
});
globalStyle(`${editor} editor-host`, {
  display: 'block',
  width: '100%',
  minHeight: '100%',
});
globalStyle(`${editor}[data-mode="edgeless"]`, {
  height: '100%',
  overflow: 'hidden',
});
globalStyle(`${editor}[data-mode="edgeless"] editor-host`, { height: '100%' });
export const hidden = style({ display: 'none' });
export const officeBody = style({
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  selectors: {
    '&[data-chat-open="true"]': {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 360px)',
    },
  },
  '@media': {
    '(max-width: 1000px)': {
      selectors: {
        '&[data-chat-open="true"]': { gridTemplateColumns: 'minmax(0, 1fr)' },
      },
    },
  },
});
export const officeEditor = style([
  content,
  {
    '@media': {
      '(max-width: 1000px)': {
        selectors: {
          [`${officeBody}[data-chat-open="true"] &`]: { display: 'none' },
        },
      },
    },
  },
]);
export const officeChat = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  borderLeft: `1px solid ${wb.line}`,
});
export const officeConversation = style({ flex: 1, minWidth: 0, minHeight: 0 });

export const documentBody = style({
  minHeight: '100%',
  selectors: {
    '&[data-mode="page"]': { padding: '32px 24px 80px' },
    '&[data-mode="edgeless"]': { height: '100%' },
  },
  '@media': {
    '(max-width: 760px)': {
      selectors: { '&[data-mode="page"]': { padding: '24px 12px 64px' } },
    },
  },
});
export const documentTitle = style({
  margin: '0 auto 24px',
  maxWidth: 800,
  fontSize: 32,
  fontWeight: 700,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
});

export const filePreview = style([content, { padding: 24 }]);
globalStyle(`${filePreview} img, ${filePreview} video`, {
  display: 'block',
  maxWidth: '100%',
  maxHeight: '100%',
  margin: '0 auto',
  objectFit: 'contain',
});
globalStyle(`${filePreview} audio`, { width: '100%' });
export const fileText = style({
  margin: 0,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  fontFamily: 'var(--affine-font-code-family)',
  fontSize: 14,
});
globalStyle(`textarea.${fileText}`, {
  width: '100%',
  minHeight: 240,
  padding: 12,
  resize: 'vertical',
  color: wb.ink,
  background: wb.paper,
  border: `1px solid ${wb.line}`,
  borderRadius: 6,
  boxSizing: 'border-box',
});

// v10 preview header: quiet bordered tools beside the document title.
globalStyle(`${preview} > ${toolbar} button`, {
  minHeight: 30,
  border: `1px solid ${wb.line}`,
  borderRadius: 10,
  background: wb.paper,
  color: wb.ink2,
  boxShadow: '0 1px 2px rgba(82, 92, 102, 0.07)',
});
globalStyle(`${preview} > ${toolbar} button:hover:not(:disabled)`, {
  background: wb.panel,
  borderColor: wb.lineStrong,
  color: wb.ink,
});
