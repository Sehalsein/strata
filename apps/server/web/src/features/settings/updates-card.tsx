import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, Download, LoaderCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { queryClient, queryKeys } from "@/lib/query";
import type { Settings, UpdateStatus } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { InlineError, KeyValue, KeyValueList } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SwitchField, type SetFn } from "./fields";

const STATE_LABEL: Record<UpdateStatus["state"], string> = {
  idle: "Up to date",
  checking: "Checking…",
  available: "Update available",
  downloading: "Downloading…",
  "waiting-for-idle": "Waiting for streams to finish",
  restarting: "Restarting…",
  error: "Error",
};

const BUSY: UpdateStatus["state"][] = ["checking", "downloading", "waiting-for-idle", "restarting"];

export function UpdatesCard({ draft, set }: { draft: Settings; set: SetFn }) {
  const [startedFrom, setStartedFrom] = useState<string | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const autoCheckStarted = useRef(false);

  const query = useQuery({
    queryKey: queryKeys.updateStatus,
    queryFn: api.updateStatus,
    // Poll while something is in flight, and through a restart until the new version answers.
    refetchInterval: (q) => (q.state.data && BUSY.includes(q.state.data.state)) || startedFrom ? 2000 : false,
  });
  const status = query.data;
  const busy = !!status && BUSY.includes(status.state);
  const setStatus = (s: UpdateStatus) => queryClient.setQueryData(queryKeys.updateStatus, s);

  const restartedInto = startedFrom && status && status.currentVersion !== startedFrom ? status.currentVersion : null;
  useEffect(() => {
    if (restartedInto) {
      setStartedFrom(null);
      toast.success(`Updated to v${restartedInto}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.info });
    }
  }, [restartedInto]);

  const check = async () => {
    setPending("check");
    setActionError(null);
    try {
      const s = await api.checkUpdate();
      setStatus(s);
      if (!s.updateAvailable && !s.lastError) toast.success("Strata is up to date");
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  // Menu-bar and overview links ask for one check (?checkUpdate=1) once the status has loaded.
  useEffect(() => {
    if (!status || busy || autoCheckStarted.current) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("checkUpdate") !== "1") return;
    autoCheckStarted.current = true;
    url.searchParams.delete("checkUpdate");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, busy]);

  const apply = async () => {
    if (!status?.latest) return;
    setPending("apply");
    setActionError(null);
    try {
      setStartedFrom(status.currentVersion);
      setStatus(await api.applyUpdate());
    } catch (err) {
      setStartedFrom(null);
      setActionError(errorMessage(err));
      throw err;
    } finally {
      setPending(null);
    }
  };

  const progress = status?.progress;
  const manifestCustom = draft.updateManifestUrl !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>Strata updates itself from a signed release feed.</CardDescription>
        {status && (
          <CardAction>
            <Badge variant={status.state === "error" ? "destructive" : status.updateAvailable ? "accent" : busy ? "secondary" : "success"}>
              {status.state === "idle" && status.updateAvailable ? "Update available" : STATE_LABEL[status.state]}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <KeyValueList>
            <KeyValue k="Running" mono>
              {status ? `v${status.currentVersion}` : "—"} {status && <span className="text-muted-foreground">· {status.platform}</span>}
            </KeyValue>
            <KeyValue k="Latest" mono>
              {status?.latest ? `v${status.latest.version}` : "—"}
              {status?.lastCheckedAt && <span className="text-muted-foreground"> · checked {relativeTime(status.lastCheckedAt)}</span>}
            </KeyValue>
          </KeyValueList>

          {status?.latest?.notes && status.updateAvailable && <p className="text-muted-foreground bg-muted/40 rounded-md border p-3 text-sm whitespace-pre-wrap">{status.latest.notes}</p>}
          {status?.disabledReason && <p className="text-muted-foreground text-sm">{status.disabledReason}</p>}
          {status?.state === "downloading" && progress && (
            <div className="flex items-center gap-3">
              <Progress value={(progress.received / Math.max(1, progress.total)) * 100} aria-label="Download progress" />
              <span className="text-muted-foreground font-mono text-xs">{Math.round((progress.received / Math.max(1, progress.total)) * 100)}%</span>
            </div>
          )}
          {status?.state === "waiting-for-idle" && <p className="text-muted-foreground text-sm">The update is downloaded and verified. Strata restarts when the last stream stops.</p>}
          <InlineError error={status?.lastError} />
          <InlineError error={actionError ?? (query.error && !startedFrom ? query.error : null)} />

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void check()} disabled={pending !== null || busy}>
              {pending === "check" || status?.state === "checking" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
              {pending === "check" || status?.state === "checking" ? "Checking…" : "Check for updates"}
            </Button>
            {status?.updateAvailable && !status.disabledReason && (
              <Button size="sm" onClick={() => setConfirming(true)} disabled={pending !== null || busy}>
                {pending === "apply" ? <LoaderCircle className="animate-spin" /> : <Download />}
                {pending === "apply" ? "Starting…" : `Update to v${status.latest?.version}`}
              </Button>
            )}
            {busy && (
              <Button variant="ghost" size="sm" onClick={() => void query.refetch()}>
                Refresh
              </Button>
            )}
          </div>

          <FormField label="Channel" description="Nightly is built from every change and is unreviewed. Switching back to stable from a nightly installs the stable release. Save before checking.">
            {(p) => (
              <ToggleGroup id={p.id} aria-describedby={p["aria-describedby"]} type="single" variant="outline" value={draft.updateChannel} onValueChange={(v) => v && set("updateChannel", v as Settings["updateChannel"])}>
                <ToggleGroupItem value="stable" className="px-4">
                  Stable
                </ToggleGroupItem>
                <ToggleGroupItem value="nightly" className="px-4">
                  Nightly
                </ToggleGroupItem>
              </ToggleGroup>
            )}
          </FormField>

          <SwitchField checked={draft.autoUpdate} onChange={(v) => set("autoUpdate", v)} label="Install updates automatically" description="Checked every 6 hours; installs when nothing is playing." />

          <Collapsible defaultOpen={manifestCustom}>
            <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium">
              <ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90" />
              Advanced
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 flex flex-col gap-3">
              <FormField
                label="Manifest URL override"
                description={
                  <>
                    Leave empty to use the feed built into this server. <code>{"{channel}"}</code> becomes stable or nightly; the signature is read from the same URL plus <code>.sig</code> and must still match
                    the built-in key.
                  </>
                }
              >
                {(p) => (
                  <Input
                    {...p}
                    className="font-mono"
                    type="url"
                    placeholder={!manifestCustom && status?.manifestUrl ? status.manifestUrl : "https://…/manifest.json"}
                    value={draft.updateManifestUrl}
                    onChange={(e) => set("updateManifestUrl", e.target.value.trim())}
                    spellCheck={false}
                    autoCapitalize="off"
                  />
                )}
              </FormField>
              {manifestCustom && (
                <div>
                  <Button variant="ghost" size="sm" onClick={() => set("updateManifestUrl", "")}>
                    Use the built-in feed
                  </Button>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </FieldGroup>
      </CardContent>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Install v${status?.latest?.version ?? ""}?`}
        description="Strata restarts once nothing is playing."
        confirmLabel="Install update"
        destructive={false}
        onConfirm={apply}
      />
    </Card>
  );
}
