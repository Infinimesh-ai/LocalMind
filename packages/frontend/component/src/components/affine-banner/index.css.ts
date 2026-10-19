import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

// LocalMind workspace shell (core `components/localmind-theme`): this package
// cannot import core, so the workbench variables are referenced by name.
const localmindShell = '[data-localmind-shell="true"] &';
const wb = (name: string) => `var(--localmind-workbench-${name})`;
export const browserWarningStyle = style({
  backgroundColor: cssVar('backgroundWarningColor'),
  color: cssVar('warningColor'),
  width: '100%',
  padding: '8px 16px',
  fontSize: cssVar('fontSm'),
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  position: 'relative',
  flexShrink: 0,
  zIndex: 1,
});
export const closeButtonStyle = style({
  width: '36px',
  height: '36px',
  color: cssVar('iconColor'),
  cursor: 'pointer',
  display: 'flex',
  justifyContent: 'flex-end',
  alignItems: 'center',
  position: 'absolute',
  right: '16px',
});
export const closeIconStyle = style({
  width: '15px',
  height: '15px',
  position: 'relative',
  zIndex: 1,
});
export const tipsContainer = style({
  backgroundColor: cssVar('backgroundErrorColor'),
  color: cssVar('errorColor'),
  width: '100%',
  fontSize: cssVar('fontSm'),
  fontWeight: '700',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '12px 16px',
  position: 'relative',
  flexShrink: 0,
  zIndex: 1,
  gap: '16px',
  containerType: 'inline-size',
  '@media': {
    'screen and (max-width: 520px)': {
      flexWrap: 'wrap',
    },
  },
  selectors: {
    [localmindShell]: {
      padding: '10px 18px 10px 24px',
      borderBottom: `1px solid ${wb('warningLine')}`,
      backgroundColor: wb('warningSoft'),
      color: wb('warning'),
      fontSize: 13,
      fontWeight: 560,
    },
  },
});
export const tipsMessage = style({
  color: cssVar('errorColor'),
  flexGrow: 1,
  flexShrink: 1,
  selectors: { [localmindShell]: { color: 'inherit' } },
});
export const tipsRightItem = style({
  display: 'flex',
  flexShrink: 0,
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  '@media': {
    'screen and (max-width: 520px)': {
      width: '100%',
    },
  },
});
