import { ArrowLeft } from "lucide-react";
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

export const PlayerHeader = ({
  visible,
  breadcrumb,
  transcoding,
  onBack,
}: Props) => {
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
      <div className="pointer-events-auto bg-gradient-to-b from-strata-bg/85 via-strata-bg/40 to-transparent px-6 pb-12 pt-5">
        <div className="flex items-start justify-between gap-6">
          <div className="flex items-start gap-4">
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-strata-paper/20 bg-strata-bg/40 text-strata-paper transition hover:bg-strata-paper/10"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div className="leading-tight">
              {isEpisode && (
                <div className="spec text-strata-paper/55">
                  {breadcrumb.show}
                </div>
              )}
              <div className="flex items-baseline gap-3">
                {isEpisode && (
                  <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-strata-paper/70">
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
                <span className="font-display text-lg italic text-strata-paper">
                  {isEpisode ? `"${breadcrumb.title}"` : breadcrumb.title}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
};
