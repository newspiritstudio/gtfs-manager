import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge amb les escales pròpies del tema (tailwind.config.js i src/index.css).
 *
 * Sense aquesta configuració, `text-body-medium` es llegiria com un color i trauria
 * `text-on-surface`; amb ella, l'escala tipogràfica MD3 és mida de lletra, `rounded-lg-inc` és un
 * radi i `z-popover` és un z-index.
 */
const MD3_TYPE_SCALE = [
  'display-large',
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

const isAppHeight = (value: string) => /^app(?:-\d+)?$/.test(value);

const twMerge = extendTailwindMerge<'md3-type'>({
  extend: {
    theme: {
      text: ['micro', 'tiny', 'nano'],
      radius: ['xs', 'lg-inc'],
    },
    classGroups: {
      // Les classes tipogràfiques MD3 són CSS propi (src/index.css) que ja porta l'interlineat: es
      // substitueixen entre elles i amb les mides de Tailwind, però no treuen cap `leading-*`.
      'md3-type': [{ text: MD3_TYPE_SCALE }],
      // L'alçada de l'app (src/index.css): `h-app`, `max-h-app-70`...
      h: [{ h: [isAppHeight] }],
      'min-h': [{ 'min-h': [isAppHeight] }],
      'max-h': [{ 'max-h': [isAppHeight] }],
      z: [
        {
          z: [
            'base',
            'above',
            'raised',
            'sticky-inner',
            'sticky',
            'fab',
            'banner',
            'modal',
            'modal-loading',
            'popover',
            'system-dialog',
            'toast',
            'mobile-overlay',
            'mobile-overlay-top',
          ],
        },
      ],
    },
    conflictingClassGroups: {
      'md3-type': ['font-size'],
      'font-size': ['md3-type'],
    },
  },
});

/**
 * Uneix classes i resol els conflictes de Tailwind: la classe que ve després guanya. Abans era
 * clsx pelat, i el `className` que una pantalla passava a una primitiva per substituir-ne el
 * farciment, l'alçada o el radi arribava al DOM al costat del de la base i manava l'ordre del full
 * compilat, no la intenció (UI-SIS-001, UI-USO-001).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
