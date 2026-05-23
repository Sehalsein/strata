import { ArrowLeft } from "lucide-react";
import { memo } from "react";
import { cn, formatBitrate } from "@/lib/utils";

type Breadcrumb = {
  show: string | null;
  season: number | null;
  episode: number | null;
  title: string;
};

type Transcoding = {
  kind: "direct" | "hls";
  bitrate: number | null;
};

type Props = {
  visible: boolean;
  breadcrumb: Breadcrumb;
  transcoding: Transcoding;
  onBack: () => void;
};



export const PlayerHeader = memo(function PlayerHeader({
  visible,
  breadcrumb,
  transcoding,
  onBack,
}: Props) {
  const mbps = formatBitrate(transcoding.bitrate);
  const isEpisode =
    breadcrumb.show !== null &&
    (breadcrumb.season !== null || breadcrumb.episode !== null);

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-0 top-0 z-30 transition-opacity duration-300",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={cn(
          "bg-gradient-to-b from-strata-bg/85 via-strata-bg/40 to-transparent pb-12",
          visible ? "pointer-events-auto" : "pointer-events-none",
        )}
        style={{
          paddingTop: "max(1.25rem, env(safe-area-inset-top))",
          paddingLeft: "max(1.5rem, env(safe-area-inset-left))",
          paddingRight: "max(1.5rem, env(safe-area-inset-right))",
        }}
      >
        <div className="flex items-start justify-between gap-3 sm:gap-6">
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full border border-strata-paper/20 bg-strata-bg/40 text-strata-paper transition hover:bg-strata-paper/10 sm:h-10 sm:w-10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="min-w-0 leading-tight">
              {isEpisode && (
                <div className="spec truncate text-strata-paper/55">
                  {breadcrumb.show}
                </div>
              )}
              <div className="flex min-w-0 items-baseline gap-3">
                {isEpisode && (
                  <span className="flex-none font-mono text-[11px] uppercase tracking-[0.22em] text-strata-paper/70">
                    {breadcrumb.season !== null
                      ? `S${breadcrumb.season}`
                      : null}
                    {breadcrumb.season !== null && breadcrumb.episode !== null
                      ? " · "
                      : null}
                    {breadcrumb.episode !== null
                      ? `E${breadcrumb.episode}`
                      : null}
                  </span>
                )}
                <span className="truncate font-display text-base italic text-strata-paper sm:text-lg">
                  {isEpisode ? `"${breadcrumb.title}"` : breadcrumb.title}
                </span>
              </div>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <span
              className={cn(
                "chip font-mono",
                transcoding.kind === "direct"
                  ? "border-strata-success/40 text-strata-success/90"
                  : "border-strata-accent-2/40 text-strata-accent-2",
              )}
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  transcoding.kind === "direct"
                    ? "bg-strata-success"
                    : "bg-strata-accent-2",
                )}
              />
              {transcoding.kind === "direct" ? "Direct play" : "Transcode"}
              {mbps ? ` · ${mbps}` : null}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
});
