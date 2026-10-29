import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { Dialog } from "../components/Dialog";
import { Badge, ErrorText, Field, PageHeader, Spinner, useResource } from "../components/ui";
import { formatBytes, relativeTime, resolutionLabel } from "../format";
import type { LibraryFile, LibrarySort, MatchStatus, Provider, TmdbResult } from "../types";

const PAGE = 50;
const SORTS: { value: LibrarySort; label: string }[] = [
  { value: "lastAccessed", label: "Last accessed" }, { value: "added", label: "Date added" },
  { value: "title", label: "Title" }, { value: "name", label: "Filename" },
  { value: "size", label: "File size" }, { value: "year", label: "Release year" },
];

const TABS: { value: MatchStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "unmatched", label: "Unmatched" },
  { value: "pending", label: "Pending" },
  { value: "matched", label: "Matched" },
  { value: "manual", label: "Manual" },
  { value: "ignored", label: "Ignored" },
];

const STATUS_TONE: Record<MatchStatus, "ok" | "warn" | "neutral" | "accent" | "error"> = {
  matched: "ok",
  manual: "accent",
  pending: "neutral",
  unmatched: "warn",
  ignored: "neutral",
};

function initialFilters() {
  const p = new URLSearchParams(location.search);
  const status = p.get("status") as MatchStatus | null;
  const provider = p.get("provider") as Provider | null;
  return {
    q: p.get("q")?.slice(0, 200) ?? "",
    searchIn: p.get("searchIn") === "title" ? "title" as const : p.get("searchIn") === "filename" ? "filename" as const : "all" as const,
    mediaType: p.get("mediaType") === "movie" ? "movie" as const : p.get("mediaType") === "episode" ? "episode" as const : "" as const,
    accessed: p.get("accessed") === "yes" ? "yes" as const : p.get("accessed") === "no" ? "no" as const : "" as const,
    sort: SORTS.some((s) => s.value === p.get("sort")) ? p.get("sort") as LibrarySort : "lastAccessed" as const,
    direction: p.get("direction") === "asc" ? "asc" as const : "desc" as const,
    status: status && TABS.some((t) => t.value === status) ? status : ("" as const),
    provider: provider === "local" || provider === "torbox" ? provider : ("" as const),
  };
}

