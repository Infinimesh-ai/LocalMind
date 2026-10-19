import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const body = style({
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  height: '100%',
  width: '100%',
  containerName: 'docs-body',
  containerType: 'size',
});

export const list = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const createTips = style({
  color: cssVar('textSecondaryColor'),
  fontSize: 12,
  lineHeight: '20px',
});
