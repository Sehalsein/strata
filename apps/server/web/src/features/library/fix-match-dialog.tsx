import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film, LoaderCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { LibraryFile, TmdbResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptyState, InlineError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export function FixMatchDialog({ file, onOpenChange }: { file: LibraryFile | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!file} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Fix match</DialogTitle>
          <DialogDescription className="font-mono text-xs break-all">{file?.ref ?? file?.name}</DialogDescription>
        </DialogHeader>
        {file && <FixMatchBody key={file.id} file={file} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function FixMatchBody({ file, onDone }: { file: LibraryFile; onDone: () => void }) {
  const initialType = file.mediaType === "episode" || file.parsed?.kind === "episode" ? "show" : "movie";
  const [type, setType] = useState<"movie" | "show">(initialType);
  const [query, setQuery] = useState(file.parsed?.title ?? "");
  const [submitted, setSubmitted] = useState(query.trim());
  const [picked, setPicked] = useState<TmdbResult | null>(null);
  const [season, setSeason] = useState(String(file.season ?? file.parsed?.season ?? 1));
  const [episode, setEpisode] = useState(String(file.episode ?? file.parsed?.episode ?? 1));
  const [seError, setSeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const results = useQuery({
    queryKey: queryKeys.tmdbSearch(submitted, type),
    queryFn: () => api.tmdbSearch(submitted, type),
    enabled: !!submitted,
    staleTime: 60_000,
  });

  const save = async () => {
    if (!picked) return;
    const s = Number(season);
    const e = Number(episode);
    if (type === "show" && (season === "" || episode === "" || !Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 0)) {
      setSeError("Enter a season and episode number.");
      return;
    }
    setSeError(null);
    setSaving(true);
    setSaveError(null);
    try {
      await api.matchFile(file.fileId, type === "show" ? { type, tmdbId: picked.tmdbId, season: s, episode: e } : { type, tmdbId: picked.tmdbId });
      toast.success(`Matched to ${picked.title}`);
      void queryClient.invalidateQueries({ queryKey: queryKeys.filesAll });
      void queryClient.invalidateQueries({ queryKey: queryKeys.status });
      onDone();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setPicked(null);
          setSubmitted(query.trim());
        }}
      >
        <ToggleGroup
          type="single"
          variant="outline"
          value={type}
          onValueChange={(v) => {
            if (!v) return;
            setType(v as "movie" | "show");
            setPicked(null);
          }}
          aria-label="Type"
        >
          <ToggleGroupItem value="movie" className="px-3">
            Movie
          </ToggleGroupItem>
          <ToggleGroupItem value="show" className="px-3">
            TV show
          </ToggleGroupItem>
        </ToggleGroup>
        <Input aria-label="Search TMDB" type="search" placeholder="Search TMDB" value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
        <Button type="submit" variant="secondary" disabled={!query.trim() || results.isFetching}>
          {results.isFetching ? <LoaderCircle className="animate-spin" /> : <Search />}
          Search
        </Button>
      </form>

      <InlineError error={results.error} />

      <div className="max-h-80 overflow-y-auto rounded-md border" role="listbox" aria-label="Search results">
        {!submitted ? (
          <EmptyState icon={Search} title="Search TMDB" description="Type a title and press Search." className="border-0" />
        ) : results.isPending ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : results.data && results.data.items.length === 0 ? (
          <EmptyState icon={Film} title="No results" description="Try another spelling, or switch between Movie and TV show." className="border-0" />
        ) : (
          results.data?.items.map((r) => {
            const selected = picked?.tmdbId === r.tmdbId;
            return (
              <button
                key={r.tmdbId}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => setPicked(r)}
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-3 border-b p-2 text-left last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
                  selected && "bg-primary/10 hover:bg-primary/15",
                )}
              >
                {r.posterUrl ? <img src={r.posterUrl} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded object-cover" /> : <span className="bg-muted h-14 w-10 shrink-0 rounded" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.title}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {r.year ?? "—"} · {r.tmdbId}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {picked && type === "show" && (
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Season" error={seError}>
            {(p) => <Input {...p} className="font-mono" inputMode="numeric" value={season} onChange={(e) => setSeason(e.target.value.replace(/\D/g, ""))} />}
          </FormField>
          <FormField label="Episode">
            {(p) => <Input {...p} className="font-mono" inputMode="numeric" value={episode} onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ""))} />}
          </FormField>
        </div>
      )}

      <InlineError error={saveError} />

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button disabled={!picked || saving} onClick={() => void save()} className="max-w-full">
          {saving && <LoaderCircle className="animate-spin" />}
          <span className="truncate">{picked ? `Match to ${picked.title}` : "Pick a result"}</span>
        </Button>
      </DialogFooter>
    </div>
  );
}
