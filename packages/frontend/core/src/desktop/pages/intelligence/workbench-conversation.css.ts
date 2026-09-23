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
  minHeight: 108,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16,
  padding: '32px 32px 20px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 760px)': {
      minHeight: 76,
      padding: '20px 16px 14px',
    },
  },
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
  fontSize: 25,
  fontWeight: 640,
  letterSpacing: '-0.035em',
  lineHeight: '31px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
globalStyle(`${conversationIdentity} span`, {
  overflow: 'hidden',
  marginTop: 7,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const tools = style({
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const content = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  contain: 'layout',
  background: cssVarV2('layer/background/primary'),
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

globalStyle(`${root} .chat-panel-main`, {
  maxWidth: 'none',
  padding: '24px 32px 0',
  '@media': {
    'screen and (max-width: 760px)': { padding: '12px 16px 0' },
  },
});
globalStyle(`${root} ai-chat-messages`, {
  width: 'min(100%, 900px)',
  margin: '0 auto',
});
globalStyle(`${root} ai-chat-composer`, {
  width: 'min(100%, 680px)',
  margin: '0 auto',
  padding: '0 0 16px',
});
globalStyle(`${root} .chat-panel-input[data-independent-mode="true"]`, {
  minHeight: 82,
  padding: '12px 13px 10px',
  borderRadius: 11,
  boxShadow: `0 14px 36px rgba(25, 29, 34, 0.1), inset 0 0 0 1px ${cssVarV2('layer/insideBorder/border')}`,
});
