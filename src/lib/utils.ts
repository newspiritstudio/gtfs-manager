import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge with the theme's own scales (tailwind.config.js and src/index.css).
 *
 * Without this configuration, `text-body-medium` would be read as a colour and would drop
 * `text-on-surface`; with it, the MD3 type scale is font size, `rounded-lg-inc` is a radius and
 * `z-popover` is a z-index.
 */
const MD3_TYPE_SCALE = [
  'display-medium',
  'display-small',
  'headline-large',
  'headline-medium',
  'headline-small',
  'title-large',
  'title-medium',
  'title-small',
  'body-large',
  'body-medium',
  'body-small',
  'label-large',
  'label-medium',
  'label-small',
];

const twMerge = extendTailwindMerge<'md3-type'>({
  extend: {
    theme: {
      radius: ['xs', 'lg-inc'],
    },
    classGroups: {
      // MD3 typographic classes are custom CSS (src/index.css) that already carries the line height:
      // they replace each other and Tailwind's sizes, but do not remove any `leading-*`.
      'md3-type': [{ text: MD3_TYPE_SCALE }],
      // The app height (src/index.css).
      h: ['h-app'],
      z: [{ z: ['modal', 'popover', 'toast', 'mobile-overlay'] }],
    },
    conflictingClassGroups: {
      'md3-type': ['font-size'],
      'font-size': ['md3-type'],
    },
  },
});

/**
 * Joins classes and resolves Tailwind conflicts: the later class wins. It used to be bare clsx,
 * and the `className` a screen passed to a primitive to override its padding, height or radius
 * reached the DOM next to the base one, and the order of the compiled stylesheet decided, not
 * the intent (UI-SIS-001, UI-USO-001).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
