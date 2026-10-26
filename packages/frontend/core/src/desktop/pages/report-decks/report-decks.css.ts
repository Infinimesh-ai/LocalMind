import { createVar, globalStyle, keyframes, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from '../intelligence/workbench-tokens.css';

const border = `1px solid ${wb.line}`;
const focusRing = { outline: `2px solid ${wb.signal}`, outlineOffset: 2 };
const ease = 'cubic-bezier(.2,.7,.2,1)';

/* Shell: global rail + page column. */
export const shell = style({
  display: 'flex',
  width: '100%',
  height: '100%',
  minHeight: 0,
  background: wb.paper,
  color: wb.ink,
  fontFamily: 'var(--affine-font-family)',
});
export const page = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  background: wb.paper,
});
export const scroll = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  scrollbarGutter: 'stable',
});
export const container = style({
  width: '100%',
  maxWidth: 1240,
  margin: '0 auto',
  padding: '40px clamp(20px, 4vw, 56px) 72px',
  boxSizing: 'border-box',
  containerType: 'inline-size',
});
export const narrow = style({ maxWidth: 940 });
globalStyle(`${shell} ::selection`, { background: wb.signalSoft });
globalStyle(`${shell} button`, { touchAction: 'manipulation' });

/* Typography & generic controls. */
export const eyebrow = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  margin: 0,
  fontSize: 11,
  fontWeight: 650,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: wb.ink3,
});
export const brandDot = style({
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: wb.brand,
  boxShadow: `0 0 0 3px ${wb.brandSoft}`,
});
export const pageTitle = style({
  margin: '10px 0 0',
  fontSize: 'clamp(30px, 3vw, 40px)',
  fontWeight: 680,
  letterSpacing: '-0.035em',
  lineHeight: 1.08,
  color: wb.ink,
});
export const pageLead = style({
  maxWidth: 640,
  margin: '12px 0 0',
  fontSize: 14,
  lineHeight: 1.7,
  color: wb.ink2,
});
export const muted = style({
  margin: 0,
  fontSize: 12,
  lineHeight: 1.6,
  color: wb.ink3,
});
export const row = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});
export const spacer = style({ flex: 1 });

export const button = style({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  height: 36,
  flexShrink: 0,
  padding: '0 14px',
  border,
  borderRadius: 8,
  background: wb.paper,
  color: wb.ink,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  textDecoration: 'none',
  transition: `background .15s ease, border-color .15s ease, transform .15s ${ease}`,
  selectors: {
    '&:hover:not(:disabled)': {
      borderColor: wb.lineStrong,
      background: wb.panel,
    },
    '&:active:not(:disabled)': { transform: 'translateY(1px)' },
    '&:disabled': { opacity: 0.45, cursor: 'not-allowed' },
    '&:focus-visible': focusRing,
  },
});
globalStyle(`${button} svg`, { width: 16, height: 16, flexShrink: 0 });
export const primaryButton = style([
  button,
  {
    borderColor: wb.action,
    background: wb.action,
    color: wb.onAction,
    fontWeight: 600,
    selectors: {
      '&:hover:not(:disabled)': {
        background: wb.actionHover,
        borderColor: wb.actionHover,
      },
    },
  },
]);
export const largeButton = style({
  height: 42,
  padding: '0 20px',
  fontSize: 14,
  borderRadius: 11,
});
export const ghostButton = style([
  button,
  {
    borderColor: 'transparent',
    background: 'transparent',
    boxShadow: 'none',
    color: wb.ink2,
    selectors: {
      '&:hover:not(:disabled)': {
        background: wb.panel,
        borderColor: 'transparent',
        color: wb.ink,
      },
    },
  },
]);
export const dangerButton = style([
  button,
  {
    color: wb.danger,
    selectors: {
      '&:hover:not(:disabled)': {
        background: wb.dangerSoft,
        borderColor: wb.dangerSoft,
      },
    },
  },
]);
export const iconButton = style([
  ghostButton,
  { width: 30, height: 30, padding: 0, borderRadius: 8 },
]);

