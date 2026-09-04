import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const header = style({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 8px',
});

export const headerTitle = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  color: cssVarV2('text/primary'),
  fontSize: 14,
  fontWeight: 600,
});

globalStyle(`${headerTitle} > svg`, {
  width: 18,
  height: 18,
  flexShrink: 0,
  color: cssVarV2('icon/primary'),
});

globalStyle(`${headerTitle} > span:first-of-type`, {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const revisionLabel = style({
  flexShrink: 0,
  padding: '1px 5px',
  borderRadius: 4,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  fontWeight: 500,
  fontVariantNumeric: 'tabular-nums',
});

export const headerActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
});

export const mobileRoot = style({
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: '44px minmax(0, 1fr)',
});

export const editorRoot = style({
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: '42px auto auto minmax(0, 1fr)',
  overflow: 'hidden',
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  '@media': {
    print: {
      display: 'block',
      height: 'auto',
      overflow: 'visible',
      background: '#ffffff',
    },
  },
});

export const toolbar = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 8px',
  overflowX: 'auto',
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  scrollbarWidth: 'thin',
  '@media': { print: { display: 'none' } },
});

globalStyle(`${toolbar} button[data-active="true"]`, {
  background: cssVarV2('layer/background/hoverOverlay'),
  color: cssVarV2('button/primary'),
});

export const select = style({
  width: 112,
  height: 28,
  flexShrink: 0,
  padding: '0 24px 0 8px',
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 4,
  outline: 0,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  fontSize: 12,
  selectors: {
    '&:focus-visible': {
      borderColor: cssVarV2('button/primary'),
      boxShadow: `0 0 0 1px ${cssVarV2('button/primary')}`,
    },
  },
});

export const fontSelect = style([select, { width: 134 }]);
export const sizeSelect = style([select, { width: 70 }]);

export const toolbarDivider = style({
  width: 1,
  height: 20,
  flexShrink: 0,
  margin: '0 3px',
  background: cssVarV2('layer/insideBorder/border'),
});

export const toolbarSpacer = style({ flex: 1, minWidth: 8 });

export const selectionStatus = style({
  flexShrink: 0,
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
});

export const colorControl = style({
  width: 28,
  height: 28,
  flexShrink: 0,
  position: 'relative',
  display: 'grid',
  placeItems: 'center',
  borderRadius: 4,
  cursor: 'pointer',
  color: cssVarV2('text/primary'),
  fontSize: 13,
  fontWeight: 700,
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&:focus-within': { outline: `2px solid ${cssVarV2('button/primary')}` },
  },
});

globalStyle(`${colorControl} input`, {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  padding: 0,
  border: 0,
  opacity: 0,
  cursor: 'pointer',
});

globalStyle(`${colorControl}::after`, {
  content: '',
  position: 'absolute',
  left: 6,
  right: 6,
  bottom: 4,
  height: 2,
  background: 'currentColor',
});

export const previewBar = style({
  minHeight: 38,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '5px 12px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/secondary'),
  fontSize: 12,
});

export const previewActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
});

export const errorBar = style({
  minHeight: 34,
  padding: '8px 12px',
  borderBottom: `0.5px solid ${cssVarV2('status/error')}`,
  background: cssVarV2('layer/background/error'),
  color: cssVarV2('status/error'),
  fontSize: 12,
});

export const dialogForm = style({
  width: '100%',
  minWidth: 0,
  display: 'grid',
  gap: 14,
  padding: '4px 0',
});

export const dialogField = style({
  minWidth: 0,
  display: 'grid',
  gap: 5,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
});

globalStyle(`${dialogField} > span`, {
  overflowWrap: 'anywhere',
});

