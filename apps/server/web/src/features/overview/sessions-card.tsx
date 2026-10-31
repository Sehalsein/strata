import { useState } from "react";
import { LoaderCircle, Play, Square } from "lucide-react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { PlaybackSessionDto } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function sessionTitle(s: PlaybackSessionDto) {
  return s.title ?? `${s.target.mediaType === "movie" ? "Movie" : "Episode"} ${s.target.tmdbId}`;
}

export function SessionsCard({ sessions }: { sessions: PlaybackSessionDto[] }) {
  const [confirming, setConfirming] = useState<PlaybackSessionDto | null>(null);
  const stop = useApiMutation((id: string) => api.stopSession(id), { success: "Stream stopped", invalidate: [queryKeys.status] });

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Now playing{sessions.length > 0 && <span className="text-muted-foreground font-normal"> · {sessions.length}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessions.length === 0 ? (
          <EmptyState icon={Play} title="Nothing is playing" description="Streams from the Strata apps show up here while they play." className="py-8" />
        ) : (
          <ul className="divide-y">
            {sessions.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {sessionTitle(s)}
                      {s.target.season !== undefined && (
                        <span className="font-mono text-sm">{` · S${String(s.target.season).padStart(2, "0")}E${String(s.target.episode ?? 0).padStart(2, "0")}`}</span>
                      )}
                    </span>
                    <Badge variant={s.mode === "direct" ? "success" : s.mode === "remux" ? "accent" : "warning"}>{s.mode}</Badge>
                    <Badge variant="secondary">{s.source === "torbox" ? "TorBox" : "Local"}</Badge>
                    {s.paused && <Badge variant="outline">Paused</Badge>}
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {s.profileName ?? `Profile ${s.profileId}`} · file {s.fileId} · started {relativeTime(s.startedAt)} · last request {relativeTime(s.lastAccessAt)}
                  </p>
                  {s.reasons.length > 0 && <p className="text-muted-foreground font-mono text-xs">{s.reasons.join(" · ")}</p>}
                  {s.error && <p className="text-destructive text-sm">{s.error}</p>}
                </div>
                <Button variant="outline" size="sm" className="text-destructive shrink-0" onClick={() => setConfirming(s)} disabled={stop.isPending && stop.variables === s.id}>
                  {stop.isPending && stop.variables === s.id ? <LoaderCircle className="animate-spin" /> : <Square />}
                  Stop
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title="Stop this stream?"
        description={confirming ? `“${sessionTitle(confirming)}” stops playing on ${confirming.profileName ?? "the device"}.` : undefined}
        confirmLabel="Stop stream"
        onConfirm={() => (confirming ? stop.mutateAsync(confirming.id) : undefined)}
      />
    </Card>
  );
}
