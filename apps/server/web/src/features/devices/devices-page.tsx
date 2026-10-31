import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, LogOut, MonitorSmartphone, Search } from "lucide-react";
import { api } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { Device } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorAlert, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SortKey = "name" | "lastSeenAt" | "createdAt";
type Access = "all" | "admin" | "viewer";
const PAGE_SIZE = 20;

const deviceName = (d: Device) => d.deviceName ?? "Unknown device";

/** Every signed-in app and browser, with a way to sign each one out. */
export default function DevicesPage() {
  const devices = useQuery({ queryKey: queryKeys.devices, queryFn: api.devices, refetchInterval: 30_000 });
  const [filter, setFilter] = useState("");
  const [access, setAccess] = useState<Access>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "lastSeenAt", dir: "desc" });
  const [page, setPage] = useState(0);
  const [confirming, setConfirming] = useState<Device | null>(null);
  const signOut = useApiMutation((d: Device) => api.signOutDevice(d.id), { success: (_, d) => `Signed out ${deviceName(d)}`, invalidate: [queryKeys.devices] });

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = (devices.data?.items ?? []).filter(
      (d) =>
        (access === "all" || (access === "viewer" ? d.viewerOnly : !d.viewerOnly)) &&
        (!f || deviceName(d).toLowerCase().includes(f) || (d.profileName ?? "").toLowerCase().includes(f)),
    );
    const mul = sort.dir === "asc" ? 1 : -1;
    return list.sort((a, b) => (sort.key === "name" ? deviceName(a).localeCompare(deviceName(b)) : a[sort.key] - b[sort.key]) * mul);
  }, [devices.data, filter, access, sort]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const total = devices.data?.items.length ?? 0;

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }));
    setPage(0);
  };

  return (
    <Page>
      <PageHeader title="Devices" description="Apps and browsers signed in to this server. Signing one out sends it back to the Connect screen." />

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            aria-label="Filter devices"
            placeholder="Filter by device or profile"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(0);
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={access}
          onValueChange={(v) => {
            setAccess(v as Access);
            setPage(0);
          }}
        >
          <SelectTrigger aria-label="Access" className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All access</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="viewer">Watch only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ErrorAlert error={devices.error} title="Couldn't load devices" onRetry={() => void devices.refetch()} />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Device" k="name" sort={sort} onSort={toggleSort} className="pl-4" />
              <TableHead>Access</TableHead>
              <TableHead>Profile</TableHead>
              <SortHead label="Last active" k="lastSeenAt" sort={sort} onSort={toggleSort} />
              <SortHead label="Signed in" k="createdAt" sort={sort} onSort={toggleSort} />
              <TableHead className="pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {devices.isPending ? (
              Array.from({ length: 4 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6} className="px-4">
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : visible.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-4">
                  <EmptyState
                    icon={MonitorSmartphone}
                    title={total === 0 ? "No devices yet" : "No devices match"}
                    description={total === 0 ? "Open Strata on an Apple device and pick this server to connect it." : "Try a different filter."}
                    className="border-0"
                  />
                </TableCell>
              </TableRow>
            ) : (
              visible.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-4 font-medium">
                    {deviceName(d)}
                    {d.isCurrent && (
                      <Badge variant="success" className="ml-2">
                        This browser
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{d.viewerOnly ? <Badge variant="secondary">Watch only</Badge> : <Badge variant="accent">Admin</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{d.profileName ?? "—"}</TableCell>
                  <TableCell title={new Date(d.lastSeenAt).toLocaleString()}>{relativeTime(d.lastSeenAt)}</TableCell>
                  <TableCell className="text-muted-foreground" title={new Date(d.createdAt).toLocaleString()}>
                    {relativeTime(d.createdAt)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {!d.isCurrent && (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(d)} disabled={signOut.isPending && signOut.variables?.id === d.id}>
                        <LogOut /> Sign out
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {rows.length > PAGE_SIZE && (
          <div className="flex items-center justify-end gap-3 border-t px-4 py-3">
            <span className="text-muted-foreground font-mono text-xs">
              {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + visible.length} of {rows.length}
            </span>
            <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={current === 0} onClick={() => setPage(current - 1)}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={current + 1 >= pageCount} onClick={() => setPage(current + 1)}>
              <ChevronRight />
            </Button>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming ? `Sign out ${deviceName(confirming)}?` : "Sign out device?"}
        description="It will need to connect again."
        confirmLabel="Sign out"
        onConfirm={() => (confirming ? signOut.mutateAsync(confirming) : undefined)}
      />
    </Page>
  );
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: { key: SortKey; dir: "asc" | "desc" }; onSort: (k: SortKey) => void; className?: string }) {
  const active = sort.key === k;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <Button variant="ghost" size="sm" className="-ml-3 h-8" onClick={() => onSort(k)}>
        {label}
        <Icon className={cn("size-3.5", !active && "text-muted-foreground/60")} />
      </Button>
    </TableHead>
  );
}
