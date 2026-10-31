/**
 * Motion tokens: springs (stiffness/damping). Spatial (bouncy) for position and size; effects (no bounce) for colour and opacity.
 */
export const SPRING = {
  fastSpatial: { type: 'spring', stiffness: 1400, damping: 67 },
  defaultSpatial: { type: 'spring', stiffness: 700, damping: 47 },
  slowSpatial: { type: 'spring', stiffness: 300, damping: 31 },
  fastEffects: { type: 'spring', stiffness: 3800, damping: 123 },
  defaultEffects: { type: 'spring', stiffness: 1600, damping: 80 },
  slowEffects: { type: 'spring', stiffness: 800, damping: 57 },
} as const;
