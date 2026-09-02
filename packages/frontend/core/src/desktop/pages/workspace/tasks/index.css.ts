import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const header = style({
  width: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
});

export const filters = style({
  display: 'flex',
  minWidth: 0,
});

export const root = style({
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(280px, 36%) minmax(0, 1fr)',
  background: cssVarV2('layer/background/primary'),
  '@media': {
    'screen and (max-width: 760px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      gridTemplateRows: 'minmax(220px, 40%) minmax(0, 1fr)',
    },
  },
});

export const listPane = style({
  minWidth: 0,
  minHeight: 0,
  overflowY: 'auto',
  borderRight: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 760px)': {
      borderRight: 0,
      borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});

export const detailPane = style({
  minWidth: 0,
  minHeight: 0,
  overflowY: 'auto',
});

export const centerState = style({
  width: '100%',
  minHeight: 180,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});

export const errorText = style({
  color: cssVarV2('status/error'),
});

export const taskRow = style({
  width: '100%',
  minHeight: 76,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  justifyContent: 'center',
  gap: 8,
  padding: '14px 16px',
  border: 0,
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: 'transparent',
  color: cssVarV2('text/primary'),
  textAlign: 'left',
  cursor: 'pointer',
  selectors: {
    '&:hover': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&[data-selected="true"]': {
      background: cssVarV2('layer/background/secondary'),
    },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: -2,
    },
  },
});

export const taskRowTopline = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  minWidth: 0,
});

export const taskTitle = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 14,
  fontWeight: 600,
});

export const taskMeta = style({
  fontSize: 12,
  color: cssVarV2('text/tertiary'),
});

export const status = style({
  flexShrink: 0,
  maxWidth: '100%',
  padding: '2px 6px',
  borderRadius: 4,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
  selectors: {
    '&[data-status="running"]': {
      color: cssVarV2('button/primary'),
    },
    '&[data-status="waiting_approval"]': {
      color: cssVarV2('text/link'),
    },
    '&[data-status="completed"]': {
      color: cssVarV2('status/success'),
    },
    '&[data-status="failed"]': {
      color: cssVarV2('status/error'),
      background: cssVarV2('layer/background/error'),
    },
  },
});

export const detailContent = style({
  width: '100%',
  maxWidth: 760,
  margin: '0 auto',
  padding: '28px clamp(20px, 5vw, 56px) 48px',
});

export const detailHeader = style({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 20,
  paddingBottom: 24,
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 560px)': {
      flexDirection: 'column',
    },
  },
});

export const detailHeading = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 10,
});

export const detailTitle = style({
  maxWidth: '100%',
  margin: 0,
  overflowWrap: 'anywhere',
  color: cssVarV2('text/primary'),
  fontSize: 24,
  lineHeight: '32px',
  fontWeight: 600,
  letterSpacing: 0,
});

export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  flexShrink: 0,
});

export const metadata = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 20,
  margin: 0,
  padding: '20px 0',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const metadataLabel = style({
  marginBottom: 4,
  color: cssVarV2('text/tertiary'),
  fontSize: 12,
});

export const metadataValue = style({
  margin: 0,
  overflowWrap: 'anywhere',
  color: cssVarV2('text/primary'),
  fontSize: 13,
});

export const detailSection = style({
  paddingTop: 24,
  color: cssVarV2('text/primary'),
});

export const detailSectionTitle = style({
  margin: '0 0 12px',
  fontSize: 14,
  lineHeight: '20px',
  fontWeight: 600,
  letterSpacing: 0,
});

export const detailSectionText = style({
  margin: 0,
  overflowWrap: 'anywhere',
  color: cssVarV2('text/secondary'),
  fontSize: 13,
  lineHeight: '20px',
  selectors: {
    '&[data-failure="true"]': {
      color: cssVarV2('status/error'),
    },
  },
});

export const steps = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
  margin: 0,
  padding: 0,
  listStyle: 'none',
});

export const step = style({
  position: 'relative',
  display: 'grid',
  gridTemplateColumns: '16px minmax(0, 1fr)',
  gap: 12,
  minHeight: 54,
  paddingBottom: 16,
  selectors: {
    '&:not(:last-child)::after': {
      content: '',
      position: 'absolute',
      top: 16,
      bottom: 0,
      left: 7,
      width: 1,
      background: cssVarV2('layer/insideBorder/border'),
    },
  },
});

export const stepMarker = style({
  position: 'relative',
  zIndex: 1,
  width: 16,
  height: 16,
  borderRadius: '50%',
  border: `2px solid ${cssVarV2('text/tertiary')}`,
  background: cssVarV2('layer/background/primary'),
  selectors: {
    '&[data-status="running"]': {
      borderColor: cssVarV2('button/primary'),
    },
    '&[data-status="waiting_approval"]': {
      borderColor: cssVarV2('text/link'),
    },
    '&[data-status="completed"]': {
      borderColor: cssVarV2('status/success'),
      background: cssVarV2('status/success'),
    },
    '&[data-status="failed"]': {
      borderColor: cssVarV2('status/error'),
      background: cssVarV2('status/error'),
    },
    '&[data-status="skipped"]': {
      borderColor: cssVarV2('text/disable'),
    },
  },
});

export const stepContent = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
});

export const stepTitle = style({
  overflowWrap: 'anywhere',
  color: cssVarV2('text/primary'),
  fontSize: 13,
  lineHeight: '18px',
  fontWeight: 500,
});

export const stepStatus = style({
  color: cssVarV2('text/tertiary'),
  fontSize: 12,
  lineHeight: '18px',
});
