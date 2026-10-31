import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { Provider, ServerInfo, Settings, SettingsResponse } from "@/lib/types";
import { ErrorAlert, KeyValue, KeyValueList, Page, PageHeader, PageSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldDescription, FieldGroup, FieldLabel, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NumberInput, SwitchField, type SetFn } from "./fields";
import { MediaFolders } from "./media-folders";
import { SecretKeyForm } from "./secret-key-form";
import { UpdatesCard } from "./updates-card";

const PROVIDER_LABEL: Record<Provider, string> = { local: "Local folders", torbox: "TorBox" };

const TABS = [
  { value: "general", label: "General" },
  { value: "library", label: "Library" },
  { value: "playback", label: "Playback" },
  { value: "keys", label: "Provider keys" },
  { value: "updates", label: "Updates" },
] as const;
type TabValue = (typeof TABS)[number]["value"];

/** #keys and #updates (linked from the Overview) open their tab. */
function tabFromHash(): TabValue {
  const h = location.hash.slice(1);
  return (TABS.find((t) => t.value === h)?.value ?? "general") as TabValue;
}

export default function SettingsPage() {
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings, staleTime: Infinity });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [tab, setTab] = useState<TabValue>(tabFromHash);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const data = settings.data;

  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(data.settings) !== JSON.stringify(draft), [data, draft]);

  if (settings.isPending) return <PageSkeleton cards={2} />;
  if (!data || !draft) {
    return (
      <Page>
        <PageHeader title="Settings" />
        <ErrorAlert error={settings.error} title="Couldn't load settings" onRetry={() => void settings.refetch()} />
      </Page>
    );
  }

  const set: SetFn = (key, value) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!draft.serverName.trim()) {
      setTab("general");
      setSaveError("Give the server a name.");
      return;
    }
    const patch: Partial<Settings> = {};
    for (const k of Object.keys(draft) as (keyof Settings)[]) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(data.settings[k])) (patch as Record<string, unknown>)[k] = draft[k];
    }
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await api.updateSettings(patch);
      queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (d) => (d ? { ...d, settings: r.settings } : d));
      setDraft(r.settings);
      if (patch.serverName) queryClient.setQueryData<ServerInfo>(queryKeys.info, (i) => (i ? { ...i, serverName: r.settings.serverName } : i));
      void queryClient.invalidateQueries({ queryKey: queryKeys.status });
      toast.success("Settings saved");
    } catch (err) {
      setSaveError(errorMessage(err));
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page className="max-w-4xl pb-24">
      <PageHeader title="Settings" description="Changes apply to every client of this server." />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as TabValue);
          history.replaceState(null, "", `${location.pathname}${location.search}${v === "general" ? "" : `#${v}`}`);
        }}
        className="gap-6"
      >
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList>
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="general" className="flex flex-col gap-6">
          <ServerCard draft={draft} set={set} />
          <NetworkCard draft={draft} set={set} />
        </TabsContent>

        <TabsContent value="library" className="flex flex-col gap-6">
          <SectionCard title="Media folders" description="Folders on this server that hold movies or shows.">
            <MediaFolders value={draft.mediaFolders} onChange={(v) => set("mediaFolders", v)} />
          </SectionCard>
          <ScanningCard draft={draft} set={set} />
          <SourcesCard draft={draft} set={set} />
        </TabsContent>

        <TabsContent value="playback" className="flex flex-col gap-6">
          <DiscoveryCard draft={draft} set={set} />
          <TranscodingCard draft={draft} set={set} />
        </TabsContent>

        <TabsContent value="keys" className="flex flex-col gap-6">
          <ProviderKeysCard secrets={data.secrets} />
        </TabsContent>

        <TabsContent value="updates" className="flex flex-col gap-6">
          <UpdatesCard draft={draft} set={set} />
        </TabsContent>
      </Tabs>

      {(dirty || saveError) && (
        <form
          onSubmit={save}
          className="bg-background/95 animate-in slide-in-from-bottom-4 fixed inset-x-4 bottom-4 z-30 mx-auto flex max-w-3xl flex-col gap-2 rounded-xl border p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center md:left-[calc(var(--sidebar-width)+1rem)]"
          aria-label="Unsaved changes"
        >
          <p className="text-muted-foreground flex-1 text-sm">{saveError ? <span className="text-destructive">{saveError}</span> : "You have unsaved changes."}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setDraft(data.settings);
                setSaveError(null);
              }}
            >
              Discard
            </Button>
            <Button type="submit" disabled={saving || !dirty}>
              {saving && <LoaderCircle className="animate-spin" />}
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      )}
    </Page>
  );
}

