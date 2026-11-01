import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, FileSearch, Search, X } from "lucide-react";
import { api } from "@/lib/api";
import { formatBytes, relativeTime, resolutionLabel } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { LibraryFile, LibrarySort, MatchStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorAlert, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FixMatchDialog } from "./fix-match-dialog";
import { DEFAULT_STATE, PAGE_SIZES, SORTS, STATUS_TABS, defaultDirection, directionLabels, isFiltered, readUrlState, writeUrlState, type LibraryState } from "./filters";

const STATUS_VARIANT: Record<MatchStatus, "success" | "warning" | "secondary" | "accent"> = {
  matched: "success",
  manual: "accent",
  pending: "secondary",
  unmatched: "warning",
  ignored: "secondary",
};

const pad = (n: number) => String(n).padStart(2, "0");

export default function LibraryPage() {
  const [state, setState] = useState<LibraryState>(() => readUrlState(location.search));
  const [query, setQuery] = useState(state.q);
  const [fixing, setFixing] = useState<LibraryFile | null>(null);

  /** Any filter change returns to the first page. */
  const update = (patch: Partial<LibraryState>) => setState((s) => ({ ...s, page: 0, ...patch }));

  useEffect(() => {
    history.replaceState(null, "", writeUrlState(state));
  }, [state]);

  const filters = {
    status: state.status === "all" ? undefined : state.status,
    provider: state.provider === "all" ? undefined : state.provider,
    q: state.q || undefined,
    searchIn: state.searchIn,
    mediaType: state.mediaType === "all" ? undefined : state.mediaType,
    accessed: state.accessed === "all" ? undefined : state.accessed,
    sort: state.sort,
    direction: state.direction,
    limit: state.pageSize,
    offset: state.page * state.pageSize,
  };
  const files = useQuery({ queryKey: queryKeys.files(filters), queryFn: () => api.files(filters), placeholderData: keepPreviousData });

  const toggleIgnore = useApiMutation((f: LibraryFile) => (f.matchStatus === "ignored" ? api.unignoreFile(f.fileId) : api.ignoreFile(f.fileId)), {
    success: (_, f) => (f.matchStatus === "ignored" ? `Restored ${f.name}` : `Ignored ${f.name}`),
    invalidate: [queryKeys.filesAll, queryKeys.status],
  });

  const items = files.data?.items ?? [];
  const total = files.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  const dir = directionLabels(state.sort);

  const sortBy = (sort: LibrarySort) =>
    update(state.sort === sort ? { direction: state.direction === "asc" ? "desc" : "asc" } : { sort, direction: defaultDirection(sort) });

  return (
    <Page>
      <PageHeader title="Library" description="Every file Strata knows about, local and TorBox. Fix wrong or missing matches here." />

      <Card className="gap-4 py-4">
        <CardContent className="flex flex-col gap-4 px-4">
          <form
            role="search"
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              update({ q: query.trim() });
            }}
          >
            <div className="relative flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input aria-label="Search library" type="search" placeholder="Search titles, filenames, or paths…" maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
            </div>
            <Select value={state.searchIn} onValueChange={(v) => update({ searchIn: v as LibraryState["searchIn"] })}>
              <SelectTrigger aria-label="Search in" className="sm:w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All fields</SelectItem>
                <SelectItem value="title">Titles</SelectItem>
                <SelectItem value="filename">Filenames</SelectItem>
              </SelectContent>
            </Select>
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>

          <Tabs value={state.status} onValueChange={(v) => update({ status: v as LibraryState["status"] })}>
            <div className="-mx-1 overflow-x-auto px-1">
              <TabsList aria-label="Match status">
                {STATUS_TABS.map((t) => (
                  <TabsTrigger key={t.value} value={t.value}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <FilterSelect label="Source" value={state.provider} onChange={(v) => update({ provider: v as LibraryState["provider"] })} options={[["all", "All sources"], ["local", "Local"], ["torbox", "TorBox"]]} />
            <FilterSelect label="Type" value={state.mediaType} onChange={(v) => update({ mediaType: v as LibraryState["mediaType"] })} options={[["all", "All types"], ["movie", "Movies"], ["episode", "Episodes"]]} />
            <FilterSelect label="Activity" value={state.accessed} onChange={(v) => update({ accessed: v as LibraryState["accessed"] })} options={[["all", "All activity"], ["yes", "Accessed"], ["no", "Never accessed"]]} />
            <FilterSelect label="Sort by" value={state.sort} onChange={(v) => update({ sort: v as LibrarySort, direction: defaultDirection(v as LibrarySort) })} options={SORTS.map((s) => [s.value, s.label])} />
            <FilterSelect label="Order" value={state.direction} onChange={(v) => update({ direction: v as "asc" | "desc" })} options={[["desc", dir.desc], ["asc", dir.asc]]} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-xs" role="status">
              {files.isPending ? "Loading files…" : `${total.toLocaleString()} file${total === 1 ? "" : "s"}${state.q ? ` matching “${state.q}”` : ""}`} · Last accessed uses playback activity across all profiles; never-accessed files appear last.
            </p>
            {(isFiltered(state) || state.sort !== DEFAULT_STATE.sort || state.direction !== DEFAULT_STATE.direction) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setQuery("");
                  setState({ ...DEFAULT_STATE, pageSize: state.pageSize });
                }}
              >
                <X /> Reset filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ErrorAlert error={files.error} title="Couldn't load files" onRetry={() => void files.refetch()} />

      {!files.isPending && items.length === 0 ? (
        <EmptyState
          icon={FileSearch}
          title={state.page > 0 ? "No more files" : isFiltered(state) ? "No files match these filters" : "No files here yet"}
          description={isFiltered(state) ? "Try a different search or reset the filters." : "Add media folders or connect TorBox in Settings, then run a scan from the Overview."}
        />
      ) : (
      <Card className="py-0">
        <Table className={cn(files.isFetching && !files.isPending && "opacity-70 transition-opacity")} aria-busy={files.isFetching}>
          <TableHeader>
            <TableRow>
              <SortableHead label="File" sort="name" state={state} onSort={sortBy} className="pl-4" />
              <TableHead>Source</TableHead>
              <TableHead>Quality</TableHead>
              <SortableHead label="Size" sort="size" state={state} onSort={sortBy} className="text-right" />
              <SortableHead label="Last accessed" sort="lastAccessed" state={state} onSort={sortBy} />
              <SortableHead label="Match" sort="title" state={state} onSort={sortBy} />
              <TableHead className="pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.isPending ? (
              Array.from({ length: 8 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7} className="px-4">
                    <Skeleton className="h-9 w-full" />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              items.map((f) => (
                <TableRow key={f.id}>
                  <TableCell className="max-w-[22rem] pl-4 whitespace-normal">
                    <span className="block truncate font-medium" title={f.ref ?? f.name}>
                      {f.name}
                    </span>
                    {f.parsed && (
                      <span className="text-muted-foreground block truncate text-xs">
                        Parsed as “{f.parsed.title}”{f.parsed.year ? ` (${f.parsed.year})` : ""}
                        {f.parsed.season !== undefined && ` · S${pad(f.parsed.season)}E${pad(f.parsed.episode ?? 0)}`}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={f.provider === "torbox" ? "text-torbox" : "text-local"}>
                      {f.provider === "torbox" ? "TorBox" : "Local"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {resolutionLabel(f.resolution)}
                    {f.videoCodec && <span className="text-muted-foreground"> · {f.videoCodec}</span>}
                    {f.hdr && <span className="text-muted-foreground"> · {f.hdr}</span>}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs">{formatBytes(f.size)}</TableCell>
                  <TableCell className="text-sm">
                    <span className="block" title={f.lastAccessedAt ? new Date(f.lastAccessedAt).toLocaleString() : "No recorded playback for this title or episode"}>
                      {f.lastAccessedAt ? relativeTime(f.lastAccessedAt) : "Never"}
                    </span>
                    <span className="text-muted-foreground block text-xs" title={new Date(f.addedAt).toLocaleString()}>
                      Added {relativeTime(f.addedAt)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[16rem] whitespace-normal">
                    <div className="flex flex-col items-start gap-1">
                      <Badge variant={STATUS_VARIANT[f.matchStatus]} className="capitalize">
                        {f.matchStatus}
                      </Badge>
                      {f.tmdbId !== null && (
                        <span className="text-muted-foreground text-xs">
                          {f.title ?? `${f.mediaType === "episode" ? "tv" : "movie"}/${f.tmdbId}`}
                          {f.year !== null && ` (${f.year})`}
                          {f.season !== null && <span className="font-mono">{` S${pad(f.season)}E${pad(f.episode ?? 0)}`}</span>}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="pr-4">
                    <div className="flex justify-end gap-1">
                      <Button variant="outline" size="sm" onClick={() => setFixing(f)}>
                        Fix match
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => toggleIgnore.mutate(f)} disabled={toggleIgnore.isPending && toggleIgnore.variables?.id === f.id}>
                        {f.matchStatus === "ignored" ? "Restore" : "Ignore"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        {total > 0 && (
          <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
            <div className="flex items-center gap-2">
              <Label htmlFor="page-size" className="text-muted-foreground text-xs font-normal">
                Rows per page
              </Label>
              <Select value={String(state.pageSize)} onValueChange={(v) => update({ pageSize: Number(v) })}>
                <SelectTrigger id="page-size" size="sm" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground font-mono text-xs">
                {state.page * state.pageSize + 1}–{state.page * state.pageSize + items.length} of {total.toLocaleString()}
              </span>
              <div className="flex gap-1">
                <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={state.page === 0} onClick={() => setState((s) => ({ ...s, page: s.page - 1 }))}>
                  <ChevronLeft />
                </Button>
                <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={state.page + 1 >= pageCount} onClick={() => setState((s) => ({ ...s, page: s.page + 1 }))}>
                  <ChevronRight />
                </Button>
              </div>
            </div>
          </div>
        )}
      </Card>
      )}

      <FixMatchDialog file={fixing} onOpenChange={(o) => !o && setFixing(null)} />
    </Page>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className="text-muted-foreground text-xs font-normal">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SortableHead({ label, sort, state, onSort, className }: { label: string; sort: LibrarySort; state: LibraryState; onSort: (s: LibrarySort) => void; className?: string }) {
  const active = state.sort === sort;
  const Icon = !active ? ArrowUpDown : state.direction === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (state.direction === "asc" ? "ascending" : "descending") : "none"}>
      <Button variant="ghost" size="sm" className={cn("-ml-3 h-8", className?.includes("text-right") && "-mr-3 ml-auto flex")} onClick={() => onSort(sort)}>
        {label}
        <Icon className={cn("size-3.5", !active && "text-muted-foreground/60")} />
      </Button>
    </TableHead>
  );
}
