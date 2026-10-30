import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  width: '100%',
  height: '100%',
  overflow: 'auto',
  containerName: 'help-center',
  containerType: 'inline-size',
  background: cssVarV2.layer.background.primary,
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});
export const page = style({
  width: '100%',
  maxWidth: 1120,
  boxSizing: 'border-box',
  margin: '0 auto',
  padding: '40px 40px 80px',
  '@container': {
    'help-center (width <= 760px)': { padding: '28px 24px 64px' },
    'help-center (width <= 480px)': { padding: '24px 16px 48px' },
  },
});
export const headerTitle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  minHeight: 32,
  fontSize: 14,
  fontWeight: 600,
  color: cssVarV2.text.primary,
});
globalStyle(`${headerTitle} svg`, { width: 18, height: 18 });
export const visuallyHidden = style({
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0, 0, 0, 0)',
  whiteSpace: 'nowrap',
  border: 0,
});
export const intro = style({
  paddingBottom: 28,
  marginBottom: 32,
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});
globalStyle(`${intro} h1`, {
  margin: 0,
  color: cssVarV2.text.primary,
  fontSize: 28,
  fontWeight: 600,
  lineHeight: '36px',
});
globalStyle(`${intro} p`, {
  margin: '10px 0 0',
  maxWidth: '72ch',
  color: cssVarV2.text.secondary,
  fontSize: 14,
  lineHeight: '24px',
});
export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  marginTop: 24,
});
export const search = style({
  minWidth: 180,
  maxWidth: 440,
  flex: '1 1 260px',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 10px',
  minHeight: 36,
  border: `1px solid ${cssVarV2.layer.insideBorder.border}`,
  borderRadius: 4,
  background: cssVarV2.layer.background.secondary,
  color: cssVarV2.text.secondary,
  selectors: {
    '&:focus-within': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 2,
    },
  },
  '@container': {
    'help-center (width <= 560px)': { maxWidth: 'none', flexBasis: '100%' },
  },
});
globalStyle(`${search} > svg`, { width: 16, height: 16, flexShrink: 0 });
globalStyle(`${search} input`, {
  minWidth: 0,
  flex: 1,
  width: '100%',
  padding: '8px 0',
  border: 0,
  outline: 0,
  background: 'transparent',
  color: cssVarV2.text.primary,
  caretColor: cssVarV2.text.primary,
  font: 'inherit',
  fontSize: 14,
});
globalStyle(`${search} input::placeholder`, { color: cssVarV2.text.secondary });
globalStyle(`${search} input::-webkit-search-cancel-button`, {
  WebkitAppearance: 'none',
});
export const availability = style({ fontSize: 13 });
export const layout = style({
  display: 'grid',
  gridTemplateColumns: '170px minmax(0, 1fr)',
  alignItems: 'start',
  gap: 40,
  '@container': {
    'help-center (width <= 760px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 24,
    },
  },
});
export const toc = style({
  position: 'sticky',
  top: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  '@container': {
    'help-center (width <= 760px)': {
      position: 'static',
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      paddingBottom: 20,
      borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
    },
  },
});
export const tocLabel = style({
  gridColumn: '1 / -1',
  padding: '0 8px 8px',
  color: cssVarV2.text.secondary,
  fontSize: 12,
  fontWeight: 600,
});
globalStyle(`${toc} a`, {
  padding: '8px',
  borderRadius: 4,
  color: cssVarV2.text.secondary,
  fontSize: 14,
  lineHeight: '22px',
  textDecoration: 'none',
});
globalStyle(`${toc} a:hover`, {
  background: cssVarV2.layer.background.hoverOverlay,
  color: cssVarV2.text.primary,
});
globalStyle(`${toc} a:focus-visible`, {
  outline: `2px solid ${cssVarV2('button/primary')}`,
  outlineOffset: 2,
});
export const content = style({ minWidth: 0, maxWidth: '75ch' });
export const resultStatus = style({
  color: cssVarV2.text.secondary,
  fontSize: 13,
  selectors: { '&:not(:empty)': { marginBottom: 12 } },
});
export const section = style({ scrollMarginTop: 24, marginBottom: 36 });
globalStyle(`${section} h2`, {
  margin: '0 0 8px',
  color: cssVarV2.text.primary,
  fontSize: 20,
  fontWeight: 600,
  lineHeight: '28px',
});
export const sectionDescription = style({
  margin: '0 0 16px',
  color: cssVarV2.text.secondary,
  fontSize: 14,
  lineHeight: '24px',
});
export const article = style({
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  overflowWrap: 'anywhere',
});
globalStyle(`${article} summary`, {
  padding: '15px 4px',
  color: cssVarV2.text.primary,
  cursor: 'pointer',
  fontSize: 15,
  fontWeight: 600,
  lineHeight: '24px',
});
globalStyle(`${article} summary:hover`, {
  background: cssVarV2.layer.background.hoverOverlay,
});
globalStyle(`${article} summary:focus-visible`, {
  outline: `2px solid ${cssVarV2('button/primary')}`,
  outlineOffset: 2,
});
export const articleBody = style({
  padding: '0 4px 20px',
  color: cssVarV2.text.primary,
  fontSize: 14,
  lineHeight: '25px',
});
globalStyle(`${articleBody} p`, { margin: '0 0 12px' });
globalStyle(`${articleBody} ol`, {
  margin: '0 0 16px',
  paddingLeft: 24,
  listStyleType: 'decimal',
});
globalStyle(`${articleBody} li + li`, { marginTop: 8 });
globalStyle(`${articleBody} li`, { listStyleType: 'decimal' });
export const note = style({ color: cssVarV2.text.secondary });
export const empty = style({
  padding: '48px 0',
  color: cssVarV2.text.secondary,
  fontSize: 14,
  lineHeight: '24px',
});
globalStyle(`${empty} > svg`, { width: 24, height: 24 });
globalStyle(`${empty} h2`, { color: cssVarV2.text.primary, fontSize: 18 });
