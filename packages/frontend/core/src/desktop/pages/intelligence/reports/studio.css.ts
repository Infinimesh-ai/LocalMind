import { createVar, globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from '../workbench-tokens.css';

const border = `1px solid ${wb.line}`;
export const chatWidthVar = createVar();
export const slideWidthVar = createVar();

export const studio = style({
  display: 'grid',
  gridTemplateRows: '56px minmax(0, 1fr)',
  gridTemplateColumns: `${chatWidthVar} minmax(0, 1fr)`,
  height: '100%',
  minHeight: 0,
  minWidth: 0,
  background: wb.canvas,
  color: wb.ink,
  vars: { [chatWidthVar]: '380px' },
  selectors: {
    '&[data-chat="collapsed"]': { vars: { [chatWidthVar]: '0px' } },
  },
  '@media': {
    '(max-width: 900px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

/* Header */
export const header = style({
  gridColumn: '1 / -1',
  display: 'grid',
  gridTemplateColumns: `${chatWidthVar} minmax(0, 1fr)`,
  alignItems: 'center',
  background: wb.paper,
  borderBottom: border,
  minWidth: 0,
  zIndex: 2,
  '@media': {
    '(max-width: 900px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});
export const headerLead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  height: '100%',
  minWidth: 0,
  padding: '0 10px 0 12px',
  borderRight: border,
  selectors: {
    [`${studio}[data-chat="collapsed"] &`]: {
      borderRight: 0,
      paddingRight: 0,
    },
  },
  '@media': { '(max-width: 900px)': { display: 'none' } },
});
export const headerLeadTitle = style({
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  lineHeight: 1.25,
  overflow: 'hidden',
  selectors: {
    [`${studio}[data-chat="collapsed"] &`]: { display: 'none' },
  },
});
globalStyle(`${headerLeadTitle} strong`, {
  fontSize: 13,
  fontWeight: 650,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});
globalStyle(`${headerLeadTitle} span`, {
  fontSize: 11,
  color: wb.ink3,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
});
export const headerMain = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  height: '100%',
  padding: '0 14px 0 16px',
  overflowX: 'auto',
  scrollbarWidth: 'none',
  containerType: 'inline-size',
  containerName: 'studio-head',
});
export const titleInput = style({
  minWidth: 120,
  maxWidth: 320,
  flex: '0 1 260px',
  height: 32,
  padding: '0 8px',
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'transparent',
  color: wb.ink,
  font: 'inherit',
  fontSize: 15,
  fontWeight: 650,
  letterSpacing: '-0.01em',
  textOverflow: 'ellipsis',
  selectors: {
    '&:hover:not(:disabled)': { borderColor: wb.line },
    '&:focus-visible': {
      outline: 'none',
      borderColor: wb.signal,
      boxShadow: `0 0 0 3px ${wb.signalSoft}`,
    },
    '&:disabled': { color: wb.ink, cursor: 'default' },
  },
});
export const saveState = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  fontSize: 11,
  color: wb.ink3,
  whiteSpace: 'nowrap',
  selectors: {
    '&::before': {
      content: '""',
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: wb.success,
    },
    '&[data-state="dirty"]::before': { background: wb.warning },
    '&[data-state="saving"]::before': { background: wb.signal },
    '&[data-state="conflict"]::before': { background: wb.danger },
  },
});
export const divider = style({
  width: 1,
  height: 20,
  background: wb.line,
  flexShrink: 0,
  margin: '0 4px',
});
export const spacer = style({ flex: 1, minWidth: 8 });
export const zoom = style({
  '@container': { 'studio-head (max-width: 1000px)': { display: 'none' } },
  display: 'inline-flex',
  alignItems: 'center',
  border,
  borderRadius: 8,
  height: 30,
  overflow: 'hidden',
  flexShrink: 0,
});
globalStyle(`${zoom} button`, {
  width: 26,
  height: '100%',
  border: 0,
  background: 'transparent',
  color: wb.ink2,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center',
});
globalStyle(`${zoom} button:hover:not(:disabled)`, { background: wb.panel });
globalStyle(`${zoom} button:disabled`, { opacity: 0.4 });
export const zoomValue = style({
  minWidth: 46,
  textAlign: 'center',
  fontSize: 12,
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  color: wb.signal,
  background: wb.signalSoft,
  height: '100%',
  lineHeight: '30px',
});
export const primaryButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 14px',
  border: 0,
  borderRadius: 9,
  background: wb.action,
  color: wb.onAction,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  boxShadow: '0 4px 12px rgba(25, 29, 34, 0.12)',
  selectors: {
    '&:hover:not(:disabled)': { background: wb.actionHover },
    '&:disabled': { opacity: 0.45, cursor: 'not-allowed', boxShadow: 'none' },
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: 2 },
  },
});
export const secondaryButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 12px',
  border,
  borderRadius: 9,
  background: wb.paper,
  color: wb.ink,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover:not(:disabled)': {
      borderColor: wb.lineStrong,
      background: wb.panel,
    },
    '&[aria-pressed="true"]': {
      background: wb.panelStrong,
      borderColor: wb.lineStrong,
    },
    '&:disabled': { opacity: 0.45, cursor: 'not-allowed' },
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: 2 },
  },
});

