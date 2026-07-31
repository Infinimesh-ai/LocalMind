import { cssVar } from '@toeverything/theme';
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
  maxWidth: 1180,
  margin: '0 auto',
  padding: '44px 48px 96px',
  '@container': {
    'help-center (width <= 900px)': {
      padding: '32px 24px 72px',
    },
    'help-center (width <= 560px)': {
      padding: '24px 16px 64px',
    },
  },
});

export const headerTitle = style({
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  fontSize: 14,
  fontWeight: 600,
  color: cssVarV2.text.primary,
});

globalStyle(`${headerTitle} svg`, {
  width: 18,
  height: 18,
  color: cssVarV2.icon.primary,
});

export const headerSearch = style({
  width: 280,
  height: 32,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 8px',
  border: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  borderRadius: 4,
  background: cssVarV2.layer.background.secondary,
  color: cssVarV2.text.secondary,
  selectors: {
    '&:focus-within': {
      borderColor: cssVarV2('button/primary'),
    },
  },
  '@media': {
    'screen and (max-width: 700px)': {
      width: 190,
    },
  },
});

globalStyle(`${headerSearch} > svg`, {
  width: 16,
  height: 16,
  flexShrink: 0,
});

globalStyle(`${headerSearch} input`, {
  minWidth: 0,
  flex: 1,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: cssVarV2.text.primary,
  font: 'inherit',
});

globalStyle(`${headerSearch} input::placeholder`, {
  color: cssVarV2.text.tertiary,
});

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
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'space-between',
  gap: 32,
  paddingBottom: 32,
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  '@container': {
    'help-center (width <= 760px)': {
      alignItems: 'flex-start',
      flexDirection: 'column',
      gap: 20,
    },
  },
});

export const eyebrow = style({
  marginBottom: 10,
  color: cssVarV2.text.tertiary,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
  letterSpacing: 0,
});

globalStyle(`${intro} h1`, {
  margin: 0,
  color: cssVarV2.text.primary,
  fontSize: 32,
  fontWeight: 650,
  lineHeight: '40px',
  letterSpacing: 0,
});

globalStyle(`${intro} p`, {
  maxWidth: 660,
  margin: '10px 0 0',
  color: cssVarV2.text.secondary,
  fontSize: 15,
  lineHeight: '24px',
});

export const actions = style({
  display: 'flex',
  flexShrink: 0,
  gap: 8,
  '@container': {
    'help-center (width <= 560px)': {
      width: '100%',
      flexWrap: 'wrap',
    },
  },
});

export const snapshotAlert = style({
  display: 'grid',
  gridTemplateColumns: '24px minmax(0, 1fr)',
  gap: 12,
  margin: '28px 0 36px',
  padding: '16px 18px',
  borderLeft: `3px solid ${cssVar('warningColor')}`,
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  borderRight: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  borderRadius: 4,
  background: cssVarV2.layer.background.secondary,
  color: cssVarV2.text.primary,
});

globalStyle(`${snapshotAlert} > svg`, {
  width: 20,
  height: 20,
  marginTop: 1,
  color: cssVar('warningColor'),
});

globalStyle(`${snapshotAlert} strong`, {
  fontSize: 14,
  lineHeight: '22px',
});

globalStyle(`${snapshotAlert} p`, {
  margin: '3px 0 0',
  color: cssVarV2.text.secondary,
  fontSize: 13,
  lineHeight: '21px',
});

export const layout = style({
  display: 'grid',
  gridTemplateColumns: '190px minmax(0, 1fr)',
  alignItems: 'start',
  gap: 56,
  '@container': {
    'help-center (width <= 840px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 28,
    },
  },
});

export const toc = style({
  position: 'sticky',
  top: 24,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  '@container': {
    'help-center (width <= 840px)': {
      position: 'static',
      display: 'grid',
      gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
      borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
      paddingBottom: 20,
    },
    'help-center (width <= 560px)': {
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    },
  },
});

export const tocLabel = style({
  padding: '0 8px 8px',
  color: cssVarV2.text.tertiary,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
  '@container': {
    'help-center (width <= 840px)': {
      gridColumn: '1 / -1',
      paddingLeft: 0,
    },
  },
});

