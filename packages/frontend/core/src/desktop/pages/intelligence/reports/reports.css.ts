import { globalStyle, keyframes, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from '../workbench-tokens.css';

const border = `1px solid ${wb.line}`;
const focusRing = {
  outline: `2px solid ${wb.signal}`,
  outlineOffset: 2,
};

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  color: wb.ink,
  background: wb.paper,
  fontFamily: 'var(--affine-font-family)',
});
export const toolbar = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '10px 20px',
  flexShrink: 0,
});
export const title = style({
  fontSize: 18,
  fontWeight: 650,
  letterSpacing: '-0.01em',
  margin: 0,
  marginRight: 'auto',
  overflowWrap: 'anywhere',
  color: wb.ink,
});
export const body = style({
  minHeight: 0,
  flex: 1,
  overflow: 'auto',
  padding: '24px clamp(16px, 4vw, 48px) 48px',
  width: '100%',
  maxWidth: 1180,
  margin: '0 auto',
  boxSizing: 'border-box',
});
export const row = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
});
export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
});
export const muted = style({
  fontSize: 12,
  color: wb.ink3,
  lineHeight: 1.6,
  margin: 0,
});
export const error = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 8,
  padding: '10px 14px',
  border: `1px solid ${wb.dangerSoft}`,
  borderRadius: wb.radiusSmall,
  color: wb.danger,
  background: wb.dangerSoft,
  fontSize: 13,
  overflowWrap: 'anywhere',
});
export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  fontSize: 12,
  fontWeight: 600,
  color: wb.ink2,
  minWidth: 0,
});
export const input = style({
  width: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  border: `1px solid ${wb.line}`,
  borderRadius: 8,
  background: wb.paper,
  color: wb.ink,
  padding: '7px 10px',
  font: 'inherit',
  fontSize: 13,
  fontWeight: 400,
  lineHeight: 1.6,
  boxShadow: wb.shadow,
  transition: 'border-color .15s ease, box-shadow .15s ease',
  selectors: {
    '&:hover:not(:disabled)': { borderColor: wb.lineStrong },
    '&:focus-visible': {
      outline: 'none',
      borderColor: wb.signal,
      boxShadow: `0 0 0 3px ${wb.signalSoft}`,
    },
    '&:disabled': {
      opacity: 0.6,
      cursor: 'not-allowed',
      background: wb.panel,
    },
  },
});
export const textarea = style([input, { minHeight: 96, resize: 'vertical' }]);
export const formGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 14,
  '@media': { '(max-width: 680px)': { gridTemplateColumns: '1fr' } },
});
export const list = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
});
export const listRow = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 10,
  padding: '14px 16px',
  background: wb.paper,
  border,
  borderRadius: wb.radius,
  boxShadow: wb.shadow,
  transition: 'border-color .15s ease, box-shadow .15s ease',
  selectors: {
    '&:hover': {
      borderColor: wb.lineStrong,
      boxShadow: '0 6px 18px rgba(25, 29, 34, 0.06)',
    },
  },
});
export const link = style({
  border: 0,
  background: 'transparent',
  color: 'inherit',
  padding: 0,
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 4,
  selectors: {
    '&:hover': { color: wb.signal, textDecoration: 'underline' },
    '&:focus-visible': focusRing,
  },
});
export const node = style({ padding: '12px 0', borderBottom: border });
export const tableWrap = style({ overflowX: 'auto', maxWidth: '100%' });
export const table = style({
  width: '100%',
  borderCollapse: 'collapse',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'left',
});
globalStyle(`${table} th, ${table} td`, {
  padding: '8px 10px',
  borderBottom: border,
  verticalAlign: 'top',
});

