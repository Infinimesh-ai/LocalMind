import { globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from '../workbench-tokens.css';

export const sidebar = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  overflowY: 'auto',
  padding: `6px ${wb.sidebarInset} 16px`,
  fontSize: wb.sidebarItemFontSize,
});
export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  minWidth: 0,
});
export const sectionTitle = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  margin: '0 0 2px',
  padding: '0 8px',
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0,
});
export const list = style({
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
});
export const item = style({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: wb.sidebarItemHeight,
  padding: '0 10px',
  border: 0,
  borderRadius: wb.sidebarItemRadius,
  background: 'transparent',
  color: wb.ink2,
  fontSize: wb.sidebarItemFontSize,
  lineHeight: wb.sidebarItemLineHeight,
  fontWeight: 400,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: wb.sidebarHover },
    '&[aria-current="true"], &[aria-current="page"]': {
      background: wb.panelStrong,
      color: wb.ink,
      fontWeight: 600,
    },
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
      outlineOffset: -2,
    },
    '&:disabled': { cursor: 'default', opacity: 0.6 },
  },
});
globalStyle(`${item} > svg`, {
  width: 16,
  height: 16,
  flexShrink: 0,
  color: wb.ink2,
});
export const itemLabel = style({
  minWidth: 0,
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const itemMeta = style({
  flexShrink: 0,
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 400,
});
export const more = style({
  alignSelf: 'flex-start',
  height: 22,
  padding: '0 8px',
  border: 0,
  background: 'transparent',
  color: wb.ink3,
  fontSize: 11,
  cursor: 'pointer',
  selectors: { '&:hover': { color: wb.ink } },
});
export const hint = style({
  margin: '2px 8px 0',
  color: wb.ink3,
  fontSize: 11,
  lineHeight: 1.45,
});
export const archived = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 28,
  padding: '0 4px 0 8px',
  color: wb.ink3,
});
globalStyle(`${archived} > svg`, { width: 16, height: 16, flexShrink: 0 });
export const restore = style({
  flexShrink: 0,
  height: 22,
  padding: '0 6px',
  border: `1px solid ${wb.line}`,
  borderRadius: 6,
  background: wb.paper,
  color: wb.ink2,
  fontSize: 11,
  cursor: 'pointer',
});
