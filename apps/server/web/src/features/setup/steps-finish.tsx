import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CircleCheck, CircleDashed, Copy, LayoutDashboard, Library, LoaderCircle, RefreshCw, Tv } from "lucide-react";
import { renderSVG } from "uqr";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileManager } from "@/features/profiles/profile-manager";
import type { StepProps } from "./setup-wizard";
import { StepCard } from "./step-card";

export function ProfilesStep({ onNext, onBack }: StepProps) {
  return (
    <StepCard
      title="Who's watching?"
      description="Your first profile was created from your username — rename it if you like. Add one per person: each keeps its own progress and My List. A Kids profile only shows family-friendly titles, and a PIN keeps a profile private."
      onBack={onBack}
      actions={
        <Button size="lg" onClick={onNext}>
          Continue <ArrowRight />
        </Button>
      }
    >
      <ProfileManager />
    </StepCard>
  );
}

/** The address the apps should use: the server's LAN URL when it knows one, else this page's origin. */
function useServerAddress() {
  const status = useQuery({ queryKey: queryKeys.status, queryFn: api.status });
  const lan = status.data?.network.urls[0];
  const here = window.location.origin;
  // Opened via localhost: other devices can't use that, so prefer the LAN address.
  const isLoopback = /^https?:\/\/(localhost|127\.|\[::1\])/.test(here);
  return { address: isLoopback ? (lan ?? here) : here, lan, loading: status.isPending && isLoopback };
}

function QrCode({ value }: { value: string }) {
  const svg = useMemo(() => renderSVG(value, { border: 2, pixelSize: 6, blackColor: "#000", whiteColor: "#fff" }), [value]);
  // uqr builds the SVG from the QR matrix itself; nothing user-supplied is interpolated as markup.
  return <div className="size-44 overflow-hidden rounded-lg bg-white p-1 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label={`QR code for ${value}`} dangerouslySetInnerHTML={{ __html: svg }} />;
}

export function DevicesStep({ info, onNext, onBack }: StepProps) {
  const { address, lan, loading } = useServerAddress();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy — select the address instead");
    }
  };
  return (
    <StepCard
      title="Connect your devices"
      description="Install Strata on your iPhone, iPad, Mac or Apple TV, then pick this server."
      onBack={onBack}
      actions={
        <Button size="lg" onClick={onNext}>
          Continue <ArrowRight />
        </Button>
      }
    >
      <div className="grid gap-6 sm:grid-cols-[auto_1fr] sm:items-start">
        {loading ? <Skeleton className="size-44" /> : <QrCode value={address} />}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Server address</p>
            <div className="flex items-center gap-2">
              <code className="bg-muted min-w-0 truncate rounded-md px-3 py-2 text-sm">{address}</code>
              <Button variant="outline" size="icon" onClick={() => void copy()} aria-label="Copy address">
                <Copy />
              </Button>
            </div>
            {lan && lan !== address && <p className="text-muted-foreground text-xs">On your home network: {lan}</p>}
          </div>
          <ol className="text-muted-foreground list-decimal space-y-1.5 pl-5 text-sm">
            <li>On your home network, “{info.serverName}” shows up in the app by itself (Bonjour).</li>
            <li>Otherwise, enter the address above, or scan the code with your iPhone's camera.</li>
            <li>Sign in with the admin account you just created, then pick a profile.</li>
          </ol>
          <div className="flex gap-3 rounded-lg border p-3">
            <Tv className="text-muted-foreground mt-0.5 size-5 shrink-0" />
            <p className="text-muted-foreground text-sm">
              <span className="text-foreground font-medium">Apple TV:</span> choose to sign in with a code. The TV shows a code and a QR code; scan it with an iPhone that's already signed in to this server and approve it there — no typing a password with the remote.
            </p>
          </div>
        </div>
      </div>
    </StepCard>
  );
}

export function DoneStep({ onBack, onFinish }: Omit<StepProps, "onNext"> & { onFinish: (to?: string) => void }) {
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings });
  const profiles = useQuery({ queryKey: queryKeys.profiles, queryFn: api.profiles });
  const [syncing, setSyncing] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);

  const s = settings.data;
  const torbox = !!s?.secrets.torboxApiKey;

  const syncTorbox = async () => {
    setSyncing(true);
    try {
      await api.runJob("syncTorbox");
      toast.success("TorBox sync started");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSyncing(false);
    }
  };

  const finish = async (to: string) => {
    setLeaving(to);
    if (s?.settings.mediaFolders.length) {
      try {
        await api.runJob("scanLocal");
      } catch {
        /* the scan also runs on its schedule */
      }
    }
    onFinish(to);
  };

  return (
    <StepCard
      title="You're set"
      description="Strata scans your folders and matches files in the background. Here's where things stand."
      onBack={onBack}
      actions={
        <>
          <Button size="lg" variant="outline" onClick={() => void finish("/library")} disabled={!!leaving}>
            {leaving === "/library" ? <LoaderCircle className="animate-spin" /> : <Library />}
            Open Library
          </Button>
          <Button size="lg" onClick={() => void finish("/")} disabled={!!leaving}>
            {leaving === "/" ? <LoaderCircle className="animate-spin" /> : <LayoutDashboard />}
            Go to Overview
          </Button>
        </>
      }
    >
      {!s || !profiles.data ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          <Summary done label="Admin account" detail="Created" />
          <Summary done={s.secrets.tmdbApiKey} label="TMDB" detail={s.secrets.tmdbApiKey ? "Connected" : "Not set — add it in Settings › Provider keys"} />
          <Summary
            done={torbox}
            optional
            label="TorBox"
            detail={torbox ? "Connected" : "Not set"}
            action={
              torbox && (
                <Button variant="outline" size="sm" onClick={() => void syncTorbox()} disabled={syncing}>
                  {syncing ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                  Sync TorBox now
                </Button>
              )
            }
          />
          <Summary
            done={s.settings.mediaFolders.length > 0}
            optional
            label="Media folders"
            detail={s.settings.mediaFolders.length ? `${s.settings.mediaFolders.length} folder${s.settings.mediaFolders.length === 1 ? "" : "s"}` : "None"}
          />
          <Summary done={profiles.data.length > 0} label="Profiles" detail={profiles.data.map((p) => p.name).join(", ") || "None"} />
          <Summary done label="Server name" detail={s.settings.serverName} />
        </ul>
      )}
      <p className="text-muted-foreground text-sm">Unmatched files can be fixed from Library. Keys, folders and playback limits live in Settings. Active streams and background jobs show on the Overview.</p>
    </StepCard>
  );
}

function Summary({ done, optional, label, detail, action }: { done: boolean; optional?: boolean; label: string; detail: string; action?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 p-3">
      {done ? <CircleCheck className="text-ok size-5 shrink-0" /> : <CircleDashed className="text-muted-foreground size-5 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          {label}
          {optional && !done && <Badge variant="secondary">Optional</Badge>}
        </p>
        <p className="text-muted-foreground truncate text-sm">{detail}</p>
      </div>
      {action}
    </li>
  );
}