/* Slide: theme-driven, shared by the studio canvas and presentation. */
export const slide = style({
  position: 'relative',
  width: '100%',
  aspectRatio: '16 / 9',
  padding: '4.2% 5.6% 5%',
  boxSizing: 'border-box',
  background: 'var(--report-background)',
  color: 'var(--report-foreground)',
  overflow: 'hidden',
  containerType: 'inline-size',
  fontFamily: 'var(--report-font)',
  display: 'flex',
  flexDirection: 'column',
  gap: '2.2cqw',
  // Keeps the theme background image behind content but above the fill.
  isolation: 'isolate',
});
export const slideBackground = style({});
globalStyle(`${slide} > ${slideBackground}`, {
  position: 'absolute',
  inset: 0,
  zIndex: -1,
  width: '100%',
  height: '100%',
  maxHeight: 'none',
  objectFit: 'cover',
  borderRadius: 0,
  pointerEvents: 'none',
});
export const slideKicker = style({
  display: 'flex',
  alignItems: 'center',
  gap: '1cqw',
  fontSize: 'clamp(9px, 1.25cqw, 15px)',
  fontWeight: 650,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--report-accent)',
  selectors: {
    '&::before': {
      content: '""',
      width: '2.6cqw',
      height: 3,
      borderRadius: 2,
      background: 'var(--report-accent)',
    },
  },
});
globalStyle(`${slide} h1`, {
  fontSize: 'clamp(18px, 3.6cqw, 46px)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  lineHeight: 1.18,
  margin: 0,
  textWrap: 'balance',
});
globalStyle(`${slide} h2, ${slide} h3`, {
  fontSize: 'clamp(14px, 2.3cqw, 30px)',
  fontWeight: 650,
  margin: '0.4cqw 0',
  lineHeight: 1.3,
});
globalStyle(`${slide} p, ${slide} li, ${slide} td, ${slide} th, ${slide} dd`, {
  fontSize: 'clamp(11px, 1.75cqw, 24px)',
  lineHeight: 1.6,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  margin: 0,
});
globalStyle(`${slide} ul, ${slide} ol`, {
  margin: 0,
  paddingLeft: '1.3em',
  display: 'grid',
  gap: '0.6cqw',
});
globalStyle(`${slide} li::marker`, { color: 'var(--report-accent)' });
globalStyle(`${slide} small`, {
  display: 'inline-block',
  marginTop: '0.6cqw',
  marginRight: '1cqw',
  fontSize: 'clamp(9px, 1.1cqw, 14px)',
  opacity: 0.62,
});
globalStyle(`${slide} img`, {
  objectFit: 'contain',
  maxWidth: '100%',
  maxHeight: '40cqw',
  borderRadius: 6,
});
globalStyle(`${slide} figcaption`, {
  fontSize: 'clamp(10px, 1.3cqw, 16px)',
  opacity: 0.7,
  marginTop: '0.6cqw',
});
globalStyle(`${slide} ${table} th`, {
  background: 'color-mix(in srgb, var(--report-accent) 12%, transparent)',
  fontWeight: 650,
});
globalStyle(`${slide} ${table} th, ${slide} ${table} td`, {
  borderBottom:
    '1px solid color-mix(in srgb, var(--report-foreground) 14%, transparent)',
});
globalStyle(`${slide} details`, {
  fontSize: 'clamp(10px, 1.2cqw, 14px)',
  opacity: 0.8,
});
export const slideFooter = style({
  position: 'absolute',
  left: '5.6%',
  right: '5.6%',
  bottom: '2.4%',
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 'clamp(8px, 1cqw, 13px)',
  opacity: 0.5,
  fontVariantNumeric: 'tabular-nums',
});
export const metric = style({
  display: 'grid',
  gap: '0.4cqw',
  padding: '1.6cqw 2cqw',
  borderRadius: 10,
  background: 'color-mix(in srgb, var(--report-accent) 8%, transparent)',
  border: '1px solid color-mix(in srgb, var(--report-accent) 22%, transparent)',
  margin: 0,
});
globalStyle(`${metric} dt`, {
  fontSize: 'clamp(10px, 1.3cqw, 16px)',
  fontWeight: 600,
  opacity: 0.75,
});
globalStyle(`${metric} dd strong`, {
  fontSize: 'clamp(20px, 4cqw, 52px)',
  fontWeight: 700,
  letterSpacing: '-0.02em',
  color: 'var(--report-accent)',
  lineHeight: 1.1,
});
export const callout = style({
  margin: 0,
  padding: '1.4cqw 1.8cqw',
  borderLeft: '4px solid var(--report-accent)',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--report-accent) 7%, transparent)',
});
globalStyle(`${callout} strong`, {
  display: 'block',
  fontSize: 'clamp(10px, 1.3cqw, 16px)',
  color: 'var(--report-accent)',
  marginBottom: '0.4cqw',
});
export const timeline = style({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: '1.2cqw',
});
globalStyle(`${timeline} > li`, {
  position: 'relative',
  paddingLeft: '3cqw',
});
globalStyle(`${timeline} > li::before`, {
  content: '""',
  position: 'absolute',
  left: 0,
  top: '0.55em',
  width: '1.2cqw',
  height: '1.2cqw',
  minWidth: 8,
  minHeight: 8,
  borderRadius: '50%',
  background: 'var(--report-accent)',
});
export const slideContent = style({
  display: 'grid',
  gap: '1.8cqw',
  minWidth: 0,
  alignContent: 'start',
});
globalStyle(`${slide}[data-layout="cover"]`, {
  justifyContent: 'center',
  padding: '6% 8%',
});
globalStyle(`${slide}[data-layout="cover"] h1`, {
  fontSize: 'clamp(24px, 5.4cqw, 68px)',
});
globalStyle(
  `${slide}[data-layout="comparison"] ${slideContent}, ${slide}[data-layout="gallery"] ${slideContent}`,
  { gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }
);
globalStyle(`${slide}[data-layout="timeline"] ${slideContent}`, {
  borderLeft: '3px solid var(--report-accent)',
  paddingLeft: '2.4cqw',
});
globalStyle(`${slideContent} > div`, { minWidth: 0 });
export const logo = style({
  position: 'absolute',
  top: '3.4%',
  right: '4.4%',
  width: '9cqw',
  height: '4.5cqw',
  objectFit: 'contain',
});
export const slideEmpty = style({
  display: 'grid',
  placeItems: 'center',
  flex: 1,
  border:
    '1.5px dashed color-mix(in srgb, var(--report-foreground) 18%, transparent)',
  borderRadius: 10,
  fontSize: 'clamp(11px, 1.5cqw, 18px)',
  opacity: 0.55,
});