/* Chat pane */
export const chat = style({
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: wb.paper,
  borderRight: border,
  overflow: 'hidden',
  selectors: {
    [`${studio}[data-chat="collapsed"] &`]: { display: 'none' },
  },
  '@media': {
    '(max-width: 900px)': {
      position: 'fixed',
      inset: '56px auto 0 0',
      width: 'min(380px, 92vw)',
      zIndex: 5,
      boxShadow: wb.shadowRaised,
    },
  },
});
export const chatScope = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  padding: '8px 12px',
  borderBottom: border,
  background: wb.panel,
  fontSize: 12,
  color: wb.ink2,
});
export const scopeChip = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  maxWidth: '100%',
  height: 22,
  padding: '0 4px 0 9px',
  borderRadius: 999,
  background: wb.signalSoft,
  color: wb.signal,
  fontSize: 11,
  fontWeight: 600,
});
globalStyle(`${scopeChip} span`, {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
globalStyle(`${scopeChip} button`, {
  width: 16,
  height: 16,
  border: 0,
  borderRadius: '50%',
  padding: 0,
  display: 'grid',
  placeItems: 'center',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
});
export const chatBody = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});
globalStyle(`${chatBody} > section`, { flex: 1, minHeight: 0 });

/* Workspace (canvas + drawer) */
export const workspace = style({
  minWidth: 0,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
});
export const canvasColumn = style({
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});
export const banners = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 24px 0',
  selectors: { '&:empty': { display: 'none' } },
});
export const banner = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 10,
  padding: '9px 12px 9px 14px',
  borderRadius: 11,
  border,
  background: wb.paper,
  fontSize: 13,
  color: wb.ink2,
  boxShadow: wb.shadow,
  selectors: {
    '&[data-tone="warning"]': {
      background: wb.warningSoft,
      borderColor: wb.warningLine,
      color: wb.warning,
    },
    '&[data-tone="danger"]': {
      background: wb.dangerSoft,
      borderColor: wb.dangerSoft,
      color: wb.danger,
    },
    '&[data-tone="signal"]': {
      background: wb.signalSoft,
      borderColor: wb.signalLine,
      color: wb.signal,
    },
  },
});
globalStyle(`${banner} > strong`, { color: wb.ink, fontWeight: 650 });
globalStyle(`${banner} > span`, { flex: 1, minWidth: 160 });
export const canvas = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: '24px 32px 96px',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 28,
  vars: { [slideWidthVar]: '960px' },
  outline: 'none',
});
export const page = style({
  width: `min(100%, ${slideWidthVar})`,
  flexShrink: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  scrollMarginTop: 24,
});
export const pageMeta = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 11,
  color: wb.ink3,
  fontVariantNumeric: 'tabular-nums',
  minHeight: 22,
});
export const pageMetaTitle = style({
  border: 0,
  padding: '2px 6px',
  marginLeft: -6,
  borderRadius: 6,
  background: 'transparent',
  color: wb.ink2,
  font: 'inherit',
  fontWeight: 650,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: wb.panelStrong, color: wb.ink },
    '&[aria-current="true"]': { color: wb.signal },
  },
});
export const pageFrame = style({
  position: 'relative',
  borderRadius: 10,
  overflow: 'hidden',
  boxShadow:
    '0 1px 2px rgba(25, 29, 34, 0.06), 0 12px 32px rgba(25, 29, 34, 0.08)',
  outline: '1px solid rgba(25, 29, 34, 0.06)',
  selectors: {
    '&[data-hidden="true"]': { opacity: 0.55 },
    '&[data-current="true"]': {
      outline: `2px solid ${wb.signalLine}`,
    },
  },
});
export const nodeTarget = style({
  position: 'relative',
  borderRadius: 6,
  margin: '-0.5cqw',
  padding: '0.5cqw',
  outline: '1.5px solid transparent',
  outlineOffset: 0,
  transition: 'outline-color .12s ease, background .12s ease',
  selectors: {
    '[data-mode="select"] &, [data-mode="comment"] &, [data-mode="edit"] &': {
      cursor: 'pointer',
    },
    '[data-mode] &:hover': {
      outlineColor: 'color-mix(in srgb, #556678 45%, transparent)',
    },
    '&[data-selected="true"]': {
      outlineColor: '#556678',
      background: 'color-mix(in srgb, #556678 7%, transparent)',
    },
    '&[data-locked="true"]::after': {
      content: '"🔒"',
      position: 'absolute',
      top: 2,
      right: 4,
      fontSize: 10,
      opacity: 0.6,
    },
  },
});
export const commentBadge = style({
  position: 'absolute',
  top: -8,
  right: -8,
  minWidth: 18,
  height: 18,
  padding: '0 5px',
  borderRadius: 999,
  background: '#98702f',
  color: '#ffffff',
  fontSize: 10,
  fontWeight: 700,
  lineHeight: '18px',
  textAlign: 'center',
  boxShadow: '0 0 0 2px #ffffff',
});
export const addChapter = style({
  width: `min(100%, ${slideWidthVar})`,
  height: 64,
  flexShrink: 0,
  border: `1.5px dashed ${wb.lineStrong}`,
  borderRadius: 10,
  background: 'transparent',
  color: wb.ink3,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  selectors: {
    '&:hover:not(:disabled)': {
      borderColor: wb.signal,
      color: wb.signal,
      background: wb.signalSoft,
    },
    '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
  },
});

