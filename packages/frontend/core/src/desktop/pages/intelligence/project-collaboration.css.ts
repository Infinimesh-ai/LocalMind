import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 20,
  padding: '4px 0 0',
  letterSpacing: 0,
});

export const section = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
});

export const sectionHeader = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
});

export const memberList = style({
  minWidth: 0,
  maxHeight: 280,
  overflowY: 'auto',
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const memberRow = style({
  minWidth: 0,
  minHeight: 52,
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 1fr) auto auto',
  alignItems: 'center',
  gap: 10,
  padding: '8px 0',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 560px)': {
      gridTemplateColumns: '28px minmax(0, 1fr) auto',
    },
  },
});

export const memberIdentity = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  fontSize: 12,
});

globalStyle(`${memberIdentity} > strong, ${memberIdentity} > span`, {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

globalStyle(`${memberIdentity} > span`, {
  color: cssVarV2('text/tertiary'),
});

export const role = style({
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  whiteSpace: 'nowrap',
});

export const memberActions = style({
  display: 'flex',
  gap: 6,
  '@media': {
    'screen and (max-width: 560px)': {
      gridColumn: '2 / -1',
      justifyContent: 'flex-end',
    },
  },
});

export const inviteRow = style({
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
});

export const footer = style({
  display: 'flex',
  justifyContent: 'flex-end',
  paddingTop: 4,
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});
