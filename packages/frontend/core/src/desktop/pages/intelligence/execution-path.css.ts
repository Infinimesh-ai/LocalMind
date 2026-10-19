import { globalStyle, keyframes, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './workbench-tokens.css';

export const root = style({
  flex: 'none',
  marginBottom: 16,
  padding: '12px 14px 4px',
  border: `1px solid ${wb.line}`,
  borderRadius: wb.radius,
  background: wb.paper,
  boxShadow: wb.shadow,
});

export const header = style({
  width: '100%',
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: wb.ink,
  font: 'inherit',
  textAlign: 'start',
  cursor: 'pointer',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${wb.signal}`,
      outlineOffset: 2,
      borderRadius: 6,
    },
  },
});

export const heading = style({
  flex: 1,
  minWidth: 0,
  margin: 0,
  fontSize: 13,
  fontWeight: 650,
  lineHeight: '20px',
});

export const progress = style({
  color: wb.ink3,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
});

export const chevron = style({
  width: 16,
  height: 16,
  flexShrink: 0,
  color: wb.ink3,
  transition: 'transform 140ms ease-out',
  selectors: {
    '[aria-expanded="true"] > &': { transform: 'rotate(90deg)' },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
  },
});

export const list = style({
  margin: '6px 0 0',
  padding: 0,
  listStyle: 'none',
});

export const step = style({
  display: 'grid',
  gridTemplateColumns: '30px minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  padding: '12px 2px',
  borderBottom: `1px solid ${wb.line}`,
  selectors: {
    '&:last-child': { borderBottom: 0 },
  },
});

const pulse = keyframes({
  '0%, 100%': { transform: 'scale(1)', opacity: 1 },
  '50%': { transform: 'scale(0.6)', opacity: 0.55 },
});

export const dot = style({
  position: 'relative',
  width: 24,
  height: 24,
  display: 'grid',
  placeItems: 'center',
  borderRadius: 999,
  border: `1px solid ${wb.line}`,
  background: wb.panel,
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 650,
  fontVariantNumeric: 'tabular-nums',
  selectors: {
    '&[data-status="completed"]': {
      borderColor: wb.successLine,
      background: wb.successSoft,
      color: wb.success,
    },
    '&[data-status="running"]': {
      borderColor: wb.signalLine,
      background: wb.signalSoft,
      color: wb.signal,
    },
    '&[data-status="waiting_approval"]': {
      borderColor: wb.warningLine,
      background: wb.warningSoft,
      color: wb.warning,
    },
    '&[data-status="failed"]': {
      borderColor: wb.danger,
      background: wb.dangerSoft,
      color: wb.danger,
    },
    '&[data-status="skipped"]': {
      borderStyle: 'dashed',
    },
  },
});
globalStyle(`${dot} svg`, { width: 14, height: 14 });

export const pulseCenter = style({
  width: 6,
  height: 6,
  borderRadius: 999,
  background: wb.signal,
  animation: `${pulse} 1.4s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': { animation: 'none' },
  },
});

export const copy = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});

export const stepTitle = style({
  overflow: 'hidden',
  color: wb.ink,
  fontSize: 12,
  fontWeight: 650,
  lineHeight: '18px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  selectors: {
    [`${step}[data-status="pending"] &, ${step}[data-status="skipped"] &`]: {
      color: wb.ink3,
    },
  },
});

export const stepMeta = style({
  color: wb.ink3,
  fontSize: 11,
  lineHeight: '16px',
  overflowWrap: 'anywhere',
  selectors: {
    [`${step}[data-status="waiting_approval"] &`]: { color: wb.warning },
    [`${step}[data-status="failed"] &`]: { color: wb.danger },
  },
});

export const time = style({
  color: wb.ink3,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});
