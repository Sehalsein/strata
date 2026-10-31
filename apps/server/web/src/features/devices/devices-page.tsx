import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useSession } from "@/app/session";
import { authClient } from "@/lib/auth-client";
import { relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { AuthSession } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorAlert, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** A readable name from a user agent: "Safari on macOS", "Strata on Apple TV". */
export function deviceName(s: AuthSession): string {
  const ua = s.userAgent ?? "";
  if (!ua) return s.viewerOnly ? "TV or home device" : "Unknown device";
  const platform = /AppleTV|tvOS/i.test(ua)
    ? "Apple TV"
    : /iPad/.test(ua)
      ? "iPad"
      : /iPhone/.test(ua)
        ? "iPhone"
        : /Android/.test(ua)
          ? "Android"
          : /Mac OS X|Macintosh|macOS/.test(ua)
            ? "macOS"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const app = /Strata/i.test(ua)
    ? "Strata"
    : /Edg\//.test(ua)
      ? "Edge"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : ua.split(/[\s/]/)[0]!;
  return platform ? `${app} on ${platform}` : app;
}

const time = (iso: string) => new Date(iso).getTime();

/** The signed-in account's sign-ins: apps, TVs and browsers, each with a way to sign it out. */
export default function DevicesPage() {
  const { me } = useSession();
  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: authClient.listSessions, refetchInterval: 30_000 });
  const token = useQuery({ queryKey: queryKeys.sessionToken, queryFn: authClient.currentSessionToken, staleTime: Infinity });
  const households = useQuery({ queryKey: queryKeys.households, queryFn: authClient.listHouseholds, staleTime: 60_000 });
  const [confirming, setConfirming] = useState<AuthSession | null>(null);
  const signOut = useApiMutation((s: AuthSession) => authClient.revokeSession(s.token), { success: (_, s) => `Signed out ${deviceName(s)}`, invalidate: [queryKeys.sessions] });

  const householdName = useMemo(() => new Map((households.data ?? []).map((h) => [h.id, h.name])), [households.data]);
  const rows = useMemo(() => [...(sessions.data ?? [])].sort((a, b) => time(b.updatedAt) - time(a.updatedAt)), [sessions.data]);

  return (
    <Page>
      <PageHeader
        title="Devices"
        description={`Where ${me.user.name} is signed in: the Strata apps, TVs and browsers. Signing one out sends it back to the sign-in screen. Changing your password signs out all but this browser.`}
      />

      <ErrorAlert error={sessions.error} title="Couldn't load devices" onRetry={() => void sessions.refetch()} />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Device</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Household</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead>Signed in</TableHead>
              <TableHead className="pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.isPending ? (
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={6} className="px-4">
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="p-4">
                  <EmptyState icon={MonitorSmartphone} title="No devices yet" description="Open Strata on an Apple device and sign in to this server to connect it." className="border-0" />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => {
                const isCurrent = s.token === token.data;
                return (
                  <TableRow key={s.id}>
                    <TableCell className="pl-4 font-medium" title={s.userAgent ?? undefined}>
                      {deviceName(s)}
                      {isCurrent && (
                        <Badge variant="success" className="ml-2">
                          This browser
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>{s.viewerOnly ? <Badge variant="secondary">Watch only</Badge> : <Badge variant="accent">Full</Badge>}</TableCell>
                    <TableCell className="text-muted-foreground">{s.activeOrganizationId ? (householdName.get(s.activeOrganizationId) ?? "—") : "—"}</TableCell>
                    <TableCell title={new Date(s.updatedAt).toLocaleString()}>{relativeTime(time(s.updatedAt))}</TableCell>
                    <TableCell className="text-muted-foreground" title={new Date(s.createdAt).toLocaleString()}>
                      {relativeTime(time(s.createdAt))}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {!isCurrent && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(s)} disabled={signOut.isPending && signOut.variables?.id === s.id}>
                          <LogOut /> Sign out
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming ? `Sign out ${deviceName(confirming)}?` : "Sign out device?"}
        description="It will need to sign in again."
        confirmLabel="Sign out"
        onConfirm={() => (confirming ? signOut.mutateAsync(confirming) : undefined)}
      />
    </Page>
  );
}
