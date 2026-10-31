import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { LogOut, MonitorSmartphone } from "lucide-react";
import { useSession } from "@/app/session";
import { authClient } from "@/lib/auth-client";
import { relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { AuthSession, HouseholdDevice } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EmptyState, ErrorAlert, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/** A readable name from a user agent: "Safari on macOS", "Strata on Apple TV". */
export function deviceName(s: Pick<AuthSession, "userAgent" | "viewerOnly">): string {
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

/** One row: a device, whose it is, and how to sign it out. */
interface DeviceRow {
  id: string;
  person: string | null;
  userAgent: string | null;
  viewerOnly: boolean;
  household: string | null;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
  signOut: () => Promise<unknown>;
}

/**
 * The household's devices, with whose each one is, for its owner and admins; for everyone
 * else, the devices they're signed in on. Each can be signed out.
 */
export default function DevicesPage() {
  const { me, can } = useSession();
  const isAdmin = can("householdAdmin");
  const household = useQuery({ queryKey: queryKeys.devices, queryFn: api.devices, enabled: isAdmin, refetchInterval: 30_000 });
  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: authClient.listSessions, enabled: !isAdmin, refetchInterval: 30_000 });
  const token = useQuery({ queryKey: queryKeys.sessionToken, queryFn: authClient.currentSessionToken, enabled: !isAdmin, staleTime: Infinity });
  const households = useQuery({ queryKey: queryKeys.households, queryFn: authClient.listHouseholds, enabled: !isAdmin, staleTime: 60_000 });
  const [confirming, setConfirming] = useState<DeviceRow | null>(null);
  const signOut = useApiMutation((row: DeviceRow) => row.signOut(), {
    success: (_, row) => `Signed out ${deviceName(row)}${row.person ? ` (${row.person})` : ""}`,
    invalidate: [queryKeys.devices, queryKeys.sessions],
  });

  const householdName = useMemo(() => new Map((households.data ?? []).map((h) => [h.id, h.name])), [households.data]);
  const rows: DeviceRow[] = useMemo(() => {
    if (isAdmin) {
      return (household.data?.items ?? []).map((d: HouseholdDevice) => ({
        id: d.id,
        person: d.userName,
        userAgent: d.userAgent,
        viewerOnly: d.viewerOnly,
        household: null,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        isCurrent: d.isCurrent,
        signOut: () => api.signOutDevice(d.id),
      }));
    }
    return [...(sessions.data ?? [])]
      .sort((a, b) => time(b.updatedAt) - time(a.updatedAt))
      .map((s) => ({
        id: s.id,
        person: null,
        userAgent: s.userAgent,
        viewerOnly: !!s.viewerOnly,
        household: s.activeOrganizationId ? (householdName.get(s.activeOrganizationId) ?? null) : null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        isCurrent: s.token === token.data,
        signOut: () => authClient.revokeSession(s.token),
      }));
  }, [isAdmin, household.data, sessions.data, token.data, householdName]);
  const query = isAdmin ? household : sessions;
  const columns = 6;

  return (
    <Page>
      <PageHeader
        title="Devices"
        description={
          isAdmin
            ? "Every app, TV and browser signed in to this household, and whose it is. Signing one out sends it back to the sign-in screen."
            : `Where ${me.user.name} is signed in: the Strata apps, TVs and browsers. Signing one out sends it back to the sign-in screen. Changing your password signs out all but this browser.`
        }
      />

      <ErrorAlert error={query.error} title="Couldn't load devices" onRetry={() => void query.refetch()} />

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Device</TableHead>
              <TableHead>{isAdmin ? "Person" : "Household"}</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead>Signed in</TableHead>
              <TableHead className="pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isPending ? (
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns} className="px-4">
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns} className="p-4">
                  <EmptyState icon={MonitorSmartphone} title="No devices yet" description="Open Strata on an Apple device and sign in to this server to connect it." className="border-0" />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="pl-4 font-medium" title={row.userAgent ?? undefined}>
                    {deviceName(row)}
                    {row.isCurrent && (
                      <Badge variant="success" className="ml-2">
                        This browser
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className={isAdmin ? undefined : "text-muted-foreground"}>{(isAdmin ? row.person : row.household) ?? "—"}</TableCell>
                  <TableCell>{row.viewerOnly ? <Badge variant="secondary">Watch only</Badge> : <Badge variant="accent">Full</Badge>}</TableCell>
                  <TableCell title={new Date(row.updatedAt).toLocaleString()}>{relativeTime(time(row.updatedAt))}</TableCell>
                  <TableCell className="text-muted-foreground" title={new Date(row.createdAt).toLocaleString()}>
                    {relativeTime(time(row.createdAt))}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    {!row.isCurrent && (
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirming(row)} disabled={signOut.isPending && signOut.variables?.id === row.id}>
                        <LogOut /> Sign out
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming ? `Sign out ${deviceName(confirming)}${confirming.person ? ` (${confirming.person})` : ""}?` : "Sign out device?"}
        description="It will need to sign in again."
        confirmLabel="Sign out"
        onConfirm={() => (confirming ? signOut.mutateAsync(confirming) : undefined)}
      />
    </Page>
  );
}
