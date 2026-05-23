import { AnimatePresence, motion } from "motion/react";
import { Pause, Play } from "lucide-react";

type Props = {
  playing: boolean;
  visible: boolean;
  loading: boolean;
  onClick: () => void;
};

export const CenterPlayButton = ({
  playing,
  visible,
  loading,
  onClick,
}: Props) => {
  // Only surface the center button on pause or when the user is interacting
  // (visible flag from the auto-hide hook). During steady playback we keep
  // the canvas clean.
  const show = visible && !loading;

  return (
    <AnimatePresence>
      {show && (
        <motion.button
          key="center-play"
          type="button"
          onClick={onClick}
          aria-label={playing ? "Pause" : "Play"}
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: playing ? 0 : 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.85 }}
          transition={{ duration: 0.2, ease: [0.2, 0.6, 0.2, 1] }}
          className="absolute left-1/2 top-1/2 z-20 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-strata-paper/30 bg-strata-bg/40 text-strata-paper backdrop-blur-md transition hover:border-strata-paper/60 hover:bg-strata-paper/15 sm:h-20 sm:w-20"
        >
          {playing ? (
            <Pause className="h-8 w-8 sm:h-7 sm:w-7" />
          ) : (
            <Play className="h-8 w-8 translate-x-0.5 sm:h-7 sm:w-7" />
          )}
        </motion.button>
      )}
    </AnimatePresence>
  );
};