export function LibraryPage() {
  const [status, setStatus] = useState<MatchStatus | "">(() => initialFilters().status);
  const [provider, setProvider] = useState<Provider | "">(() => initialFilters().provider);
  const [query, setQuery] = useState(() => initialFilters().q);
  const [search, setSearch] = useState(() => initialFilters().q);
  const [searchIn, setSearchIn] = useState<"all" | "title" | "filename">(() => initialFilters().searchIn);
  const [mediaType, setMediaType] = useState<"" | "movie" | "episode">(() => initialFilters().mediaType);
  const [accessed, setAccessed] = useState<"" | "yes" | "no">(() => initialFilters().accessed);
  const [sort, setSort] = useState<LibrarySort>(() => initialFilters().sort);
  const [direction, setDirection] = useState<"asc" | "desc">(() => initialFilters().direction);
  const [offset, setOffset] = useState(0);
  const [fixing, setFixing] = useState<LibraryFile | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  // Keep filters in the URL so they survive reloads and can be linked to.
  useEffect(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (provider) p.set("provider", provider);
    if (search) p.set("q", search);
    if (searchIn !== "all") p.set("searchIn", searchIn);
    if (mediaType) p.set("mediaType", mediaType);
    if (accessed) p.set("accessed", accessed);
    p.set("sort", sort);
    p.set("direction", direction);
    const qs = p.toString();
    history.replaceState(null, "", `/library${qs ? `?${qs}` : ""}`);
  }, [status, provider, search, searchIn, mediaType, accessed, sort, direction]);

  const { data, error, loading, refresh } = useResource(() => api.files({ status: status || undefined, provider: provider || undefined, q: search || undefined, searchIn, mediaType: mediaType || undefined, accessed: accessed || undefined, sort, direction, limit: PAGE, offset }), { deps: [status, provider, search, searchIn, mediaType, accessed, sort, direction, offset] });

  const toggleIgnore = async (f: LibraryFile) => {
    setRowError(null);
    try {
      await (f.matchStatus === "ignored" ? api.unignoreFile(f.fileId) : api.ignoreFile(f.fileId));
      await refresh();
    } catch (err) {
      setRowError({ id: f.fileId, message: errorMessage(err) });
    }
  };

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="page">
      <PageHeader title="Library" subtitle="Every file Strata knows about, local and TorBox. Fix wrong or missing matches here." />

      <form className="library-search" role="search" onSubmit={(e) => { e.preventDefault(); setSearch(query.trim()); setOffset(0); }}>
        <label htmlFor="library-query" className="sr-only">Search library</label>
        <input id="library-query" className="input" type="search" placeholder="Search titles, filenames, or paths…" maxLength={200} value={query} onChange={(e) => setQuery(e.target.value)} />
        <label htmlFor="library-search-in" className="sr-only">Search in</label>
        <select id="library-search-in" className="input" value={searchIn} onChange={(e) => { setSearchIn(e.target.value as typeof searchIn); setOffset(0); }}>
          <option value="all">All fields</option><option value="title">Titles</option><option value="filename">Filenames</option>
        </select>
        <button type="submit" className="btn btn-secondary">Search</button>
      </form>
      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Match status">
          {TABS.map((t) => (
            <button
              key={t.value || "all"}
              type="button"
              role="tab"
              aria-selected={status === t.value}
              className={`tab-btn ${status === t.value ? "is-active" : ""}`}
              onClick={() => {
                setStatus(t.value);
                setOffset(0);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label htmlFor="provider-filter" className="field-label-inline">
            Source
          </label>
          <select
            id="provider-filter"
            className="input input-sm"
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value as Provider | "");
              setOffset(0);
            }}
          >
            <option value="">All sources</option>
            <option value="local">Local</option>
            <option value="torbox">TorBox</option>
          </select>
        </div>
      </div>

      <div className="library-filters">
        <label className="field">Type
          <select className="input input-sm" value={mediaType} onChange={(e) => { setMediaType(e.target.value as typeof mediaType); setOffset(0); }}>
            <option value="">All types</option><option value="movie">Movies</option><option value="episode">Episodes</option>
          </select>
        </label>
        <label className="field">Activity
          <select className="input input-sm" value={accessed} onChange={(e) => { setAccessed(e.target.value as typeof accessed); setOffset(0); }}>
            <option value="">All activity</option><option value="yes">Accessed</option><option value="no">Never accessed</option>
          </select>
        </label>
        <label className="field">Sort by
          <select className="input input-sm" value={sort} onChange={(e) => { const next = e.target.value as LibrarySort; setSort(next); setDirection(next === "title" || next === "name" ? "asc" : "desc"); setOffset(0); }}>
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </label>
        <label className="field">Order
          <select className="input input-sm" value={direction} onChange={(e) => { setDirection(e.target.value as typeof direction); setOffset(0); }}>
            <option value="desc">{sort === "title" || sort === "name" ? "Z–A" : sort === "size" ? "Largest first" : "Newest first"}</option>
            <option value="asc">{sort === "title" || sort === "name" ? "A–Z" : sort === "size" ? "Smallest first" : "Oldest first"}</option>
          </select>
        </label>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); setSearch(""); setSearchIn("all"); setStatus(""); setProvider(""); setMediaType(""); setAccessed(""); setSort("lastAccessed"); setDirection("desc"); setOffset(0); }}>Reset</button>
      </div>
      <p className="small muted" role="status">{loading ? "Loading files…" : `${total} file${total === 1 ? "" : "s"}${search ? ` matching “${search}”` : ""}`} · Last accessed uses playback activity across all profiles; never-accessed files appear last.</p>
      <ErrorText error={error} />

      <div className="table-wrap" aria-busy={loading}>
        {loading && !data ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state small-empty">
            <p className="muted">{offset > 0 ? "No more files." : search || status || provider || mediaType || accessed ? "No files match these filters. Try a different search or reset the filters." : "No files here yet."}</p>
          </div>
        ) : (
          <table className="table files-table">
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Source</th>
                <th scope="col">Quality</th>
                <th scope="col" className="num">
                  Size
                </th>
                <th scope="col">Last accessed</th>
                <th scope="col">Match</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((f) => (
                <tr key={f.id}>
                  <td className="file-cell" data-label="File">
                    <span className="file-name" title={f.ref ?? f.name}>
                      {f.name}
                    </span>
                    {f.parsed && (
                      <span className="file-parsed">
                        Parsed as “{f.parsed.title}”{f.parsed.year ? ` (${f.parsed.year})` : ""}
                        {f.parsed.season !== undefined && ` · S${pad(f.parsed.season)}E${pad(f.parsed.episode ?? 0)}`}
                      </span>
                    )}
                    {rowError?.id === f.fileId && <ErrorText error={rowError.message} />}
                  </td>
                  <td data-label="Source">
                    <Badge>{f.provider === "torbox" ? "TorBox" : "Local"}</Badge>
                  </td>
                  <td data-label="Quality" className="mono small">
                    {resolutionLabel(f.resolution)}
                    {f.videoCodec && <span className="muted"> · {f.videoCodec}</span>}
                    {f.hdr && <span className="muted"> · {f.hdr}</span>}
                  </td>
                  <td data-label="Size" className="num mono small">
                    {formatBytes(f.size)}
                  </td>
                  <td data-label="Last accessed" className="small">
                    <span title={f.lastAccessedAt ? new Date(f.lastAccessedAt).toLocaleString() : "No recorded playback for this title or episode"}>{f.lastAccessedAt ? relativeTime(f.lastAccessedAt) : "Never"}</span>
                    <span className="file-parsed" title={new Date(f.addedAt).toLocaleString()}>Added {relativeTime(f.addedAt)}</span>
                  </td>
                  <td data-label="Match">
                    <div className="match-cell">
                      <Badge tone={STATUS_TONE[f.matchStatus]}>{f.matchStatus}</Badge>
                      {f.tmdbId !== null && (
                        <span className="small muted">
                          {f.title ?? `${f.mediaType === "episode" ? "tv" : "movie"}/${f.tmdbId}`}
                          {f.year !== null && ` (${f.year})`}
                          {f.season !== null && <span className="mono">{` S${pad(f.season)}E${pad(f.episode ?? 0)}`}</span>}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="actions-cell">
                    <div className="row-gap">
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setFixing(f)}>
                        Fix match
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleIgnore(f)}>
                        {f.matchStatus === "ignored" ? "Restore" : "Ignore"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {total > PAGE && (
        <div className="pager">
          <button type="button" className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
            Previous
          </button>
          <span className="mono small muted">
            {offset + 1}–{offset + items.length} of {total}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" disabled={offset + items.length >= total} onClick={() => setOffset(offset + PAGE)}>
            Next
          </button>
        </div>
      )}

      <Dialog open={!!fixing} onClose={() => setFixing(null)} title="Fix match" wide>
        {fixing && (
          <FixMatch
            key={fixing.id}
            file={fixing}
            onCancel={() => setFixing(null)}
            onDone={() => {
              setFixing(null);
              void refresh();
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function FixMatch({ file, onCancel, onDone }: { file: LibraryFile; onCancel: () => void; onDone: () => void }) {
  const initialType = file.mediaType === "episode" || file.parsed?.kind === "episode" ? "show" : "movie";
  const [type, setType] = useState<"movie" | "show">(initialType);
  const [query, setQuery] = useState(file.parsed?.title ?? "");
  const [results, setResults] = useState<TmdbResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<TmdbResult | null>(null);
  const [season, setSeason] = useState(String(file.season ?? file.parsed?.season ?? 1));
  const [episode, setEpisode] = useState(String(file.episode ?? file.parsed?.episode ?? 1));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const search = async (t = type) => {
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    setPicked(null);
    try {
      const r = await api.tmdbSearch(query.trim(), t);
      setResults(r.items);
    } catch (err) {
      setSearchError(errorMessage(err));
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  useEffect(() => {
    if (query.trim()) void search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!picked) return;
    const s = Number(season);
    const e = Number(episode);
    if (type === "show" && (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e < 0)) {
      setSaveError("Enter a season and episode number.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await api.matchFile(file.fileId, type === "show" ? { type, tmdbId: picked.tmdbId, season: s, episode: e } : { type, tmdbId: picked.tmdbId });
      onDone();
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <p className="mono small break fix-file">{file.ref ?? file.name}</p>

      <form
        className="fix-search"
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <div className="segmented" role="radiogroup" aria-label="Type">
          {(["movie", "show"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              className={`segment ${type === t ? "is-active" : ""}`}
              onClick={() => {
                setType(t);
                setResults(null);
                setPicked(null);
                if (query.trim()) void search(t);
              }}
            >
              {t === "movie" ? "Movie" : "TV show"}
            </button>
          ))}
        </div>
        <label htmlFor="fix-q" className="sr-only">
          Search TMDB
        </label>
        <input id="fix-q" className="input" type="search" placeholder="Search TMDB" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="btn btn-secondary" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
      </form>

      <ErrorText error={searchError} />

      <div className="results" role="listbox" aria-label="Search results">
        {searching && !results ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : results && results.length === 0 ? (
          <p className="empty-inline">No results.</p>
        ) : (
          results?.map((r) => (
            <button key={r.tmdbId} type="button" role="option" aria-selected={picked?.tmdbId === r.tmdbId} className={`result ${picked?.tmdbId === r.tmdbId ? "is-picked" : ""}`} onClick={() => setPicked(r)}>
              {r.posterUrl ? <img src={r.posterUrl} alt="" loading="lazy" className="result-poster" /> : <span className="result-poster result-poster-empty" aria-hidden="true" />}
              <span className="result-text">
                <span className="result-title">{r.title}</span>
                <span className="mono small muted">
                  {r.year ?? "—"} · {r.tmdbId}
                </span>
              </span>
            </button>
          ))
        )}
      </div>

      {picked && type === "show" && (
        <div className="se-inputs">
          <Field label="Season">{(id) => <input id={id} className="input mono" inputMode="numeric" value={season} onChange={(e) => setSeason(e.target.value.replace(/\D/g, ""))} />}</Field>
          <Field label="Episode">{(id) => <input id={id} className="input mono" inputMode="numeric" value={episode} onChange={(e) => setEpisode(e.target.value.replace(/\D/g, ""))} />}</Field>
        </div>
      )}

      <ErrorText error={saveError} />

      <div className="dialog-foot-buttons">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!picked || saving} onClick={() => void save()}>
          {saving ? "Saving…" : picked ? `Match to ${picked.title}` : "Pick a result"}
        </button>
      </div>
    </div>
  );
}