/* Presentation */
export const presentationRoot = style({
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  background: '#0f1114',
  color: '#eef0f3',
});
export const presentationBar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  flexShrink: 0,
  transition: 'opacity .25s ease',
  selectors: {
    '&[data-dimmed="true"]': { opacity: 0 },
    '&[data-dimmed="true"]:focus-within': { opacity: 1 },
  },
});
globalStyle(`${presentationBar} h1`, {
  fontSize: 14,
  fontWeight: 600,
  margin: 0,
  marginRight: 'auto',
  color: '#c6ccd4',
});
export const darkButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 12px',
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.06)',
  color: '#eef0f3',
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&:hover:not(:disabled)': { background: 'rgba(255,255,255,0.12)' },
    '&[aria-pressed="true"]': {
      background: '#eef0f3',
      color: '#15181c',
    },
    '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
    '&:focus-visible': { outline: '2px solid #a9bacb', outlineOffset: 2 },
  },
});
export const presenter = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)',
  gap: 24,
  padding: '8px 24px 24px',
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  '@media': { '(max-width: 860px)': { gridTemplateColumns: '1fr' } },
});
export const presenterAside = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
  padding: 16,
  borderRadius: 12,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
});
globalStyle(`${presenterAside} h2`, {
  fontSize: 11,
  fontWeight: 650,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#8c96a2',
  margin: 0,
});
export const timer = style({
  fontSize: 28,
  fontWeight: 650,
  fontVariantNumeric: 'tabular-nums',
});
export const stage = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  overflow: 'hidden',
  position: 'relative',
  padding: '0 24px',
});
globalStyle(`${stage} > ${slide}`, {
  width: 'min(100%, calc((100vh - 140px) * 16 / 9))',
  borderRadius: 6,
  boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
});
globalStyle(`${presenter} ${stage}`, { padding: 0 });
globalStyle(`${presenter} ${stage} > ${slide}`, { width: '100%' });
export const presentationFooter = style([
  presentationBar,
  { justifyContent: 'center', gap: 12 },
]);
export const progress = style({
  position: 'absolute',
  left: 0,
  bottom: 0,
  height: 3,
  background: '#a9bacb',
  transition: 'width .25s ease',
});
export const darkSelect = style({
  height: 30,
  maxWidth: 240,
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 8,
  background: '#1d2126',
  color: '#eef0f3',
  font: 'inherit',
  fontSize: 12,
  padding: '0 8px',
});
export const black = style({
  position: 'absolute',
  inset: 0,
  background: '#000000',
  zIndex: 2,
});
export const pointer = style({
  width: 16,
  height: 16,
  borderRadius: '50%',
  background: '#ea4335',
  border: '2px solid #ffffff',
  boxShadow: '0 0 0 6px rgba(234, 67, 53, 0.25)',
  position: 'absolute',
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
  zIndex: 3,
});

/* Lists, empty states and the reports shell. */
export const empty = style({
  maxWidth: 620,
  margin: '48px auto',
  padding: '36px 32px',
  lineHeight: 1.7,
  textAlign: 'center',
  background: wb.paper,
  border,
  borderRadius: wb.radius,
  boxShadow: wb.shadow,
});
globalStyle(`${empty} h2`, { fontSize: 18, fontWeight: 650, margin: 0 });
globalStyle(`${empty} p`, { color: wb.ink2, margin: '8px 0 20px' });
globalStyle(`${empty} ${row}`, { justifyContent: 'center' });