function SectionCard({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function ServerCard({ draft, set }: { draft: Settings; set: SetFn }) {
  return (
    <SectionCard title="Server">
      <FieldGroup>
        <FormField label="Server name" description="Shown in the apps when they find this server." error={!draft.serverName.trim() ? "Give the server a name." : null}>
          {(p) => <Input {...p} value={draft.serverName} maxLength={64} onChange={(e) => set("serverName", e.target.value)} required />}
        </FormField>
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField label="Metadata language" description="TMDB language tag, e.g. en-US, fr-FR, ja-JP." error={draft.language && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(draft.language) ? "Use a tag like en-US." : null}>
            {(p) => <Input {...p} className="font-mono" value={draft.language} onChange={(e) => set("language", e.target.value)} spellCheck={false} autoCapitalize="off" />}
          </FormField>
          <FormField label="Region" description="Two-letter country code for release dates and ratings, e.g. US, GB." error={draft.region && !/^[A-Z]{2}$/.test(draft.region) ? "Use two letters, like US." : null}>
            {(p) => <Input {...p} className="font-mono" value={draft.region} maxLength={2} onChange={(e) => set("region", e.target.value.toUpperCase())} spellCheck={false} autoCapitalize="characters" />}
          </FormField>
        </div>
      </FieldGroup>
    </SectionCard>
  );
}

function NetworkCard({ draft, set }: { draft: Settings; set: SetFn }) {
  const status = useQuery({ queryKey: queryKeys.status, queryFn: api.status });
  const net = status.data?.network;
  return (
    <SectionCard title="Network">
      <FieldGroup>
        <KeyValueList>
          <KeyValue k="Host" mono>
            {net ? net.host : "—"}
          </KeyValue>
          <KeyValue k="Port" mono>
            {net ? net.port : "—"}
          </KeyValue>
          <KeyValue k="LAN URL" mono>
            {net?.urls.length
              ? net.urls.map((u) => (
                  <div key={u}>
                    <a href={u} className="hover:underline">
                      {u}
                    </a>
                  </div>
                ))
              : "—"}
          </KeyValue>
        </KeyValueList>
        <FieldDescription>
          Port and bind address are set when the server starts (<code>--port</code>, <code>--host</code>, or <code>STRATA_PORT</code> / <code>STRATA_HOST</code>), so a change here can't lock you out of the
          dashboard.
        </FieldDescription>
        <Separator />
        <SwitchField
          checked={draft.bonjourEnabled}
          onChange={(v) => set("bonjourEnabled", v)}
          label="Bonjour discovery"
          description={`Advertise this server on the local network so the Strata apps find it automatically.${net && draft.bonjourEnabled && !net.bonjour ? " (Not advertising right now — see Logs.)" : ""}`}
        />
        <SwitchField
          checked={draft.localJoin}
          onChange={(v) => set("localJoin", v)}
          label="No password at home"
          description="Devices on your home network skip sign-in and go straight to picking a profile (PINs still apply). They can watch but can't change settings. Away from home, devices sign in with your account. Turn this off before exposing the server through a tunnel or port forward that hides visitors' addresses."
        />
      </FieldGroup>
    </SectionCard>
  );
}

function ScanningCard({ draft, set }: { draft: Settings; set: SetFn }) {
  return (
    <SectionCard title="Scanning & sync">
      <FieldGroup>
        <FormField label="Scan local folders every" description="Minutes. 0 turns scheduled scans off.">
          {(p) => <NumberInput {...p} min={0} suffix="min" value={draft.scanIntervalMinutes} onChange={(v) => set("scanIntervalMinutes", v)} />}
        </FormField>
        <FormField label="Sync TorBox every" description="Minutes. 0 turns scheduled syncs off.">
          {(p) => <NumberInput {...p} min={0} suffix="min" value={draft.torboxSyncMinutes} onChange={(v) => set("torboxSyncMinutes", v)} />}
        </FormField>
        <FormField
          label="Remove unplayed TorBox releases after"
          description="Releases Strata added to find something to play are removed from TorBox once nobody has played them for this long. Anything you add in TorBox yourself is never touched. 0 keeps everything."
        >
          {(p) => <NumberInput {...p} min={0} max={365} suffix="days" value={draft.torboxCleanupDays} onChange={(v) => set("torboxCleanupDays", v)} />}
        </FormField>
      </FieldGroup>
    </SectionCard>
  );
}

function SourcesCard({ draft, set }: { draft: Settings; set: SetFn }) {
  // Every provider must appear in the order list, even if an older config dropped one.
  const priority: Provider[] = [...draft.sourcePriority, ...(["local", "torbox"] as Provider[]).filter((p) => !draft.sourcePriority.includes(p))];
  const move = (i: number, dir: -1 | 1) => {
    const next = [...priority];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set("sourcePriority", next);
  };
  return (
    <SectionCard title="Sources & quality">
      <FieldGroup>
        <div className="flex flex-col gap-2">
          <FieldLabel id="priority-label">Source priority</FieldLabel>
          <ol className="divide-y rounded-lg border" aria-labelledby="priority-label">
            {priority.map((p, i) => (
              <li key={p} className="flex items-center gap-3 px-3 py-2">
                <span className="text-muted-foreground w-4 font-mono text-sm">{i + 1}</span>
                <span className="flex-1 text-sm font-medium">{PROVIDER_LABEL[p]}</span>
                <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${PROVIDER_LABEL[p]} up`}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" disabled={i === priority.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${PROVIDER_LABEL[p]} down`}>
                  <ArrowDown />
                </Button>
              </li>
            ))}
          </ol>
          <FieldDescription>When a title exists in both, the first source wins.</FieldDescription>
        </div>
        <FormField label="Maximum resolution" description="Higher-resolution sources are ranked below ones within the cap.">
          {(p) => (
            <ToggleGroup id={p.id} aria-describedby={p["aria-describedby"]} type="single" variant="outline" value={String(draft.maxResolution)} onValueChange={(v) => v && set("maxResolution", Number(v))}>
              {[2160, 1080, 720].map((r) => (
                <ToggleGroupItem key={r} value={String(r)} className="px-4">
                  {r === 2160 ? "4K" : `${r}p`}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </FormField>
      </FieldGroup>
    </SectionCard>
  );
}

function DiscoveryCard({ draft, set }: { draft: Settings; set: SetFn }) {
  const urlInvalid = !!draft.torrentioUrl && !/^https?:\/\/\S+$/.test(draft.torrentioUrl);
  return (
    <SectionCard title="Discovery" description="Find playable releases of titles that aren't in your library.">
      <FieldGroup>
        <SwitchField checked={draft.discoveryEnabled} onChange={(v) => set("discoveryEnabled", v)} label="Find releases on TorBox" description="Look for playable TorBox releases of titles that aren't in your library." />
        <FormField label="Stream addon URL" description="A Torrentio-compatible Stremio addon to search. Leave empty to turn it off." error={urlInvalid ? "Enter a full http(s) URL." : null}>
          {(p) => (
            <Input {...p} className="font-mono" type="url" placeholder="https://torrentio.strem.fun" value={draft.torrentioUrl} onChange={(e) => set("torrentioUrl", e.target.value.trim())} spellCheck={false} autoCapitalize="off" />
          )}
        </FormField>
        <SwitchField checked={draft.useTorboxSearch} onChange={(v) => set("useTorboxSearch", v)} label="Use TorBox search" description="Also ask TorBox's own search for releases." />
        <SwitchField checked={draft.showUncached} onChange={(v) => set("showUncached", v)} label="Show uncached releases" description="Offer releases TorBox hasn't cached yet; they download before they can play." />
        <FormField label="Largest automatic pick" description="In GB. Discovery won't auto-pick a bigger release. 0 means no limit.">
          {(p) => <NumberInput {...p} min={0} step={0.5} suffix="GB" value={draft.maxReleaseSizeGb} onChange={(v) => set("maxReleaseSizeGb", v)} />}
        </FormField>
      </FieldGroup>
    </SectionCard>
  );
}

function TranscodingCard({ draft, set }: { draft: Settings; set: SetFn }) {
  return (
    <SectionCard title="Transcoding">
      <FieldGroup>
        <SwitchField checked={draft.hardwareAcceleration} onChange={(v) => set("hardwareAcceleration", v)} label="Hardware acceleration" description="Use VideoToolbox / VAAPI / QSV when a full transcode is needed." />
        <FormField label="Concurrent transcodes" description="1–16. How many ffmpeg remux/transcode jobs may run at once.">
          {(p) => <NumberInput {...p} min={1} max={16} value={draft.maxTranscodes} onChange={(v) => set("maxTranscodes", v)} />}
        </FormField>
      </FieldGroup>
    </SectionCard>
  );
}

function ProviderKeysCard({ secrets }: { secrets: SettingsResponse["secrets"] }) {
  return (
    <SectionCard title="Provider keys" description="Each key is checked with its provider, then stored encrypted on this server.">
      <div className="flex flex-col gap-6">
        <SecretKeyForm
          secretKey="tmdbApiKey"
          label="TMDB API key"
          required
          configured={secrets.tmdbApiKey}
          description={
            <>
              v3 API key or v4 read access token from{" "}
              <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
                themoviedb.org/settings/api
              </a>
              .
            </>
          }
        />
        <Separator />
        <SecretKeyForm
          secretKey="torboxApiKey"
          label="TorBox API key"
          configured={secrets.torboxApiKey}
          description={
            <>
              From{" "}
              <a href="https://torbox.app/settings" target="_blank" rel="noreferrer">
                torbox.app/settings
              </a>
              . Saving it starts a library sync.
            </>
          }
        />
      </div>
    </SectionCard>
  );
}
