import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import {
  assignVars,
  createThemeContract,
  globalStyle,
  style,
} from '@vanilla-extract/css';

const palette = createThemeContract({
  surface: null,
  hover: null,
  border: null,
  text: null,
  muted: null,
  focus: null,
  danger: null,
  dangerSurface: null,
  shadow: null,
});

export const container = style({
  height:
    'min(480px, var(--radix-dropdown-menu-content-available-height, 70dvh))',
  maxHeight: 'calc(100dvh - 32px)',
  width: '384px',
  maxWidth: 'calc(100vw - 32px)',
  display: 'flex',
  flexDirection: 'column',
  color: palette.text,
  vars: assignVars(palette, {
    surface: '#f5f6f7',
    hover: '#eceeef',
    border: 'rgba(91, 103, 114, 0.14)',
    text: '#20262c',
    muted: '#59636d',
    focus: '#2588dc',
    danger: '#b7372e',
    dangerSurface: '#fff0ee',
    shadow:
      '0 1px 2px rgba(82, 92, 102, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.72)',
  }),

  selectors: {
    '&[data-mobile]': {
      width: '100%',
    },
    '[data-theme="dark"] &': {
      vars: assignVars(palette, {
        surface: '#292e34',
        hover: '#353c44',
        border: 'rgba(175, 188, 202, 0.2)',
        text: '#eef0f3',
        muted: '#aeb8c4',
        focus: '#72b8f1',
        danger: '#ffaaa3',
        dangerSurface: '#472e30',
        shadow:
          '0 1px 2px rgba(0, 0, 0, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      }),
    },
  },
});

export const header = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '8px',
  flexShrink: 0,
  fontSize: cssVar('fontSm'),
  lineHeight: '22px',
  padding: '8px 10px 12px',
  borderBottom: `1px solid ${palette.border}`,
});

export const headerTitle = style({ fontSize: '16px', fontWeight: 600 });
export const filter = style({
  background: palette.surface,
  boxShadow: `inset 0 0 0 1px ${palette.border}`,
});
export const filterIndicator = style({ boxShadow: palette.shadow });
globalStyle(`${filter} [role="radio"]`, { color: palette.muted });
globalStyle(`${filter} [role="radio"][data-state="checked"]`, {
  color: palette.text,
});
globalStyle(`${filter} [role="radio"]:focus-visible`, {
  outline: `2px solid ${palette.focus}`,
  outlineOffset: '2px',
});

export const headerActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
});

export const accessDecision = style({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const scrollRoot = style({
  flex: 1,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
});

export const scrollViewport = style({
  flex: 1,
  padding: '4px 0',
  overflowAnchor: 'none',
});

export const itemList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
});

export const notificationListItem = style({
  display: 'flex',
  flexDirection: 'column',
  borderBottom: `1px solid ${palette.border}`,
  padding: '12px 10px',
  selectors: {
    '&:last-child': { borderBottom: 'none' },
    '&:focus-visible': {
      outline: `2px solid ${palette.focus}`,
      outlineOffset: '-2px',
      borderRadius: '8px',
    },
  },
});

export const itemContent = style({
  flex: 1,
  minWidth: 0,
});

export const itemActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  flexShrink: 0,
  gap: '6px',
  paddingTop: '6px',
});

export const confirmActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: '8px',
});

export const listEmpty = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2px',
  height: '184px',
  padding: '16px 45px',
});

export const listEmptyIconContainer = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '40px',
  height: '40px',
  marginBottom: '14px',
  borderRadius: '50%',
  backgroundColor: cssVarV2('layer/background/secondary'),
  color: cssVarV2('icon/primary'),
});

export const listEmptyTitle = style({
  color: cssVarV2('text/primary'),
  fontSize: '14px',
  lineHeight: '22px',
  textAlign: 'center',
});

export const listEmptyDescription = style({
  color: cssVarV2('text/secondary'),
  fontSize: '14px',
  lineHeight: '20px',
  textAlign: 'center',
});