/* Right drawer */
export const drawer = style({
  width: 360,
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  background: wb.paper,
  borderLeft: border,
  '@media': {
    '(max-width: 1180px)': {
      position: 'fixed',
      top: 56,
      right: 0,
      bottom: 0,
      width: 'min(380px, 94vw)',
      zIndex: 6,
      boxShadow: wb.shadowRaised,
    },
  },
});
export const drawerHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: 48,
  padding: '0 10px 0 16px',
  borderBottom: border,
  flexShrink: 0,
});
globalStyle(`${drawerHeader} h2`, {
  flex: 1,
  fontSize: 14,
  fontWeight: 650,
  margin: 0,
});
export const drawerBody = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
});
export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  paddingBottom: 14,
  borderBottom: border,
  selectors: { '&:last-child': { borderBottom: 0, paddingBottom: 0 } },
});
export const sectionTitle = style({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: wb.ink3,
  margin: 0,
});
export const item = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '10px 12px',
  border,
  borderRadius: 11,
  background: wb.paper,
  fontSize: 13,
  selectors: {
    '&[data-tone="warning"]': {
      background: wb.warningSoft,
      borderColor: wb.warningLine,
    },
    '&[data-tone="muted"]': { background: wb.panel },
  },
});
globalStyle(`${item} p`, {
  margin: 0,
  color: wb.ink2,
  lineHeight: 1.55,
  overflowWrap: 'anywhere',
});
export const itemHead = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});
globalStyle(`${itemHead} > strong`, {
  flex: 1,
  minWidth: 0,
  fontSize: 13,
  fontWeight: 650,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
});
export const diffBefore = style({
  display: 'block',
  whiteSpace: 'pre-wrap',
  padding: '6px 8px',
  borderRadius: 6,
  background: wb.dangerSoft,
  color: wb.danger,
  textDecoration: 'line-through',
  fontSize: 12,
});
export const diffAfter = style({
  display: 'block',
  whiteSpace: 'pre-wrap',
  padding: '6px 8px',
  borderRadius: 6,
  background: wb.successSoft,
  color: wb.success,
  textDecoration: 'none',
  fontSize: 12,
});

