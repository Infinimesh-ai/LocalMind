import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: cssVarV2('layer/background/primary'),
});

export const header = style({
  minWidth: 0,
  minHeight: 44,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '0 10px 0 12px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

export const conversationIdentity = style({
  minWidth: 0,
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  overflow: 'hidden',
});

export const tabs = conversationIdentity;
globalStyle(`${conversationIdentity} strong`, {
  overflow: 'hidden',
  fontSize: 13,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
globalStyle(`${conversationIdentity} span`, {
  overflow: 'hidden',
  color: cssVarV2('text/secondary'),
  fontSize: 11,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const tools = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
});

export const content = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  contain: 'layout',
});

export const configuration = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  flexShrink: 0,
  gap: 8,
  padding: '8px 12px',
  fontSize: 13,
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});
