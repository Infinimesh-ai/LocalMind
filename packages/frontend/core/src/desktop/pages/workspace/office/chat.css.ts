import { cssVar } from '@toeverything/theme';
import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  color: cssVarV2('text/primary'),
  background: cssVarV2('layer/background/primary'),
  userSelect: 'text',
});

export const header = style({
  minHeight: 40,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const title = style({
  flexShrink: 0,
  fontSize: 14,
  fontWeight: 600,
});

export const tabs = style({
  minWidth: 0,
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  overflow: 'hidden',
});

export const context = style({
  display: 'grid',
  gap: 6,
  padding: '8px 12px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/secondary'),
});

export const contextChips = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 5,
});

export const contextChip = style({
  minWidth: 0,
  maxWidth: '100%',
  height: 24,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '0 7px',
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 4,
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/primary'),
  fontSize: 11,
  lineHeight: '22px',
});

globalStyle(`${contextChip} > span`, {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

globalStyle(`${contextChip} > svg`, {
  width: 14,
  height: 14,
  flexShrink: 0,
});

export const selectionChip = style([
  contextChip,
  {
    color: cssVarV2('text/primary'),
    borderColor: cssVarV2('button/primary'),
  },
]);

export const clearSelection = style({
  width: 18,
  height: 18,
  flexShrink: 0,
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: 0,
  borderRadius: 3,
  color: 'inherit',
  background: 'transparent',
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&:focus-visible': { outline: `2px solid ${cssVarV2('button/primary')}` },
  },
});

globalStyle(`${clearSelection} > svg`, {
  width: 12,
  height: 12,
});

export const contextNotice = style({
  fontSize: 11,
  lineHeight: '16px',
  color: cssVarV2('text/tertiary'),
});

export const pdfBoundary = style({
  paddingLeft: 7,
  borderLeft: `2px solid ${cssVar('warningColor')}`,
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  lineHeight: '16px',
});

export const taskRegion = style({
  minHeight: 0,
  maxHeight: 276,
  display: 'flex',
  flexDirection: 'column',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const taskHeader = style({
  minHeight: 32,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  padding: '5px 12px',
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  fontWeight: 600,
});

export const taskList = style({
  minHeight: 0,
  overflowY: 'auto',
});

export const task = style({
  display: 'grid',
  gap: 6,
  padding: '8px 12px',
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const taskTopline = style({
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});

export const taskTitle = style({
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 12,
  fontWeight: 600,
});

export const taskStatus = style({
  flexShrink: 0,
  padding: '1px 5px',
  borderRadius: 4,
  color: cssVarV2('text/secondary'),
  background: cssVarV2('layer/background/secondary'),
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'capitalize',
  selectors: {
    '&[data-status="waiting"]': {
      color: cssVar('warningColor'),
    },
    '&[data-status="queued"]': {
      color: cssVarV2('button/primary'),
    },
    '&[data-status="running"]': {
      color: cssVarV2('button/primary'),
    },
    '&[data-status="completed"]': {
      color: cssVarV2('status/success'),
    },
    '&[data-status="rejected"]': {
      color: cssVarV2('text/tertiary'),
    },
    '&[data-status="cancelled"]': {
      color: cssVarV2('text/tertiary'),
    },
    '&[data-status="conflict"]': {
      color: cssVar('warningColor'),
    },
    '&[data-status="failed"]': {
      color: cssVarV2('status/error'),
    },
  },
});

export const taskMeta = style({
  minWidth: 0,
  display: 'flex',
  flexWrap: 'wrap',
  gap: '3px 10px',
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  lineHeight: '16px',
});

globalStyle(`${taskMeta} > span`, {
  minWidth: 0,
  overflowWrap: 'anywhere',
});

export const taskReason = style({
  margin: 0,
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  lineHeight: '16px',
  overflowWrap: 'anywhere',
});

export const taskError = style({
  margin: 0,
  color: cssVarV2('status/error'),
  fontSize: 11,
  lineHeight: '16px',
  overflowWrap: 'anywhere',
});

export const taskActions = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  flexWrap: 'wrap',
  gap: 6,
});

export const taskState = style({
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '8px 12px',
  color: cssVarV2('text/tertiary'),
  fontSize: 11,
  borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const content = style({
  width: '100%',
  minHeight: 0,
  height: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
});

globalStyle(`${content} > ai-chat-content`, {
  width: '100%',
  minHeight: 0,
  height: 0,
  flex: 1,
});

export const loading = style({
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
});