globalStyle(`${toc} a`, {
  display: 'grid',
  gridTemplateColumns: '22px minmax(0, 1fr)',
  gap: 4,
  alignItems: 'center',
  minHeight: 32,
  padding: '5px 8px',
  borderRadius: 4,
  color: cssVarV2.text.secondary,
  fontSize: 13,
  lineHeight: '18px',
  textDecoration: 'none',
});

globalStyle(`${toc} a:hover`, {
  background: cssVarV2.layer.background.hoverOverlay,
  color: cssVarV2.text.primary,
});

globalStyle(`${toc} a span`, {
  color: cssVarV2.text.tertiary,
  fontSize: 10,
  fontVariantNumeric: 'tabular-nums',
});

export const embeddingButton = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 10,
  padding: '9px 8px',
  border: 0,
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  background: 'transparent',
  color: cssVarV2.text.secondary,
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 12,
  textAlign: 'left',
  '@container': {
    'help-center (width <= 840px)': {
      gridColumn: '1 / -1',
      marginTop: 8,
    },
  },
});

globalStyle(`${embeddingButton} > svg`, {
  width: 15,
  height: 15,
  flexShrink: 0,
});

globalStyle(`${embeddingButton}:hover`, {
  color: cssVarV2.text.primary,
});

export const content = style({
  minWidth: 0,
});

export const section = style({
  scrollMarginTop: 24,
  padding: '0 0 48px',
  marginBottom: 48,
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  selectors: {
    '&:last-child': {
      marginBottom: 0,
    },
  },
});

export const sectionHeading = style({
  display: 'grid',
  gridTemplateColumns: '36px minmax(0, 1fr)',
  gap: 12,
  marginBottom: 24,
});

globalStyle(`${sectionHeading} > span`, {
  color: cssVarV2.text.tertiary,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '28px',
  fontVariantNumeric: 'tabular-nums',
});

globalStyle(`${sectionHeading} h2`, {
  margin: 0,
  color: cssVarV2.text.primary,
  fontSize: 22,
  fontWeight: 620,
  lineHeight: '28px',
  letterSpacing: 0,
});

globalStyle(`${sectionHeading} p`, {
  margin: '5px 0 0',
  color: cssVarV2.text.secondary,
  fontSize: 13,
  lineHeight: '20px',
});

export const sectionContent = style({
  marginLeft: 48,
  color: cssVarV2.text.secondary,
  fontSize: 14,
  lineHeight: '22px',
  '@container': {
    'help-center (width <= 560px)': {
      marginLeft: 0,
    },
  },
});

globalStyle(`${sectionContent} h3`, {
  margin: 0,
  color: cssVarV2.text.primary,
  fontSize: 14,
  fontWeight: 600,
  lineHeight: '22px',
});

globalStyle(`${sectionContent} p`, {
  margin: '6px 0 0',
});

export const path = style({
  padding: '1px 4px',
  borderRadius: 3,
  background: cssVarV2.layer.background.hoverOverlay,
  color: cssVarV2.text.primary,
  fontFamily: 'var(--affine-font-mono-family)',
  fontSize: '0.92em',
});

export const stepGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '0 28px',
  '@container': {
    'help-center (width <= 620px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const step = style({
  display: 'grid',
  gridTemplateColumns: '34px minmax(0, 1fr)',
  gap: 10,
  minHeight: 92,
  padding: '16px 0',
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const stepNumber = style({
  color: cssVarV2.text.tertiary,
  fontSize: 11,
  fontVariantNumeric: 'tabular-nums',
});

export const stepTitle = style({
  color: cssVarV2.text.primary,
  fontSize: 14,
  fontWeight: 600,
});

export const stepDescription = style({
  margin: '4px 0 0',
  color: cssVarV2.text.secondary,
  fontSize: 13,
  lineHeight: '20px',
});

export const promptExample = style({
  marginTop: 20,
  padding: '14px 16px',
  borderLeft: `2px solid ${cssVarV2('button/primary')}`,
  background: cssVarV2.layer.background.secondary,
});

export const exampleLabel = style({
  marginBottom: 4,
  color: cssVarV2.text.tertiary,
  fontSize: 11,
  fontWeight: 600,
  lineHeight: '16px',
});

export const twoColumn = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 32,
  '@container': {
    'help-center (width <= 620px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const orderedList = style({
  margin: '6px 0 0',
  paddingLeft: 20,
});

