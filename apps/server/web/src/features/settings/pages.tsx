import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { GalleryHorizontal, GripVertical, RotateCcw, Settings2 } from "lucide-react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { PageId, PageLayout, PageRow } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorAlert } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PagesData = { pages: PageLayout[]; maxAddonRows: number };

/** How many titles a row shows before "See all", when it isn't set. */
const DEFAULT_COUNT = 15;
const COUNTS = [5, 10, 15, 20, 25, 30, 40, 50];

const setPages = (pages: PageLayout[]) => queryClient.setQueryData<PagesData>(queryKeys.pages, (old) => (old ? { ...old, pages } : old));
const reload = () => queryClient.invalidateQueries({ queryKey: queryKeys.pages });

/** The carousel first, then the rest in the order given. */
const heroFirst = (rows: PageRow[]) => [...rows.filter((r) => r.hero), ...rows.filter((r) => !r.hero)];

/**
 * Saves one page's rows, shown at once and undone if the server says no. `rows: []` puts
 * the page back to its defaults (then there's nothing to show early: the answer has it).
 */
async function savePage(page: PageId, rows: PageRow[]) {
  const before = queryClient.getQueryData<PagesData>(queryKeys.pages)?.pages;
  if (before && rows.length) setPages(before.map((p) => (p.id === page ? { ...p, rows } : p)));
  try {
    setPages((await api.setPage(page, rows.map(({ id, on, name, count }) => ({ id, on, name, count })))).pages);
  } catch (err) {
    if (before) setPages(before);
    toast.error(errorMessage(err));
    throw err;
  }
}

/**
 * Home, Movies, Shows and Anime as the household's apps show them: which rows, in what
 * order. Strata's own rows, ones made for each person, and every add-on catalog.
 */
