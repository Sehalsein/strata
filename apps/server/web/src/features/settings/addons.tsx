import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { StreamAddon } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorAlert } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

const setItems = (items: StreamAddon[]) => queryClient.setQueryData(queryKeys.addons, { items });
const reload = () => queryClient.invalidateQueries({ queryKey: queryKeys.addons });

/**
 * The household's add-ons: Torrentio, AIOStreams, Comet or any other that finds streams,
 * OpenSubtitles or any other that finds subtitles, and AIO Metadata or any other with
 * catalogs (rows on Home), each added by its manifest URL, as in Stremio.
 * Changes save straight away; their URLs stay on the server (they often hold a key), so
 * rows show the host and Configure goes through a server redirect.
 */
export function AddonsSection() {
  const addons = useQuery({ queryKey: queryKeys.addons, queryFn: api.addons });
  const items = addons.data?.items ?? [];
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const { items, failed } = await api.refreshAddons();
      setItems(items);
      if (failed.length) toast.warning(`${failed.join(", ")} didn't answer. ${failed.length === 1 ? "It's" : "They're"} kept as they were.`);
      else toast.success("Add-ons refreshed");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  };

  const clear = async () => {
    try {
      await api.removeAllAddons();
      setItems([]);
      toast.success("Add-ons removed");
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">Add-ons</h2>
          <p className="text-muted-foreground min-h-5 text-sm">{addons.data && `${items.length} ${items.length === 1 ? "add-on" : "add-ons"} installed`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={refresh} disabled={refreshing || !items.length}>
            <RefreshCw className={cn(refreshing && "animate-spin")} /> Refresh
          </Button>
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmClear(true)} disabled={!items.length}>
            Delete all
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add add-on
          </Button>
        </div>
      </div>

      <Card className="gap-0 divide-y overflow-hidden py-0">
        {addons.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : addons.error ? (
          <div className="p-5">
            <ErrorAlert error={addons.error} onRetry={() => void addons.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-start gap-3 px-5 py-8">
            <p className="text-muted-foreground text-sm">No add-ons, so only TorBox's own search finds releases (if it's on under Discovery), and subtitles come only from the files.</p>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add add-on
            </Button>
          </div>
        ) : (
          items.map((a, i) => <AddonRow key={a.id} addon={a} index={i} count={items.length} />)
        )}
      </Card>

      <p className="text-muted-foreground px-1 text-xs">
        Paste an add-on's manifest URL, the same one you'd install in Stremio. Every add-on that's on is asked for releases, top to bottom. Strata adds what it finds to your TorBox
        itself, so an add-on has to say which torrent each result is: most do (Torrentio, Comet, MediaFusion, Jackettio). AIOStreams is asked through its search API, with the uuid
        and password in its URL. Subtitle add-ons, like OpenSubtitles v3, are asked as a title starts, in the languages set under General. Catalog add-ons, like
        AIO Metadata, add rows to Home: pick them under Home rows.
      </p>

      <UrlDialog
        open={adding}
        onOpenChange={setAdding}
        title="Add an add-on"
        description="Paste its manifest URL. Strata reads the manifest first to check it has streams, subtitles or catalogs of movies or shows."
        submitLabel="Add"
        onSubmit={async (url) => {
          const added = await api.addAddon(url);
          await reload();
          toast.success(`${added.name} added`);
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Delete every add-on?"
        description="Strata stops asking all of them. You can add them again with their manifest URLs."
        confirmLabel="Delete all"
        onConfirm={clear}
      />
    </div>
  );
}

function AddonRow({ addon: a, index, count }: { addon: StreamAddon; index: number; count: number }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const update = async (patch: { enabled?: boolean; index?: number; homeCatalogs?: string[] }) => {
    setBusy(true);
    try {
      setItems((await api.updateAddon(a.id, patch)).items);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.removeAddon(a.id);
      await reload();
      toast.success(`${a.name} removed`);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center lg:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className={cn("mt-2 size-2 shrink-0 rounded-full", a.enabled ? "bg-emerald-500" : "bg-muted-foreground/40")} aria-hidden />
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className={cn("font-medium", !a.enabled && "text-muted-foreground")}>{a.name}</span>
            {a.isDefault && <Badge variant="secondary">Default</Badge>}
            {a.resources.includes("stream") && <Badge variant="outline">Streams</Badge>}
            {a.resources.includes("subtitles") && <Badge variant="outline">Subtitles</Badge>}
            {a.resources.includes("catalog") && <Badge variant="outline">Catalogs</Badge>}
            {a.anime && <Badge variant="outline">Anime</Badge>}
            {!a.enabled && <Badge variant="outline">Off</Badge>}
          </div>
          <p className="text-muted-foreground truncate text-sm">{a.host}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5 lg:pl-0">
        {a.catalogs.length > 0 && <HomeRowsMenu addon={a} busy={busy} onChange={(keys) => update({ homeCatalogs: keys })} />}
        {a.configurable && (
          <Button variant="outline" size="sm" asChild>
            <a href={api.addonConfigureUrl(a.id)} target="_blank" rel="noreferrer">
              Configure
            </a>
          </Button>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirmRemove(true)}>
          Delete
        </Button>
        <Button variant="outline" size="sm" disabled={busy || index === 0} onClick={() => update({ index: index - 1 })} aria-label={`Move ${a.name} up`}>
          Up
        </Button>
        <Button variant="outline" size="sm" disabled={busy || index === count - 1} onClick={() => update({ index: index + 1 })} aria-label={`Move ${a.name} down`}>
          Down
        </Button>
        <Switch className="ml-1" checked={a.enabled} disabled={busy} onCheckedChange={(v) => update({ enabled: v })} aria-label={`Use ${a.name}`} />
      </div>

      <UrlDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Edit ${a.name}`}
        description="Paste its new manifest URL, after changing its settings, say. It keeps its place in the list and its switch."
        submitLabel="Save"
        onSubmit={async (url) => {
          setItems((await api.updateAddon(a.id, { url })).items);
          toast.success(`${a.name} updated`);
        }}
      />
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Delete ${a.name}?`}
        description="Strata stops asking it. You can add it again with its manifest URL."
        confirmLabel="Delete"
        onConfirm={remove}
      />
    </div>
  );
}

/** Which of an add-on's catalogs are rows on Home: ticked in a menu, saved as they change. */
function HomeRowsMenu({ addon: a, busy, onChange }: { addon: StreamAddon; busy: boolean; onChange: (keys: string[]) => void }) {
  const on = a.catalogs.filter((c) => c.home).map((c) => c.key);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          Home rows{on.length ? ` (${on.length})` : ""} <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-96 w-72">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Ticked catalogs show as rows on Home, after Strata's own.</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {a.catalogs.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={c.home}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(v) => onChange(v ? [...on, c.key] : on.filter((k) => k !== c.key))}
          >
            <span className="truncate">{c.name}</span>
            <span className="text-muted-foreground ml-auto pl-3 text-xs">{c.type === "movie" ? "Movies" : "Shows"}</span>
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Asks for a manifest URL; the server checks it, and its error shows under the field. */
function UrlDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  onSubmit: (url: string) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (next: boolean) => {
    if (pending) return;
    onOpenChange(next);
    if (!next) {
      setValue("");
      setError(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return setError("Paste the manifest URL first.");
    setPending(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      setPending(false);
      onOpenChange(false);
      setValue("");
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Input
              aria-label="Manifest URL"
              className="font-mono"
              type="url"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
              placeholder="https://…/manifest.json"
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              aria-invalid={!!error}
              autoFocus
            />
            {error && <p className="text-destructive text-sm">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <LoaderCircle className="animate-spin" />}
              {pending ? "Checking…" : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
