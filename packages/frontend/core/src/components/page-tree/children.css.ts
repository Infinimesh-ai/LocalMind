import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

export const section = style({
  width: 'calc(100% - 64px)',
  maxWidth: 800,
  margin: '24px auto 64px',
  color: cssVar('textPrimaryColor'),
  '@media': { '(max-width: 600px)': { width: 'calc(100% - 32px)' } },
});
export const header = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  borderBottom: `1px solid ${cssVar('borderColor')}`,
  paddingBottom: 8,
});
export const heading = style({
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  flex: 1,
});
export const breadcrumbs = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 4,
  alignItems: 'center',
  padding: '8px 24px',
  fontSize: 13,
  color: cssVar('textSecondaryColor'),
});

export const folderBody = style({
  width: '100%',
  minWidth: 0,
  overflow: 'auto',
});
