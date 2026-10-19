import { globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './workbench-tokens.css';

const narrow = 'project-board (max-width: 900px)';
const compact = 'project-board (max-width: 680px)';

export const root = style({
  containerType: 'inline-size',
  containerName: 'project-board',
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  background: wb.paper,
  color: wb.ink,
});
export const shell = style({
  flex: '1 1 0',
  minHeight: 0,
  overflow: 'auto',
  scrollbarGutter: 'stable',
  width: 'min(100%, 1280px)',
  margin: '0 auto',
  padding: '26px 40px 48px',
  boxSizing: 'border-box',
  '@media': {
    'screen and (max-width: 760px)': { padding: '18px 16px 40px' },
  },
});
globalStyle(`${root}[data-view="relations"] ${shell}`, {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  padding: '16px 0 0',
  scrollbarGutter: 'auto',
});

/* Top line: monospace path on the left, mode switch and filters on the right. */
export const topline = style({
  width: 'min(100%, 1280px)',
  margin: '0 auto',
  padding: '26px 40px 0',
  boxSizing: 'border-box',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  flexShrink: 0,
  alignItems: 'center',
  gap: 16,
  '@container': { [narrow]: { gridTemplateColumns: 'minmax(0, 1fr)' } },
  '@media': {
    'screen and (max-width: 760px)': { padding: '18px 16px 0' },
  },
});
export const path = style({
  minWidth: 0,
  color: wb.ink3,
  fontFamily: wb.fontMono,
  fontSize: 11.5,
  letterSpacing: '0.03em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const controls = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
});
export const segmented = style({
  display: 'inline-flex',
  gap: 4,
  padding: 5,
  marginRight: 4,
  borderRadius: 14,
  background: wb.panelStrong,
  boxShadow: 'inset 0 0 0 1px rgba(91, 103, 114, 0.1)',
});
globalStyle(`${segmented} button`, {
  minHeight: 34,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 7,
  padding: '0 14px',
  border: 0,
  borderRadius: 10,
  background: 'transparent',
  color: wb.ink3,
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 560,
  cursor: 'pointer',
});
globalStyle(`${segmented} button[aria-selected="true"]`, {
  background: wb.paper,
  color: wb.ink,
  boxShadow:
    '0 1px 3px rgba(24, 27, 31, 0.11), inset 0 0 0 1px rgba(24, 27, 31, 0.06)',
});
globalStyle(`${segmented} button:focus-visible`, {
  outline: `2px solid ${wb.signal}`,
  outlineOffset: 2,
});
export const modeIconList = style({
  display: 'inline-grid',
  gap: 2,
  width: 14,
});
globalStyle(`${modeIconList} i`, {
  display: 'block',
  height: 2,
  borderRadius: 2,
  background: 'currentColor',
});
globalStyle(`${segmented} button[aria-selected="true"] ${modeIconList}`, {
  color: wb.brand,
});
export const modeIconMap = style({
  position: 'relative',
  width: 14,
  height: 12,
  selectors: {
    '&::before, &::after': {
      content: '""',
      position: 'absolute',
      width: 4,
      height: 4,
      borderRadius: '50%',
      background: 'currentColor',
      top: 0,
    },
    '&::before': { left: 0 },
    '&::after': { right: 0 },
  },
});
globalStyle(`${modeIconMap} i`, {
  position: 'absolute',
  left: 5,
  bottom: 0,
  width: 4,
  height: 4,
  borderRadius: '50%',
  background: 'currentColor',
});
globalStyle(`${segmented} button[aria-selected="true"] ${modeIconMap}`, {
  color: wb.brand,
});
export const filterButton = style({
  position: 'relative',
  minHeight: 36,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 12px',
  border: `1px solid ${wb.line}`,
  borderRadius: 11,
  background: wb.paper,
  color: wb.ink2,
  font: 'inherit',
  fontSize: 12.5,
  cursor: 'pointer',
  boxShadow:
    '0 1px 2px rgba(82, 92, 102, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.68)',
  selectors: {
    '&:hover': { borderColor: wb.lineStrong, color: wb.ink },
    '&:focus-within': { outline: `2px solid ${wb.signal}`, outlineOffset: 2 },
    '&[aria-pressed="true"]': { background: wb.panelStrong, color: wb.ink },
  },
  '@media': { 'screen and (max-width: 760px)': { maxWidth: '100%' } },
});
globalStyle(`${filterButton} select`, {
  maxWidth: 220,
  border: 0,
  padding: '0 14px 0 0',
  margin: '0 -14px 0 0',
  appearance: 'none',
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  cursor: 'pointer',
  textOverflow: 'ellipsis',
  outline: 'none',
});
export const projectFilter = style([
  filterButton,
  { width: 180, minWidth: 0, flexShrink: 0, boxSizing: 'border-box' },
]);
globalStyle(`${projectFilter} select`, { width: '100%', minWidth: 0 });
globalStyle(`${filterButton} > span[aria-hidden="true"]`, {
  pointerEvents: 'none',
  color: wb.ink3,
});
globalStyle(`${filterButton} svg`, { width: 16, height: 16 });
export const visuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
});

export const header = style({
  flexShrink: 0,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  marginBottom: 24,
});
export const title = style({
  margin: 0,
  color: wb.ink,
  fontSize: 'clamp(28px, 2.6vw, 36px)',
  fontWeight: 650,
  letterSpacing: '-0.04em',
  lineHeight: 1.1,
});
export const subtitle = style({
  maxWidth: 720,
  margin: '10px 0 0',
  color: wb.ink3,
  fontSize: 13,
  lineHeight: '20px',
});
export const mobileNewConversation = style({
  display: 'none',
  minHeight: 34,
  alignItems: 'center',
  gap: 6,
  padding: '0 12px',
  border: 0,
  borderRadius: 10,
  background: wb.action,
  color: wb.onAction,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  '@media': {
    'screen and (max-width: 760px)': { display: 'inline-flex' },
  },
});
globalStyle(`${mobileNewConversation} svg`, { color: wb.brand });

