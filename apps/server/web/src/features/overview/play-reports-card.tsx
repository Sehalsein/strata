import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, ServerOff, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { PlayReport } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

function reportTitle(r: PlayReport) {
  const name = r.title ?? r.ref;
  if (r.season === null) return name;
  return `${name} · S${String(r.season).padStart(2, "0")}E${String(r.episode ?? 0).padStart(2, "0")}`;
}

/** File servers that refused or never answered, most often first: usually the whole story. */
function deadServers(reports: PlayReport[]) {
  const counts = new Map<string, { count: number; last: number }>();
  for (const r of reports) {
    for (const a of r.attempts) {
      for (const s of a.servers ?? []) {
        const c = counts.get(s.host) ?? { count: 0, last: 0 };
        counts.set(s.host, { count: c.count + 1, last: Math.max(c.last, r.at) });
      }
    }
  }
  return [...counts.entries()].map(([host, c]) => ({ host, ...c })).sort((a, b) => b.count - a.count);
}

/** Plays that failed, or only started after switching copies or file servers. */
export function PlayReportsCard() {
  const reports = useQuery({ queryKey: queryKeys.playReports, queryFn: () => api.playReports(50), refetchInterval: 15_000 });
  const [confirming, setConfirming] = useState(false);
  const clear = useApiMutation(() => api.clearPlayReports(), { success: "Playback problems cleared", invalidate: [queryKeys.playReports] });
  const items = reports.data?.items ?? [];
  const servers = deadServers(items);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          Playback problems{items.length > 0 && <span className="text-muted-foreground font-normal"> · {items.length}</span>}
        </CardTitle>
        <CardDescription>Plays that failed, or had to switch copies or file servers, as the apps report them.</CardDescription>
        {items.length > 0 && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} disabled={clear.isPending}>
              <Trash2 /> Clear
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {reports.isError && <p className="text-destructive text-sm">Couldn't load playback problems.</p>}
        {!reports.isPending && !reports.isError && items.length === 0 && (
          <EmptyState icon={CircleCheck} title="No problems reported" description="When a play fails or has to switch copies, what went wrong shows up here." className="py-8" />
        )}

        {servers.length > 0 && (
          <div className="bg-muted/50 space-y-2 rounded-lg p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <ServerOff className="size-4" /> File servers that didn't answer
            </p>
            <ul className="space-y-1">
              {servers.map((s) => (
                <li key={s.host} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-mono text-xs break-all">{s.host}</span>
                  <span className="text-muted-foreground text-xs">
                    {s.count}× · last {relativeTime(s.last)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {items.length > 0 && (
          <ul className="divide-y">
            {items.map((r) => (
              <ReportRow key={r.id} report={r} />
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Clear playback problems?"
        description="Every report in this household is deleted. New ones appear as the apps send them."
        confirmLabel="Clear"
        onConfirm={() => clear.mutateAsync()}
      />
    </Card>
  );
}

function ReportRow({ report: r }: { report: PlayReport }) {
  const device = [r.deviceName, r.deviceModel].filter(Boolean).join(" · ");
  const meta = [r.userName ?? "Someone", device || null, r.appVersion ? `app ${r.appVersion}` : null, r.location, relativeTime(r.at)].filter(Boolean);
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <Collapsible>
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{reportTitle(r)}</span>
            <Badge variant={r.outcome === "failed" ? "destructive" : "warning"}>{r.outcome === "failed" ? "Failed" : "Played after retrying"}</Badge>
          </div>
          <p className="text-muted-foreground text-sm">{meta.join(" · ")}</p>
          <p className="text-sm">{r.message}</p>
          {r.attempts.length > 0 && (
            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs">
              <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
              {r.attempts.length === 1 ? "1 copy tried" : `${r.attempts.length} copies tried`}
            </CollapsibleTrigger>
          )}
        </div>
        <CollapsibleContent>
          <ol className="mt-2 space-y-2 border-l pl-3">
            {r.attempts.map((a, i) => (
              <li key={i} className="space-y-1 text-sm">
                <p>
                  <span className="font-medium">{a.copy ?? (a.fileId !== undefined ? `File ${a.fileId}` : `Copy ${i + 1}`)}</span>
                  {a.fileId !== undefined && a.copy && <span className="text-muted-foreground"> · file {a.fileId}</span>}
                  {a.stage && <span className="text-muted-foreground"> · while {a.stage}</span>}
                </p>
                {a.error ? <p className="text-destructive font-mono text-xs break-words">{a.error}</p> : <p className="text-ok text-xs">Played</p>}
                {a.servers && a.servers.length > 0 && (
                  <ul className="space-y-0.5">
                    {a.servers.map((s, j) => (
                      <li key={j} className="text-muted-foreground font-mono text-xs break-all">
                        {s.host} — {s.error}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ol>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
