import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Blocks, LayoutList, Cable, Compass, Globe, Library, LoaderCircle, Network, RefreshCw, Server } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { ServerInfo, Settings, SettingsResponse } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ErrorAlert, Page, PageHeader, PageSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChoiceSelect, minutesLabel, type SetFn } from "./fields";
import { MediaFolders } from "./media-folders";
import { Connections } from "./connections";
import { AddonsSection } from "./addons";
import { PagesSection } from "./pages";
import { SettingRow, SettingsSection, ToggleRow } from "./layout";
import { CATALOG_LANGUAGES, languageName, REGIONS, regionName, SUBTITLE_LANGUAGES } from "./languages";
import { ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UpdatesCard } from "./updates-card";
import { useSession } from "@/app/session";
import { Link, navigate, usePath } from "@/lib/router";

type SectionId = "general" | "library" | "discovery" | "addons" | "pages" | "connections" | "server" | "network" | "updates";
interface Section {
  id: SectionId;
  label: string;
  icon: typeof Globe;
  group: "household" | "server";
}

/** Old names (keys, playback) still land in the right place. */
const ALIASES: Record<string, SectionId> = { keys: "connections", playback: "discovery" };
const SERVER_SECTIONS = ["server", "network", "updates"];

/** The section a path names (/settings/discovery → "discovery"), as written; "" for none. */
const sectionIn = (path: string, base: string) => {
  const rest = path.startsWith(base) ? path.slice(base.length).replace(/^\/+|\/+$/g, "") : "";
  return ALIASES[rest] ?? rest;
};

/**
 * Settings, by whose they are: this household's (its owner and admins, under Settings) or
 * the server's (the system admin, in the backoffice). Each section is a list of rows;
 * changes collect in a bar at the bottom until saved. Keys save on their own (they're
 * checked with the provider first).
 */
