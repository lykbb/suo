import type { Transition } from 'motion/react';

// One motion vocabulary for the whole app: springs for things that move, short fades for things
// that appear. MotionConfig reducedMotion="user" turns movement into plain fades when the system asks.
export const spring: Transition = { type: 'spring', stiffness: 520, damping: 38, mass: 0.8 };
export const panelSpring: Transition = { type: 'spring', stiffness: 340, damping: 34, mass: 0.9 };
// Softer and a little bouncy: cards travelling from the composer to their place on the board.
export const flight: Transition = { type: 'spring', stiffness: 170, damping: 21, mass: 1 };
export const fade: Transition = { duration: 0.16, ease: [0.2, 0, 0, 1] };
export const STAGGER = 0.06;

export const popover = {
  initial: { opacity: 0, scale: 0.97, y: 4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: spring },
  exit: { opacity: 0, scale: 0.98, y: 2, transition: { duration: 0.12 } },
};

export const reducedMotion = () => (typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduce') || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
