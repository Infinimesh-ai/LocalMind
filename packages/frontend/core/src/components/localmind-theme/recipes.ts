import { workbenchTokens as wb } from './tokens.css';

/** Small grey group label above sidebar sections and list groups. */
export const sectionLabel = {
  color: wb.ink3,
  fontSize: 11,
  lineHeight: '18px',
  fontWeight: 600,
  letterSpacing: '0.04em',
} as const;

/** Selected sidebar item: a white chip lifted off the grey sidebar. */
export const selectedItem = {
  background: wb.paper,
  color: wb.ink,
  fontWeight: 600,
  boxShadow: `inset 0 0 0 1px ${wb.line}, 0 1px 3px rgba(25, 29, 34, 0.04)`,
} as const;

/** Header tool: bordered 34px square (Project hub header). */
export const toolButton = {
  width: 34,
  height: 34,
  borderRadius: 11,
  border: `1px solid ${wb.line}`,
  background: wb.paper,
  color: wb.ink2,
  boxShadow:
    '0 1px 2px rgba(82, 92, 102, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.68)',
} as const;
export const toolButtonHover = {
  background: wb.panel,
  borderColor: wb.lineStrong,
  color: wb.ink,
} as const;

/**
 * Point AFFiNE's colour variables at the workbench palette inside a subtree,
 * so stock components (tree nodes, list rows, icon buttons) pick up the
 * Project hub inks, lines and hovers in both themes.
 */
export const affinePaletteBridge = {
  '--affine-v2-text-primary': wb.ink,
  '--affine-v2-text-secondary': wb.ink3,
  '--affine-v2-text-tertiary': wb.ink3,
  '--affine-v2-icon-primary': wb.ink2,
  '--affine-v2-icon-secondary': wb.ink3,
  '--affine-v2-layer-background-hoverOverlay': wb.sidebarHover,
  '--affine-v2-layer-insideBorder-border': wb.line,
  '--affine-text-primary-color': wb.ink,
  '--affine-text-secondary-color': wb.ink3,
  '--affine-icon-color': wb.ink2,
  '--affine-hover-color': wb.sidebarHover,
  '--affine-border-color': wb.line,
} as const;
