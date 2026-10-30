import { cssVarV2 } from '@toeverything/theme/v2';
import { createVar, globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './workbench-tokens.css';

export const youLabelVar = createVar();
export const headerHeightVar = createVar();
export const composerHeightVar = createVar();
export const footerHeightVar = createVar();

const compactChat = 'chat-panel-split-view (max-width: 640px)';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  background: wb.panel,
});

export const floatingHeaderRoot = style([
  root,
  {
    position: 'relative',
    vars: {
      [headerHeightVar]: '0px',
      [composerHeightVar]: '0px',
      [footerHeightVar]: '0px',
    },
  },
]);

export const headerOverlay = style({
  position: 'absolute',
  inset: '0 0 auto',
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  pointerEvents: 'none',
});
globalStyle(`${headerOverlay} > *`, { pointerEvents: 'auto' });

// v10 title card: the conversation identity floats above the stream.
export const header = style({
  minWidth: 0,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  rowGap: 10,
  columnGap: 24,
  width: 'min(calc(100% - 56px), 960px)',
  margin: '20px auto 0',
  padding: '18px 18px 19px 22px',
  border: `1px solid ${wb.line}`,
  borderRadius: 18,
  background: wb.paper,
  boxShadow: '0 1px 2px rgba(75, 84, 93, 0.05)',
  boxSizing: 'border-box',
  transition: 'transform 180ms ease-out, opacity 180ms ease-out',
  selectors: {
    '&[data-hidden="true"]': {
      transform: 'translateY(-16px)',
      opacity: 0,
      pointerEvents: 'none',
    },
    '&:focus-within': {
      transform: 'none',
      opacity: 1,
      pointerEvents: 'auto',
      transition: 'none',
    },
  },
  '@media': {
    '(prefers-reduced-motion: reduce)': { transition: 'none' },
    'screen and (max-width: 760px)': {
      width: 'calc(100% - 24px)',
      margin: '12px auto 0',
      padding: '14px',
    },
  },
});
export const status = style({
  flexShrink: 0,
  padding: '5px 9px',
  borderRadius: 8,
  background: wb.signalSoft,
  color: wb.signal,
  fontSize: 11.5,
  fontWeight: 560,
  whiteSpace: 'nowrap',
  selectors: {
    '&[data-column="todo"]': {
      background: wb.warningSoft,
      color: wb.warning,
    },
    '&[data-column="done"]': {
      background: wb.successSoft,
      color: wb.success,
    },
  },
});

export const conversationIdentity = style({
  minWidth: 0,
  flex: '1 1 220px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  overflow: 'hidden',
});

export const tabs = conversationIdentity;
globalStyle(`${conversationIdentity} strong`, {
  overflow: 'hidden',
  fontSize: 24,
  fontWeight: 650,
  letterSpacing: '-0.035em',
  lineHeight: '30px',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
globalStyle(`${conversationIdentity} span`, {
  overflow: 'hidden',
  marginTop: 6,
  color: wb.ink3,
  fontSize: 12,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const tools = style({
  flexShrink: 0,
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});

export const content = style({
  minWidth: 0,
  minHeight: 0,
  flex: 1,
  contain: 'layout',
  background: wb.panel,
});

export const configuration = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  flexShrink: 0,
  gap: 8,
  padding: '8px 12px',
  fontSize: 13,
  borderBottom: `1px solid ${wb.line}`,
});
globalStyle(`${headerOverlay} > ${configuration}`, {
  background: wb.paper,
});

export const deliveryCard = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 12,
  margin: '16px 32px 0',
  padding: 16,
  border: `1px solid ${wb.line}`,
  borderRadius: 12,
  background: wb.panel,
  '@media': {
    'screen and (max-width: 760px)': { margin: '12px 16px 0' },
  },
});

export const deliveryCardHeader = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
});

export const deliveryCardList = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: 0,
  paddingLeft: 20,
});
globalStyle(`${deliveryCardList} li`, { lineHeight: 1.5 });
globalStyle(`${deliveryCardList} li strong`, { marginRight: 8 });
globalStyle(`${deliveryCardList} li span, ${deliveryCardList} li a`, {
  marginRight: 8,
});

export const deliveryCardError = style({
  margin: 0,
  color: wb.danger,
});

