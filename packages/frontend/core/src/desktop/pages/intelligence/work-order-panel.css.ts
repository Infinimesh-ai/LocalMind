import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  borderLeft: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
});
export const header = style({
  minHeight: 82,
  flexShrink: 0,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  padding: '20px 20px 16px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});
globalStyle(`${header} h2`, {
  margin: '6px 0 0',
  fontSize: 18,
  overflowWrap: 'anywhere',
});
export const eyebrow = style({
  color: cssVarV2('text/secondary'),
  fontSize: 10,
});
export const status = style({
  flexShrink: 0,
  padding: '3px 7px',
  borderRadius: 999,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/secondary'),
  fontSize: 10,
});
export const scroll = style({ minHeight: 0, flex: 1, overflowY: 'auto' });
export const section = style({
  padding: '18px 20px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});
globalStyle(`${section} h3`, { margin: '0 0 8px', fontSize: 12 });
globalStyle(`${section} p`, {
  margin: '0 0 8px',
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
});
globalStyle(`${section} textarea`, {
  width: '100%',
  resize: 'vertical',
  padding: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 4,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  font: 'inherit',
});
export const meta = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  margin: 0,
});
globalStyle(`${meta} div`, { minWidth: 0 });
globalStyle(`${meta} dt`, { color: cssVarV2('text/tertiary'), fontSize: 10 });
globalStyle(`${meta} dd`, {
  margin: '2px 0 0',
  fontSize: 12,
  overflowWrap: 'anywhere',
});
export const requirements = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  marginBottom: 10,
});
export const requirement = style({
  minWidth: 0,
  margin: 0,
  padding: 12,
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 8,
});
globalStyle(`${requirement} legend`, {
  padding: '0 4px',
  fontSize: 12,
  fontWeight: 600,
});
export const fileInput = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  color: cssVarV2('text/secondary'),
  fontSize: 11,
});
export const timeline = style({ margin: 0, padding: '0 0 0 18px' });
globalStyle(`${timeline} li`, { marginBottom: 8, fontSize: 11 });
globalStyle(`${timeline} li span`, {
  display: 'block',
  marginTop: 2,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
});
globalStyle(`${timeline} time`, {
  display: 'block',
  marginTop: 2,
  color: cssVarV2('text/tertiary'),
  fontSize: 10,
});
export const delivery = style({
  marginTop: 8,
  padding: 9,
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 5,
  fontSize: 11,
});
globalStyle(`${delivery} header`, {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
});
globalStyle(`${delivery} code`, {
  display: 'block',
  marginTop: 5,
  overflowWrap: 'anywhere',
  color: cssVarV2('text/tertiary'),
  fontSize: 9,
});
globalStyle(`${delivery} ul`, { margin: '7px 0 0', paddingLeft: 18 });
export const actions = style({
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
});
export const locked = style({
  margin: 12,
  padding: 10,
  borderRadius: 5,
  background: cssVarV2('layer/background/secondary'),
  color: cssVarV2('text/secondary'),
  fontSize: 11,
});
export const state = style({
  minHeight: 220,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: 16,
  color: cssVarV2('text/secondary'),
  textAlign: 'center',
});
