import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const stack = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
});

export const panel = style({
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
  overflow: 'hidden',
  background: cssVarV2('layer/background/primary'),
});

export const panelHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 16px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    '(max-width: 600px)': {
      alignItems: 'stretch',
      flexDirection: 'column',
      padding: 12,
    },
  },
});

export const title = style({
  fontSize: cssVar('fontSm'),
  fontWeight: 600,
  color: cssVarV2('text/primary'),
});

export const description = style({
  fontSize: cssVar('fontXs'),
  lineHeight: '20px',
  color: cssVarV2('text/secondary'),
  overflowWrap: 'anywhere',
});

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 16,
  '@media': { '(max-width: 600px)': { padding: 12 } },
});

export const form = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 12,
  '@media': {
    '(max-width: 600px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});

export const fullWidth = style({ gridColumn: '1 / -1' });

export const field = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
});

export const fixedValue = style({
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  padding: '7px 10px',
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  overflowWrap: 'anywhere',
});

export const actions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 8,
});

globalStyle(`${actions} > button`, {
  '@media': { '(max-width: 520px)': { minWidth: 0, flex: 1 } },
});

export const metaGrid = style({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '10px 18px',
  '@media': {
    '(max-width: 600px)': { gridTemplateColumns: 'minmax(0, 1fr)' },
  },
});

export const meta = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
});

export const metaLabel = style({
  fontSize: cssVar('fontXs'),
  color: cssVarV2('text/secondary'),
});

export const metaValue = style({
  fontSize: cssVar('fontSm'),
  color: cssVarV2('text/primary'),
  overflowWrap: 'anywhere',
});

export const status = style({
  display: 'inline-flex',
  width: 'fit-content',
  padding: '2px 8px',
  borderRadius: 999,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontXs'),
});

export const error = style({
  padding: 10,
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontSize: cssVar('fontXs'),
  overflowWrap: 'anywhere',
});

export const tools = style({ display: 'flex', flexDirection: 'column' });

export const tool = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 12,
  padding: '10px 16px',
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  selectors: { '&:last-child': { borderBottom: 0 } },
  '@media': {
    '(max-width: 600px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      padding: 12,
    },
  },
});

export const empty = style({
  padding: 24,
  textAlign: 'center',
  color: cssVarV2('text/secondary'),
  fontSize: cssVar('fontSm'),
});

export const testResult = style({
  maxHeight: 220,
  margin: 0,
  padding: 12,
  overflow: 'auto',
  borderRadius: 8,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/primary'),
  fontFamily: cssVar('fontMonoFamily'),
  fontSize: cssVar('fontXs'),
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});
