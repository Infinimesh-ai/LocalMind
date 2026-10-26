import { cssVarV2 } from '@toeverything/theme/v2';
import { globalStyle, style } from '@vanilla-extract/css';

import { workbenchTokens as wb } from './workbench-tokens.css';

// v10 task-context card look; content and behaviour stay unchanged.
export const root = style({
  minWidth: 0,
  minHeight: 0,
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  border: `1px solid ${wb.line}`,
  borderRadius: 17,
  background: wb.paper,
  color: wb.ink2,
  boxShadow: '0 1px 2px rgba(75, 84, 93, 0.05)',
  boxSizing: 'border-box',
});
export const header = style({
  flexShrink: 0,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  padding: '16px 16px 15px',
  borderBottom: `1px solid ${wb.line}`,
});
globalStyle(`${header} h2`, {
  margin: '6px 0 0',
  color: wb.ink,
  fontSize: 17,
  fontWeight: 650,
  letterSpacing: '-0.01em',
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
});
export const eyebrow = style({
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.03em',
});
export const headerActions = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
});
globalStyle(`${headerActions} button`, {
  flexShrink: 0,
});
export const status = style({
  flexShrink: 0,
  padding: '4px 9px',
  borderRadius: 8,
  background: wb.signalSoft,
  color: wb.signal,
  fontSize: 11.5,
  fontWeight: 600,
});
export const scroll = style({ minHeight: 0, flex: 1, overflowY: 'auto' });
export const section = style({
  padding: '15px 16px',
  selectors: { '& + &': { borderTop: `1px solid ${wb.line}` } },
});
globalStyle(`${section} h3`, {
  margin: '0 0 9px',
  color: wb.ink3,
  fontSize: 11,
  fontWeight: 620,
  letterSpacing: '0.04em',
});
globalStyle(`${section} p`, {
  margin: '0 0 8px',
  color: wb.ink2,
  fontSize: 12.5,
  lineHeight: '19px',
});
globalStyle(`${section} textarea`, {
  width: '100%',
  resize: 'vertical',
  padding: '8px 10px',
  border: `1px solid ${wb.line}`,
  borderRadius: 10,
  background: wb.paper,
  color: wb.ink,
  font: 'inherit',
  fontSize: 13,
  boxSizing: 'border-box',
});
globalStyle(`${section} textarea:focus-visible`, {
  outline: 'none',
  borderColor: wb.signal,
  boxShadow: `0 0 0 3px ${wb.signalSoft}`,
});
export const meta = style({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
  margin: 0,
});
globalStyle(`${meta} div`, { minWidth: 0 });
globalStyle(`${meta} dt`, { color: wb.ink3, fontSize: 11 });
globalStyle(`${meta} dd`, {
  margin: '2px 0 0',
  color: wb.ink,
  fontSize: 12.5,
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
  padding: '10px 12px 12px',
  border: `1px solid ${wb.line}`,
  borderRadius: 12,
  background: wb.panel,
});
globalStyle(`${requirement} legend`, {
  padding: '0 4px',
  color: wb.ink,
  fontSize: 12.5,
  fontWeight: 620,
});
export const fileInput = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  minWidth: 0,
});
globalStyle(`${fileInput} input[type="file"]`, { display: 'none' });
export const uploadButton = style({
  flexShrink: 0,
  maxWidth: '100%',
});
export const filePicker = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
});
export const fileList = style({ minWidth: 0, flex: 1 });
export const fileRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '4px 0',
});
export const fileIcon = style({
  width: 20,
  height: 20,
  flexShrink: 0,
  color: cssVarV2('icon/secondary'),
});
export const fileDetails = style({
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
});
export const fileName = style({
  fontSize: 13,
  lineHeight: '20px',
  color: cssVarV2('text/primary'),
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  textUnderlineOffset: 3,
});
export const fileHint = style({
  color: cssVarV2('text/secondary'),
  fontSize: 12,
  lineHeight: '18px',
  overflowWrap: 'anywhere',
});
export const fileError = style({
  color: cssVarV2('status/error'),
  fontSize: 12,
  lineHeight: '18px',
  overflowWrap: 'anywhere',
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
// Long titles wrap instead of pushing the status and collapse control out.
globalStyle(`${header} > div:first-child`, { flex: 1, minWidth: 0 });
globalStyle(`${headerActions}`, { flexShrink: 0 });
