import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Cable, Compass, Globe, Library, LoaderCircle, Network, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { Provider, ServerInfo, Settings, SettingsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorAlert, Page, PageHeader, PageSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { NumberInput, type SetFn } from "./fields";
import { MediaFolders } from "./media-folders";
import { Connections } from "./connections";
import { SettingRow, SettingsSection, ToggleRow } from "./layout";
import { UpdatesCard } from "./updates-card";
import { useSession } from "@/app/session";

const PROVIDER_LABEL: Record<Provider, string> = { local: "Local folders", torbox: "TorBox" };

type SectionId = "general" | "library" | "discovery" | "connections" | "server" | "network" | "updates";
interface Section {
  id: SectionId;
  label: string;
  icon: typeof Globe;
  group: "household" | "server";
}

/** Old links (#keys, #playback) still land in the right place. */
const ALIASES: Record<string, SectionId> = { keys: "connections", playback: "discovery" };

function sectionFromHash(available: Section[]): SectionId {
  const h = location.hash.slice(1);
  const id = (ALIASES[h] ?? h) as SectionId;
  return available.some((s) => s.id === id) ? id : "general";
}

/**
 * Settings, split by whose they are: this household's (its owner and admins) and the
 * server's (its admin). Each section is a list of rows; changes collect in a bar at the
 * bottom until saved. Keys save on their own (they're checked with the provider first).
 */
export default function SettingsPage() {
  const { isServerAdmin, cloud } = useSession();
  const sections: Section[] = [
    { id: "general", label: "General", icon: Globe, group: "household" },
    { id: "library", label: "Library", icon: Library, group: "household" },
    { id: "discovery", label: "Discovery", icon: Compass, group: "household" },
    { id: "connections", label: "Connections", icon: Cable, group: "household" },
    ...(isServerAdmin
      ? ([
          { id: "server", label: "Server", icon: Server, group: "server" },
          ...(!cloud ? [{ id: "network", label: "Network", icon: Network, group: "server" } as Section, { id: "updates", label: "Updates", icon: RefreshCw, group: "server" } as Section] : []),
        ] as Section[])
      : []),
  ];
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings, staleTime: Infinity });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [section, setSection] = useState<SectionId>(() => sectionFromHash(sections));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const data = settings.data;

  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash(sections));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isServerAdmin, cloud]);

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

  const go = (id: SectionId) => {
    setSection(id);
    history.replaceState(null, "", `${location.pathname}${location.search}${id === "general" ? "" : `#${id}`}`);
  };

  const set: SetFn = (key, value) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isServerAdmin && !draft.serverName.trim()) {
      go("server");
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

  const current = sections.find((s) => s.id === section)!;

  return (
    <Page className="max-w-5xl pb-24">
      <PageHeader title="Settings" />

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        <SettingsNav sections={sections} current={section} onChange={go} />

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <h2 className="text-xl font-semibold">{current.label}</h2>

          {section === "general" && (
            <SettingsSection title="Catalog" description="How titles and dates are shown.">
              <SettingRow
                label="Language"
                htmlFor="language"
                description="For titles, overviews and artwork, as a TMDB language tag: en-US, fr-FR, ja-JP."
                error={draft.language && !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(draft.language) ? "Use a tag like en-US." : null}
              >
                <Input id="language" className="font-mono sm:w-48" value={draft.language} onChange={(e) => set("language", e.target.value)} spellCheck={false} autoCapitalize="off" />
              </SettingRow>
              <SettingRow
                label="Region"
                htmlFor="region"
                description="Two-letter country code for release dates and age ratings: US, GB."
                error={draft.region && !/^[A-Z]{2}$/.test(draft.region) ? "Use two letters, like US." : null}
              >
                <Input id="region" className="font-mono sm:w-24" value={draft.region} maxLength={2} onChange={(e) => set("region", e.target.value.toUpperCase())} spellCheck={false} autoCapitalize="characters" />
              </SettingRow>
            </SettingsSection>
          )}

          {section === "library" && (
            <>
              {!cloud && (
                <SettingsSection title="Media folders" description="Folders on this server that hold the household's movies and shows. Strata scans them and matches each file.">
                  <div className="p-5">
                    <MediaFolders value={draft.mediaFolders} onChange={(v) => set("mediaFolders", v)} canBrowse={isServerAdmin} />
                  </div>
                </SettingsSection>
              )}
              <SourcesSection draft={draft} set={set} />
              <SettingsSection title="TorBox" description="Keeping the household's TorBox library in step.">
                <SettingRow label="Sync every" htmlFor="torbox-sync" description="How often Strata picks up what's new in TorBox. 0 turns it off.">
                  <NumberInput id="torbox-sync" min={0} suffix="min" value={draft.torboxSyncMinutes} onChange={(v) => set("torboxSyncMinutes", v)} />
                </SettingRow>
                <SettingRow
                  label="Clean up after"
                  htmlFor="torbox-cleanup"
                  description="Releases Strata added to TorBox for you are removed once nobody has played them for this long. What you add yourself is never touched. 0 keeps everything."
                >
                  <NumberInput id="torbox-cleanup" min={0} max={365} suffix="days" value={draft.torboxCleanupDays} onChange={(v) => set("torboxCleanupDays", v)} />
                </SettingRow>
              </SettingsSection>
            </>
          )}

          {section === "discovery" && (
            <SettingsSection title="Finding releases" description="Playable releases for titles that aren't in the library yet.">
              <ToggleRow label="Find releases" description="Look for TorBox releases of titles that aren't in the library." checked={draft.discoveryEnabled} onChange={(v) => set("discoveryEnabled", v)} />
              <ToggleRow label="Use TorBox search" description="Also ask TorBox's own search." checked={draft.useTorboxSearch} onChange={(v) => set("useTorboxSearch", v)} />
              <ToggleRow label="Show uncached releases" description="Offer releases TorBox hasn't cached yet. They download before they can play." checked={draft.showUncached} onChange={(v) => set("showUncached", v)} />
              <SettingRow label="Largest automatic pick" htmlFor="max-size" description="Discovery won't pick a bigger release by itself. 0 means no limit.">
                <NumberInput id="max-size" min={0} step={0.5} suffix="GB" value={draft.maxReleaseSizeGb} onChange={(v) => set("maxReleaseSizeGb", v)} />
              </SettingRow>
            </SettingsSection>
          )}

          {section === "connections" && <Connections secrets={data.secrets} />}

          {section === "server" && isServerAdmin && <ServerSections draft={draft} set={set} cloud={cloud} />}
          {section === "network" && isServerAdmin && !cloud && <NetworkSection draft={draft} set={set} />}
          {section === "updates" && isServerAdmin && !cloud && <UpdatesCard draft={draft} set={set} />}
        </div>
      </div>

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

/** Sections grouped by whose they are: a column on wide screens, a scrolling row on narrow ones. */
function SettingsNav({ sections, current, onChange }: { sections: Section[]; current: SectionId; onChange: (id: SectionId) => void }) {
  // The household is the one the sidebar's switcher shows; the server's sections are its admin's.
  const groups = [
    { id: "household" as const, label: "Household" },
    { id: "server" as const, label: "Server" },
  ].filter((g) => sections.some((s) => s.group === g.id));
  return (
    <nav aria-label="Settings sections" className="md:sticky md:top-20 md:w-52 md:shrink-0">
      <div className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:flex-col md:gap-5 md:overflow-visible md:px-0">
        {groups.map((g) => (
          <div key={g.id} className="flex shrink-0 gap-1 md:flex-col">
            <p className="text-muted-foreground hidden truncate px-2.5 pb-1 text-xs font-medium md:block">{g.label}</p>
            {sections
              .filter((s) => s.group === g.id)
              .map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onChange(s.id)}
                  aria-current={current === s.id ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    current === s.id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <s.icon className="size-4" />
                  {s.label}
                </button>
              ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

function SourcesSection({ draft, set }: { draft: Settings; set: SetFn }) {
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
    <SettingsSection title="Sources & quality" description="Which copy plays when there's more than one.">
      <SettingRow label="Source order" description="When a title is in both, the first source wins.">
        <ol className="divide-y rounded-lg border sm:w-64" aria-label="Source order">
          {priority.map((p, i) => (
            <li key={p} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
              <span className="text-muted-foreground w-4 font-mono text-xs">{i + 1}</span>
              <span className="flex-1 text-sm">{PROVIDER_LABEL[p]}</span>
              <Button variant="ghost" size="icon-sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${PROVIDER_LABEL[p]} up`}>
                <ArrowUp />
              </Button>
              <Button variant="ghost" size="icon-sm" disabled={i === priority.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${PROVIDER_LABEL[p]} down`}>
                <ArrowDown />
              </Button>
            </li>
          ))}
        </ol>
      </SettingRow>
      <SettingRow label="Highest quality" description="Sharper sources rank below ones within this.">
        <ToggleGroup type="single" variant="outline" value={String(draft.maxResolution)} onValueChange={(v) => v && set("maxResolution", Number(v))} aria-label="Highest quality">
          {[2160, 1080, 720].map((r) => (
            <ToggleGroupItem key={r} value={String(r)} className="px-4">
              {r === 2160 ? "4K" : `${r}p`}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingRow>
    </SettingsSection>
  );
}

function ServerSections({ draft, set, cloud }: { draft: Settings; set: SetFn; cloud: boolean }) {
  const urlInvalid = !!draft.torrentioUrl && !/^https?:\/\/\S+$/.test(draft.torrentioUrl);
  return (
    <>
      <SettingsSection title="Identity">
        <SettingRow label="Server name" htmlFor="server-name" description="What the apps call this server when they find it." error={!draft.serverName.trim() ? "Give the server a name." : null}>
          <Input id="server-name" className="sm:w-64" value={draft.serverName} maxLength={64} onChange={(e) => set("serverName", e.target.value)} required />
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Library" description="For every household.">
        {!cloud && (
          <SettingRow label="Scan folders every" htmlFor="scan-every" description="How often every household's media folders are checked for new files. 0 turns it off.">
            <NumberInput id="scan-every" min={0} suffix="min" value={draft.scanIntervalMinutes} onChange={(v) => set("scanIntervalMinutes", v)} />
          </SettingRow>
        )}
        <SettingRow
          label="Stream addon"
          htmlFor="addon-url"
          description="A Torrentio-compatible Stremio addon that discovery searches. Empty turns it off."
          error={urlInvalid ? "Enter a full http(s) address." : null}
        >
          <Input id="addon-url" className="font-mono sm:w-72" type="url" placeholder="https://torrentio.strem.fun" value={draft.torrentioUrl} onChange={(e) => set("torrentioUrl", e.target.value.trim())} spellCheck={false} autoCapitalize="off" />
        </SettingRow>
      </SettingsSection>
      {!cloud && (
        <SettingsSection title="Transcoding" description="Only for files on this server's disk; TorBox video plays straight from TorBox.">
          <ToggleRow label="Hardware acceleration" description="VideoToolbox, VAAPI or QSV when a file has to be converted." checked={draft.hardwareAcceleration} onChange={(v) => set("hardwareAcceleration", v)} />
          <SettingRow label="At the same time" htmlFor="max-transcodes" description="How many conversions may run at once (1–16).">
            <NumberInput id="max-transcodes" min={1} max={16} value={draft.maxTranscodes} onChange={(v) => set("maxTranscodes", v)} />
          </SettingRow>
        </SettingsSection>
      )}
    </>
  );
}

function NetworkSection({ draft, set }: { draft: Settings; set: SetFn }) {
  const status = useQuery({ queryKey: queryKeys.status, queryFn: api.status });
  const net = status.data?.network;
  return (
    <>
      <SettingsSection title="Addresses" description="Set when the server starts (--port and --host, or STRATA_PORT and STRATA_HOST), so nothing here can lock you out.">
        <SettingRow label="On your network">
          <div className="flex flex-col gap-1 sm:items-end">
            {net?.urls.length ? (
              net.urls.map((u) => (
                <a key={u} href={u} className="font-mono text-sm hover:underline">
                  {u}
                </a>
              ))
            ) : (
              <span className="text-muted-foreground text-sm">—</span>
            )}
          </div>
        </SettingRow>
        <SettingRow label="Listening on">
          <span className="font-mono text-sm">{net ? `${net.host}:${net.port}` : "—"}</span>
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Home network">
        <ToggleRow
          label="Bonjour discovery"
          description="Announce this server on the network so the Strata apps find it by themselves."
          checked={draft.bonjourEnabled}
          onChange={(v) => set("bonjourEnabled", v)}
          badge={net && draft.bonjourEnabled && !net.bonjour ? <Badge variant="warning">Not announcing — see Logs</Badge> : undefined}
        />
        <ToggleRow
          label="No password at home"
          description="Devices on your home network pick who they are, without a password, and can watch but not change settings. Turn this off before opening the server to the internet through a tunnel or port forward."
          checked={draft.localJoin}
          onChange={(v) => set("localJoin", v)}
        />
      </SettingsSection>
    </>
  );
}
