import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

const border = cssVarV2('layer/insideBorder/border');
const background = cssVarV2('layer/background/primary');
const text = cssVarV2('text/primary');
const secondary = cssVarV2('text/secondary');
const accent = cssVarV2('button/primary');

export const root = style({
  vars: {
    '--graph-height': '440px',
    '--relation-selected': cssVarV2('text/link'),
    '--relation-incoming': cssVarV2('text/link'),
    '--relation-outgoing': cssVarV2('text/primary'),
    '--relation-complete': cssVarV2('status/success'),
    '--relation-muted': secondary,
    '--relation-neutral': secondary,
  },
  position: 'relative',
  flex: 1,
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  alignContent: 'start',
  border: `1px solid ${border}`,
  borderRadius: 12,
  background,
  color: text,
  overflow: 'hidden',
  selectors: {
    '&[data-compact="true"]': { gridTemplateColumns: 'minmax(0, 1fr)' },
    '&[data-enlarged="true"]': {
      vars: { '--graph-height': 'min(72vh, 800px)' },
    },
  },
});
export const graphArea = style({ minWidth: 0 });
export const topBar = style({
  display: 'flex',
  minHeight: 52,
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '8px 16px',
  borderBottom: `1px solid ${border}`,
  fontSize: 14,
});
export const canvas = style({ minWidth: 0 });
export const graphToolbar = style({
  display: 'flex',
  minHeight: 54,
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  padding: '10px 16px',
});
export const search = style({
  minWidth: 0,
  width: 156,
  height: 32,
  padding: '4px 8px',
  border: `1px solid ${border}`,
  borderRadius: 6,
  background,
  color: text,
  fontSize: 12,
  selectors: {
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
  },
});
export const diagram = style({
  position: 'relative',
  width: '100%',
  height: 'var(--graph-height)',
  overflow: 'clip',
  touchAction: 'none',
  userSelect: 'none',
  cursor: 'grab',
  selectors: {
    '&[data-panning="true"]': { cursor: 'grabbing' },
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: -2 },
  },
});
export const lines = style({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
});
export const person = style({
  position: 'absolute',
  transform: 'translate(-50%, -24px)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  width: 96,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: text,
  fontSize: 12,
  cursor: 'pointer',
  borderRadius: 6,
  selectors: {
    '&[data-self="true"]': { cursor: 'default' },
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 4 },
  },
});
globalStyle(`${person} strong`, {
  width: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textAlign: 'center',
  fontWeight: 500,
});
export const nodeAvatar = style({
  display: 'flex',
  width: 48,
  height: 48,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  background: cssVarV2('layer/background/secondary'),
  border: `1px solid ${border}`,
  color: text,
  fontSize: 18,
  fontWeight: 600,
});
globalStyle(`${person}[data-self="true"] ${nodeAvatar}`, {
  background: text,
  color: background,
  borderColor: text,
});
export const labelGroup = style({
  position: 'absolute',
  transform: 'translate(-50%, -50%)',
});
export const summary = style({
  display: 'flex',
  width: '100%',
  height: 48,
  alignItems: 'center',
  justifyContent: 'center',
  padding: '5px 10px',
  background,
  color: text,
  border: `1px solid ${border}`,
  borderRadius: 8,
  fontSize: 13,
  lineHeight: '18px',
  textAlign: 'center',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&[data-active="true"]': {
      borderColor: cssVarV2('text/link'),
      outline: `1px solid ${cssVarV2('text/link')}`,
    },
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 3 },
  },
});
globalStyle(`${summary} span`, {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
});
export const expand = style({
  position: 'absolute',
  top: 'calc(100% + 6px)',
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
  minHeight: 28,
  padding: '2px 8px',
  background,
  color: secondary,
  border: `1px solid ${border}`,
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  selectors: {
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
  },
});
globalStyle(`${expand} svg`, { width: 16, height: 16 });
export const graphFooter = style({
  minHeight: 46,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  padding: '8px 16px',
  borderTop: `1px solid ${border}`,
  fontSize: 11,
  color: secondary,
});
export const pagination = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontVariantNumeric: 'tabular-nums',
});
export const noPeople = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  padding: 16,
  color: secondary,
  fontSize: 13,
});
export const list = style({
  minWidth: 0,
  minHeight: 0,
  contain: 'size',
  display: 'flex',
  flexDirection: 'column',
  borderLeft: `1px solid ${border}`,
  background,
  selectors: { '&[hidden]': { display: 'none' } },
});
globalStyle(`${root}[data-compact="true"] ${list}`, {
  position: 'absolute',
  top: 0,
  bottom: 0,
  right: 0,
  width: 'min(360px, 100%)',
  zIndex: 2,
  maxHeight: 'none',
});
export const listHeader = style({
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  minHeight: 52,
  gap: 8,
  padding: '8px 14px',
  borderBottom: `1px solid ${border}`,
});
globalStyle(`${listHeader} h2`, { fontSize: 13, margin: 0, fontWeight: 600 });
globalStyle(`${listHeader} h2:focus-visible`, {
  outline: `2px solid ${accent}`,
});
export const filterBar = style({
  display: 'flex',
  flex: 'none',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '6px 14px',
  fontSize: 12,
  borderBottom: `1px solid ${border}`,
});
globalStyle(`${list} > ul`, {
  margin: 0,
  padding: '0 14px',
  listStyle: 'none',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  minHeight: 0,
  flex: 1,
});
export const order = style({
  padding: '14px 4px',
  borderBottom: `1px solid ${border}`,
  scrollMargin: 8,
  outlineOffset: -2,
  selectors: {
    '&[data-active="true"]': {
      background: cssVarV2('layer/background/secondary'),
      outline: `1px solid ${cssVarV2('text/link')}`,
    },
    '&:focus-visible': { outline: `2px solid ${accent}` },
  },
});
export const orderHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 6,
  marginBottom: 8,
});
export const openConversation = style({
  fontSize: 11,
  flex: 'none',
  minHeight: 28,
});
export const orderSummary = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 7,
  padding: 0,
  width: '100%',
  border: 0,
  background: 'transparent',
  textAlign: 'left',
  color: text,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1.6,
  overflowWrap: 'anywhere',
  selectors: {
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
  },
});
export const orderMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 10px',
  color: secondary,
  fontSize: 11,
});
globalStyle(`${orderSummary} strong`, {
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  fontSize: 14,
  lineHeight: '21px',
  fontWeight: 600,
});
export const orderStatus = style({
  color: secondary,
  fontSize: 12,
  lineHeight: 1.5,
});
globalStyle(`${orderStatus}[data-tone="complete"]`, {
  color: 'var(--relation-complete)',
});
export const requirements = style({
  margin: '12px 0 0',
  padding: 0,
  listStyle: 'none',
  fontSize: 12,
  lineHeight: 1.6,
  overflowWrap: 'anywhere',
});
globalStyle(`${requirements} li`, { margin: '4px 0', borderRadius: 4 });
globalStyle(`${requirements} li[data-active="true"]`, {
  outline: `1px solid ${cssVarV2('text/link')}`,
});
globalStyle(`${requirements} button`, {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  width: '100%',
  textAlign: 'left',
  padding: '6px 4px',
  border: 0,
  background: 'transparent',
  color: text,
  font: 'inherit',
  cursor: 'pointer',
});
globalStyle(`${requirements} button:focus-visible`, {
  outline: `2px solid ${accent}`,
  outlineOffset: 2,
});
export const requirementKind = style({
  flex: 'none',
  fontSize: 11,
  color: secondary,
});
export const detailsToggle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minHeight: 32,
  marginTop: 8,
  padding: 0,
  background: 'transparent',
  color: secondary,
  border: 0,
  fontSize: 11,
  cursor: 'pointer',
  selectors: {
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
  },
});
globalStyle(`${detailsToggle} svg`, { width: 16, height: 16 });
globalStyle(`${detailsToggle}[aria-expanded="true"] svg`, {
  transform: 'rotate(180deg)',
});
export const orderDetails = style({
  fontSize: 12,
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});
globalStyle(`${orderDetails} dt`, { fontWeight: 600 });
globalStyle(`${orderDetails} dd`, { margin: '4px 0 12px', color: secondary });
export const orderFilters = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 4,
  padding: '10px 14px',
  borderBottom: `1px solid ${border}`,
  flex: 'none',
});
globalStyle(`${orderFilters} button`, {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 4,
  border: '1px solid transparent',
  borderRadius: 4,
  background: 'transparent',
  color: secondary,
  fontSize: 12,
  minHeight: 32,
  padding: '4px 8px',
  cursor: 'pointer',
});
globalStyle(`${orderFilters} button[aria-pressed="true"]`, {
  color: text,
  borderColor: border,
  background: cssVarV2('layer/background/secondary'),
});
globalStyle(`${orderFilters} button:focus-visible`, {
  outline: `2px solid ${accent}`,
  outlineOffset: 2,
});
globalStyle(`${orderFilters} span`, { fontVariantNumeric: 'tabular-nums' });
export const graphActions = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
});
export const diagramWorld = style({
  position: 'absolute',
  top: 0,
  left: 0,
  transformOrigin: '0 0',
  willChange: 'transform',
  border: `1px solid ${border}`,
});
globalStyle(`${diagram}[data-pan-ready="true"] button`, { cursor: 'grab' });
globalStyle(`${diagram}[data-panning="true"] button`, { cursor: 'grabbing' });
export const cameraToolbar = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 4,
  padding: '0 12px 10px',
});
export const zoomValue = style({
  minWidth: 52,
  height: 32,
  padding: '0 4px',
  border: 0,
  borderRadius: 4,
  background: 'transparent',
  color: text,
  fontSize: 12,
  fontVariantNumeric: 'tabular-nums',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&:disabled': { color: secondary, cursor: 'default' },
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
  },
});
export const diagramContent = style({ position: 'relative', width: '100%' });
export const graphEnd = style({
  position: 'absolute',
  left: 0,
  width: '100%',
  textAlign: 'center',
  fontSize: 11,
  color: secondary,
});
export const notice = style({
  color: secondary,
  fontSize: 11,
  lineHeight: 1.5,
  overflowWrap: 'anywhere',
});
export const truncation = style({
  gridColumn: '1 / -1',
  margin: 0,
  padding: '8px 16px',
  color: secondary,
  borderTop: `1px solid ${border}`,
  fontSize: 12,
});
export const openError = style({
  color: cssVarV2('status/error'),
  fontSize: 12,
  lineHeight: 1.5,
});
export const state = style({
  minHeight: 400,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 24,
  border: `1px solid ${border}`,
  borderRadius: 12,
  color: secondary,
  textAlign: 'center',
});

export const desktopPanHint = style({
  '@media': { '(max-width: 760px)': { display: 'none' } },
});
export const touchPanHint = style({
  display: 'none',
  '@media': { '(max-width: 760px)': { display: 'inline' } },
});

export const directionToolbar = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'space-between',
  gap: 8,
  padding: '0 12px 10px',
});
export const collapseGroup = style({
  position: 'absolute',
  transform: 'translateX(-50%)',
  whiteSpace: 'nowrap',
  padding: '4px 8px',
  border: `1px solid ${border}`,
  borderRadius: 4,
  background,
  color: secondary,
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&:focus-visible': { outline: `2px solid ${accent}`, outlineOffset: 2 },
  },
});
