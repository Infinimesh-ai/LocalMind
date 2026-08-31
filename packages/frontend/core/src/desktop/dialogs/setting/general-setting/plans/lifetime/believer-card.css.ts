import { cssVar } from '@toeverything/theme';
import { style } from '@vanilla-extract/css';

const colorSchemes = {
  light: {
    dot: '#E0E0E0',
  },
  dark: {
    dot: 'rgba(255,255,255,0.1)',
  },
};

export const card = style({
  position: 'relative',
  width: '100%',
  minHeight: 200,
  borderRadius: 16,
  padding: '20px 24px',
  border: `1px solid ${cssVar('borderColor')}`,
  overflow: 'hidden',
  background: cssVar('white'),
});

export const content = style({
  position: 'relative',
  zIndex: 3,
});

export const bg = style({
  vars: {
    '--dot': colorSchemes.light.dot,
  },
  width: '100%',
  height: '100%',
  position: 'absolute',
  top: 0,
  left: 0,
  backgroundImage:
    'radial-gradient(circle, var(--dot) 1.2px, transparent 1.2px)',
  backgroundSize: '12px 12px',
  backgroundRepeat: 'repeat',

  selectors: {
    '[data-theme="dark"] &': {
      vars: {
        '--dot': colorSchemes.dark.dot,
      },
    },

    [`${card}[data-type="1"] &::after`]: {
      background: `linear-gradient(231deg, transparent 0%, ${cssVar('white')} 80%)`,
    },
    [`${card}[data-type="2"] &::after`]: {
      background: `linear-gradient(290deg, transparent 0%, ${cssVar('white')} 40%)`,
    },
  },

  // Overlay
  '::after': {
    content: '""',
    position: 'absolute',
    width: '100%',
    height: '100%',
    top: 0,
    left: 0,
    zIndex: 1,
  },
});

export const brandMark = style({
  position: 'absolute',
  zIndex: 0,
  width: 240,
  height: 240,
  opacity: 0.1,
  selectors: {
    [`${card}[data-type='1'] &`]: {
      right: -64,
      top: -72,
    },
    [`${card}[data-type='2'] &`]: {
      right: -72,
      bottom: -88,
    },
  },
});
