import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';
export const root = style({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
});
export const toolbar = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  padding: '8px 24px',
  color: cssVarV2('text/primary'),
  flexShrink: 0,
});
export const selectionToolbar = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginInlineStart: 'auto',
  flexShrink: 0,
  whiteSpace: 'nowrap',
});
export const tagDialog = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  minWidth: 0,
});
export const tagDialogActions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
});
globalStyle(
  `${root}[data-select-mode="false"] [data-testid="doc-list-item-select"]`,
  { display: 'none' }
);
globalStyle(
  `${root}[data-select-mode="false"] [data-resource-group-select="true"]`,
  { display: 'none' }
);
export const results = style({
  flex: 1,
  minHeight: 0,
  position: 'relative',
  containerName: 'resource-results',
  containerType: 'inline-size',
});
export const name = style({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  height: '100%',
  minWidth: 0,
  padding: '0 4px',
  borderRadius: 4,
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
  },
});
export const card = style([
  row,
  {
    flexDirection: 'column',
    alignItems: 'stretch',
    padding: 16,
    border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  },
]);
export const open = style({
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
  textAlign: 'left',
  border: 0,
  padding: '8px 0',
  selectors: {
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 2,
    },
  },
});
export const metadata = style({
  fontSize: 12,
  color: cssVarV2('text/secondary'),
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
});
export const editorBody = style({
  padding: 24,
  overflow: 'auto',
  height: '100%',
});
export const typeFilter = style({
  minWidth: 144,
  height: 32,
  fontSize: 14,
  selectors: {
    '&[data-state="open"]': {
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});
export const typeMenu = style({
  minWidth: 208,
  maxWidth: 'calc(100vw - 32px)',
});
export const typeMenuItem = style({
  minHeight: 32,
  selectors: {
    '&[aria-checked="true"]': {
      backgroundColor: cssVarV2('layer/background/hoverOverlay'),
    },
  },
});