export function PagesSection() {
  const query = useQuery({ queryKey: queryKeys.pages, queryFn: api.pages });
  const [tab, setTab] = useState<PageId>("home");

  return (
    <div className="flex flex-col gap-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold">Pages</h2>
        <p className="text-muted-foreground text-sm">The rows on each page of the apps, for everyone in the household. Rows for each person are filled for whoever's watching.</p>
      </div>

      {query.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : query.error ? (
        <ErrorAlert error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <Tabs value={tab} onValueChange={(v) => setTab(v as PageId)} className="gap-4">
          <TabsList className="w-full sm:w-fit">
            {query.data.pages.map((p) => (
              <TabsTrigger key={p.id} value={p.id} className="sm:px-4">
                {p.title}
              </TabsTrigger>
            ))}
          </TabsList>
          {query.data.pages.map((p) => (
            <TabsContent key={p.id} value={p.id}>
              <PageEditor page={p} maxAddonRows={query.data.maxAddonRows} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}

function PageEditor({ page, maxAddonRows }: { page: PageLayout; maxAddonRows: number }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [configuring, setConfiguring] = useState<PageRow | null>(null);
  const rows = heroFirst(page.rows);
  const heroes = rows.filter((r) => r.hero);
  const movable = rows.filter((r) => !r.hero);
  const addonRowsOn = rows.filter((r) => r.source === "addon" && r.on).length;
  const atLimit = addonRowsOn >= maxAddonRows;

  // Drag (or keyboard: Space, arrows, Space) to move a row; it moves at once and saves.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const reorder = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = movable.findIndex((r) => r.id === active.id);
    const to = movable.findIndex((r) => r.id === over.id);
    if (from < 0 || to < 0) return;
    savePage(page.id, [...heroes, ...arrayMove(movable, from, to)]).catch(() => {});
  };
  /** Changes one row, keeping every other row (and its name and count) as it is. */
  const change = (row: PageRow, patch: Partial<Pick<PageRow, "on" | "name" | "count">>) => savePage(page.id, rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
  const rowProps = (r: PageRow) => ({
    row: r,
    onChange: (patch: Partial<Pick<PageRow, "on" | "name" | "count">>) => void change(r, patch).catch(() => {}),
    onConfigure: () => setConfiguring(r),
  });

  const reset = async () => {
    await savePage(page.id, []);
    toast.success(`${page.title} is back to its default rows`);
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <p className={cn("text-sm", atLimit ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
          {addonRowsOn} of {maxAddonRows} add-on rows
        </p>
        <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
          <RotateCcw /> Reset to default
        </Button>
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        {rows.length === 0 ? (
          <p className="text-muted-foreground px-5 py-8 text-sm">No rows on this page yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={reorder}>
            <SortableContext items={movable.map((r) => r.id)} strategy={verticalListSortingStrategy}>
              <ul className="divide-y" aria-label={`${page.title} rows, in order`}>
                {heroes.map((r) => (
                  <RowItem key={r.id} {...rowProps(r)} />
                ))}
                {movable.map((r) => (
                  <SortableRow key={r.id} {...rowProps(r)} blocked={atLimit && r.source === "addon" && !r.on} maxAddonRows={maxAddonRows} />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </Card>

      <p className="text-muted-foreground px-1 text-xs">
        Drag to change the order. Add-on rows start off: turn on the ones you want, up to {maxAddonRows} per page. Each row shows the number of titles you pick, and its
        See all shows every one.
      </p>

      <ConfigureDialog
        row={configuring}
        onOpenChange={(open) => !open && setConfiguring(null)}
        onSave={async (patch) => {
          await change(configuring!, patch);
          toast.success(`${patch.name ?? configuring!.title} saved`);
        }}
      />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Reset ${page.title}?`}
        description={`${page.title} goes back to Strata's order with only Strata's own rows and the rows for each person on. Add-on rows are turned off, and names and title counts you set are cleared.`}
        confirmLabel="Reset"
        onConfirm={reset}
      />
    </div>
  );
}

type RowProps = {
  row: PageRow;
  onChange: (patch: Partial<Pick<PageRow, "on" | "name" | "count">>) => void;
  onConfigure: () => void;
  blocked?: boolean;
  maxAddonRows?: number;
};

function SortableRow(props: RowProps) {
  const { row } = props;
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  return (
    <RowItem
      {...props}
      liRef={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
      handle={
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md outline-none focus-visible:ring-2 active:cursor-grabbing"
          aria-label={`Move ${row.name ?? row.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </button>
      }
    />
  );
}

/**
 * One row: its handle (or, for the carousel, a mark that it stays first), its name (and
 * the original under a name the household gave it), where it comes from, its switch, and
 * a button to configure its name and how many titles it shows.
 */
function RowItem({
  row,
  onChange,
  onConfigure,
  blocked = false,
  maxAddonRows,
  handle,
  liRef,
  style,
  dragging = false,
}: RowProps & {
  handle?: React.ReactNode;
  liRef?: (el: HTMLElement | null) => void;
  style?: React.CSSProperties;
  dragging?: boolean;
}) {
  const tag = row.source === "strata" ? "Strata" : row.source === "personal" ? "For each person" : (row.addon ?? "Add-on");
  const shown = row.name ?? row.title;
  return (
    <li ref={liRef} style={style} className={cn("bg-card relative flex items-center gap-2 py-3 pr-3 pl-1.5 sm:gap-3 sm:pr-4", dragging && "z-10 shadow-lg ring-1 ring-border")}>
      {handle ?? (
        <span className="text-muted-foreground flex size-8 shrink-0 items-center justify-center" title="The carousel is always first">
          <GalleryHorizontal className="size-4" aria-hidden />
        </span>
      )}
      <div className={cn("flex min-w-0 flex-1 flex-col gap-1.5 transition-opacity", !row.on && "opacity-55")}>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{shown}</span>
          {row.name && <span className="text-muted-foreground truncate text-xs">Originally {row.title}</span>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {row.hero && <Badge variant="secondary">Carousel · always first</Badge>}
          <Badge variant="outline" className="max-w-48 min-w-0">
            <span className="truncate">{tag}</span>
          </Badge>
        </div>
      </div>
      <Switch
        checked={row.on}
        disabled={blocked}
        onCheckedChange={(on) => onChange({ on })}
        aria-label={`${shown}: ${row.on ? "on" : "off"}`}
        title={blocked ? `${maxAddonRows} add-on rows are on already: turn one off first` : row.on ? `Hide ${shown}` : `Show ${shown}`}
      />
      <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={onConfigure} aria-label={`Configure ${shown}`} title="Name and titles shown">
        <Settings2 />
      </Button>
    </li>
  );
}

/**
 * A row's name for the household (empty is its own name) and how many titles it shows
 * before See all. "Because you watched …" rows are named for the title they follow, and
 * the carousel isn't cut, so each leaves out its field.
 */
function ConfigureDialog({
  row,
  onOpenChange,
  onSave,
}: {
  row: PageRow | null;
  onOpenChange: (open: boolean) => void;
  onSave: (patch: { name?: string; count?: number }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [count, setCount] = useState(DEFAULT_COUNT);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forRow, setForRow] = useState<PageRow | null>(null);
  // Starts from the row as it is each time it opens.
  if (row !== forRow) {
    setForRow(row);
    if (row) {
      setName(row.name ?? "");
      setCount(row.count ?? DEFAULT_COUNT);
      setError(null);
    }
  }
  const renamable = row?.id !== "because";
  const counted = !row?.hero;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!row) return;
    const trimmed = name.trim();
    setPending(true);
    setError(null);
    try {
      await onSave({
        name: renamable ? (trimmed && trimmed !== row.title ? trimmed : undefined) : row.name,
        count: counted && count !== DEFAULT_COUNT ? count : undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={!!row} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle className="truncate pr-6">{row?.name ?? row?.title}</DialogTitle>
            <DialogDescription>How this row shows in the apps, for everyone in the household.</DialogDescription>
          </DialogHeader>

          {renamable && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="row-name">Name</Label>
              <Input id="row-name" placeholder={row?.title} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground min-w-0 truncate text-xs">Original: {row?.title}</p>
                <Button type="button" variant="link" size="sm" className="h-auto shrink-0 p-0 text-xs" onClick={() => setName("")} disabled={!name}>
                  Use original
                </Button>
              </div>
            </div>
          )}

          {counted && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="row-count">Titles shown</Label>
              <Select value={String(count)} onValueChange={(v) => setCount(Number(v))}>
                <SelectTrigger id="row-count" className="w-full sm:w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COUNTS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === DEFAULT_COUNT ? `${n} (default)` : n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">See all always shows the full list.</p>
            </div>
          )}

          {error && <p className="text-destructive text-sm">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
