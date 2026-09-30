import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

const text = cssVarV2('text/primary');
const secondary = cssVarV2('text/secondary');
const border = cssVarV2('layer/insideBorder/border');
const background = cssVarV2('layer/background/primary');

export const board = style({
  vars: {
    '--orbit-incoming': '#3658d8',
    '--orbit-outgoing': '#b34f0b',
    '--orbit-track': '#d6dae1',
    '--orbit-flow': '#3697e0',
  },
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
  minHeight: 560,
  height: 'min(78vh, 900px)',
  overflow: 'hidden',
  background,
  color: text,
});
globalStyle(`[data-theme="dark"] ${board}`, {
  vars: {
    '--orbit-incoming': '#8dacf9',
    '--orbit-outgoing': '#ffb36b',
    '--orbit-track': '#585d70',
    '--orbit-flow': '#7fb9ed',
  },
});

export const heading = style({
  position: 'relative',
  zIndex: 8,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 12,
  minHeight: 72,
  padding: '14px 24px',
  background,
});
export const headingTitle = style({ margin: 0, fontSize: 21, fontWeight: 650 });
export const headingMeta = style({ color: secondary, fontSize: 12 });
export const headingActions = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
});
export const search = style({
  width: 224,
  minWidth: 0,
  height: 34,
  padding: '0 10px',
  border: `1px solid ${border}`,
  borderRadius: 8,
  background,
  color: text,
  font: 'inherit',
  fontSize: 12,
});
export const action = style({
  minHeight: 34,
  padding: '5px 10px',
  border: `1px solid ${border}`,
  borderRadius: 8,
  background,
  color: text,
  font: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
  selectors: {
    '&[aria-pressed="true"]': {
      color: 'var(--orbit-incoming)',
      borderColor: 'currentColor',
    },
  },
});
export const notice = style({
  position: 'relative',
  zIndex: 8,
  padding: '6px 24px',
  color: secondary,
  fontSize: 12,
});
export const world = style({
  position: 'relative',
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
});
export const legend = style({
  position: 'absolute',
  top: 10,
  left: 24,
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 18,
  color: secondary,
  fontSize: 12,
  pointerEvents: 'none',
});
globalStyle(`${legend} [data-direction="incoming"]`, {
  color: 'var(--orbit-incoming)',
});
globalStyle(`${legend} [data-direction="outgoing"]`, {
  color: 'var(--orbit-outgoing)',
});
globalStyle(`${legend} b`, {
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
});
export const viewport = style({
  position: 'absolute',
  inset: '36px 0 60px',
  overflow: 'hidden',
  cursor: 'grab',
  touchAction: 'none',
  selectors: {
    '&[data-panning="true"]': { cursor: 'grabbing' },
    '&[data-pan-ready="true"]': { cursor: 'grabbing' },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: -3,
    },
  },
});
export const canvas = style({
  position: 'absolute',
  top: 0,
  left: 0,
  transformOrigin: '0 0',
});
export const lines = style({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
});
export const connection = style({
  transition: 'opacity 180ms ease',
  selectors: { '&[data-dimmed="true"]': { opacity: 0.3 } },
});
export const deliveryTrack = style({
  fill: 'none',
  stroke: 'var(--orbit-track)',
  strokeLinecap: 'round',
  opacity: 0.75,
});
export const deliveryFlow = style({
  fill: 'none',
  stroke: 'var(--orbit-flow)',
  strokeLinecap: 'round',
  opacity: 0.9,
});
export const self = style({
  position: 'absolute',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  width: 112,
  transform: 'translate(-50%, -50%)',
  textAlign: 'center',
  pointerEvents: 'none',
});
globalStyle(`${self} strong`, {
  marginTop: 8,
  fontSize: 15,
  whiteSpace: 'nowrap',
});
globalStyle(`${self} small`, {
  marginTop: 3,
  color: secondary,
  fontSize: 11,
  whiteSpace: 'nowrap',
});
export const person = style({
  position: 'absolute',
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: 0,
  borderRadius: '50%',
  background: 'transparent',
  transform: 'translate(-50%, -50%)',
  cursor: 'pointer',
  transition: 'opacity 180ms ease',
  selectors: {
    '&[data-dimmed="true"]': { opacity: 0.6 },
    '&:focus-visible': {
      outline: `2px solid ${cssVarV2('button/primary')}`,
      outlineOffset: 5,
    },
  },
});
export const avatarRing = style({
  position: 'absolute',
  inset: -4,
  border: '2px solid var(--orbit-incoming)',
  borderRadius: '50%',
  pointerEvents: 'none',
  selectors: {
    '&[data-both="true"]': {
      borderRightColor: 'var(--orbit-outgoing)',
      borderBottomColor: 'var(--orbit-outgoing)',
    },
  },
});
export const personCaption = style({
  position: 'absolute',
  top: 'calc(100% + 12px)',
  left: '50%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 3,
  minWidth: 120,
  transform: 'translateX(-50%)',
  textAlign: 'center',
  pointerEvents: 'none',
});
globalStyle(`${personCaption} strong`, {
  color: text,
  fontSize: 12,
  fontWeight: 650,
  whiteSpace: 'nowrap',
});
globalStyle(`${personCaption} small`, {
  color: secondary,
  fontSize: 10,
  whiteSpace: 'nowrap',
});
export const expansion = style({
  position: 'absolute',
  zIndex: 4,
  width: 0,
  height: 0,
});
export const orderCard = style({
  vars: { '--order-tone': 'var(--orbit-incoming)' },
  position: 'absolute',
  zIndex: 3,
  display: 'flex',
  alignItems: 'center',
  boxSizing: 'border-box',
  padding: '0 14px',
  border: '2px solid var(--order-tone)',
  borderRadius: 999,
  background: 'transparent',
  color: text,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  selectors: {
    '&[data-direction="outgoing"]': {
      vars: { '--order-tone': 'var(--orbit-outgoing)' },
    },
    '&:hover': {
      boxShadow:
        '0 0 0 3px color-mix(in srgb, var(--order-tone) 15%, transparent)',
    },
    '&[data-active="true"]': {
      boxShadow:
        '0 0 0 3px color-mix(in srgb, var(--order-tone) 22%, transparent)',
    },
    '&:disabled': { cursor: 'default', pointerEvents: 'none' },
    '&:focus-visible': {
      outline: '2px solid var(--order-tone)',
      outlineOffset: 3,
    },
  },
});
export const cardContent = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  width: '100%',
  pointerEvents: 'none',
});
globalStyle(`${cardContent} i`, {
  flex: 'none',
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: 'var(--order-tone)',
});
globalStyle(`${cardContent} strong`, {
  overflow: 'hidden',
  color: text,
  fontSize: 12,
  fontWeight: 600,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
export const personControls = style({
  position: 'absolute',
  top: 'var(--controls-top)',
  left: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 6,
  width: 250,
  transform: 'translateX(-50%)',
  color: secondary,
  fontSize: 11,
});
export const directionFilters = style({
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  gap: 5,
});
globalStyle(`${directionFilters} button`, {
  minHeight: 28,
  padding: '4px 8px',
  border: `1px solid ${border}`,
  borderRadius: 999,
  background,
  color: 'var(--orbit-incoming)',
  fontSize: 11,
  cursor: 'pointer',
});
globalStyle(`${directionFilters} button[data-direction="outgoing"]`, {
  color: 'var(--orbit-outgoing)',
});
globalStyle(`${directionFilters} button[aria-pressed="true"]`, {
  borderColor: 'currentColor',
  fontWeight: 700,
});
export const empty = style({
  position: 'absolute',
  transform: 'translateX(-50%)',
  color: secondary,
  fontSize: 12,
  whiteSpace: 'nowrap',
});
export const camera = style({
  position: 'absolute',
  right: 24,
  bottom: 13,
  zIndex: 6,
  display: 'flex',
  gap: 4,
  padding: 3,
  border: `1px solid ${border}`,
  borderRadius: 8,
  background,
});
globalStyle(`${camera} button`, {
  minHeight: 27,
  minWidth: 28,
  padding: '3px 7px',
  border: 0,
  borderRadius: 5,
  background: 'transparent',
  color: text,
  cursor: 'pointer',
});
globalStyle(`${camera} button:disabled`, { opacity: 0.4, cursor: 'default' });
globalStyle(`${camera} button:hover:not(:disabled)`, {
  background: cssVarV2('layer/background/secondary'),
});

export const draftPanel = style({
  position: 'absolute',
  top: 72,
  right: 24,
  zIndex: 12,
  width: 'min(340px, calc(100% - 32px))',
  maxHeight: 'min(440px, 65vh)',
  overflow: 'auto',
  padding: 14,
  border: `1px solid ${border}`,
  borderRadius: 12,
  background,
  boxShadow: '0 16px 40px rgb(18 20 32 / 14%)',
});
export const draftItem = style({
  display: 'block',
  width: '100%',
  padding: '9px 8px',
  border: 0,
  borderRadius: 7,
  background: 'transparent',
  color: text,
  textAlign: 'left',
  cursor: 'pointer',
});
globalStyle(`${draftItem}:hover`, {
  background: cssVarV2('layer/background/secondary'),
});

export const popover = style({
  position: 'fixed',
  zIndex: 100,
  width: 'min(392px, calc(100vw - 32px))',
  maxHeight: 'min(610px, calc(100vh - 32px))',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'auto',
  padding: 18,
  border: `1px solid ${border}`,
  borderRadius: 14,
  background,
  color: text,
  boxShadow: '0 16px 48px rgb(18 20 32 / 18%)',
});
export const popoverTop = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
});
export const popoverMeta = style({
  color: secondary,
  fontSize: 12,
  lineHeight: 1.5,
});
export const popoverBody = style({
  minHeight: 0,
  overflow: 'auto',
  fontSize: 13,
  lineHeight: 1.6,
});
export const popoverFooter = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  marginTop: 16,
  paddingTop: 12,
  borderTop: `1px solid ${border}`,
});
export const error = style({ color: cssVarV2('status/error'), fontSize: 12 });

