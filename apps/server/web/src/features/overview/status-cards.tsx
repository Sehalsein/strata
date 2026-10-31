import { useQuery } from "@tanstack/react-query";
import { api, errorMessage } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { Link } from "@/lib/router";
import type { AdminStatus, LibraryStats } from "@/lib/types";
import { KeyValue, KeyValueList } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function ServerCard({ status }: { status: AdminStatus }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Status</CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValueList>
          <KeyValue k="Version" mono>
            {status.version} <span className="text-muted-foreground">· API {String(status.apiVersion)}</span>
          </KeyValue>
          <KeyValue k="Platform" mono>
            {status.platform}
          </KeyValue>
          <KeyValue k="Uptime">{formatDuration(status.uptimeMs)}</KeyValue>
          {status.dataDir && (
            <KeyValue k="Data" mono>
              <span className="break-all">{status.dataDir}</span>
            </KeyValue>
          )}
          <KeyValue k="ffmpeg" mono>
            {status.ffmpeg ? (
              <>
                <span title={status.ffmpeg.path}>{status.ffmpeg.version}</span>
                {status.ffmpeg.hwEncoder && <span className="text-muted-foreground"> · {status.ffmpeg.hwEncoder}</span>}
              </>
            ) : (
              <Badge variant="warning">Not found</Badge>
            )}
          </KeyValue>
        </KeyValueList>
      </CardContent>
    </Card>
  );
}

export function summarize(stats: LibraryStats) {
  const out = { total: 0, matched: 0, pending: 0, unmatched: 0, ignored: 0, local: 0, torbox: 0 };
  for (const r of stats.files) {
    out.total += r.count;
    out[r.provider] += r.count;
    if (r.status === "matched" || r.status === "manual") out.matched += r.count;
    else out[r.status] += r.count;
  }
  return out;
}

export function LibraryCard({ stats }: { stats: LibraryStats }) {
  const s = summarize(stats);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contents</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/library">Open</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-2">
          <Figure value={stats.titles.movie ?? 0} label="Movies" />
          <Figure value={stats.titles.show ?? 0} label="Shows" />
          <Figure value={s.total} label="Files" />
        </div>
        <KeyValueList>
          <KeyValue k="Matched">{s.matched}</KeyValue>
          <KeyValue k="Unmatched">
            {s.unmatched > 0 ? (
              <Link href="/library?status=unmatched" className="text-brand-text font-medium hover:underline">
                {s.unmatched} to fix
              </Link>
            ) : (
              0
            )}
          </KeyValue>
          <KeyValue k="Pending">{s.pending}</KeyValue>
          <KeyValue k="Sources">
            {s.local} local · {s.torbox} TorBox
          </KeyValue>
        </KeyValueList>
      </CardContent>
    </Card>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</span>
      <span className="text-muted-foreground text-xs">{label}</span>
    </div>
  );
}

function planName(plan: number | string): string {
  const names: Record<string, string> = { "0": "Free", "1": "Essential", "2": "Pro", "3": "Standard" };
  return names[String(plan)] ?? String(plan);
}

export function ProvidersCard({ status }: { status: AdminStatus }) {
  const account = useQuery({ queryKey: queryKeys.torboxAccount, queryFn: api.torboxAccount, enabled: status.torbox.configured, staleTime: 60_000 });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Providers</CardTitle>
      </CardHeader>
      <CardContent>
        <KeyValueList>
          <KeyValue k="TMDB">{status.tmdb.configured ? <Badge variant="success">Connected</Badge> : <Badge variant="warning">No key</Badge>}</KeyValue>
          <KeyValue k="TorBox">{status.torbox.configured ? <Badge variant="success">Connected</Badge> : <Badge variant="secondary">Not set up</Badge>}</KeyValue>
          {status.torbox.configured &&
            (account.data ? (
              <>
                {account.data.email && <KeyValue k="Account">{account.data.email}</KeyValue>}
                {account.data.plan !== null && <KeyValue k="Plan">{planName(account.data.plan)}</KeyValue>}
                {account.data.premiumExpiresAt && <KeyValue k="Renews">{new Date(account.data.premiumExpiresAt).toLocaleDateString()}</KeyValue>}
              </>
            ) : account.error ? (
              <KeyValue k="Account">
                <span className="text-destructive text-sm">{errorMessage(account.error)}</span>
              </KeyValue>
            ) : (
              <KeyValue k="Account">
                <Skeleton className="h-4 w-32" />
              </KeyValue>
            ))}
        </KeyValueList>
      </CardContent>
      <CardFooter className="mt-auto">
        <Button variant="ghost" size="sm" asChild className="-ml-3">
          <Link href="/settings#connections">Manage keys</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
