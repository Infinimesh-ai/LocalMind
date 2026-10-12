import {
  createGlobalTheme,
  createGlobalThemeContract,
} from '@vanilla-extract/css';

// LocalMind v9 controls. Keep these separate from editor and canvas colors.
export const controlTokens = createGlobalThemeContract(
  {
    action: null,
    actionHover: null,
    onAction: null,
    surface: null,
    surfaceHover: null,
    text: null,
    muted: null,
    border: null,
    borderHover: null,
    fieldBorder: null,
    focus: null,
    disabledSurface: null,
    danger: null,
    dangerSurface: null,
    success: null,
    successSurface: null,
    warning: null,
  },
  (_, path) => `affine-control-${path.join('-')}`
);

createGlobalTheme(':root, [data-theme="light"]', controlTokens, {
  action: '#252a30',
  actionHover: '#111419',
  onAction: '#ffffff',
  surface: '#ffffff',
  surfaceHover: '#f6f7f9',
  text: '#181b1f',
  muted: '#606974',
  border: '#e2e5e9',
  borderHover: '#cfd4da',
  fieldBorder: '#8b949e',
  focus: '#b43b30',
  disabledSurface: '#f5f6f8',
  danger: '#ad4d44',
  dangerSurface: '#f9ecea',
  success: '#37745d',
  successSurface: '#eaf3ef',
  warning: '#886329',
});

// Dark adaptation of the light-only reference, with matching contrast roles.
createGlobalTheme('[data-theme="dark"]', controlTokens, {
  action: '#e9edf1',
  actionHover: '#ffffff',
  onAction: '#1b1e23',
  surface: '#20242a',
  surfaceHover: '#252a31',
  text: '#eef0f3',
  muted: '#a7b0bb',
  border: '#373e48',
  borderHover: '#535d69',
  fieldBorder: '#7e8996',
  focus: '#f8a296',
  disabledSurface: '#252a31',
  danger: '#e5aaa2',
  dangerSurface: '#3c2a2a',
  success: '#9fcbb6',
  successSurface: '#25382f',
  warning: '#dcc18c',
});
