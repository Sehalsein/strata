import { LoaderCircle, Play } from "lucide-react";
import { api } from "@/lib/api";
import { formatDuration, jobLabel, relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { JobStatus } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

function JobBadge({ job }: { job: JobStatus }) {
  if (job.running) return <Badge variant="accent">Running</Badge>;
  if (job.lastError) return <Badge variant="destructive">Failed</Badge>;
  if (job.lastRunAt) return <Badge variant="success">OK</Badge>;
  return <Badge variant="secondary">Idle</Badge>;
}

/** The household's own jobs (Overview); the rest run server-wide (the backoffice). */
const HOUSEHOLD_JOBS = ["syncTorbox", "matchPending"];

export function JobsCard({ jobs: all, scope }: { jobs: JobStatus[]; scope: "household" | "server" }) {
  const jobs = all.filter((j) => HOUSEHOLD_JOBS.includes(j.name) === (scope === "household"));
  const run = useApiMutation((name: string) => api.runJob(name), { success: (_, name) => `${jobLabel(name)} started`, invalidate: [queryKeys.status] });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{scope === "server" ? "Server jobs" : "Jobs"}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {jobs.map((j) => {
            const starting = run.isPending && run.variables === j.name;
            return (
              <li key={j.name} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{jobLabel(j.name)}</span>
                    <JobBadge job={j} />
                  </div>
                  {j.running && (
                    <div className="flex max-w-md items-center gap-3">
                      <Progress value={j.progress && j.progress.total > 0 ? (j.progress.done / j.progress.total) * 100 : undefined} aria-label={`${jobLabel(j.name)} progress`} />
                      {j.progress && j.progress.total > 0 && (
                        <span className="text-muted-foreground shrink-0 font-mono text-xs">
                          {j.progress.label ? `${j.progress.label} · ` : ""}
                          {j.progress.done}/{j.progress.total}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-muted-foreground text-sm">
                    {j.lastRunAt ? `Last run ${relativeTime(j.lastRunAt)}` : "Never run"}
                    {j.lastDurationMs !== undefined && ` · took ${formatDuration(j.lastDurationMs)}`}
                    {` · next ${j.nextRunAt ? relativeTime(j.nextRunAt) : "manual only"}`}
                  </p>
                  {j.lastError && <p className="text-destructive font-mono text-xs break-words">{j.lastError}</p>}
                </div>
                {(
                <Button variant="outline" size="sm" className="shrink-0" onClick={() => run.mutate(j.name)} disabled={j.running || starting}>
                  {j.running || starting ? <LoaderCircle className="animate-spin" /> : <Play />}
                  {j.running ? "Running…" : "Run now"}
                </Button>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