/* Item columns share a soft plate; the relation map fills the workspace. */
export const stage = style({
  minWidth: 0,
  padding: 17,
  borderRadius: 28,
  background: wb.panelStrong,
  boxShadow:
    'inset 0 0 0 1px rgba(91, 103, 114, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.68)',
  '@container': { [compact]: { padding: 10, borderRadius: 20 } },
});
globalStyle(`${root}[data-view="relations"] ${stage}`, {
  flex: 1,
  minHeight: 560,
  display: 'flex',
  flexDirection: 'column',
  padding: 0,
  borderRadius: 0,
  background: 'transparent',
  boxShadow: 'none',
});

export const columnSwitch = style({
  display: 'none',
  gap: 4,
  paddingBlockEnd: 12,
  '@container': {
    [narrow]: { display: 'flex', flexWrap: 'wrap' },
  },
});
globalStyle(`${columnSwitch} button`, {
  padding: '7px 12px',
  border: `1px solid ${wb.line}`,
  borderRadius: 999,
  background: wb.paper,
  color: wb.ink2,
  fontSize: 12,
  cursor: 'pointer',
});
globalStyle(`${columnSwitch} button[aria-selected="true"]`, {
  background: wb.action,
  borderColor: wb.action,
  color: wb.onAction,
  fontWeight: 600,
});
globalStyle(`${columnSwitch} button:focus-visible`, {
  outline: `2px solid ${wb.signal}`,
  outlineOffset: 2,
});

export const columns = style({
  minWidth: 0,
  minHeight: 520,
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 14,
  '@container': { [narrow]: { gridTemplateColumns: '1fr' } },
});
export const column = style({
  minWidth: 0,
  padding: '0 15px 16px',
  borderRadius: 21,
  border: '1px solid rgba(255, 255, 255, 0.7)',
  background: `color-mix(in srgb, ${wb.paper} 72%, transparent)`,
  boxShadow: '0 1px 2px rgba(75, 84, 93, 0.043)',
});
globalStyle(`${column}[data-mobile-active="false"]`, {
  '@container': { [narrow]: { display: 'none' } },
});
export const columnTitle = style({
  margin: 0,
  minHeight: 59,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '17px 1px 13px',
  color: wb.ink,
  fontSize: 13,
  fontWeight: 690,
});
export const count = style({
  minWidth: 22,
  height: 22,
  display: 'grid',
  placeItems: 'center',
  padding: '0 6px',
  borderRadius: 8,
  background: wb.panelStrong,
  color: wb.ink3,
  fontFamily: wb.fontMono,
  fontSize: 11,
  fontWeight: 500,
});
globalStyle(`#workbench-column-todo ${count}`, {
  background: wb.warningSoft,
  color: wb.warning,
});
export const sectionLabel = style({
  margin: '6px 2px 9px',
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  selectors: { '&:not(:first-child)': { marginTop: 16 } },
});
export const cardList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
});
export const card = style({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: '14px 14px 13px',
  border: `1px solid ${wb.line}`,
  borderRadius: 15,
  background: wb.paper,
  color: wb.ink,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  boxShadow: '0 1px 2px rgba(75, 84, 93, 0.055)',
  transition: 'border-color .15s ease, box-shadow .15s ease',
  selectors: {
    '&:hover': {
      borderColor: wb.lineStrong,
      boxShadow: '0 6px 18px rgba(75, 84, 93, 0.08)',
    },
    '&[data-attention="true"]': {
      borderColor: `color-mix(in srgb, ${wb.brand} 32%, ${wb.line})`,
      boxShadow: '0 0 0 3px rgba(234, 67, 53, 0.05)',
    },
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: 2 },
  },
});
export const cardTop = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
});
export const cardType = style({
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 650,
  letterSpacing: '0.04em',
});
export const cardStatus = style({
  flexShrink: 0,
  padding: '3px 8px',
  borderRadius: 7,
  background: wb.signalSoft,
  color: wb.signal,
  fontSize: 11,
  fontWeight: 560,
  selectors: {
    '&[data-column="todo"]': {
      background: wb.warningSoft,
      color: wb.warning,
    },
    '&[data-column="done"]': {
      background: wb.successSoft,
      color: wb.success,
    },
  },
});
export const cardTitle = style({
  marginTop: 5,
  color: wb.ink,
  fontSize: 15,
  fontWeight: 640,
  letterSpacing: '-0.012em',
  lineHeight: 1.35,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const cardMeta = style({
  color: wb.ink3,
  fontSize: 12,
  lineHeight: 1.5,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const reasons = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 4,
});
export const reason = style({
  alignSelf: 'flex-start',
  padding: '3px 8px',
  borderRadius: 7,
  background: wb.dangerSoft,
  color: wb.danger,
  fontSize: 11,
});
export const cardFooter = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 7,
  marginTop: 8,
  color: wb.ink3,
  fontSize: 11.5,
});
export const cardAvatar = style({
  width: 22,
  height: 22,
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  borderRadius: '50%',
  background: wb.action,
  color: wb.onAction,
  fontSize: 9,
  fontWeight: 700,
  selectors: {
    '&[data-kind="ai"]': { background: wb.brand, color: '#ffffff' },
  },
});
export const state = style({
  minHeight: 120,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  color: wb.ink3,
  fontSize: 12,
  textAlign: 'center',
});
