import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
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

  return (
    <motion.button
      whileHover={{ scale: 1.03 }}
      whileTap={{ scale: 0.96 }}
      onClick={() => mutation.mutate(!isFav)}
      className="btn-glass"
      aria-pressed={isFav}
      aria-label={isFav ? "Remove from watchlist" : "Add to watchlist"}
    >
      {isFav ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <PlusIcon className="h-3.5 w-3.5" />
      )}
      {isFav ? "Watchlisted" : "Watchlist"}
    </motion.button>
  );
};