globalStyle(`${root} .chat-panel-main`, {
  maxWidth: 'none',
  padding: '24px 28px 0',
  minWidth: 0,
  boxSizing: 'border-box',
  '@container': {
    [compactChat]: { padding: '12px 12px 0' },
  },
});
globalStyle(`${root} ai-chat-messages`, {
  width: 'min(100%, 960px)',
  margin: '0 auto',
  padding: 0,
  minWidth: 0,
});
globalStyle(`${root} .chat-panel-messages-container`, {
  gap: 24,
  paddingBottom: 24,
});

// Reserve the title's height inside the scrolling stream, so its surrounding
// space reveals messages as they pass behind the opaque title card.
globalStyle(`${floatingHeaderRoot} .chat-panel-main`, {
  position: 'relative',
  paddingTop: 0,
});
globalStyle(`${floatingHeaderRoot} ai-chat-messages`, {
  scrollPaddingTop: `calc(${headerHeightVar} + 24px)`,
});
globalStyle(`${floatingHeaderRoot} .chat-panel-messages-container`, {
  boxSizing: 'border-box',
  paddingTop: `calc(${headerHeightVar} + 24px)`,
  '@container': {
    [compactChat]: { paddingTop: `calc(${headerHeightVar} + 12px)` },
  },
});

/* Keep each speaker on their side, with room for an avatar beside the content. */
globalStyle(`${root} chat-message-user`, {
  position: 'relative',
  display: 'flex',
  alignSelf: 'flex-end',
  width: 'fit-content',
  maxWidth: 'min(70%, 600px)',
  minWidth: 0,
  paddingRight: 40,
  boxSizing: 'border-box',
  '@container': { [compactChat]: { maxWidth: '90%' } },
});
globalStyle(`${root} chat-message-user::before`, {
  content: youLabelVar,
  position: 'absolute',
  top: 6,
  right: 0,
  width: 28,
  height: 28,
  display: 'grid',
  placeItems: 'center',
  boxSizing: 'border-box',
  borderRadius: '50%',
  background: wb.action,
  color: wb.onAction,
  fontSize: 10,
  fontWeight: 700,
});
globalStyle(`${root} chat-message-user .chat-message-user`, {
  minWidth: 0,
  maxWidth: '100%',
  gap: 8,
});
globalStyle(`${root} chat-message-user .text-content-wrapper`, {
  width: 'fit-content',
  maxWidth: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  padding: '12px 16px',
  borderRadius: 16,
  background: wb.paper,
  color: wb.ink,
  textAlign: 'left',
  overflowWrap: 'anywhere',
});
globalStyle(`${root} chat-message-assistant`, {
  position: 'relative',
  display: 'block',
  alignSelf: 'flex-start',
  width: 'fit-content',
  maxWidth: 'min(85%, 800px)',
  minWidth: 0,
  paddingLeft: 40,
  boxSizing: 'border-box',
  '@container': { [compactChat]: { maxWidth: '95%' } },
});
globalStyle(`${root} chat-message-assistant .user-info`, {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: '4px 10px',
  minHeight: 28,
  marginBottom: 8,
  color: wb.ink,
  fontSize: 12,
  fontWeight: 650,
});
globalStyle(`${root} chat-message-assistant chat-assistant-avatar`, {
  minHeight: 28,
  display: 'inline-flex',
  alignItems: 'center',
});
globalStyle(`${root} chat-message-assistant chat-assistant-avatar > svg`, {
  position: 'absolute',
  top: 0,
  left: 0,
  width: 28,
  height: 28,
  padding: 6,
  display: 'grid',
  placeItems: 'center',
  boxSizing: 'border-box',
  borderRadius: '50%',
  background: wb.brand,
  color: '#ffffff',
  vars: { '--affine-primary-color': '#ffffff' },
});
globalStyle(
  `${root} chat-message-assistant chat-assistant-avatar > dotlottie-wc`,
  {
    position: 'absolute',
    top: 4,
    left: 4,
  }
);
globalStyle(`${root} chat-message-assistant .item-wrapper`, {
  minWidth: 0,
  maxWidth: '100%',
  boxSizing: 'border-box',
  padding: '12px 16px',
  border: `1px solid ${wb.line}`,
  borderRadius: 16,
  background: wb.paper,
  color: wb.ink,
  overflowWrap: 'anywhere',
  overflowX: 'auto',
  '@container': { [compactChat]: { padding: '12px' } },
});
// Read-only answers must contribute their text width to a content-sized bubble.
globalStyle(`${root} chat-message-assistant .ai-answer-text-editor`, {
  containerType: 'normal',
});

