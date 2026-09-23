import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

export const root = style({
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  padding: '24px 18px',
  overflowY: 'auto',
  background: cssVarV2('layer/background/primary'),
});

export const header = style({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  padding: '0 0 17px',
  borderBottom: `0.5px solid ${cssVarV2('layer/insideBorder/border')}`,
});

globalStyle(`${header} h2`, {
  margin: 0,
  fontSize: 13,
  lineHeight: '20px',
});

globalStyle(`${header} p`, {
  maxWidth: 320,
  margin: '7px 0 0',
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
});

export const memoryNotice = style({
  margin: 0,
  padding: '18px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  fontSize: 12,
});

globalStyle(`${memoryNotice} span`, {
  color: cssVarV2('text/secondary'),
  lineHeight: '18px',
});

export const roles = style({
  margin: 0,
  padding: '18px 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  background: cssVarV2('layer/background/primary'),
  fontSize: 12,
});
globalStyle(`${roles} h3, ${roles} p`, { margin: 0 });
globalStyle(`${roles} h3`, { fontSize: 12, lineHeight: '18px' });
globalStyle(`${roles} p`, {
  color: cssVarV2('text/secondary'),
  lineHeight: '18px',
});
globalStyle(`${roles} ul`, {
  margin: 2,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  listStyle: 'none',
});
globalStyle(`${roles} li`, {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 5,
  padding: '6px 0',
  borderRadius: 0,
  background: 'transparent',
});
globalStyle(`${roles} li > span:nth-last-child(-n + 2)`, {
  color: cssVarV2('text/secondary'),
});

export const rolesEmpty = style({
  color: cssVarV2('text/tertiary'),
  lineHeight: '18px',
});

export const rolesError = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  color: cssVarV2('text/secondary'),
});

export const resources = style({
  minHeight: 0,
  margin: 0,
  padding: '12px 0 0',
  overflowY: 'auto',
  listStyle: 'none',
});

globalStyle(`${resources} li + li`, { marginTop: 6 });
globalStyle(`${resources} button`, {
  width: '100%',
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 0',
  border: 0,
  borderBottom: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
  borderRadius: 0,
  background: cssVarV2('layer/background/primary'),
  color: cssVarV2('text/primary'),
  textAlign: 'start',
  cursor: 'pointer',
});
globalStyle(`${resources} button span`, {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const state = style({
  flex: 1,
  minHeight: 160,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 20,
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  textAlign: 'center',
});

export const projectActivity = style({
  marginTop: 16,
  borderTop: `1px solid ${cssVarV2('layer/insideBorder/border')}`,
});
