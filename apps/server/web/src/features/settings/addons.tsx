import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GripVertical, LoaderCircle, MoreHorizontal, Pencil, Plus, RefreshCw, Rows3, Trash2 } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { StreamAddon } from "@/lib/types";
import { cn } from "@/lib/utils";
import { relativeTime } from "@/lib/format";
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
  // Polled, so each add-on's status light stays current while the page is open.
  const addons = useQuery({ queryKey: queryKeys.addons, queryFn: api.addons, refetchInterval: 30_000 });
  const items = addons.data?.items ?? [];
  const removable = items.filter((a) => !a.builtIn);
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

  // Drag (or keyboard: Space, arrows, Space) to change the order; it moves at once and saves.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const reorder = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = items.findIndex((a) => a.id === active.id);
    const to = items.findIndex((a) => a.id === over.id);
    if (from < 0 || to < 0) return;
    setItems(arrayMove(items, from, to));
    try {
      setItems((await api.updateAddon(String(active.id), { index: to })).items);
    } catch (err) {
      toast.error(errorMessage(err));
      void reload();
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
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmClear(true)} disabled={!removable.length}>
            Delete all
          </Button>
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add add-on
          </Button>
        </div>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
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
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
            <SortableContext items={items.map((a) => a.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y" aria-label="Add-ons, in the order Strata asks them">
                {items.map((a) => (
                  <AddonRow key={a.id} addon={a} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      <p className="text-muted-foreground px-1 text-xs">
        Add one with its manifest URL, the same one you'd install in Stremio. Drag to change the order: higher add-ons come first when sources tie. Subtitle add-ons are asked in
        the languages set under General; catalog add-ons add rows to Home (pick them in each one's menu).
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
        description="Strata stops asking all of them (its own built-in entry stays). You can add them again with their manifest URLs."
        confirmLabel="Delete all"
        onConfirm={clear}
      />
    </div>
  );
}

function AddonRow({ addon: a }: { addon: StreamAddon }) {
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: a.id });

  /** Saves a change; the switch and menus show it at once, and it's undone if the server says no. */
  const update = async (patch: { enabled?: boolean; homeCatalogs?: string[] }, optimistic: Partial<StreamAddon>) => {
    const before = queryClient.getQueryData<{ items: StreamAddon[] }>(queryKeys.addons)?.items;
    if (before) setItems(before.map((x) => (x.id === a.id ? { ...x, ...optimistic } : x)));
    try {
      setItems((await api.updateAddon(a.id, patch)).items);
    } catch (err) {
      if (before) setItems(before);
      toast.error(errorMessage(err));
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

  const homeOn = a.catalogs.filter((c) => c.home).map((c) => c.key);
  const setHome = (keys: string[]) => update({ homeCatalogs: keys }, { catalogs: a.catalogs.map((c) => ({ ...c, home: keys.includes(c.key) })) });
  const hasMenu = a.catalogs.length > 0 || a.configurable || !a.builtIn;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("bg-card relative flex items-center gap-2 py-3 pr-3 pl-1.5 sm:gap-3 sm:pr-4", isDragging && "z-10 shadow-lg ring-1 ring-border")}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md outline-none focus-visible:ring-2 active:cursor-grabbing"
        aria-label={`Move ${a.name}`}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <div className={cn("flex min-w-0 flex-1 items-center gap-3 transition-opacity", !a.enabled && "opacity-55")}>
        <span className={cn("size-2 shrink-0 rounded-full", healthDot(a))} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{a.name}</span>
            {a.builtIn && <Badge variant="secondary">Built in</Badge>}
          </div>
          <p className="text-muted-foreground truncate text-xs">{a.description ?? a.host}</p>
          {a.enabled ? <HealthLine health={a.health} /> : <p className="text-muted-foreground text-xs">Off: Strata doesn't ask it.</p>}
        </div>
        <div className="hidden shrink-0 flex-wrap justify-end gap-1 md:flex md:max-w-56">
          {a.resources.includes("stream") && <Badge variant="outline">Streams</Badge>}
          {a.resources.includes("subtitles") && <Badge variant="outline">Subtitles</Badge>}
          {a.resources.includes("catalog") && <Badge variant="outline">Catalogs</Badge>}
        </div>
      </div>

      <Switch
        checked={a.enabled}
        onCheckedChange={(v) => update({ enabled: v }, { enabled: v })}
        aria-label={`${a.name}: ${a.enabled ? "on" : "off"}`}
        title={a.enabled ? `Turn ${a.name} off` : `Turn ${a.name} on`}
      />

      {hasMenu ? (
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 shrink-0" aria-label={`More for ${a.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {a.catalogs.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Rows3 /> Home rows{homeOn.length ? ` (${homeOn.length})` : ""}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-96 w-72">
                  <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Ticked catalogs show as rows on Home, after Strata's own.</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {a.catalogs.map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.key}
                      checked={c.home}
                      onSelect={(e) => e.preventDefault()}
                      onCheckedChange={(v) => setHome(v ? [...homeOn, c.key] : homeOn.filter((k) => k !== c.key))}
                    >
                      <span className="truncate">{c.name}</span>
                      <span className="text-muted-foreground ml-auto pl-3 text-xs">{c.type === "movie" ? "Movies" : "Shows"}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
            {a.configurable && (
              <DropdownMenuItem asChild>
                <a href={api.addonConfigureUrl(a.id)} target="_blank" rel="noreferrer">
                  <ExternalLink /> Configure
                </a>
              </DropdownMenuItem>
            )}
            {!a.builtIn && (
              <>
                <DropdownMenuItem onSelect={() => setEditing(true)}>
                  <Pencil /> Change address…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmRemove(true)}>
                  <Trash2 /> Delete…
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <span className="size-8 shrink-0" aria-hidden />
      )}

      <UrlDialog
        open={editing}
        onOpenChange={setEditing}
        title={`Change ${a.name}'s address`}
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
    </li>
  );
}

/** The status light: green answering, amber paused, red failing, grey not asked yet or off. */
function healthDot(a: StreamAddon) {
  if (!a.enabled) return "bg-muted-foreground/40";
  return { ok: "bg-emerald-500", failing: "bg-red-500", paused: "bg-amber-500", unknown: "bg-muted-foreground/40" }[a.health.state];
}

/** How the add-on is doing, in a line: when it last answered, or what went wrong. */
function HealthLine({ health: h }: { health: StreamAddon["health"] }) {
  if (h.state === "unknown") return <p className="text-muted-foreground text-xs">Not asked since the server started.</p>;
  if (h.state === "ok")
    return (
      <p className="text-muted-foreground text-xs">
        Answered {relativeTime(h.at)}
        {h.latencyMs !== undefined && ` in ${h.latencyMs < 1000 ? `${h.latencyMs} ms` : `${(h.latencyMs / 1000).toFixed(1)} s`}`}
      </p>
    );
  return (
    <p className={cn("text-xs", h.state === "failing" ? "text-destructive" : "text-amber-700 dark:text-amber-400")}>
      {h.state === "paused" ? "Paused" : "Failing"}: {h.message ?? "it didn't answer."} {h.state === "paused" ? `Strata asks again ${relativeTime(h.pausedUntil)}.` : `(${relativeTime(h.at)})`}
    </p>
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