export const shellHeader = style({
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  height: 56,
  padding: '0 18px',
  flexShrink: 0,
  background: wb.paper,
  borderBottom: border,
});
export const brandMark = style({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: wb.brand,
  boxShadow: `0 0 0 3px ${wb.brandSoft}`,
  flexShrink: 0,
});
export const viewSwitch = style({
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  padding: 3,
  border,
  borderRadius: 10,
  background: wb.panel,
});
export const viewSwitchButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 28,
  border: 0,
  padding: '0 12px',
  borderRadius: 7,
  background: 'transparent',
  color: wb.ink3,
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover': { color: wb.ink },
    '&[aria-pressed="true"], &[aria-current="page"]': {
      color: wb.ink,
      background: wb.paper,
      boxShadow: '0 1px 4px rgba(25, 27, 25, 0.09)',
    },
    '&:focus-visible': focusRing,
  },
});
export const ghostButton = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 30,
  padding: '0 10px',
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'transparent',
  color: wb.ink2,
  font: 'inherit',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&:hover:not(:disabled)': { background: wb.panel, color: wb.ink },
    '&[aria-pressed="true"]': {
      background: wb.panelStrong,
      color: wb.ink,
    },
    '&:disabled': { opacity: 0.45, cursor: 'not-allowed' },
    '&:focus-visible': focusRing,
  },
});
export const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 22,
  padding: '0 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  background: wb.panelStrong,
  color: wb.ink2,
  selectors: {
    '&[data-tone="success"]': {
      background: wb.successSoft,
      color: wb.success,
    },
    '&[data-tone="warning"]': {
      background: wb.warningSoft,
      color: wb.warning,
    },
    '&[data-tone="danger"]': { background: wb.dangerSoft, color: wb.danger },
    '&[data-tone="signal"]': { background: wb.signalSoft, color: wb.signal },
  },
});
export const card = style({
  background: wb.paper,
  border,
  borderRadius: wb.radius,
  padding: 14,
  boxShadow: wb.shadow,
});
const pulse = keyframes({
  '0%, 100%': { transform: 'scale(1)', opacity: 1 },
  '50%': { transform: 'scale(0.55)', opacity: 0.55 },
});
export const pulseDot = style({
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: wb.signal,
  flexShrink: 0,
  animation: `${pulse} 1.5s ease-in-out infinite`,
  '@media': {
    '(prefers-reduced-motion: reduce)': { animation: 'none' },
  },
});

globalStyle(`${root} input[type="checkbox"]`, {
  appearance: 'auto',
  width: 15,
  height: 15,
  accentColor: wb.action,
  margin: 0,
});
globalStyle(`${root} label:has(> input[type="checkbox"])`, {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: wb.ink2,
  cursor: 'pointer',
});
globalStyle(`${root} details > summary`, {
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  color: wb.ink2,
  padding: '4px 0',
});
globalStyle(`${root} article`, { minWidth: 0 });
globalStyle(`${root} h2`, { fontSize: 15, fontWeight: 650, margin: 0 });
globalStyle(`${root} h3`, { fontSize: 13, fontWeight: 650, margin: 0 });
globalStyle(`${root} ::selection`, { background: wb.signalSoft });
globalStyle(`${root} button`, { touchAction: 'manipulation' });
globalStyle(`${root} a`, { textUnderlineOffset: 3 });