export const dialogGrid = style({
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 10,
  '@media': {
    'screen and (max-width: 520px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const dialogGridThree = style({
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
  '@media': {
    'screen and (max-width: 620px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const dialogGridFour = style({
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
  gap: 8,
  '@media': {
    'screen and (max-width: 620px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
});

export const dialogCheck = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 7,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
});

globalStyle(`${dialogCheck} input`, {
  flexShrink: 0,
});

export const dialogSectionAction = style({
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  paddingTop: 12,
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 520px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const dialogError = style({
  minWidth: 0,
  padding: '8px 10px',
  border: `0.5px solid ${cssVarV2('status/error')}`,
  borderRadius: 4,
  color: cssVarV2('status/error'),
  background: cssVarV2('layer/background/error'),
  fontSize: 12,
  lineHeight: '18px',
  overflowWrap: 'anywhere',
});

export const dialogActions = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'flex-end',
  gap: 8,
  paddingTop: 2,
});

export const workspace = style({
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: '220px minmax(0, 1fr)',
  overflow: 'hidden',
  '@media': {
    'screen and (max-width: 820px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
    print: { display: 'block', overflow: 'visible' },
  },
});

export const navigation = style({
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  overflowY: 'auto',
  padding: '14px 10px',
  borderRight: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  '@media': { 'screen and (max-width: 820px)': { display: 'none' } },
});

export const navigationTitle = style({
  padding: '0 6px 10px',
  color: cssVarV2('text/primary'),
  fontSize: 12,
  fontWeight: 600,
});

export const headingList = style({
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  overflowY: 'auto',
});

globalStyle(`${headingList} a`, {
  minHeight: 28,
  display: 'flex',
  alignItems: 'center',
  padding: '4px 6px',
  overflow: 'hidden',
  borderRadius: 4,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
  textDecoration: 'none',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

globalStyle(`${headingList} a[data-level="1"]`, { paddingLeft: 16 });
globalStyle(`${headingList} a[data-level="2"]`, { paddingLeft: 26 });
globalStyle(`${headingList} a:hover`, {
  background: cssVarV2('layer/background/hoverOverlay'),
  color: cssVarV2('text/primary'),
});
globalStyle(`${headingList} a:focus-visible`, {
  outline: `2px solid ${cssVarV2('button/primary')}`,
  outlineOffset: -2,
});

export const navigationEmpty = style({
  padding: '8px 6px',
  color: cssVarV2('text/tertiary'),
  fontSize: 12,
});

export const navigationSectionTitle = style({
  marginTop: 14,
  padding: '8px 6px 6px',
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  color: cssVarV2('text/primary'),
  fontSize: 11,
  fontWeight: 600,
});

export const reviewSummary = style({
  display: 'grid',
  gap: 5,
  color: cssVarV2('text/secondary'),
  fontSize: 11,
});

export const reviewActions = style({
  display: 'flex',
  gap: 4,
  padding: '4px 6px 0',
});

export const notesSummary = style({
  display: 'grid',
  gap: 5,
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  lineHeight: '16px',
});

globalStyle(`${notesSummary} > span`, {
  display: '-webkit-box',
  padding: '0 6px',
  overflow: 'hidden',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
});

export const pageCount = style({
  marginTop: 'auto',
  padding: '12px 6px 0',
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
});

export const canvas = style({
  minWidth: 0,
  minHeight: 0,
  overflow: 'auto',
  padding: '28px max(20px, calc((100% - 900px) / 2)) 72px',
  outline: 0,
  background: cssVarV2('layer/background/secondary'),
  scrollBehavior: 'smooth',
  selectors: {
    '&:focus-visible': {
      boxShadow: `inset 0 0 0 2px ${cssVarV2('button/primary')}`,
    },
  },
  '@media': {
    'screen and (max-width: 620px)': { padding: '16px 10px 48px' },
    print: { overflow: 'visible', padding: 0, background: '#ffffff' },
  },
});

export const page = style({
  position: 'relative',
  width: 'min(var(--office-page-width), 100%)',
  minHeight: 'var(--office-page-height)',
  margin: '0 auto 24px',
  overflow: 'hidden',
  background: '#ffffff',
  color: '#1f2329',
  boxShadow:
    '0 2px 8px rgba(20, 24, 31, 0.14), 0 12px 28px rgba(20, 24, 31, 0.08)',
  selectors: {
    '&::selection': { background: '#b8d7ff' },
  },
  '@media': {
    print: {
      width: 'var(--office-page-width)',
      minHeight: 'var(--office-page-height)',
      margin: 0,
      boxShadow: 'none',
      breakAfter: 'page',
    },
  },
});

export const pageContent = style({
  minHeight: 'var(--office-page-height)',
  padding:
    'var(--office-margin-top) var(--office-margin-right) var(--office-margin-bottom) var(--office-margin-left)',
  fontFamily: 'Aptos, Calibri, Arial, sans-serif',
  fontSize: '11pt',
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
  userSelect: 'text',
});

export const pageHeader = style({
  position: 'absolute',
  top: 18,
  left: 'var(--office-margin-left)',
  right: 'var(--office-margin-right)',
  minHeight: 18,
  overflow: 'hidden',
  color: '#5f6875',
  fontFamily: 'Aptos, Calibri, Arial, sans-serif',
  fontSize: '9pt',
  lineHeight: 1.2,
  whiteSpace: 'pre-wrap',
});

export const pageFooter = style({
  position: 'absolute',
  left: 'var(--office-margin-left)',
  right: 'var(--office-margin-right)',
  bottom: 18,
  minHeight: 18,
  overflow: 'hidden',
  color: '#5f6875',
  fontFamily: 'Aptos, Calibri, Arial, sans-serif',
  fontSize: '9pt',
  lineHeight: 1.2,
  whiteSpace: 'pre-wrap',
});

globalStyle(`${pageContent} ::selection`, {
  background: '#b8d7ff',
  color: '#111827',
});

export const paragraph = style({
  minHeight: '1.2em',
  margin: '0 0 8pt',
  whiteSpace: 'pre-wrap',
  letterSpacing: 0,
  scrollMarginTop: 70,
  outline: 0,
  selectors: {
    '&:focus': {
      boxShadow: '0 1px 0 #8eb8ff',
    },
  },
});

export const inlineObject = style({
  display: 'inline-block',
  maxWidth: '100%',
  verticalAlign: 'middle',
});

globalStyle(`${inlineObject} img`, {
  display: 'block',
  maxWidth: '100%',
  height: 'auto',
  objectFit: 'contain',
});

export const inlineObjectPlaceholder = style({
  display: 'inline-flex',
  minWidth: 32,
  minHeight: 20,
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 2px',
  padding: '1px 4px',
  border: '0.75pt solid #9aa3af',
  color: '#5f6875',
  background: '#f3f4f6',
  fontSize: '8pt',
  verticalAlign: 'middle',
});

globalStyle(`${paragraph}[data-outline-level="0"]`, {
  marginTop: '14pt',
  marginBottom: '6pt',
  fontSize: '18pt',
  lineHeight: 1.22,
  fontWeight: 650,
});

globalStyle(`${paragraph}[data-outline-level="1"]`, {
  marginTop: '12pt',
  marginBottom: '5pt',
  fontSize: '14pt',
  lineHeight: 1.25,
  fontWeight: 650,
});

globalStyle(`${paragraph} span[data-change="inserted"]`, {
  textDecoration: 'underline',
  textDecorationColor: '#16803c',
});

globalStyle(`${paragraph} span[data-change="deleted"]`, {
  color: '#b42318',
  textDecoration: 'line-through',
});

export const table = style({
  width: '100%',
  margin: '8pt 0 12pt',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
});

globalStyle(`${table} td`, {
  minWidth: 0,
  padding: '5pt 6pt',
  verticalAlign: 'top',
  border: '0.75pt solid #aeb4bd',
});

globalStyle(`${table} ${paragraph}`, { marginBottom: '3pt' });

export const contentControl = style({
  position: 'relative',
  margin: '3pt 0',
  outline: '1px dotted #7a8696',
  outlineOffset: 2,
});

export const unsupportedBlock = style({
  margin: '8pt 0',
  padding: '8pt',
  border: '1px dashed #aeb4bd',
  color: '#5e6673',
  fontSize: '9pt',
});

export const pageNumber = style({
  position: 'absolute',
  right: 18,
  bottom: 12,
  color: '#7a828d',
  fontSize: '8pt',
  fontVariantNumeric: 'tabular-nums',
});

export const centerState = style({
  width: '100%',
  height: '100%',
  minHeight: 260,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  padding: 24,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

globalStyle(`${centerState} strong`, {
  color: cssVarV2('text/primary'),
  fontSize: 15,
});

globalStyle(`${centerState} span`, {
  maxWidth: '60ch',
  fontSize: 13,
  lineHeight: '20px',
});