/* Steps (v10 execution path) for generation runs */
export const steps = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
});
export const step = style({
  display: 'grid',
  gridTemplateColumns: '24px 1fr auto',
  alignItems: 'center',
  gap: 10,
  padding: '7px 0',
  fontSize: 12,
  color: wb.ink3,
  selectors: {
    '&[data-state="done"]': { color: wb.ink2 },
    '&[data-state="active"]': { color: wb.ink, fontWeight: 650 },
  },
});
export const stepDot = style({
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: `1px solid ${wb.lineStrong}`,
  background: wb.paper,
  display: 'grid',
  placeItems: 'center',
  fontSize: 10,
  fontWeight: 700,
  selectors: {
    [`${step}[data-state="done"] &`]: {
      background: wb.successSoft,
      borderColor: wb.successLine,
      color: wb.success,
    },
    [`${step}[data-state="active"] &`]: {
      background: wb.signalSoft,
      borderColor: wb.signalLine,
    },
  },
});

/* Outline menu */
export const outlineMenu = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 280,
  maxWidth: 360,
  maxHeight: 420,
  overflow: 'auto',
  padding: 2,
});
export const outlineRow = style({
  display: 'grid',
  gridTemplateColumns: '22px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 6,
  padding: '4px 4px 4px 6px',
  borderRadius: 8,
  fontSize: 13,
  selectors: {
    '&:hover': { background: wb.panel },
    '&[aria-current="true"]': { background: wb.signalSoft },
  },
});
globalStyle(`${outlineRow} > span:first-child`, {
  fontSize: 11,
  color: wb.ink3,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
});
export const outlineTitle = style({
  border: 0,
  padding: 0,
  background: 'transparent',
  color: wb.ink,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const iconButton = style({
  width: 26,
  height: 26,
  border: 0,
  borderRadius: 7,
  display: 'inline-grid',
  placeItems: 'center',
  background: 'transparent',
  color: wb.ink3,
  cursor: 'pointer',
  fontSize: 14,
  flexShrink: 0,
  selectors: {
    '&:hover:not(:disabled)': { background: wb.panelStrong, color: wb.ink },
    '&:disabled': { opacity: 0.35, cursor: 'not-allowed' },
    '&[aria-pressed="true"]': { background: wb.panelStrong, color: wb.ink },
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: 1 },
  },
});
export const loading = style({
  display: 'grid',
  placeItems: 'center',
  height: '100%',
  gridColumn: '1 / -1',
});

export const compactLabel = style({
  '@container': { 'studio-head (max-width: 1120px)': { display: 'none' } },
});
export const chapterLabel = style({
  maxWidth: 140,
  '@container': { 'studio-head (max-width: 1040px)': { display: 'none' } },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
globalStyle(`${chatBody} header strong`, {
  fontSize: 14,
  lineHeight: 1.35,
});
globalStyle(`${chatBody} header`, {
  minHeight: 0,
  padding: '10px 12px',
});
export const saveLabel = style({
  '@container': { 'studio-head (max-width: 1040px)': { display: 'none' } },
});
