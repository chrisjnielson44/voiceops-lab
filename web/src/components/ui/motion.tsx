"use client";

import { motion, type Variants } from "framer-motion";

import { cn } from "@/lib/cn";

/**
 * Shared motion presets so every view animates consistently. Keep durations
 * short — this is an ops console, not a marketing page.
 */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } },
};

export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.02 } },
};

/**
 * Page content containers. Page-to-page motion is handled once, uniformly, by
 * the route-level crossfade (see MotionView), so these intentionally DON'T run a
 * per-page mount/stagger entrance — that was applied inconsistently across views
 * and made some pages animate their content in while others didn't. They stay
 * `motion.div` so passed interaction props (e.g. `whileHover`) keep working.
 */
export function MotionStagger({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <motion.div className={className}>{children}</motion.div>;
}

/** A content item — no mount entrance; preserves any interaction props (hover). */
export function MotionItem({
  children,
  className,
  ...props
}: React.ComponentProps<typeof motion.div>) {
  return (
    <motion.div className={cn(className)} {...props}>
      {children}
    </motion.div>
  );
}

/** Page/view wrapper — a single gentle fade-in on tab switch (keyed remount, no
 *  AnimatePresence): the new page fades up while the old is removed first, so
 *  there's no two-page overlap/ghosting and no layout jump. */
export function MotionView({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