export default function SettingsPage({ scope = "household" }: { scope?: "household" | "server" }) {
  const { isServerAdmin, capabilities } = useSession();
  const sections: Section[] = (
    [
      { id: "general", label: "General", icon: Globe, group: "household" },
      { id: "library", label: "Library", icon: Library, group: "household" },
      { id: "discovery", label: "Discovery", icon: Compass, group: "household" },
      { id: "addons", label: "Add-ons", icon: Blocks, group: "household" },
      { id: "pages", label: "Pages", icon: LayoutList, group: "household" },
      { id: "connections", label: "Connections", icon: Cable, group: "household" },
      ...(isServerAdmin
        ? ([
            { id: "server", label: "Server", icon: Server, group: "server" },
            ...(capabilities.homeNetworkJoin || capabilities.bonjour ? [{ id: "network", label: "Network", icon: Network, group: "server" } as Section] : []),
            ...(capabilities.selfUpdate ? [{ id: "updates", label: "Updates", icon: RefreshCw, group: "server" } as Section] : []),
          ] as Section[])
        : []),
    ] as Section[]
  ).filter((s) => s.group === scope);
  const title = scope === "server" ? "Server settings" : "Settings";
  // Each section has its own path: /settings/discovery, /backoffice/settings/updates.
  const base = scope === "server" ? "/backoffice/settings" : "/settings";
  const path = usePath();
  const named = sectionIn(path, base);
  const section: SectionId = sections.some((s) => s.id === named) ? (named as SectionId) : sections[0]!.id;
  const pathOf = (id: SectionId) => (id === sections[0]!.id ? base : `${base}/${id}`);
  // Old links (/settings#addons) and the server's sections under household settings (they
  // moved to the backoffice) go to where they are now.
  useEffect(() => {
    const hash = location.hash.slice(1);
    const wanted = ALIASES[hash] ?? hash ?? "";
    const target = wanted || named;
    if (scope === "household" && SERVER_SECTIONS.includes(target)) navigate(`/backoffice/settings/${target}${location.search}`, { replace: true });
    else if (wanted) navigate(`${base}/${wanted}${location.search}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, path]);
  const settings = useQuery({ queryKey: queryKeys.settings, queryFn: api.settings, staleTime: Infinity });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const data = settings.data;

  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(data.settings) !== JSON.stringify(draft), [data, draft]);

  if (settings.isPending) return <PageSkeleton cards={2} />;
  if (!data || !draft) {
    return (
      <Page>
        <PageHeader title={title} />
        <ErrorAlert error={settings.error} title="Couldn't load settings" onRetry={() => void settings.refetch()} />
      </Page>
    );
  }

  const go = (id: SectionId) => navigate(`${pathOf(id)}${location.search}`);

  const set: SetFn = (key, value) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (scope === "server" && !draft.serverName.trim()) {
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
      <PageHeader title={title} description={scope === "server" ? "For the whole server and every household on it." : undefined} />

      <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-10">
        {sections.length > 1 && <SettingsNav sections={sections} current={section} hrefOf={pathOf} />}

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          {/* Add-ons and Pages draw their own headings, with their counts and actions. */}
          {sections.length > 1 && section !== "addons" && section !== "pages" && <h2 className="text-xl font-semibold">{current.label}</h2>}

          {section === "general" && (
            <SettingsSection title="Catalog" description="The language titles and artwork are shown in, and the country release dates and age ratings follow.">
              <SettingRow label="Language" htmlFor="language" description="Titles, overviews and artwork from TMDB, where it has them in this language.">
                <ChoiceSelect id="language" value={draft.language} options={CATALOG_LANGUAGES.map((l) => ({ value: l.code, label: l.name }))} describe={languageName} onChange={(v) => set("language", v)} />
              </SettingRow>
              <SettingRow label="Region" htmlFor="region" description="The country whose release dates and age ratings are shown.">
                <ChoiceSelect id="region" value={draft.region} options={REGIONS.map((r) => ({ value: r.code, label: r.name }))} describe={regionName} onChange={(v) => set("region", v)} />
              </SettingRow>
            </SettingsSection>
          )}
          {section === "general" && <SubtitlesSection draft={draft} set={set} />}

          {section === "library" && (
            <>
              {capabilities.localMedia && (
                <SettingsSection title="Media folders" description="Folders on this server that hold the household's movies and shows. Strata scans them and matches each file.">
                  <div className="p-5">
                    <MediaFolders value={draft.mediaFolders} onChange={(v) => set("mediaFolders", v)} canBrowse={isServerAdmin} />
                  </div>
                </SettingsSection>
              )}
              <SourcesSection draft={draft} set={set} />
            </>
          )}

          {section === "discovery" && (
            <SettingsSection
              title="Finding releases"
              description="Playable releases for titles that aren't in the library yet. Cached releases come first, then ones in the household's language (from General), then ones within your limits."
            >
              <ToggleRow label="Find releases" description={<>Look for releases of titles that aren't in the library, with your <Link href="/settings/addons">add-ons</Link>.</>} checked={draft.discoveryEnabled} onChange={(v) => set("discoveryEnabled", v)} />
              <ToggleRow label="Show uncached releases" description="Offer releases TorBox hasn't cached yet. They download before they can play." checked={draft.showUncached} onChange={(v) => set("showUncached", v)} />
              <SettingRow label="Largest automatic pick" htmlFor="max-size" description="Discovery won't pick a bigger release by itself. You can still choose one.">
                <ChoiceSelect id="max-size" value={draft.maxReleaseSizeGb} options={RELEASE_SIZES} describe={(gb) => `Up to ${gb} GB`} onChange={(v) => set("maxReleaseSizeGb", v)} />
              </SettingRow>
            </SettingsSection>
          )}

          {section === "addons" && <AddonsSection />}

          {section === "pages" && <PagesSection />}

          {section === "connections" && <Connections secrets={data.secrets} draft={draft} set={set} />}

          {section === "server" && isServerAdmin && <ServerSections draft={draft} set={set} localMedia={capabilities.localMedia} />}
          {section === "network" && isServerAdmin && (capabilities.homeNetworkJoin || capabilities.bonjour) && <NetworkSection draft={draft} set={set} />}
          {section === "updates" && isServerAdmin && capabilities.selfUpdate && <UpdatesCard draft={draft} set={set} />}
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
function SettingsNav({ sections, current, hrefOf }: { sections: Section[]; current: SectionId; hrefOf: (id: SectionId) => string }) {
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
                <Link
                  key={s.id}
                  href={hrefOf(s.id)}
                  aria-current={current === s.id ? "page" : undefined}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    current === s.id ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  <s.icon className="size-4" />
                  {s.label}
                </Link>
              ))}
          </div>
        ))}
      </div>
    </nav>
  );
}

function SourcesSection({ draft, set }: { draft: Settings; set: SetFn }) {
  return (
    <SettingsSection title="Sources & quality" description="When a title has more than one copy, the sharpest within your limit plays. Copies on this server come before TorBox, then add-on links.">
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

function ServerSections({ draft, set, localMedia }: { draft: Settings; set: SetFn; localMedia: boolean }) {
  const urlInvalid = !!draft.torrentioUrl && !/^https?:\/\/\S+$/.test(draft.torrentioUrl);
  return (
    <>
      <SettingsSection title="Identity">
        <SettingRow label="Server name" htmlFor="server-name" description="What the apps call this server when they find it." error={!draft.serverName.trim() ? "Give the server a name." : null}>
          <Input id="server-name" className="sm:w-64" value={draft.serverName} maxLength={64} onChange={(e) => set("serverName", e.target.value)} required />
        </SettingRow>
      </SettingsSection>
      <SettingsSection title="Library" description="For every household.">
        {localMedia && (
          <SettingRow label="Scan folders every" htmlFor="scan-every" description="How often every household's media folders are checked for new files.">
            <ChoiceSelect id="scan-every" value={draft.scanIntervalMinutes} options={SCAN_INTERVALS} describe={minutesLabel} onChange={(v) => set("scanIntervalMinutes", v)} />
          </SettingRow>
        )}
        <SettingRow
          label="Strata's Torrentio"
          htmlFor="default-addon-url"
          description="The Torrentio address the built-in Strata add-on searches, for every household. Empty means Strata uses only TorBox's own search."
          error={urlInvalid ? "Enter a full http(s) address." : null}
        >
          <Input id="default-addon-url" className="font-mono sm:w-72" type="url" placeholder="https://torrentio.strem.fun" value={draft.torrentioUrl} onChange={(e) => set("torrentioUrl", e.target.value.trim())} spellCheck={false} autoCapitalize="off" />
        </SettingRow>
      </SettingsSection>
      {localMedia && (
        <SettingsSection title="Transcoding" description="Only for files on this server's disk; TorBox video plays straight from TorBox.">
          <ToggleRow label="Hardware acceleration" description="VideoToolbox, VAAPI or QSV when a file has to be converted." checked={draft.hardwareAcceleration} onChange={(v) => set("hardwareAcceleration", v)} />
          <SettingRow label="At the same time" htmlFor="max-transcodes" description="How many conversions may run at once.">
            <ChoiceSelect id="max-transcodes" value={draft.maxTranscodes} options={TRANSCODE_LIMITS} describe={(n) => `${n} at once`} onChange={(v) => set("maxTranscodes", v)} />
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

/** Which languages subtitle add-ons are asked for, and when the apps turn subtitles on. */
function SubtitlesSection({ draft, set }: { draft: Settings; set: SetFn }) {
  const chosen = draft.subtitleLanguages;
  const catalog = languageName(draft.language.split("-")[0] ?? "en");
  const first = chosen[0] ? languageName(chosen[0]) : catalog;
  return (
    <SettingsSection title="Subtitles" description="Subtitles inside a file are always offered. Subtitle add-ons are asked for the languages below.">
      <SettingRow
        label="Languages"
        htmlFor="subtitle-languages"
        description={chosen.length ? "In the order you ticked them: subtitles turn on in the first one a title has." : "The languages to get subtitles in. None ticked means the catalog language."}
      >
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button id="subtitle-languages" variant="outline" className="w-full justify-between font-normal sm:w-64">
              <span className="truncate">{chosen.length ? chosen.map(languageName).join(", ") : `Catalog language (${catalog})`}</span>
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-64">
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Ticked first come first. Up to 10.</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {SUBTITLE_LANGUAGES.map((l) => {
              const on = chosen.includes(l.code);
              return (
                <DropdownMenuCheckboxItem
                  key={l.code}
                  checked={on}
                  disabled={!on && chosen.length >= 10}
                  // Stays open, so several can be ticked in one go.
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) => set("subtitleLanguages", v ? [...chosen, l.code] : chosen.filter((c) => c !== l.code))}
                >
                  {l.name}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingRow>
      <SettingRow label="Turn on automatically" htmlFor="auto-subtitles" description={AUTO_SUBTITLES.find((o) => o.value === draft.autoSubtitles)!.description(first)}>
        <ChoiceSelect id="auto-subtitles" value={draft.autoSubtitles} options={AUTO_SUBTITLES} onChange={(v) => set("autoSubtitles", v)} />
      </SettingRow>
    </SettingsSection>
  );
}

const AUTO_SUBTITLES: { value: Settings["autoSubtitles"]; label: string; description: (first: string) => string }[] = [
  { value: "forced", label: "Only for foreign dialogue", description: () => "Only forced subtitles, which translate lines in another language than the audio." },
  { value: "foreign", label: "When the audio is foreign", description: (first) => `Also when a title's audio isn't in one of your languages: in ${first}, if it has them.` },
  { value: "always", label: "Always", description: (first) => `Every title starts with subtitles on, in ${first} if it has them.` },
];

const RELEASE_SIZES = [
  { value: 0, label: "No limit" },
  ...[2, 5, 10, 15, 20, 30, 50, 80].map((gb) => ({ value: gb, label: `Up to ${gb} GB` })),
];

const SCAN_INTERVALS = [{ value: 0, label: "Off" }, ...[15, 30, 60, 180, 360, 720, 1440].map((m) => ({ value: m, label: minutesLabel(m) }))];

const TRANSCODE_LIMITS = [1, 2, 3, 4, 6, 8, 12, 16].map((n) => ({ value: n, label: n === 1 ? "1 at once" : `${n} at once` }));