export const error = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  color: cssVarV2('status/error'),
  fontSize: '14px',
  lineHeight: '22px',
  padding: '8px',
});

export const errorEmptyTitle = style({
  color: cssVarV2('status/error'),
  fontSize: '14px',
  lineHeight: '22px',
  textAlign: 'center',
});

export const itemContainer = style({
  display: 'flex',
  flexDirection: 'row',
  borderRadius: '10px',
  position: 'relative',
  padding: '0',
  gap: '8px',
  cursor: 'pointer',
  selectors: {
    '&[data-interactive="false"]': { cursor: 'default' },
    [`&:hover:not([data-disabled="true"],[data-interactive="false"],:has(button:hover))`]:
      {
        backgroundColor: cssVarV2('layer/background/hoverOverlay'),
      },
  },
});

export const itemSkeletonContainer = style({
  padding: '12px 10px',
});

export const itemCleanupButton = style({
  width: '34px',
  height: '34px',
  borderRadius: '10px',
  border: `1px solid ${palette.border}`,
  background: palette.surface,
  color: palette.muted,
  boxShadow: palette.shadow,
  selectors: {
    '&:hover:not(:disabled)': {
      background: palette.hover,
      color: palette.text,
    },
    '&:active:not(:disabled)': { boxShadow: 'none' },
    '&:focus-visible': {
      outline: `2px solid ${palette.focus}`,
      outlineOffset: '2px',
    },
    '&:disabled': { opacity: 0.45, boxShadow: 'none' },
    '&[data-danger="true"]:hover:not(:disabled)': {
      background: palette.dangerSurface,
      color: palette.danger,
    },
  },
  '@media': {
    '(hover: none)': {
      width: '44px',
      height: '44px',
    },
  },
});

export const itemMain = style({
  flex: 1,
  minWidth: 0,
  overflowWrap: 'anywhere',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: '14px',
  lineHeight: '22px',
});

export const workOrderTitle = style({
  fontSize: '14px',
  fontWeight: 600,
  lineHeight: '22px',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
});
export const workOrderSummary = style({
  display: 'flex',
  flexWrap: 'wrap',
  columnGap: '8px',
  fontSize: '12px',
  lineHeight: '20px',
  color: palette.muted,
});
export const workOrderFooter = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  marginTop: '6px',
});
globalStyle(`${workOrderFooter} ${itemActions}`, { paddingTop: 0 });
export const workOrderLink = style({
  height: '34px',
  padding: '0 8px',
  width: 'fit-content',
  flexShrink: 0,
  border: 'none',
  background: 'transparent',
  boxShadow: 'none',
  borderRadius: '8px',
  color: palette.text,
  fontSize: '12px',
  selectors: {
    '&:hover:not(:disabled)': { background: palette.surface },
    '&:focus-visible': {
      outline: `2px solid ${palette.focus}`,
      outlineOffset: '2px',
    },
  },
});
globalStyle(`${notificationListItem}[data-read="true"] ${workOrderTitle}`, {
  color: palette.muted,
  fontWeight: 500,
});

export const accessRequestMain = style([
  itemMain,
  { minWidth: 0, overflowWrap: 'anywhere' },
]);

export const itemDate = style({
  color: cssVarV2('text/secondary'),
  fontSize: '12px',
  lineHeight: '20px',
});

export const itemNotSupported = style({
  color: cssVarV2('text/placeholder'),
  fontSize: '12px',
  lineHeight: '22px',
});

export const itemNameLabel = style({
  fontWeight: '500',
  color: cssVarV2('text/primary'),
  display: 'inline',
  verticalAlign: 'top',
  selectors: {
    [`&[data-inactived="true"]`]: {
      color: cssVarV2('text/placeholder'),
    },
  },
});

export const itemActionButton = style({
  width: 'fit-content',
  borderRadius: '4px',
});

export const itemNameLabelIcon = style({
  verticalAlign: 'top',
  marginRight: '4px',
  color: cssVarV2('icon/primary'),
});

export const loadMoreIndicator = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '24px',
  color: cssVarV2('text/secondary'),
});
