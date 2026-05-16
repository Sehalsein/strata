import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getItem, ticksToSeconds } from "@/lib/api";
import { useSession } from "@/lib/auth-client";
import { Player } from "@/components/player/Player";

export const WatchPage = () => {
  const { id } = useParams({ strict: false }) as { id: string };
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  if (!session) return <Navigate to="/login" />;

  const detail = useQuery({
    queryKey: ["item", id],
    queryFn: () => getItem(id),
  });

  if (detail.isLoading) {
    return <Shell message="Loading metadata…" />;
  }
  if (detail.isError || !detail.data) {
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
  <div className="fixed inset-0 z-50 flex flex-col bg-strata-bg text-strata-paper">
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
