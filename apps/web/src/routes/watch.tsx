import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { buildStreamPlan, getItem, ticksToSeconds } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Player } from "@/components/player/Player";

export const WatchPage = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: session, isPending } = useSession();
  // Hooks must be called unconditionally — gate the fetch with
  // `enabled` instead of early-returning, otherwise React errors out
  // with a hook-count mismatch as auth state resolves.
  const detail = useQuery({
    queryKey: ["item", id],
    queryFn: () => getItem(id),
    enabled: Boolean(session?.user),
  });
  // Fire PlaybackInfo in parallel with the item metadata fetch. Player
  // reads the same query key via useQuery, so by the time it mounts
  // (which requires `detail.data`), this round-trip is usually done —
  // taking the PlaybackInfo POST off the critical startup path.
  // Audio stream index intentionally omitted: the server returns the
  // default audio in MediaSources, which matches Player's initial pick.
  useQuery({
    queryKey: ["playbackInfo", id, "default"],
    queryFn: () => buildStreamPlan(id),
    enabled: Boolean(session?.user),
    // Each PlaybackInfo call mints a new PlaySessionId — keep the
    // prefetched plan short-lived so we don't reuse a stale session on
    // a later visit. ~15s covers route mount + Player mount in practice.
    staleTime: 15_000,
    gcTime: 15_000,
  });

  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;
  if (detail.isLoading || !detail.data) {
    return <Shell message="Loading metadata…" />;
  }
  if (detail.isError) {
    return <Shell message="Couldn't load this title." tone="error" />;
  }

  const item = detail.data;
  const resumeSeconds = ticksToSeconds(item.UserData?.PlaybackPositionTicks) ?? 0;

  return <Player item={item} resumeAt={resumeSeconds} />;
};

const Shell = ({
  message,
  tone = "loading",
}: {
  message: string;
  tone?: "loading" | "error";
}) => (
  <div className="fixed inset-0 z-50 flex flex-col overscroll-none bg-strata-bg text-strata-paper">
    <div className="flex items-center px-6 py-5">
      <button
        type="button"
        onClick={() => history.back()}
        className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-strata-paper/70 transition hover:text-strata-paper"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>
    </div>
    <div className="flex flex-1 items-center justify-center">
      <div className="flex items-center gap-3 rounded-md bg-strata-bg/70 px-4 py-2 backdrop-blur">
        <span
          className={
            tone === "error"
              ? "h-2 w-2 rounded-full bg-strata-accent"
              : "anim-pulse-dot inline-block h-2 w-2 rounded-full bg-strata-accent"
          }
        />
        <span className="font-mono text-[11px] uppercase tracking-[0.18em]">
          {message}
        </span>
      </div>
    </div>
  </div>
);
