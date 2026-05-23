import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { setFavorite } from "@/lib/api";

const PlusIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    className={className}
  >
    <path d="M7 2v10M2 7h10" />
  </svg>
);

const CheckIcon = ({ className }: { className?: string }) => (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M2.5 7.5l3 3 6-6" />
  </svg>
);

export const WatchlistToggle = ({
  itemId,
  initialIsFavorite,
}: {
  itemId: string;
  initialIsFavorite: boolean;
}) => {
  const [isFav, setIsFav] = useState(initialIsFavorite);
  const qc = useQueryClient();

  useEffect(() => {
    setIsFav(initialIsFavorite);
  }, [initialIsFavorite, itemId]);

  const mutation = useMutation({
    mutationFn: (next: boolean) => setFavorite(itemId, next),
    onMutate: (next) => {
      setIsFav(next);
    },
    onError: (_err, next) => {
      setIsFav(!next);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["movie", itemId] });
      qc.invalidateQueries({ queryKey: ["show", itemId] });
    },
  });

  // Bloom counter increments each time the user lands on the favorited state,
  // so quick double-clicks (off → on → off → on) restart the ripple instead of
  // suppressing it.
  const [bloomKey, setBloomKey] = useState(0);
  const handleClick = () => {
    const next = !isFav;
    if (next) setBloomKey((k) => k + 1);
    mutation.mutate(next);
  };

  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.94 }}
      onClick={handleClick}
      className="btn-glass relative"
      aria-pressed={isFav}
      aria-label={isFav ? "Remove from watchlist" : "Add to watchlist"}
    >
      <motion.span
        key={isFav ? "on" : "off"}
        initial={{ scale: 0.55, rotate: isFav ? -25 : 0, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: "spring", stiffness: 520, damping: 18 }}
        className="inline-flex"
      >
        {isFav ? (
          <CheckIcon className="h-3.5 w-3.5" />
        ) : (
          <PlusIcon className="h-3.5 w-3.5" />
        )}
      </motion.span>
      {isFav ? "Watchlisted" : "Watchlist"}

      {/* Bloom ring + accent flash on add */}
      <AnimatePresence>
        {bloomKey > 0 && (
          <motion.span
            key={bloomKey}
            aria-hidden
            initial={{ scale: 0.4, opacity: 0.55 }}
            animate={{ scale: 1.35, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: [0.2, 0.6, 0.2, 1] }}
            onAnimationComplete={() => setBloomKey(0)}
            className="pointer-events-none absolute inset-0 rounded-[2px] border border-strata-accent"
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
};
