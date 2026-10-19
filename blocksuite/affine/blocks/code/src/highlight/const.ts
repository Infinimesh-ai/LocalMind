// Shiki accepts theme getters. Fetch only when a code block needs highlighting,
// so merely importing editor extensions cannot start unhandled chunk requests.
export const CODE_BLOCK_DEFAULT_DARK_THEME = () =>
  import('shiki/themes/dark-plus.mjs');
export const CODE_BLOCK_DEFAULT_LIGHT_THEME = () =>
  import('shiki/themes/light-plus.mjs');
