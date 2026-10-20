import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { Dialog } from "../components/Dialog";
import { Badge, ErrorText, Field, PageHeader, Spinner, useResource } from "../components/ui";
import { formatBytes, resolutionLabel } from "../format";
import type { LibraryFile, MatchStatus, Provider, TmdbResult } from "../types";

const PAGE = 50;

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
    status: status && TABS.some((t) => t.value === status) ? status : ("" as const),
    provider: provider === "local" || provider === "torbox" ? provider : ("" as const),
  };
}

export function LibraryPage() {
  const [status, setStatus] = useState<MatchStatus | "">(() => initialFilters().status);
  const [provider, setProvider] = useState<Provider | "">(() => initialFilters().provider);
  const [offset, setOffset] = useState(0);
  const [fixing, setFixing] = useState<LibraryFile | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  // Keep filters in the URL so they survive reloads and can be linked to.
  useEffect(() => {
    const p = new URLSearchParams();
    if (status) p.set("status", status);
    if (provider) p.set("provider", provider);
    const qs = p.toString();
    history.replaceState(null, "", `/library${qs ? `?${qs}` : ""}`);
  }, [status, provider]);

  const { data, error, loading, refresh } = useResource(() => api.files({ status: status || undefined, provider: provider || undefined, limit: PAGE, offset }), { deps: [status, provider, offset] });

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

      <ErrorText error={error} />

      <div className="table-wrap" aria-busy={loading}>
        {loading && !data ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <div className="empty-state small-empty">
            <p className="muted">{offset > 0 ? "No more files." : status === "unmatched" ? "Nothing unmatched. Every file has a title." : "No files here yet."}</p>
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
