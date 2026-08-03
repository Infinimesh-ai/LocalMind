import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { style } from '@vanilla-extract/css';

export const privateBadge = style({
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  lineHeight: '18px',
  color: cssVarV2('status/success'),
  background: cssVarV2('layer/background/secondary'),
  whiteSpace: 'nowrap',
});

export const engineStatus = style({
  maxWidth: 320,
  overflow: 'hidden',
  color: cssVarV2('text/secondary'),
  fontSize: cssVar('fontXs'),
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const projectCreateArea = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  padding: '8px 0 16px',
  '@media': {
    'screen and (max-width: 700px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

export const projectCreateFields = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(140px, 0.7fr) minmax(180px, 1fr)',
  gap: 8,
  minWidth: 0,
  '@media': {
    'screen and (max-width: 700px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

export const projectCreateActions = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
});

export const projectList = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: 72,
});

export const projectRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 16,
  minHeight: 104,
  padding: '14px 0',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 760px)': {
      gridTemplateColumns: '1fr',
      alignItems: 'start',
    },
  },
});

export const projectMain = style({
  display: 'flex',
  minWidth: 0,
  flexDirection: 'column',
  gap: 8,
});

export const projectFields = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(120px, 0.7fr) minmax(180px, 1fr)',
  gap: 8,
  minWidth: 0,
  '@media': {
    'screen and (max-width: 640px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

export const projectMetadata = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  minWidth: 0,
});

export const projectActions = style({
  display: 'grid',
  gridTemplateColumns: '40px auto 20px 20px',
  alignItems: 'center',
  gap: 8,
});

export const documentNames = style({
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  minWidth: 0,
  overflow: 'hidden',
});

export const documentName = style({
  maxWidth: 120,
  overflow: 'hidden',
  padding: '1px 6px',
  borderRadius: 4,
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
  fontSize: 11,
  lineHeight: '18px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const documentMore = style({
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  whiteSpace: 'nowrap',
});

export const strategyList = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 6,
  minWidth: 260,
});

export const strategy = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  fontSize: cssVar('fontXs'),
});

export const strategyVersion = style({
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  color: cssVarV2('text/primary'),
});

export const strategyUsage = style({
  color: cssVarV2('text/secondary'),
  whiteSpace: 'nowrap',
});

const strategyStatus = style({
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  lineHeight: '18px',
});

export const activeStatus = style([
  strategyStatus,
  {
    color: cssVarV2('status/success'),
    background: cssVarV2('layer/background/secondary'),
  },
]);

export const archivedStatus = style([
  strategyStatus,
  {
    color: cssVarV2('text/secondary'),
    background: cssVarV2('layer/background/secondary'),
  },
]);

export const createArea = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '8px 0 16px',
});

export const createControls = style({
  display: 'grid',
  gridTemplateColumns: '132px 164px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 8,
  '@media': {
    'screen and (max-width: 800px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

export const createInputRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 32px',
  alignItems: 'center',
  gap: 8,
});

export const directiveControls = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(140px, 1fr) 132px 132px 96px',
  alignItems: 'center',
  gap: 8,
  '@media': {
    'screen and (max-width: 900px)': {
      gridTemplateColumns: '1fr 1fr',
    },
    'screen and (max-width: 560px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

export const directiveConditionControls = style({
  display: 'grid',
  gridTemplateColumns:
    'minmax(160px, 1fr) minmax(160px, 1fr) 148px 112px 112px',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  '@media': {
    'screen and (max-width: 1000px)': {
      gridTemplateColumns: '1fr 1fr',
    },
    'screen and (max-width: 560px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

export const compactInput = style({
  width: '100%',
  minWidth: 0,
  height: 32,
  boxSizing: 'border-box',
  padding: '4px 8px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 4,
  outline: 'none',
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
  fontFamily: 'inherit',
  fontSize: cssVar('fontSm'),
});

export const kindButton = style({
  width: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const targetButton = style([kindButton]);

export const projectButton = style([kindButton]);

export const filterBar = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 180px',
  alignItems: 'end',
  gap: 16,
  '@media': {
    'screen and (max-width: 800px)': {
      gridTemplateColumns: '1fr',
    },
  },
});

export const tabList = style({
  minWidth: 0,
  overflowX: 'auto',
});

export const searchInput = style({
  marginBottom: 4,
});

export const memoryList = style({
  display: 'flex',
  flexDirection: 'column',
  minHeight: 120,
});

export const memoryRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 16,
  minHeight: 94,
  padding: '14px 0',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 700px)': {
      gridTemplateColumns: '1fr',
      alignItems: 'start',
    },
  },
});

export const disabledRow = style({
  opacity: 0.58,
});

export const memoryMain = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
});

export const memoryInput = style({
  display: 'block',
  width: '100%',
  minHeight: 52,
  maxHeight: 160,
  resize: 'vertical',
  boxSizing: 'border-box',
  padding: '8px 10px',
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 4,
  outline: 'none',
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
  fontFamily: 'inherit',
  fontSize: cssVar('fontSm'),
  lineHeight: 1.45,
  selectors: {
    '&:focus': {
      borderColor: cssVarV2('button/primary'),
    },
    '&:disabled': {
      cursor: 'not-allowed',
    },
  },
});

export const metadata = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 6,
  minWidth: 0,
});

export const tag = style({
  padding: '1px 6px',
  borderRadius: 4,
  fontSize: 11,
  lineHeight: '18px',
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
});

export const projectTag = style([
  tag,
  {
    minWidth: 0,
    maxWidth: 180,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
]);

export const updatedAt = style({
  marginLeft: 'auto',
  fontSize: 11,
  color: cssVarV2('text/secondary'),
  whiteSpace: 'nowrap',
});

export const actions = style({
  display: 'grid',
  gridTemplateColumns: '40px 20px 20px',
  alignItems: 'center',
  gap: 8,
});

export const directiveActions = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 8,
});

export const eventRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 12,
  minHeight: 52,
  padding: '8px 0',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const loading = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 120,
});

export const empty = style({
  padding: '36px 12px',
  textAlign: 'center',
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/secondary'),
});

export const errorState = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 16,
  padding: '16px 0',
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const errorTitle = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const errorDescription = style({
  marginTop: 4,
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
});