globalStyle(`${board} button:focus-visible, ${board} input:focus-visible`, {
  outline: `2px solid ${cssVarV2('button/primary')}`,
  outlineOffset: 2,
});
globalStyle(`${board} button:disabled`, { opacity: 0.5 });
globalStyle(`${popover} h3`, { margin: '10px 0 6px', fontSize: 17 });
globalStyle(`${popover} h4`, { margin: '14px 0 6px', fontSize: 12 });
globalStyle(`${popover} p`, { margin: '6px 0' });
globalStyle(`${popover} ul`, { margin: '6px 0', paddingLeft: 20 });

globalStyle(`${board}`, {
  '@media': {
    'screen and (max-width: 760px)': {
      minHeight: 540,
      height: 'calc(100dvh - 180px)',
    },
  },
});
globalStyle(`${heading}`, {
  '@media': {
    'screen and (max-width: 760px)': {
      padding: '12px 16px',
      alignItems: 'flex-start',
    },
  },
});
globalStyle(`${legend}`, {
  '@media': {
    'screen and (max-width: 760px)': { left: 16, gap: 8, fontSize: 10 },
  },
});
globalStyle(`${popover}`, {
  '@media': {
    'screen and (max-width: 680px)': {
      left: 'max(0px, env(safe-area-inset-left))',
      right: 'max(0px, env(safe-area-inset-right))',
      bottom: 0,
      width: 'auto',
      maxHeight: 'min(70dvh, 580px)',
      paddingBottom: 'max(18px, env(safe-area-inset-bottom))',
      borderRadius: '16px 16px 0 0',
    },
  },
});
