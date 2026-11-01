import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText, Search } from "lucide-react";
import { api } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import type { LogEntry } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorAlert, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LIMIT = 500;
const RANK: Record<LogEntry["level"], number> = { debug: 0, info: 1, warn: 2, error: 3 };
const LEVEL_TABS: { value: LogEntry["level"]; label: string }[] = [
  { value: "debug", label: "All" },
  { value: "info", label: "Info+" },
  { value: "warn", label: "Warnings+" },
  { value: "error", label: "Errors" },
];
const LEVEL_CLASS: Record<LogEntry["level"], string> = {
  debug: "text-muted-foreground",
  info: "text-local",
  warn: "text-warn",
  error: "text-destructive",
};

export default function LogsPage() {
  const [auto, setAuto] = useState(true);
  const [minLevel, setMinLevel] = useState<LogEntry["level"]>("info");
  const [filter, setFilter] = useState("");
  const logs = useQuery({ queryKey: queryKeys.logs(LIMIT), queryFn: () => api.logs(LIMIT), refetchInterval: auto ? 3000 : false });

  const items = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (logs.data?.items ?? [])
      .filter((e) => RANK[e.level] >= RANK[minLevel])
      .filter((e) => !f || e.message.toLowerCase().includes(f) || e.scope.toLowerCase().includes(f))
      .reverse();
  }, [logs.data, minLevel, filter]);

  return (
    <Page>
      <PageHeader title="Logs" description={`The most recent ${LIMIT} entries held in memory. The full log is in the data directory.`} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={minLevel} onValueChange={(v) => setMinLevel(v as LogEntry["level"])}>
          <TabsList aria-label="Minimum level">
            {LEVEL_TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input type="search" aria-label="Filter logs" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-56 pl-9" />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="logs-auto" checked={auto} onCheckedChange={setAuto} />
            <Label htmlFor="logs-auto" className="font-normal">
              Auto-refresh
            </Label>
          </div>
          {!auto && (
            <Button variant="outline" size="sm" onClick={() => void logs.refetch()} disabled={logs.isFetching}>
              <RefreshCw className={cn(logs.isFetching && "animate-spin")} /> Refresh
            </Button>
          )}
        </div>
      </div>

      <ErrorAlert error={logs.error} title="Couldn't load logs" />

      <Card className="overflow-hidden py-0">
        <div role="log" aria-live="off" className="max-h-[70vh] overflow-auto font-mono text-xs">
          {logs.isPending ? (
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 10 }, (_, i) => (
                <Skeleton key={i} className="h-4" style={{ width: `${60 + ((i * 17) % 40)}%` }} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyState icon={ScrollText} title={`No log entries${filter || minLevel !== "debug" ? " match" : ""}`} className="m-4" />
          ) : (
            items.map((e, i) => (
              <div key={`${e.time}-${i}`} className={cn("hover:bg-muted/50 grid grid-cols-[auto_auto_1fr] gap-x-3 gap-y-0.5 border-b px-4 py-1.5 last:border-b-0 sm:grid-cols-[auto_3.5rem_8rem_1fr]", e.level === "error" && "bg-destructive/5")}>
                <time className="text-muted-foreground" dateTime={e.time} title={new Date(e.time).toLocaleString()}>
                  {formatTime(e.time)}
                </time>
                <span className={cn("font-semibold uppercase", LEVEL_CLASS[e.level])}>{e.level}</span>
                <span className="text-muted-foreground truncate" title={e.scope}>
                  {e.scope}
                </span>
                <span className="col-span-3 break-words whitespace-pre-wrap sm:col-span-1">{e.message}</span>
              </div>
            ))
          )}
        </div>
      </Card>
    </Page>
  );
}
