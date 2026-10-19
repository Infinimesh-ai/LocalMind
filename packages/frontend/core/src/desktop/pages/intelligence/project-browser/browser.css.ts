import { globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from '../workbench-tokens.css';

export const root = style({
  position: 'relative',
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: wb.paper,
  color: wb.ink,
  fontSize: 12,
});

export const toolbar = style({
  flexShrink: 0,
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  minHeight: 48,
  padding: '7px 14px',
  borderBottom: `1px solid ${wb.line}`,
  background: wb.paper,
  '@media': { print: { display: 'none' } },
});
export const toolbarGroup = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flexShrink: 0,
});
export const breadcrumb = style({
  flex: '1 1 160px',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
});
export const crumb = style({
  minWidth: 0,
  maxWidth: 200,
  height: 26,
  padding: '0 6px',
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: wb.ink2,
  fontSize: 13,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: wb.sidebarHover, color: wb.ink },
    '&[aria-current="page"]': { color: wb.ink, fontWeight: 600 },
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: -2 },
  },
});
export const crumbSeparator = style({ color: wb.ink3, flexShrink: 0 });
export const segmented = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  padding: 2,
  border: `1px solid ${wb.line}`,
  borderRadius: 8,
  background: wb.panel,
  flexShrink: 0,
});
export const segment = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  minWidth: 26,
  height: 24,
  padding: '0 6px',
  border: 0,
  borderRadius: 6,
  background: 'transparent',
  color: wb.ink2,
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&[aria-pressed="true"]': {
      background: wb.paper,
      color: wb.ink,
      boxShadow: wb.shadow,
    },
    '&:disabled': { opacity: 0.45, cursor: 'not-allowed' },
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: -2 },
  },
});
globalStyle(`${segment} > svg`, { width: 16, height: 16, flexShrink: 0 });
export const searchField = style({ width: 220, flexShrink: 1, minWidth: 140 });
export const searchBar = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 14px',
  borderBottom: `1px solid ${wb.line}`,
  background: wb.panel,
  color: wb.ink2,
});

export const body = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  outline: 'none',
  selectors: {
    '&[data-drop="true"]': {
      outline: `2px dashed ${wb.signal}`,
      outlineOffset: -4,
    },
  },
});
export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
});

export const state = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '40px 16px',
  color: wb.ink3,
  fontSize: 12,
  textAlign: 'center',
  overflowWrap: 'anywhere',
});
export const hint = style({
  margin: '12px 16px 0',
  padding: '8px 12px',
  borderRadius: 8,
  background: wb.warningSoft,
  border: `1px solid ${wb.warningLine}`,
  color: wb.warning,
  fontSize: 12,
});
export const loadMore = style({
  display: 'flex',
  justifyContent: 'center',
  padding: '8px 0 16px',
});

const selectable = {
  userSelect: 'none',
  cursor: 'default',
  outline: 'none',
  selectors: {
    '&[aria-selected="true"]': {
      background: wb.signalSoft,
      boxShadow: `inset 0 0 0 1px ${wb.signalLine}`,
    },
    '&:focus-visible': { boxShadow: `inset 0 0 0 2px ${wb.signal}` },
    '&[data-dragging="true"]': { opacity: 0.45 },
    '&[data-drop="true"]': {
      background: wb.signalSoft,
      boxShadow: `inset 0 0 0 2px ${wb.signal}`,
    },
    '&[aria-busy="true"]': { opacity: 0.6 },
    '&[aria-disabled="true"]': { opacity: 0.55 },
  },
} as const;

export const iconGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))',
  alignContent: 'start',
  gap: 6,
  padding: 2,
});
export const tile = style({
  ...selectable,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: '12px 6px 8px',
  borderRadius: 10,
  selectors: {
    ...selectable.selectors,
    '&:hover:not([aria-selected="true"])': { background: wb.panel },
  },
});
export const tileIcon = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 56,
  height: 56,
  color: wb.ink2,
  selectors: { '&[data-folder="true"]': { color: wb.signal } },
});
globalStyle(`${tileIcon} > svg`, { width: 44, height: 44 });
export const tileLabel = style({
  maxWidth: '100%',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  textAlign: 'center',
  fontSize: 12,
  lineHeight: 1.35,
  overflowWrap: 'anywhere',
});
export const tileMeta = style({ color: wb.ink3, fontSize: 11 });

