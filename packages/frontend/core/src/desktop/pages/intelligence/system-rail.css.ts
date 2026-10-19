import { globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './workbench-tokens.css';

export const rail = style({
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  background: wb.paper,
  borderRight: `1px solid ${wb.line}`,
  '@media': { 'screen and (max-width: 760px)': { display: 'none' } },
});

export const logo = style({
  width: '100%',
  height: 58,
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  border: 0,
  borderBottom: `1px solid ${wb.line}`,
  background: 'transparent',
  cursor: 'pointer',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
      outlineOffset: -4,
    },
  },
});

export const main = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  paddingTop: 18,
});

export const bottom = style({
  marginTop: 'auto',
  paddingBottom: 16,
});

export const switchButton = style({
  position: 'relative',
  width: 38,
  height: 38,
  display: 'grid',
  placeItems: 'center',
  border: '1px solid transparent',
  borderRadius: 11,
  background: 'transparent',
  color: wb.ink3,
  cursor: 'pointer',
  transition: 'background .15s ease, color .15s ease',
  selectors: {
    '&:hover': { background: wb.panel, color: wb.ink },
    '&[aria-current="page"]': {
      background: wb.signalSoft,
      borderColor: wb.lineStrong,
      color: wb.ink,
      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.75)',
    },
    '&[aria-current="page"]::before': {
      content: '""',
      position: 'absolute',
      left: -9,
      top: 12,
      width: 3,
      height: 14,
      borderRadius: '0 3px 3px 0',
      background: wb.brand,
    },
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
      outlineOffset: 2,
    },
  },
});
globalStyle(`${switchButton} svg`, { width: 20, height: 20 });
