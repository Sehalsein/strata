import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Film, LoaderCircle, Search } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { AnilistResult, LibraryFile, TitleSource, TmdbResult } from "@/lib/types";
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

/** A search result to match to: TMDB's (by id and type) or AniList's (by ref). */
type Pick = { source: "tmdb"; key: string; title: string; result: TmdbResult } | { source: "anilist"; key: string; title: string; result: AnilistResult };

const isAnilistShow = (r: AnilistResult) => r.ref.startsWith("anilist:show:");

function FixMatchBody({ file, onDone }: { file: LibraryFile; onDone: () => void }) {
  const initialType = file.mediaType === "episode" || file.parsed?.kind === "episode" ? "show" : "movie";
  // Anime is matched to AniList: start there for an AniList title or a fansub-style name.
  const [source, setSource] = useState<TitleSource>(file.titleSource === "anilist" || (file.titleRef === null && file.parsed?.anime) ? "anilist" : "tmdb");
  const [type, setType] = useState<"movie" | "show">(initialType);
  const [query, setQuery] = useState(file.parsed?.title ?? "");
  const [submitted, setSubmitted] = useState(query.trim());
  const [picked, setPicked] = useState<Pick | null>(null);
  const [season, setSeason] = useState(String(file.titleSource === "tmdb" ? (file.season ?? file.parsed?.season ?? 1) : (file.parsed?.season ?? 1)));
  const [episode, setEpisode] = useState(String(file.episode ?? file.parsed?.episode ?? 1));
  const [seError, setSeError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const tmdbResults = useQuery({
    queryKey: queryKeys.tmdbSearch(submitted, type),
    queryFn: () => api.tmdbSearch(submitted, type),
    enabled: source === "tmdb" && !!submitted,
    staleTime: 60_000,
  });
  const anilistResults = useQuery({
    queryKey: queryKeys.anilistSearch(submitted),
    queryFn: () => api.anilistSearch(submitted),
    enabled: source === "anilist" && !!submitted,
    staleTime: 60_000,
  });
  const results = source === "tmdb" ? tmdbResults : anilistResults;
  const items: Pick[] =
    source === "tmdb"
      ? (tmdbResults.data?.items ?? []).map((r) => ({ source: "tmdb", key: `tmdb:${r.tmdbId}`, title: r.title, result: r }))
      : (anilistResults.data?.items ?? []).map((r) => ({ source: "anilist", key: r.ref, title: r.title, result: r }));
  // Shows need the episode; TMDB's need the season too (AniList's have one, season 1).
  const needsEpisode = picked ? (picked.source === "tmdb" ? type === "show" : isAnilistShow(picked.result)) : false;
  const needsSeason = needsEpisode && picked?.source === "tmdb";

  const save = async () => {
    if (!picked) return;
    const s = Number(season);
    const e = Number(episode);
    if (needsEpisode && (episode === "" || !Number.isInteger(e) || e < 0 || (needsSeason && (season === "" || !Number.isInteger(s) || s < 0)))) {
      setSeError(needsSeason ? "Enter a season and episode number." : "Enter an episode number.");
      return;
    }
    setSeError(null);
    setSaving(true);
    setSaveError(null);
    try {
      if (picked.source === "anilist") {
        await api.matchFile(file.fileId, needsEpisode ? { ref: picked.result.ref, season: 1, episode: e } : { ref: picked.result.ref });
      } else {
        await api.matchFile(file.fileId, type === "show" ? { type, tmdbId: picked.result.tmdbId, season: s, episode: e } : { type, tmdbId: picked.result.tmdbId });
      }
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

  const sourceName = source === "tmdb" ? "TMDB" : "AniList";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <ToggleGroup
        type="single"
        variant="outline"
        value={source}
        onValueChange={(v) => {
          if (!v) return;
          setSource(v as TitleSource);
          setPicked(null);
        }}
        aria-label="Source"
        className="self-start"
      >
        <ToggleGroupItem value="tmdb" className="px-3">
          TMDB
        </ToggleGroupItem>
        <ToggleGroupItem value="anilist" className="px-3">
          AniList (anime)
        </ToggleGroupItem>
      </ToggleGroup>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          setPicked(null);
          setSubmitted(query.trim());
        }}
      >
        {source === "tmdb" && (
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
        )}
        <Input aria-label={`Search ${sourceName}`} type="search" placeholder={`Search ${sourceName}`} value={query} onChange={(e) => setQuery(e.target.value)} className="flex-1" />
        <Button type="submit" variant="secondary" disabled={!query.trim() || results.isFetching}>
          {results.isFetching ? <LoaderCircle className="animate-spin" /> : <Search />}
          Search
        </Button>
      </form>

      <InlineError error={results.error} />

      <div className="max-h-80 overflow-y-auto rounded-md border" role="listbox" aria-label="Search results">
        {!submitted ? (
          <EmptyState icon={Search} title={`Search ${sourceName}`} description="Type a title and press Search." className="border-0" />
        ) : results.isPending ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        ) : results.data && items.length === 0 ? (
          <EmptyState
            icon={Film}
            title="No results"
            description={source === "tmdb" ? "Try another spelling, or switch between Movie and TV show." : "Try another spelling, or the romaji title."}
            className="border-0"
          />
        ) : (
          items.map((item) => {
            const selected = picked?.key === item.key;
            const r = item.result;
            return (
              <button
                key={item.key}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => setPicked(item)}
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-3 border-b p-2 text-left last:border-b-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px]",
                  selected && "bg-primary/10 hover:bg-primary/15",
                )}
              >
                {r.posterUrl ? <img src={r.posterUrl} alt="" loading="lazy" className="h-14 w-10 shrink-0 rounded object-cover" /> : <span className="bg-muted h-14 w-10 shrink-0 rounded" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="text-muted-foreground font-mono text-xs">
                    {item.source === "tmdb"
                      ? `${item.result.year ?? "—"} · ${item.result.tmdbId}`
                      : [item.result.year ?? "—", item.result.format, item.result.episodes ? `${item.result.episodes} ep` : null, item.result.anilistId].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {needsEpisode && (
        <div className="grid grid-cols-2 gap-3">
          {needsSeason ? (
            <FormField label="Season" error={seError}>
              {(p) => <Input {...p} className="font-mono" inputMode="numeric" value={season} onChange={(e) => setSeason(e.target.value.replace(/\D/g, ""))} />}
            </FormField>
          ) : (
            <FormField label="Season" description="AniList numbers each season on its own." error={seError}>
              {(p) => <Input {...p} className="font-mono" value="1" disabled />}
            </FormField>
          )}
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