globalStyle(`${orderedList} li + li`, {
  marginTop: 4,
});

export const featureRows = style({
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

globalStyle(`${featureRows} > div`, {
  display: 'grid',
  gridTemplateColumns: '150px minmax(0, 1fr)',
  gap: 24,
  padding: '16px 0',
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

globalStyle(`${featureRows} > div p`, {
  margin: 0,
});

export const tipLine = style({
  marginTop: 18,
  color: cssVarV2.text.secondary,
  fontSize: 13,
});

globalStyle(`${tipLine} strong`, {
  color: cssVarV2.text.primary,
});

export const definitionTable = style({
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const definitionHeader = style({
  display: 'grid',
  gridTemplateColumns: '160px minmax(0, 1.2fr) minmax(0, 1fr)',
  gap: 20,
  padding: '10px 0',
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  color: cssVarV2.text.tertiary,
  fontSize: 11,
  fontWeight: 600,
  '@container': {
    'help-center (width <= 680px)': {
      display: 'none',
    },
  },
});

export const definitionRow = style({
  display: 'grid',
  gridTemplateColumns: '160px minmax(0, 1.2fr) minmax(0, 1fr)',
  gap: 20,
  padding: '14px 0',
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
  '@container': {
    'help-center (width <= 680px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 4,
    },
  },
});

globalStyle(`${definitionRow} span:first-child`, {
  color: cssVarV2.text.primary,
  fontWeight: 600,
});

export const exampleColumns = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 32,
  marginTop: 24,
  '@container': {
    'help-center (width <= 620px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
});

export const securityLead = style({
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 1fr)',
  gap: 12,
  paddingBottom: 18,
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

globalStyle(`${securityLead} > svg`, {
  width: 20,
  height: 20,
  color: cssVarV2('status/success'),
});

globalStyle(`${securityLead} strong`, {
  color: cssVarV2.text.primary,
});

export const bulletList = style({
  margin: '18px 0 0',
  paddingLeft: 20,
});

globalStyle(`${bulletList} li + li`, {
  marginTop: 7,
});

export const faqList = style({
  borderTop: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

export const faqItem = style({
  borderBottom: `0.5px solid ${cssVarV2.layer.insideBorder.border}`,
});

globalStyle(`${faqItem} summary`, {
  position: 'relative',
  padding: '15px 30px 15px 0',
  color: cssVarV2.text.primary,
  cursor: 'pointer',
  fontWeight: 600,
  listStyle: 'none',
});

globalStyle(`${faqItem} summary::-webkit-details-marker`, {
  display: 'none',
});

globalStyle(`${faqItem} summary::after`, {
  content: '"+"',
  position: 'absolute',
  top: 14,
  right: 4,
  color: cssVarV2.text.tertiary,
  fontSize: 18,
  fontWeight: 400,
});

globalStyle(`${faqItem}[open] summary::after`, {
  content: '"−"',
});

globalStyle(`${faqItem} p`, {
  margin: '0 36px 16px 0',
  color: cssVarV2.text.secondary,
});

export const empty = style({
  display: 'flex',
  minHeight: 340,
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
});

globalStyle(`${empty} > svg`, {
  width: 24,
  height: 24,
  marginBottom: 12,
  color: cssVarV2.icon.secondary,
});

globalStyle(`${empty} h2`, {
  margin: 0,
  color: cssVarV2.text.primary,
  fontSize: 18,
  fontWeight: 600,
  lineHeight: '26px',
});

globalStyle(`${empty} p`, {
  margin: '6px 0 16px',
  color: cssVarV2.text.secondary,
  fontSize: 13,
});