export const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 22,
  padding: '0 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 620,
  whiteSpace: 'nowrap',
  background: wb.panelStrong,
  color: wb.ink2,
  selectors: {
    '&[data-tone="success"]': { background: wb.successSoft, color: wb.success },
    '&[data-tone="warning"]': { background: wb.warningSoft, color: wb.warning },
    '&[data-tone="danger"]': { background: wb.dangerSoft, color: wb.danger },
    '&[data-tone="signal"]': { background: wb.signalSoft, color: wb.signal },
  },
});
const pulse = keyframes({
  '0%, 100%': { transform: 'scale(1)', opacity: 1 },
  '50%': { transform: 'scale(0.55)', opacity: 0.5 },
});
export const pulseDot = style({
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: 'currentColor',
  animation: `${pulse} 1.4s ease-in-out infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});

export const input = style({
  width: '100%',
  minWidth: 0,
  flex: '0 0 auto',
  boxSizing: 'border-box',
  height: 36,
  minHeight: 36,
  border,
  borderRadius: 8,
  background: wb.paper,
  color: wb.ink,
  padding: '0 11px',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: '20px',
  boxShadow: 'none',
  transition: 'border-color .15s ease, background .15s ease',
  selectors: {
    '&:hover:not(:disabled)': { borderColor: wb.lineStrong },
    '&:focus-visible': {
      ...focusRing,
      borderColor: wb.signal,
    },
    '&::placeholder': { color: wb.ink2, opacity: 1 },
    '&:disabled': { opacity: 0.6, cursor: 'not-allowed', background: wb.panel },
  },
});
export const selectControl = style({
  position: 'relative',
  display: 'block',
  width: '100%',
  minWidth: 0,
  flexShrink: 0,
});
export const selectIcon = style({
  position: 'absolute',
  top: '50%',
  right: 10,
  width: 16,
  height: 16,
  transform: 'translateY(-50%)',
  color: wb.ink2,
  pointerEvents: 'none',
});
export const select = style([
  input,
  {
    appearance: 'none',
    paddingRight: 34,
    cursor: 'pointer',
    textOverflow: 'ellipsis',
  },
]);
export const textarea = style([
  input,
  {
    height: 'auto',
    minHeight: 92,
    padding: '9px 11px',
    lineHeight: 1.65,
    resize: 'vertical',
  },
]);
export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '18px',
  color: wb.ink2,
});
export const fieldFoot = style({
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
  fontWeight: 400,
  color: wb.ink3,
});
export const segmented = style({
  display: 'inline-flex',
  gap: 2,
  padding: 3,
  border,
  borderRadius: 11,
  background: wb.panel,
});
export const segment = style({
  display: 'inline-flex',
  flex: '1 1 0',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  minWidth: 0,
  padding: '8px 14px',
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: wb.ink3,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { color: wb.ink },
    '&[aria-pressed="true"]': {
      color: wb.ink,
      background: wb.paper,
      boxShadow: '0 1px 4px rgba(25, 27, 25, 0.1)',
    },
    '&:focus-visible': focusRing,
  },
});
globalStyle(`${segment} strong`, { fontSize: 13, fontWeight: 640 });
globalStyle(`${segment} span`, { fontSize: 11, fontWeight: 400 });
export const chip = style({
  display: 'inline-flex',
  alignItems: 'center',
  height: 28,
  padding: '0 11px',
  border,
  borderRadius: 999,
  background: wb.paper,
  color: wb.ink2,
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover': { borderColor: wb.lineStrong, color: wb.ink },
    '&[aria-pressed="true"]': {
      borderColor: wb.action,
      color: wb.ink,
      background: wb.panel,
    },
    '&:focus-visible': focusRing,
  },
});
export const toggle = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '10px 12px',
  border,
  borderRadius: 8,
  background: wb.paper,
  cursor: 'pointer',
  transition: 'border-color .15s ease, background .15s ease',
  selectors: {
    '&:hover': { borderColor: wb.lineStrong },
    '&:has(input:checked)': {
      borderColor: wb.signalLine,
      background: wb.panel,
    },
    '&:has(input:focus-visible)': focusRing,
  },
});
globalStyle(`${toggle} input`, {
  appearance: 'auto',
  width: 15,
  height: 15,
  margin: '2px 0 0',
  accentColor: wb.action,
  flexShrink: 0,
});
globalStyle(`${toggle} strong`, {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '20px',
  color: wb.ink,
});
globalStyle(`${toggle} span`, {
  fontSize: 12,
  lineHeight: '18px',
  color: wb.ink2,
});
export const notice = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 10,
  fontSize: 12,
  lineHeight: 1.6,
  background: wb.signalSoft,
  color: wb.ink2,
  selectors: {
    '&[data-tone="warning"]': {
      background: wb.warningSoft,
      color: wb.warning,
      border: `1px solid ${wb.warningLine}`,
    },
    '&[data-tone="danger"]': { background: wb.dangerSoft, color: wb.danger },
  },
});
globalStyle(`${notice} svg`, {
  width: 16,
  height: 16,
  flexShrink: 0,
  marginTop: 1,
});

/* Home */
export const hero = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 24,
  paddingBottom: 32,
  marginBottom: 36,
  borderBottom: border,
});
export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minWidth: 0,
  marginBottom: 48,
});
export const sectionHead = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 12,
});
export const sectionTitle = style({
  margin: 0,
  fontSize: 17,
  fontWeight: 660,
  letterSpacing: '-0.01em',
  color: wb.ink,
});
export const sectionCount = style({
  fontSize: 12,
  color: wb.ink3,
  fontVariantNumeric: 'tabular-nums',
});

/* History list */
export const historyList = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  border,
  borderRadius: wb.radius,
  overflow: 'hidden',
  background: wb.paper,
  boxShadow: wb.shadow,
});
export const historyRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 16,
  padding: '14px 16px 14px 18px',
  borderTop: border,
  transition: 'background .15s ease',
  selectors: {
    '&:first-child': { borderTop: 0 },
    '&:hover': { background: wb.panel },
  },
});
export const historyMain = style({
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  minWidth: 0,
  padding: 0,
  border: 0,
  background: 'transparent',
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 8,
  selectors: { '&:focus-visible': focusRing },
});
export const historyThumb = style({
  position: 'relative',
  width: 72,
  height: 40.5,
  flexShrink: 0,
  borderRadius: 6,
  background: `linear-gradient(135deg, ${wb.panelStrong}, ${wb.panel})`,
  border,
  overflow: 'hidden',
});
globalStyle(`${historyThumb}::after`, {
  content: '""',
  position: 'absolute',
  left: 9,
  right: 22,
  top: 12,
  height: 4,
  borderRadius: 2,
  background: wb.lineStrong,
  boxShadow: `0 8px 0 -0.5px ${wb.line}, 0 14px 0 -0.5px ${wb.line}`,
});
globalStyle(`${historyThumb}[data-status="ready"]::before`, {
  content: '""',
  position: 'absolute',
  left: 0,
  top: 0,
  bottom: 0,
  width: 3,
  background: wb.brand,
});
export const historyText = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  minWidth: 0,
});
export const historyTitle = style({
  fontSize: 14,
  fontWeight: 620,
  color: wb.ink,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const historyMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '4px 10px',
  fontSize: 12,
  color: wb.ink3,
});
globalStyle(`${historyMeta} > span + span::before`, {
  content: '"·"',
  marginRight: 10,
  color: wb.lineStrong,
});
export const historyActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
});
export const progressTrack = style({
  position: 'relative',
  width: 64,
  height: 4,
  borderRadius: 2,
  background: wb.signalSoft,
  overflow: 'hidden',
});
export const progressFill = style({
  position: 'absolute',
  inset: 0,
  right: 'auto',
  borderRadius: 2,
  background: wb.signal,
  transition: `width .6s ${ease}`,
});
export const emptyState = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 10,
  padding: '44px 24px',
  border: `1px dashed ${wb.lineStrong}`,
  borderRadius: wb.radius,
  textAlign: 'center',
  background: wb.panel,
});
globalStyle(`${emptyState} h3`, {
  margin: 0,
  fontSize: 15,
  fontWeight: 640,
  color: wb.ink,
});
globalStyle(`${emptyState} p`, {
  margin: 0,
  maxWidth: 420,
  fontSize: 13,
  lineHeight: 1.7,
  color: wb.ink2,
});
export const emptyGlyph = style({
  display: 'grid',
  placeItems: 'center',
  width: 44,
  height: 44,
  borderRadius: 12,
  background: wb.paper,
  border,
  color: wb.ink3,
  marginBottom: 4,
});
globalStyle(`${emptyGlyph} svg`, { width: 22, height: 22 });
export const skeletonRow = style({
  height: 68,
  borderTop: border,
  background: `linear-gradient(90deg, ${wb.paper}, ${wb.panel}, ${wb.paper})`,
  selectors: { '&:first-child': { borderTop: 0 } },
});

/* Covers & template gallery */
const coverRadius = createVar();
export const cover = style({
  position: 'relative',
  width: '100%',
  flexShrink: 0,
  aspectRatio: '16 / 9',
  overflow: 'hidden',
  borderRadius: `${coverRadius} ${coverRadius} 0 0`,
  // Clip the scaled iframe directly; ancestor overflow is unreliable in Safari.
  clipPath: `inset(0 round ${coverRadius} ${coverRadius} 0 0)`,
  background: wb.panelStrong,
  isolation: 'isolate',
});
export const coverFrame = style({
  display: 'block',
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1280,
  height: 720,
  border: 0,
  transformOrigin: '0 0',
  pointerEvents: 'none',
  background: 'transparent',
});
const shimmer = keyframes({
  from: { backgroundPosition: '-200% 0' },
  to: { backgroundPosition: '200% 0' },
});
export const coverPlaceholder = style({
  position: 'absolute',
  inset: 0,
  background: `linear-gradient(100deg, ${wb.panel} 30%, ${wb.panelStrong} 50%, ${wb.panel} 70%)`,
  backgroundSize: '200% 100%',
  animation: `${shimmer} 1.6s linear infinite`,
  '@media': { '(prefers-reduced-motion: reduce)': { animation: 'none' } },
});
export const templateGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gridAutoRows: '1fr',
  gap: 18,
  '@container': {
    '(max-width: 815px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    '(max-width: 537px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});
export const templateCard = style({
  vars: { [coverRadius]: `calc(${wb.radius} - 1px)` },
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  minWidth: 0,
  border,
  borderRadius: wb.radius,
  overflow: 'hidden',
  background: wb.paper,
  boxShadow: wb.shadow,
  // Keep the iframe's containing block stable when the card is hovered.
  transition: `box-shadow .25s ${ease}, border-color .2s ease`,
  selectors: {
    '&:hover': {
      borderColor: wb.lineStrong,
      boxShadow: wb.shadowRaised,
    },
    '&:focus-within': { borderColor: wb.lineStrong },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
});
export const templateHit = style({
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  border: 0,
  padding: 0,
  background: 'transparent',
  cursor: 'pointer',
  borderRadius: wb.radius,
  selectors: { '&:focus-visible': { ...focusRing, outlineOffset: -2 } },
});
export const templateBody = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  gap: 6,
  padding: '13px 15px 15px',
  borderTop: border,
});
export const templateName = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: 0,
  fontSize: 14,
  fontWeight: 650,
  color: wb.ink,
});
export const swatches = style({
  display: 'inline-flex',
  marginLeft: 'auto',
});
export const swatch = style({
  width: 12,
  height: 12,
  borderRadius: '50%',
  border: `2px solid ${wb.paper}`,
  marginLeft: -4,
  boxShadow: `0 0 0 1px ${wb.line}`,
});
export const templateDescription = style({
  margin: 0,
  fontSize: 12,
  lineHeight: 1.65,
  color: wb.ink2,
});
export const templateTags = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  marginTop: 'auto',
});
export const previewButton = style([
  button,
  {
    position: 'absolute',
    zIndex: 2,
    right: 10,
    top: 10,
    height: 28,
    padding: '0 10px',
    fontSize: 12,
    opacity: 0,
    transform: 'none',
    transition: 'opacity .2s ease',
    selectors: {
      [`${templateCard}:hover &, ${templateCard}:focus-within &`]: {
        opacity: 1,
      },
      '&:active:not(:disabled)': { transform: 'none' },
    },
    '@media': {
      '(hover: none)': { opacity: 1 },
      '(prefers-reduced-motion: reduce)': { transition: 'none' },
    },
  },
]);
export const previewStage = style({
  width: '100%',
  height: 'min(72vh, 860px)',
  borderRadius: 10,
  overflow: 'hidden',
  background: wb.paper,
  border,
});
export const frame = style({
  display: 'block',
  width: '100%',
  height: '100%',
  border: 0,
  background: '#000',
  selectors: {
    '&[data-immersive="true"]': {
      position: 'fixed',
      inset: 0,
      width: '100vw',
      height: '100dvh',
      zIndex: 1000,
    },
  },
});

/* Compact template picker (configuration page) */
export const pickerGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))',
  gap: 12,
});
export const pickerCard = style({
  vars: { [coverRadius]: '10px' },
  display: 'flex',
  flexDirection: 'column',
  padding: 0,
  border,
  borderRadius: 11,
  overflow: 'hidden',
  background: wb.paper,
  color: wb.ink,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'border-color .15s ease, box-shadow .15s ease',
  selectors: {
    '&:hover': { borderColor: wb.lineStrong },
    '&[aria-pressed="true"]': {
      borderColor: wb.action,
      boxShadow: `0 0 0 2px ${wb.action}`,
    },
    '&:focus-visible': focusRing,
  },
});
export const pickerLabel = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 6,
  padding: '8px 10px',
  fontSize: 12,
  fontWeight: 600,
  borderTop: border,
});

/* Configuration page */
export const configHeader = style({ marginBottom: 28 });
export const backLink = style([ghostButton, { marginLeft: -10, height: 30 }]);
export const card = style({
  display: 'grid',
  gridTemplateColumns: '220px minmax(0, 1fr)',
  gap: 28,
  padding: '24px 26px',
  marginBottom: 16,
  border,
  borderRadius: wb.radius,
  background: wb.paper,
  boxShadow: wb.shadow,
  '@container': {
    '(max-width: 760px)': { gridTemplateColumns: 'minmax(0, 1fr)', gap: 16 },
  },
});
export const cardAside = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
});
export const stepNumber = style({
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: wb.ink3,
  fontVariantNumeric: 'tabular-nums',
});
export const cardTitle = style({
  margin: 0,
  fontSize: 15,
  fontWeight: 650,
  color: wb.ink,
});
export const cardMain = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  minWidth: 0,
  containerType: 'inline-size',
  containerName: 'report-config-fields',
});
export const grid3 = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 14,
  '@container': {
    'report-config-fields (max-width: 540px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
    'report-config-fields (max-width: 360px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});
export const sourceList = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  border,
  borderRadius: 11,
  overflow: 'hidden',
});
export const sourceRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 46,
  padding: '6px 8px 6px 12px',
  borderTop: border,
  fontSize: 13,
  selectors: {
    '&:first-child': { borderTop: 0 },
    '&[data-excluded="true"]': { background: wb.panel },
  },
});
globalStyle(`${sourceRow}[data-excluded="true"] > *:not(:last-child)`, {
  opacity: 0.55,
});
export const sourceIcon = style({
  display: 'grid',
  placeItems: 'center',
  width: 28,
  height: 28,
  borderRadius: 7,
  background: wb.panel,
  color: wb.ink2,
  flexShrink: 0,
});
globalStyle(`${sourceIcon} svg`, { width: 16, height: 16 });
export const sourceTitle = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
});
globalStyle(`${sourceTitle} > strong`, {
  fontWeight: 560,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
globalStyle(`${sourceTitle} > span`, { fontSize: 11, color: wb.ink3 });
export const colorRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
});
export const colorInput = style({
  flex: '0 0 36px',
  width: 36,
  minWidth: 36,
  maxWidth: 36,
  height: 36,
  minHeight: 36,
  boxSizing: 'border-box',
  padding: 3,
  border,
  borderRadius: 8,
  background: wb.paper,
  cursor: 'pointer',
  selectors: {
    '&:hover': { borderColor: wb.lineStrong },
    '&:focus-visible': focusRing,
    '&::-webkit-color-swatch-wrapper': { padding: 0 },
    '&::-webkit-color-swatch': { border: 0, borderRadius: 4 },
    '&::-moz-color-swatch': { border: 0, borderRadius: 4 },
  },
});
export const footer = style({
  position: 'sticky',
  bottom: 0,
  zIndex: 3,
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  padding: '14px clamp(20px, 4vw, 56px)',
  borderTop: border,
  background: `color-mix(in srgb, ${wb.paper} 88%, transparent)`,
  backdropFilter: 'saturate(1.4) blur(12px)',
});
export const footerSummary = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  marginRight: 'auto',
});
globalStyle(`${footerSummary} strong`, {
  fontSize: 14,
  fontWeight: 640,
  fontVariantNumeric: 'tabular-nums',
});

/* AI picker */
export const aiPicker = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
});
export const aiMeta = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  color: wb.ink2,
});

/* Source picker */
export const pickerLayout = style({
  display: 'grid',
  gridTemplateColumns: '200px minmax(0, 1fr)',
  height: 'min(560px, 70vh)',
  border,
  borderRadius: 12,
  overflow: 'hidden',
});
export const pickerSide = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: 8,
  borderRight: border,
  background: wb.panel,
  overflow: 'auto',
});
export const pickerSideItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  minHeight: 32,
  padding: '0 10px',
  border: 0,
  borderRadius: 8,
  background: 'transparent',
  color: wb.ink2,
  font: 'inherit',
  fontSize: 13,
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: wb.sidebarHover, color: wb.ink },
    '&[aria-current="true"]': {
      background: wb.paper,
      color: wb.ink,
      fontWeight: 600,
      boxShadow: wb.shadow,
    },
    '&:focus-visible': focusRing,
  },
});
globalStyle(`${pickerSideItem} > span`, {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const pickerMain = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
});
export const pickerToolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: 10,
  borderBottom: border,
});
export const pickerItems = style({
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  padding: 6,
});
export const pickerItem = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  minHeight: 36,
  padding: '0 10px',
  borderRadius: 8,
  fontSize: 13,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: wb.panel },
    '&[data-disabled="true"]': { opacity: 0.5, cursor: 'not-allowed' },
  },
});
globalStyle(`${pickerItem} input`, {
  appearance: 'auto',
  width: 15,
  height: 15,
  margin: 0,
  accentColor: wb.action,
});
globalStyle(`${pickerItem} svg`, {
  width: 16,
  height: 16,
  color: wb.ink3,
  flexShrink: 0,
});
export const tabs = style({
  display: 'flex',
  gap: 2,
  padding: 3,
  marginBottom: 6,
  borderRadius: 9,
  background: wb.panelStrong,
});
export const tab = style({
  flex: 1,
  height: 28,
  border: 0,
  borderRadius: 7,
  background: 'transparent',
  color: wb.ink3,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  selectors: {
    '&[aria-selected="true"]': {
      background: wb.paper,
      color: wb.ink,
      boxShadow: wb.shadow,
    },
    '&:focus-visible': focusRing,
  },
});
export const modalFooter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 16,
});

/* Viewer */
export const viewerBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 56,
  padding: '10px clamp(16px, 3vw, 28px)',
  borderBottom: border,
  background: wb.paper,
  flexWrap: 'wrap',
});
export const viewerTitle = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  marginRight: 'auto',
});
globalStyle(`${viewerTitle} h1`, {
  margin: 0,
  fontSize: 16,
  fontWeight: 650,
  letterSpacing: '-0.01em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const viewerBody = style({
  display: 'flex',
  flex: 1,
  minHeight: 0,
});
export const viewerCanvas = style({
  display: 'flex',
  flex: 1,
  minWidth: 0,
  minHeight: 0,
  alignItems: 'stretch',
  background: wb.paper,
  overflow: 'hidden',
});
export const deckStage = style({
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  background: wb.paper,
});
export const sourcesPanel = style({
  width: 320,
  flexShrink: 0,
  overflow: 'auto',
  borderLeft: border,
  background: wb.paper,
  padding: '18px 18px 28px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  '@media': { '(max-width: 960px)': { display: 'none' } },
});
export const panelHeading = style({
  margin: 0,
  fontSize: 12,
  fontWeight: 650,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: wb.ink3,
});
export const statusPanel = style({
  width: 'min(560px, 100%)',
  margin: 'auto',
  padding: '34px 34px 30px',
  border,
  borderRadius: 18,
  background: wb.paper,
  boxShadow: wb.shadowRaised,
});
export const steps = style({
  listStyle: 'none',
  margin: '24px 0',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
});
export const step = style({
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '9px 0',
  fontSize: 14,
  color: wb.ink3,
  selectors: {
    '&[data-state="active"]': { color: wb.ink, fontWeight: 620 },
    '&[data-state="done"]': { color: wb.ink2 },
  },
});
export const stepMark = style({
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  width: 22,
  height: 22,
  borderRadius: '50%',
  border: `1.5px solid ${wb.lineStrong}`,
  background: wb.paper,
  flexShrink: 0,
  fontSize: 11,
  selectors: {
    [`${step}[data-state="active"] &`]: {
      borderColor: wb.signal,
      color: wb.signal,
      boxShadow: `0 0 0 4px ${wb.signalSoft}`,
    },
    [`${step}[data-state="done"] &`]: {
      borderColor: wb.success,
      background: wb.success,
      color: wb.paper,
    },
  },
});
globalStyle(`${step}:not(:last-child) ${stepMark}::after`, {
  content: '""',
  position: 'absolute',
  top: 22,
  left: '50%',
  width: 1.5,
  height: 18,
  marginLeft: -0.75,
  background: wb.line,
});
export const bigProgress = style({
  position: 'relative',
  height: 6,
  borderRadius: 3,
  overflow: 'hidden',
  background: wb.signalSoft,
});

/* Presentation & shared page */
export const presentRoot = style({
  position: 'fixed',
  inset: 0,
  zIndex: 10,
  background: '#000',
});
export const sharedRoot = style({
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: '#0b0c0e',
  color: '#f1f2f4',
  fontFamily: 'var(--affine-font-family)',
});
export const sharedBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  height: 48,
  padding: '0 16px',
  borderBottom: '1px solid rgba(255,255,255,.08)',
  fontSize: 13,
});
globalStyle(`${sharedBar} strong`, {
  marginRight: 'auto',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontWeight: 600,
});
export const sharedLink = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 12px',
  borderRadius: 8,
  border: '1px solid rgba(255,255,255,.16)',
  color: '#f1f2f4',
  textDecoration: 'none',
  fontSize: 12,
  selectors: {
    '&:hover': { background: 'rgba(255,255,255,.08)' },
    '&:focus-visible': focusRing,
  },
});
export const sharedFrame = style({ flex: 1, minHeight: 0, display: 'flex' });
export const gate = style({
  margin: 'auto',
  width: 'min(380px, calc(100% - 40px))',
  padding: '32px 28px',
  borderRadius: 18,
  background: wb.paper,
  color: wb.ink,
  border,
  boxShadow: wb.shadowRaised,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  textAlign: 'center',
});
globalStyle(`${gate} h1`, {
  margin: 0,
  fontSize: 18,
  fontWeight: 660,
  letterSpacing: '-0.01em',
});
globalStyle(`${gate} p`, {
  margin: 0,
  fontSize: 13,
  lineHeight: 1.7,
  color: wb.ink2,
});
export const gateGlyph = style({
  display: 'grid',
  placeItems: 'center',
  width: 48,
  height: 48,
  margin: '0 auto',
  borderRadius: 14,
  background: wb.panel,
  color: wb.ink2,
  border,
});
globalStyle(`${gateGlyph} svg`, { width: 24, height: 24 });

/* Share dialog */
export const shareList = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
});
export const shareRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  border,
  borderRadius: 10,
  fontSize: 12,
  selectors: { '&[data-inactive="true"]': { opacity: 0.6 } },
});
export const linkBox = style({
  display: 'flex',
  gap: 8,
  padding: 10,
  borderRadius: 10,
  background: wb.successSoft,
  border: `1px solid ${wb.successLine}`,
});
export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
});
export const error = style({
  padding: '10px 12px',
  borderRadius: 10,
  fontSize: 13,
  color: wb.danger,
  background: wb.dangerSoft,
});

/* Per-submission custom generation mode. */
export const designModes = style({
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
  display: 'grid',
  gap: 10,
});
export const designModeOptions = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
  '@media': { '(max-width: 600px)': { gridTemplateColumns: '1fr' } },
});
export const designModeOption = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: 14,
  border,
  borderRadius: 8,
  cursor: 'pointer',
  background: wb.paper,
  selectors: {
    '&[data-selected="true"]': { borderColor: wb.signal },
    '&:focus-within': focusRing,
    '&:hover': { borderColor: wb.signal },
  },
});
globalStyle(`${designModeOption} input`, {
  appearance: 'auto',
  width: 16,
  height: 16,
  accentColor: wb.signal,
  marginTop: 3,
  flexShrink: 0,
});
globalStyle(`${designModeOption} > span`, {
  display: 'grid',
  gap: 6,
  lineHeight: 1.5,
});
globalStyle(`${designModeOption} > span > span`, {
  color: wb.ink2,
  fontSize: 13,
});
export const generationQuality = style({
  padding: '12px 16px',
  borderBottom: border,
  lineHeight: 1.5,
});
globalStyle(`${generationQuality} p`, {
  margin: '4px 0 0',
  color: wb.ink2,
  fontSize: 13,
});

globalStyle(`${designModes} > legend`, {
  padding: 0,
  marginBottom: 10,
  fontWeight: 600,
});