/* Report home: template gallery, report list and project sources. */
export const homeBody = style({ containerType: 'inline-size' });
globalStyle(`${homeBody} .${muted}`, { color: wb.ink2 });
export const homeHeader = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  marginBottom: 32,
});
export const homeTitle = style({
  margin: 0,
  color: wb.ink,
  fontSize: 'clamp(28px, 2.6vw, 36px)',
  fontWeight: 650,
  letterSpacing: '-0.04em',
  lineHeight: 1.1,
});
export const homeSubtitle = style({
  maxWidth: 720,
  margin: '10px 0 0',
  color: wb.ink2,
  fontSize: 13,
  lineHeight: '20px',
});
export const section = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  minWidth: 0,
});
export const sectionHead = style({
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 10,
  minHeight: 32,
});
export const sectionTitle = style({
  margin: 0,
  fontSize: 15,
  fontWeight: 650,
  color: wb.ink,
});
export const sectionHint = style({
  margin: 0,
  fontSize: 12,
  color: wb.ink2,
  marginRight: 'auto',
});
/* Template gallery: a masonry of real template previews. */
export const templateMasonry = style({
  columns: '3 240px',
  columnGap: 16,
  marginBottom: 36,
});
export const templateCard = style({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  minWidth: 0,
  marginBottom: 16,
  padding: 0,
  breakInside: 'avoid',
  overflow: 'hidden',
  textAlign: 'left',
  font: 'inherit',
  color: wb.ink,
  background: wb.paper,
  border,
  borderRadius: wb.radius,
  cursor: 'pointer',
  transition: 'border-color .15s ease, box-shadow .15s ease',
  selectors: {
    '&:hover:not(:disabled)': {
      borderColor: wb.lineStrong,
      boxShadow: wb.shadowRaised,
    },
    '&:disabled': { cursor: 'not-allowed', opacity: 0.6 },
    '&:focus-visible': focusRing,
  },
});
export const templateSkeleton = style({
  display: 'block',
  marginBottom: 16,
  breakInside: 'avoid',
  borderRadius: wb.radius,
  background: wb.panel,
  border,
});
export const templatePreview = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 10,
  background: wb.panel,
  borderBottom: border,
  pointerEvents: 'none',
});
globalStyle(`${templatePreview} > img`, {
  display: 'block',
  width: '100%',
  height: 'auto',
  borderRadius: 6,
});
globalStyle(`${templatePreview} .${slide}`, {
  borderRadius: 6,
  boxShadow: '0 1px 3px rgba(25, 29, 34, 0.12)',
});
export const templateStrip = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 6,
});
// Thumbnails scale text with the slide instead of the 11px reading minimum.
globalStyle(`${templatePreview} .${slide} p`, { fontSize: '2.6cqw' });
globalStyle(`${templatePreview} .${slide}[data-layout="cover"] p`, {
  fontSize: '2.2cqw',
  opacity: 0.72,
});
globalStyle(`${templateStrip} .${slide}`, { gap: '3cqw', padding: '7% 8%' });
globalStyle(`${templateStrip} .${slide} h1`, { fontSize: '8cqw' });
globalStyle(`${templateStrip} .${slide} p`, {
  fontSize: '5.4cqw',
  lineHeight: 1.45,
  opacity: 0.75,
});
export const templateInfo = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '12px 14px 14px',
  minWidth: 0,
});
export const templateName = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 14,
  fontWeight: 650,
});
export const templateDescription = style({
  margin: 0,
  fontSize: 12,
  color: wb.ink2,
  lineHeight: 1.6,
});
export const templateChapters = style({
  margin: 0,
  padding: 0,
  listStyle: 'none',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px 10px',
  fontSize: 12,
  color: wb.ink3,
  lineHeight: 1.5,
});
export const templateSource = style({
  fontSize: 11,
  color: wb.ink3,
  overflowWrap: 'anywhere',
});
/* Import dialog */
export const importLayout = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 20,
  '@media': { '(max-width: 720px)': { gridTemplateColumns: 'minmax(0, 1fr)' } },
});
export const importChapter = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
});
export const checkbox = style({
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  fontSize: 12,
  color: wb.ink2,
  lineHeight: 1.6,
});
globalStyle(`${checkbox} input`, {
  appearance: 'auto',
  flexShrink: 0,
  width: 16,
  height: 16,
  margin: '2px 0 0',
  accentColor: wb.action,
});
export const homeGrid = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 280px',
  alignItems: 'start',
  gap: 32,
  '@container': {
    '(max-width: 800px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});
export const search = style([
  input,
  { width: 200, maxWidth: '100%', padding: '4px 10px', boxShadow: 'none' },
]);
export const listEmpty = style({
  padding: '28px 20px',
  textAlign: 'center',
  fontSize: 13,
  lineHeight: 1.7,
  color: wb.ink2,
  background: wb.panel,
  border,
  borderRadius: wb.radius,
});
globalStyle(`${listEmpty} strong`, {
  display: 'block',
  marginBottom: 4,
  fontSize: 14,
  color: wb.ink,
});
export const reportThumb = style({
  position: 'relative',
  flexShrink: 0,
  width: 64,
  aspectRatio: '16 / 9',
  borderRadius: 6,
  border,
  overflow: 'hidden',
});
export const reportSummary = style({
  flex: '1 1 200px',
  minWidth: 0,
  overflowWrap: 'anywhere',
});
globalStyle(`${reportThumb} i`, {
  position: 'absolute',
  left: 7,
  bottom: 7,
  width: 18,
  height: 3,
  borderRadius: 2,
});
export const aside = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '16px 18px',
  background: wb.panel,
  border,
  borderRadius: wb.radius,
});
export const sourceList = style({
  listStyle: 'none',
  margin: '10px 0 8px',
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
});
export const sourceRow = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '9px 0',
  fontSize: 13,
  color: wb.ink2,
  borderTop: border,
});
globalStyle(`${sourceRow} strong`, {
  fontWeight: 650,
  color: wb.ink,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});
