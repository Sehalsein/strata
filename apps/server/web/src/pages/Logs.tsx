import { useMemo, useState } from "react";
import { api } from "../api";
import { ErrorText, PageHeader, Spinner, useResource } from "../components/ui";
import { formatTime } from "../format";
import type { LogEntry } from "../types";

const LEVELS: LogEntry["level"][] = ["debug", "info", "warn", "error"];
const RANK: Record<LogEntry["level"], number> = { debug: 0, info: 1, warn: 2, error: 3 };

export function LogsPage() {
  const [auto, setAuto] = useState(true);
  const [minLevel, setMinLevel] = useState<LogEntry["level"]>("info");
  const [filter, setFilter] = useState("");
  const { data, error, loading, refresh } = useResource(() => api.logs(500), { pollMs: auto ? 3000 : undefined });

  const items = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (data?.items ?? [])
      .filter((e) => RANK[e.level] >= RANK[minLevel])
      .filter((e) => !f || e.message.toLowerCase().includes(f) || e.scope.toLowerCase().includes(f))
      .reverse();
  }, [data, minLevel, filter]);

  return (
    <div className="page">
      <PageHeader title="Logs" subtitle="The most recent 500 entries held in memory. The full log is in the data directory." />

      <div className="toolbar">
        <div className="tabs" role="radiogroup" aria-label="Minimum level">
          {LEVELS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={minLevel === l} className={`tab-btn ${minLevel === l ? "is-active" : ""}`} onClick={() => setMinLevel(l)}>
              {l === "debug" ? "All" : l === "info" ? "Info+" : l === "warn" ? "Warnings+" : "Errors"}
            </button>
          ))}
        </div>
        <div className="toolbar-right">
          <label htmlFor="log-filter" className="sr-only">
            Filter logs
          </label>
          <input id="log-filter" className="input input-sm log-filter" type="search" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="check">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Auto-refresh
          </label>
          {!auto && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refresh()}>
              Refresh
            </button>
          )}
        </div>
      </div>

      <ErrorText error={error} />

      <div className="logs" role="log" aria-live="off">
        {loading && !data ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <p className="empty-inline logs-empty">No log entries{filter || minLevel !== "debug" ? " match" : ""}.</p>
        ) : (
          items.map((e, i) => (
            <div key={`${e.time}-${i}`} className={`log log-${e.level}`}>
              <time className="log-time" dateTime={e.time} title={new Date(e.time).toLocaleString()}>
                {formatTime(e.time)}
              </time>
              <span className="log-level">{e.level}</span>
              <span className="log-scope">{e.scope}</span>
              <span className="log-msg">{e.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
