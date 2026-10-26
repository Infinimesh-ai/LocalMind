import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const container = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  width: '100%',
  padding: '8px 16px',
  backgroundColor: cssVar('backgroundWarningColor'),
  color: cssVar('warningColor'),
  fontSize: cssVar('fontSm'),
  flexShrink: 0,
});

export const message = style({
  flex: '1 1 320px',
  minWidth: 0,
  lineHeight: '22px',
});
