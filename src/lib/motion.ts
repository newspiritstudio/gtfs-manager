/**
 * Els tokens de moviment de l'Àgora Design System: molles (rigidesa/amortiment). Espacial (amb rebot) per a posició i mida; d'efecte (sense rebot) per a color i opacitat.
 */
export const SPRING = {
  fastSpatial: { type: 'spring', stiffness: 1400, damping: 67 },
  defaultSpatial: { type: 'spring', stiffness: 700, damping: 47 },
  slowSpatial: { type: 'spring', stiffness: 300, damping: 31 },
  fastEffects: { type: 'spring', stiffness: 3800, damping: 123 },
  defaultEffects: { type: 'spring', stiffness: 1600, damping: 80 },
  slowEffects: { type: 'spring', stiffness: 800, damping: 57 },
} as const;
