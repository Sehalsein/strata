import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { LogOut, MapPin, MonitorSmartphone } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** A readable name from a user agent: "Safari on macOS", "Strata on Apple TV". */
export function deviceName(s: Pick<AuthSession, "userAgent" | "viewerOnly">): string {
  const ua = s.userAgent ?? "";
  if (!ua) return s.viewerOnly ? "TV or home device" : "Unknown device";
  const platform = platformOf(ua);
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

function platformOf(ua: string): string | null {
  return /AppleTV|tvOS/i.test(ua)
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
}

/** The system and its version from a user agent: "iOS 27.0", "tvOS 26.1", "macOS 15.6". */
function systemOf(ua: string | null): string | null {
  if (!ua) return null;
  // The Strata apps: "Strata/0.3.0 (iPhone; iOS 27.0)".
  const app = ua.match(/\b(iOS|iPadOS|tvOS|macOS|visionOS) (\d+(?:\.\d+)*)/);
  if (app) return `${app[1]} ${app[2]}`;
  const ios = ua.match(/(?:iPhone|CPU) OS (\d+)_(\d+)/);
  if (ios) return `${/iPad/.test(ua) ? "iPadOS" : "iOS"} ${ios[1]}.${ios[2]}`;
  // Browsers on a Mac all claim 10.15 (the version is frozen in their user agents).
  if (/Mac OS X/.test(ua)) return "macOS";
  const android = ua.match(/Android (\d+(?:\.\d+)?)/);
  if (android) return `Android ${android[1]}`;
  if (/Windows NT/.test(ua)) return "Windows";
  return null;
}

/** Apple's model identifiers people would recognise; the rest show as they are. */
const MODELS: Record<string, string> = {
  "AppleTV5,3": "Apple TV HD",
  "AppleTV6,2": "Apple TV 4K",
  "AppleTV11,1": "Apple TV 4K (2nd gen)",
  "AppleTV14,1": "Apple TV 4K (3rd gen)",
};

const time = (iso: string) => new Date(iso).getTime();

/** One row: a device, whose it is, where it is, and how to sign it out. */
interface DeviceRow {
  id: string;
  person: string | null;
  userAgent: string | null;
  viewerOnly: boolean;
  household: string | null;
  createdAt: string;
  updatedAt: string;
  isCurrent: boolean;
  /** The app's own name for the device ("Living Room"), when it sent one. */
  name: string | null;
  model: string | null;
  ipAddress: string | null;
  location: string | null;
  macAddress: string | null;
  macIsPrivate: boolean;
  signOut: () => Promise<unknown>;
}

/** The row's title: the app's own name for the device, else what its user agent says. */
function rowTitle(row: DeviceRow): string {
  return row.name || deviceName(row);
}

/** "iPhone17,1 · iOS 27.0", under the title (nothing it already says). */
function rowDetail(row: DeviceRow): string | null {
  const model = row.model ? (MODELS[row.model] ?? row.model) : null;
  const parts = [row.name ? (model ?? platformOf(row.userAgent ?? "")) : model, systemOf(row.userAgent)];
  if (row.name && /Strata/i.test(row.userAgent ?? "")) parts.unshift("Strata");
  const text = parts.filter(Boolean).join(" · ");
  return text || null;
}

/**
 * The household's devices, with whose each one is, for its owner and admins; for everyone
 * else, the devices they're signed in on. Each shows where it was last seen (its address,
 * location and, on a home server's own network, its MAC) and can be signed out.
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
    success: (_, row) => `Signed out ${rowTitle(row)}${row.person ? ` (${row.person})` : ""}`,
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
        name: d.deviceName,
        model: d.deviceModel,
        ipAddress: d.ipAddress,
        location: d.location,
        macAddress: d.macAddress,
        macIsPrivate: d.macIsPrivate,
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
        name: s.deviceName ?? null,
        model: s.deviceModel ?? null,
        ipAddress: s.ipAddress,
        location: s.location ?? null,
        macAddress: null,
        macIsPrivate: false,
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
            ? "Every app, TV and browser signed in to this household: whose it is and where it was last seen. Signing one out sends it back to the sign-in screen."
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
              <TableHead className="hidden lg:table-cell">Network</TableHead>
              <TableHead className="hidden sm:table-cell">Access</TableHead>
              <TableHead className="hidden md:table-cell">Last active</TableHead>
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
                    <Skeleton className="h-10" />
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
              rows.map((row) => {
                const detail = rowDetail(row);
                return (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="py-3 pl-4 whitespace-normal">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium" title={row.userAgent ?? undefined}>
                          {rowTitle(row)}
                        </span>
                        {row.isCurrent && <Badge variant="success">This browser</Badge>}
                      </div>
                      {detail && <p className="text-muted-foreground text-xs">{detail}</p>}
                      {/* On narrow screens the network and activity sit under the device. */}
                      <div className="mt-1 flex flex-col gap-0.5 lg:hidden">
                        <NetworkDetails row={row} />
                        <p className="text-muted-foreground text-xs md:hidden" title={new Date(row.updatedAt).toLocaleString()}>
                          Active {relativeTime(time(row.updatedAt))}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className={isAdmin ? "py-3" : "text-muted-foreground py-3"}>{(isAdmin ? row.person : row.household) ?? "—"}</TableCell>
                    <TableCell className="hidden py-3 lg:table-cell">
                      <div className="flex flex-col gap-0.5">
                        <NetworkDetails row={row} />
                      </div>
                    </TableCell>
                    <TableCell className="hidden py-3 sm:table-cell">{row.viewerOnly ? <Badge variant="secondary">Watch only</Badge> : <Badge variant="accent">Full</Badge>}</TableCell>
                    <TableCell className="hidden py-3 md:table-cell">
                      <p title={new Date(row.updatedAt).toLocaleString()}>{relativeTime(time(row.updatedAt))}</p>
                      <p className="text-muted-foreground text-xs" title={new Date(row.createdAt).toLocaleString()}>
                        Signed in {relativeTime(time(row.createdAt))}
                      </p>
                    </TableCell>
                    <TableCell className="py-3 pr-4 text-right">
                      {!row.isCurrent && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setConfirming(row)}
                          disabled={signOut.isPending && signOut.variables?.id === row.id}
                          aria-label={`Sign out ${rowTitle(row)}`}
                        >
                          <LogOut /> <span className="hidden sm:inline">Sign out</span>
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
      {isAdmin && (
        <p className="text-muted-foreground text-xs">
          A MAC address shows only for devices on this server's own home network: it never travels over the internet. Locations come from Cloudflare when the server is behind it.
        </p>
      )}

      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming ? `Sign out ${rowTitle(confirming)}${confirming.person ? ` (${confirming.person})` : ""}?` : "Sign out device?"}
        description="It will need to sign in again."
        confirmLabel="Sign out"
        onConfirm={() => (confirming ? signOut.mutateAsync(confirming) : undefined)}
      />
    </Page>
  );
}

/** Where the device was last seen: its address, location and (home network) MAC. */
function NetworkDetails({ row }: { row: DeviceRow }) {
  if (!row.ipAddress && !row.location && !row.macAddress) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <>
      {(row.ipAddress || row.location) && (
        <p className="flex flex-wrap items-center gap-x-2 text-xs">
          {row.ipAddress && <span className="font-mono">{row.ipAddress}</span>}
          {row.location && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <MapPin className="size-3" /> {row.location}
            </span>
          )}
        </p>
      )}
      {row.macAddress && (
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
          <span className="font-mono">{row.macAddress}</span>
          {row.macIsPrivate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="cursor-help px-1.5 py-0 text-[10px]" tabIndex={0}>
                  Private Wi-Fi address
                </Badge>
              </TooltipTrigger>
              <TooltipContent className="max-w-64">
                Made up by the device: iPhones and iPads use a different address on each Wi-Fi network, so it doesn't identify the hardware.
              </TooltipContent>
            </Tooltip>
          )}
        </p>
      )}
    </>
  );
}
