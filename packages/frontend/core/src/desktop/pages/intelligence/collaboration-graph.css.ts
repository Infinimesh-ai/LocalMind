import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  flex: 1,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(250px, 32%)',
  gap: 0,
  overflow: 'hidden',
  minHeight: 520,
  borderRadius: 18,
  boxShadow: `inset 0 0 0 1px ${cssVarV2('layer/insideBorder/border')}, 0 20px 54px rgba(25, 29, 34, 0.055)`,
  '@media': {
    'screen and (max-width: 1040px)': {
      gridTemplateColumns: 'minmax(0, 1fr) 240px',
    },
    'screen and (max-width: 760px)': {
      gridTemplateColumns: 'minmax(0, 1fr)',
      overflowY: 'auto',
    },
  },
});
export const canvas = style({
  position: 'relative',
  minWidth: 0,
  minHeight: 520,
  overflow: 'hidden',
  backgroundImage: `radial-gradient(${cssVarV2('layer/insideBorder/border')} 0.7px, transparent 0.7px)`,
  backgroundSize: '18px 18px',
});
export const gfxHost = style({
  width: '100%',
  height: '100%',
  minHeight: 520,
  overflow: 'hidden',
});
export const zoomControls = style({
  position: 'absolute',
  zIndex: 1,
  top: 10,
  right: 10,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: 4,
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 6,
  background: cssVarV2('layer/background/primary'),
  fontSize: 11,
});
export const zoomValue = style({
  minWidth: 44,
  border: 0,
  background: 'transparent',
  color: cssVarV2('text/secondary'),
  font: 'inherit',
  cursor: 'pointer',
});
globalStyle(`${gfxHost} editor-host`, { width: '100%', height: '100%' });
globalStyle(`${gfxHost} affine-edgeless-root`, {
  width: '100%',
  height: '100%',
});
globalStyle(`${gfxHost} affine-edgeless-toolbar`, { display: 'none' });
globalStyle(`${gfxHost} affine-edgeless-zoom-toolbar`, { display: 'none' });
export const list = style({
  minWidth: 0,
  overflowY: 'auto',
  padding: '20px 18px',
  borderLeft: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  '@media': {
    'screen and (max-width: 760px)': {
      borderLeft: 0,
      borderTop: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
    },
  },
});
globalStyle(`${list} h2`, { margin: '0 0 8px', fontSize: 13 });
globalStyle(`${list} ul`, { margin: 0, padding: 0, listStyle: 'none' });
globalStyle(`${list} li + li`, { marginTop: 6 });
globalStyle(`${list} button`, {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '12px 8px',
  border: 0,
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 0,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  textAlign: 'left',
  cursor: 'pointer',
});
globalStyle(`${list} button span`, {
  color: cssVarV2('text/secondary'),
  fontSize: 11,
});
export const notice = style({
  color: cssVarV2('text/secondary'),
  fontSize: 11,
});
export const state = style({
  minHeight: 520,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  borderRadius: 18,
  boxShadow: `inset 0 0 0 1px ${cssVarV2('layer/insideBorder/border')}`,
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});