export const listColumns = 'minmax(0, 1fr) 128px 156px';
export const listHeader = style({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'grid',
  gridTemplateColumns: listColumns,
  padding: '0 6px',
  borderBottom: `1px solid ${wb.line}`,
  background: wb.paper,
});
export const listHeaderCell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  height: 28,
  padding: '0 6px',
  border: 0,
  background: 'transparent',
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: wb.ink },
    '&[aria-sort="ascending"], &[aria-sort="descending"]': { color: wb.ink },
  },
});
globalStyle(`${listHeaderCell} > svg`, { width: 14, height: 14 });
export const listBody = style({ padding: '4px 0 12px' });
export const listRow = style({
  ...selectable,
  display: 'grid',
  gridTemplateColumns: listColumns,
  alignItems: 'center',
  minHeight: 28,
  padding: '0 6px',
  borderRadius: 6,
  selectors: {
    ...selectable.selectors,
    '&:hover:not([aria-selected="true"])': { background: wb.panel },
  },
});
export const listCell = style({
  minWidth: 0,
  padding: '0 6px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: wb.ink2,
});
export const nameCell = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: '0 6px',
  color: wb.ink,
});
globalStyle(`${nameCell} > svg`, { width: 16, height: 16, flexShrink: 0 });
export const disclosure = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 16,
  height: 16,
  flexShrink: 0,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: wb.ink3,
  cursor: 'pointer',
  transition: 'transform 120ms ease-out',
  selectors: { '&[aria-expanded="true"]': { transform: 'rotate(90deg)' } },
});
globalStyle(`${disclosure} > svg`, { width: 14, height: 14 });
export const disclosureSpacer = style({ width: 16, flexShrink: 0 });
export const label = style({
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const columns = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  overflowX: 'auto',
  overflowY: 'hidden',
});
export const column = style({
  width: 224,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderRight: `1px solid ${wb.line}`,
});
globalStyle(`${column} > div`, { padding: 4 });
export const columnRow = style({
  ...selectable,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 26,
  padding: '0 8px',
  borderRadius: 6,
  selectors: {
    ...selectable.selectors,
    '&[data-open="true"]:not([aria-selected="true"])': {
      background: wb.panelStrong,
    },
    '&:hover:not([aria-selected="true"])': { background: wb.panel },
  },
});
globalStyle(`${columnRow} > svg`, { width: 16, height: 16, flexShrink: 0 });
export const columnChevron = style({ color: wb.ink3 });
export const previewColumn = style({
  flex: '1 0 360px',
  minWidth: 360,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  overflow: 'hidden',
});

export const previewPane = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});
export const previewFrame = style({
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
});
export const meta = style({
  flexShrink: 0,
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: '4px 12px',
  margin: 0,
  padding: '10px 16px',
  borderBottom: `1px solid ${wb.line}`,
  background: wb.panel,
  fontSize: 12,
});
globalStyle(`${meta} dt`, { color: wb.ink3 });
globalStyle(`${meta} dd`, {
  margin: 0,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const folderSummary = style({
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 24,
  color: wb.ink2,
  textAlign: 'center',
});
globalStyle(`${folderSummary} > svg`, {
  width: 96,
  height: 96,
  color: wb.signal,
});

export const gallery = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});
export const galleryStage = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  borderBottom: `1px solid ${wb.line}`,
});
export const galleryStrip = style({
  flexShrink: 0,
  display: 'flex',
  gap: 6,
  padding: '10px 14px',
  overflowX: 'auto',
  overflowY: 'hidden',
  background: wb.panel,
});
export const galleryThumb = style([
  tile,
  { width: 96, flexShrink: 0, padding: '8px 4px 6px', background: wb.paper },
]);

export const quickLook = style({
  height: '72vh',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
});

export const results = style({ padding: '8px 12px 20px' });
export const resultGroup = style({ marginBottom: 12 });
export const resultGroupHeader = style({
  position: 'sticky',
  top: 0,
  zIndex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  margin: 0,
  padding: '6px 8px',
  background: wb.paper,
  borderBottom: `1px solid ${wb.line}`,
  color: wb.ink2,
  fontSize: 12,
  fontWeight: 650,
});
globalStyle(`${resultGroupHeader} > svg`, { width: 14, height: 14 });
export const resultCount = style({ color: wb.ink3, fontWeight: 400 });
export const resultList = style({ margin: 0, padding: 0, listStyle: 'none' });
export const resultRow = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '0 4px',
  borderRadius: 8,
  selectors: { '&:hover': { background: wb.panel } },
});
export const resultButton = style({
  flex: 1,
  minWidth: 0,
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '8px 6px',
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: wb.ink,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: -2 },
    '&:disabled': { cursor: 'not-allowed', opacity: 0.6 },
  },
});
globalStyle(`${resultButton} > svg`, {
  width: 18,
  height: 18,
  flexShrink: 0,
  marginTop: 1,
  color: wb.ink2,
});
export const resultCopy = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});
export const resultTitle = style({
  fontSize: 13,
  fontWeight: 500,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const resultPath = style({ color: wb.ink3, fontSize: 11 });
export const resultSnippet = style({
  color: wb.ink2,
  fontSize: 12,
  lineHeight: 1.5,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
});
globalStyle(`${resultCopy} mark`, {
  background: wb.warningSoft,
  color: wb.ink,
  borderRadius: 3,
  padding: '0 1px',
});
export const resultCheckbox = style({
  appearance: 'auto',
  width: 16,
  height: 16,
  margin: '10px 0 0 6px',
  flex: '0 0 16px',
});

export const projectGrid = style([
  iconGrid,
  { gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))', gap: 10 },
]);
export const projectTile = style([tile, { padding: '16px 8px 10px' }]);
export const projectTileIcon = style([
  tileIcon,
  { width: 72, height: 72, color: wb.signal },
]);
globalStyle(`${projectTileIcon} > svg`, { width: 64, height: 64 });