/* v10 composer: floating card with a dark send tile. */
globalStyle(`${root} ai-chat-composer`, {
  width: 'min(100%, 960px)',
  margin: '0 auto',
  padding: '0 0 18px',
});

// Keep the empty-conversation composer centered. Once messages exist, float
// the input and status cards over the stream without blocking their gutters.
const activeChat = `${floatingHeaderRoot} .chat-panel-main:has(ai-chat-messages:not(.no-message))`;
globalStyle(`${activeChat} ai-chat-composer`, {
  position: 'absolute',
  bottom: 0,
  left: '50%',
  transform: 'translateX(-50%)',
  width: 'min(calc(100% - 56px), 960px)',
  zIndex: 1,
  pointerEvents: 'none',
  '@container': {
    [compactChat]: { width: 'min(calc(100% - 24px), 960px)' },
  },
});
globalStyle(`${activeChat} ai-chat-composer > :not(.chat-panel-footer)`, {
  pointerEvents: 'auto',
});
globalStyle(`${activeChat} ai-context-compaction-status`, {
  position: 'absolute',
  bottom: composerHeightVar,
  left: '50%',
  transform: 'translateX(-50%)',
  boxSizing: 'border-box',
  width: 'min(calc(100% - 56px), 960px)',
  zIndex: 1,
  '@container': {
    [compactChat]: { width: 'min(calc(100% - 24px), 960px)' },
  },
});
globalStyle(`${activeChat} ai-chat-messages`, {
  scrollPaddingBottom: `calc(${footerHeightVar} + 24px)`,
});
globalStyle(`${activeChat} .chat-panel-messages-container`, {
  paddingBottom: `calc(${footerHeightVar} + 24px)`,
});
globalStyle(`${activeChat} .down-indicator`, {
  bottom: `calc(${footerHeightVar} + 24px)`,
});
globalStyle(`${root} .chat-panel-input[data-independent-mode="true"]`, {
  minHeight: 82,
  padding: '13px 13px 10px',
  border: `1px solid ${wb.line}`,
  borderRadius: 17,
  background: wb.paper,
  boxShadow: `0 14px 36px rgba(25, 29, 34, 0.1), inset 0 0 0 1px ${wb.line}`,
});
globalStyle(`${root} .chat-panel-input .chat-panel-send`, {
  width: 32,
  height: 32,
  borderRadius: 10,
  background: wb.action,
  color: wb.onAction,
  boxShadow: '0 4px 12px rgba(25, 29, 34, 0.12)',
});
globalStyle(`${root} .chat-panel-input .chat-panel-send svg`, {
  color: wb.onAction,
});
// The outer v10 card replaces the stock bubble; keep a single surface.
globalStyle(`${root} chat-message-user .chat-content-pure-text`, {
  display: 'block',
  padding: 0,
  maxHeight: 'none',
  background: 'transparent',
  borderRadius: 0,
  color: 'inherit',
});
globalStyle(`${root} chat-message-assistant .user-info .message-info`, {
  order: 2,
  color: wb.ink3,
  fontWeight: 400,
});

export const banner = style({
  width: 'min(calc(100% - 56px), 960px)',
  margin: '10px auto 0',
  flexShrink: 0,
  '@media': {
    'screen and (max-width: 760px)': { width: 'calc(100% - 24px)' },
  },
});
// Work order panel toggle: matches the pin / history toolbar icons.
export const orderToggle = style({
  position: 'relative',
  height: 24,
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '0 6px 0 4px',
  font: 'inherit',
  fontSize: 12.5,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  border: 0,
  borderRadius: 4,
  background: 'transparent',
  color: wb.ink,
  cursor: 'pointer',
  selectors: {
    '&:hover': { background: cssVarV2('layer/background/hoverOverlay') },
    '&[aria-expanded="true"]': {
      background: cssVarV2('layer/background/hoverOverlay'),
    },
    '&[data-attention="true"]::after': {
      content: '""',
      position: 'absolute',
      top: 0,
      right: 0,
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: wb.brand,
      boxShadow: `0 0 0 1.5px ${wb.paper}`,
    },
    '&:focus-visible': { outline: `2px solid ${wb.signal}`, outlineOffset: 1 },
  },
});
globalStyle(`${orderToggle} svg`, { width: 16, height: 16 });
