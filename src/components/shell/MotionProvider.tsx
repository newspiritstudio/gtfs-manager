'use client';

import { MotionConfig } from 'motion/react';

/** Respecta «redueix el moviment» del sistema: les animacions de transformació s'ometen. */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
