import { useMotionValue, useSpring, useTransform, type Variants } from "motion/react";
import type { PointerEvent as ReactPointerEvent } from "react";

/* Variants for staggered row reveals.
 * Apply rowContainer to the parent <motion.section>, rowVariants to each child. */
export const rowContainer: Variants = {
  hidden: {},
  show: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.05,
    },
  },
};

export const rowVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 220, damping: 24 },
  },
};

/* Standard card hover transition — used by every poster-style card. */
export const cardHoverSpring = {
  type: "spring" as const,
  stiffness: 320,
  damping: 24,
};

/* Whole-page mount fade. */
export const pageEnter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.35, ease: "easeOut" as const },
};

/* Cursor-aware card tilt. Track pointer offset within the card,
 * tween to rotateX/Y/Z via spring. Returns inline `style` for motion.div
 * plus pointer handlers. */
export const useCardTilt = (maxDeg = 6) => {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 180, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 180, damping: 18, mass: 0.4 });
  const rotateX = useTransform(sy, [-0.5, 0.5], [maxDeg, -maxDeg]);
  const rotateY = useTransform(sx, [-0.5, 0.5], [-maxDeg, maxDeg]);
  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    x.set((e.clientX - rect.left) / rect.width - 0.5);
    y.set((e.clientY - rect.top) / rect.height - 0.5);
  };
  const onPointerLeave = () => {
    x.set(0);
    y.set(0);
  };
  return {
    style: { rotateX, rotateY, transformPerspective: 1000 },
    handlers: { onPointerMove, onPointerLeave },
  };
};
