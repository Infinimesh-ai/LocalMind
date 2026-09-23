import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  maxHeight: '72vh',
  overflowY: 'auto',
  paddingRight: 4,
});
export const help = style({
  margin: 0,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
});
export const recipient = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: 12,
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 6,
});
globalStyle(`${recipient} > header`, {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});
globalStyle(`${recipient} h3, ${recipient} h4`, { margin: 0, fontSize: 13 });
globalStyle(`${recipient} label`, {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  color: cssVarV2('text/secondary'),
  fontSize: 11,
});
globalStyle(`${recipient} textarea, ${recipient} select`, {
  width: '100%',
  padding: 8,
  border: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 4,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  font: 'inherit',
});
export const resolveRow = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 8,
});
export const resolved = style({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: '2px 8px',
  padding: 8,
  borderRadius: 4,
  background: cssVarV2('layer/background/secondary'),
  fontSize: 11,
});
globalStyle(`${resolved} code`, {
  gridColumn: '1 / -1',
  color: cssVarV2('text/tertiary'),
  overflowWrap: 'anywhere',
});
export const relationshipRow = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
});
export const requirement = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  margin: 0,
  padding: 10,
  border: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 5,
});
globalStyle(`${requirement} legend`, {
  padding: '0 4px',
  fontSize: 11,
  fontWeight: 600,
});
export const requirementGrid = style({
  display: 'grid',
  gridTemplateColumns: '160px minmax(0, 1fr)',
  gap: 8,
});
export const requirementActions = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
});
export const checkbox = style({ alignItems: 'center' });
globalStyle(`${recipient} ${checkbox}`, { flexDirection: 'row' });
export const confirmation = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  padding: 10,
  borderRadius: 5,
  background: cssVarV2('layer/background/secondary'),
  fontSize: 11,
});
globalStyle(`${confirmation} code`, {
  overflowWrap: 'anywhere',
  color: cssVarV2('text/tertiary'),
});
export const actions = style({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
  position: 'sticky',
  bottom: 0,
  paddingTop: 10,
  background: cssVarV2('layer/background/primary'),
});
