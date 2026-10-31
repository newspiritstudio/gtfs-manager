import { MotionConfig } from 'motion/react';

/** Honours the system's "reduce motion": transform animations are skipped. */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
