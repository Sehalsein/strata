import { useState } from "react";
import { api, errorMessage } from "../api";
import { Badge, Card, ErrorText, Notice, PageHeader, Spinner, useResource } from "../components/ui";
import { formatDuration, jobLabel, relativeTime } from "../format";
import { linkClick } from "../router";
import type { AdminStatus, JobStatus, LibraryStats, PlaybackSessionDto } from "../types";

export function OverviewPage() {
  const { data, error, loading, refresh } = useResource(api.status, { pollMs: 3000 });

  if (loading && !data) {
    return (
      <div className="center-pad">
        <Spinner />
      </div>
    );
  }
  if (!data) return <ErrorText error={error} />;

  return (
    <div className="page">
      <PageHeader title="Overview" subtitle={<>Up {formatDuration(data.uptimeMs)}</>} actions={error ? <Badge tone="error">Connection lost — retrying</Badge> : <LiveDot />} />

      <div className="notices">
        {data.update?.updateAvailable && (
          <Notice
            tone="info"
            title="Update available"
            action={
              <a href="/settings#updates" className="btn btn-secondary btn-sm" onClick={linkClick}>
                {data.update.state === "available" ? "Update now" : "View"}
              </a>
            }
          >
            Strata v{data.update.latestVersion} is ready to install (running v{data.version}).
            {data.update.state === "waiting-for-idle" && " It installs when the last stream stops."}
            {data.update.state === "downloading" && " Downloading…"}
          </Notice>
        )}
        {!data.ffmpeg && data.ffmpegSetup?.state === "downloading" && (
          <Notice tone="info" title="Setting up ffmpeg">
            A one-time download of the ffmpeg Strata uses to play files that can't direct-play (MKV, DTS/TrueHD audio, some codecs). It only takes a minute.
          </Notice>
        )}
        {!data.ffmpeg && data.ffmpegSetup?.state !== "downloading" && (
          <Notice tone="warn" title="ffmpeg isn't set up">
            Files that can't direct-play (MKV, DTS/TrueHD audio, some codecs) need ffmpeg.{" "}
            {data.ffmpegSetup?.state === "failed"
              ? <>Strata couldn't download it ({data.ffmpegSetup.error}). Run “Set up ffmpeg” under Jobs to try again, or install ffmpeg on the server and restart Strata.</>
              : <>There's no build for this platform; install ffmpeg on the server and restart Strata.</>}
          </Notice>
        )}
        {!data.tmdb.configured && (
          <Notice
            tone="warn"
            title="No TMDB key"
            action={
              <a href="/settings" className="btn btn-secondary btn-sm" onClick={linkClick}>
                Add key
              </a>
            }
          >
            The catalog and file matching are off until a TMDB key is added.
          </Notice>
        )}
      </div>

      <div className="grid grid-3">
        <ServerCard status={data} />
        <LibraryCard stats={data.library} />
        <IntegrationsCard status={data} />
      </div>

      <SessionsCard sessions={data.sessions} onChanged={refresh} />
      <JobsCard jobs={data.jobs} onChanged={refresh} />
    </div>
  );
}

function LiveDot() {
  return (
    <span className="live" title="Refreshes every 3 seconds">
      <span className="live-dot" aria-hidden="true" />
      Live
    </span>
  );
}

function KV({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="kv">
      <dt>{k}</dt>
      <dd className={mono ? "mono" : undefined}>{children}</dd>
    </div>
  );
}

function ServerCard({ status }: { status: AdminStatus }) {
  return (
    <Card title="Status">
      <dl className="kvs">
        <KV k="Version" mono>
          {status.version} <span className="muted">· API {String(status.apiVersion)}</span>
        </KV>
        <KV k="Platform" mono>
          {status.platform}
        </KV>
        <KV k="Uptime">{formatDuration(status.uptimeMs)}</KV>
        <KV k="Data" mono>
          <span className="break">{status.dataDir}</span>
        </KV>
        <KV k="ffmpeg" mono>
          {status.ffmpeg ? (
            <>
              <span title={status.ffmpeg.path}>{status.ffmpeg.version}</span>
              {status.ffmpeg.hwEncoder && <span className="muted"> · {status.ffmpeg.hwEncoder}</span>}
            </>
          ) : (
            <Badge tone="warn">Not found</Badge>
          )}
        </KV>
      </dl>
    </Card>
  );
}

function summarize(stats: LibraryStats) {
  const out = { total: 0, matched: 0, pending: 0, unmatched: 0, ignored: 0, local: 0, torbox: 0 };
  for (const r of stats.files) {
    out.total += r.count;
    out[r.provider] += r.count;
    if (r.status === "matched" || r.status === "manual") out.matched += r.count;
    else out[r.status] += r.count;
  }
  return out;
}

function LibraryCard({ stats }: { stats: LibraryStats }) {
  const s = summarize(stats);
  return (
    <Card
      title="Contents"
      actions={
        <a href="/library" className="btn btn-ghost btn-sm" onClick={linkClick}>
          Open
        </a>
      }
    >
      <div className="figures">
        <Figure value={stats.titles.movie ?? 0} label="Movies" />
        <Figure value={stats.titles.show ?? 0} label="Shows" />
        <Figure value={s.total} label="Files" />
      </div>
      <dl className="kvs kvs-tight">
        <KV k="Matched">{s.matched}</KV>
        <KV k="Unmatched">
          {s.unmatched > 0 ? (
            <a href="/library?status=unmatched" onClick={linkClick} className="link-accent">
              {s.unmatched} to fix
            </a>
          ) : (
            0
          )}
        </KV>
        <KV k="Pending">{s.pending}</KV>
        <KV k="Sources">
          {s.local} local · {s.torbox} TorBox
        </KV>
      </dl>
    </Card>
  );
}

function Figure({ value, label }: { value: number; label: string }) {
  return (
    <div className="figure">
      <span className="figure-value">{value.toLocaleString()}</span>
      <span className="figure-label">{label}</span>
    </div>
  );
}

function IntegrationsCard({ status }: { status: AdminStatus }) {
  const account = useResource(() => (status.torbox.configured ? api.torboxAccount() : Promise.resolve(null)), { deps: [status.torbox.configured] });
  return (
    <Card title="Providers">
      <dl className="kvs">
        <KV k="TMDB">{status.tmdb.configured ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">No key</Badge>}</KV>
        <KV k="TorBox">{status.torbox.configured ? <Badge tone="ok">Connected</Badge> : <Badge>Not set up</Badge>}</KV>
        {status.torbox.configured &&
          (account.data ? (
            <>
              {account.data.email && <KV k="Account">{account.data.email}</KV>}
              {account.data.plan !== null && <KV k="Plan">{planName(account.data.plan)}</KV>}
              {account.data.premiumExpiresAt && <KV k="Renews">{new Date(account.data.premiumExpiresAt).toLocaleDateString()}</KV>}
            </>
          ) : account.error ? (
            <KV k="Account">
              <span className="text-error small">{errorMessage(account.error)}</span>
            </KV>
          ) : (
            <KV k="Account">
              <Spinner />
            </KV>
          ))}
      </dl>
      <a href="/settings#keys" className="btn btn-ghost btn-sm card-foot-link" onClick={linkClick}>
        Manage keys
      </a>
    </Card>
  );
}

function planName(plan: number | string): string {
  const names: Record<string, string> = { "0": "Free", "1": "Essential", "2": "Pro", "3": "Standard" };
  return names[String(plan)] ?? String(plan);
}

function SessionsCard({ sessions, onChanged }: { sessions: PlaybackSessionDto[]; onChanged: () => void }) {
  const [stopping, setStopping] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const stop = async (id: string) => {
    setStopping(id);
    setErr(null);
    try {
      await api.stopSession(id);
      onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setStopping(null);
    }
  };
  return (
    <Card title={`Now playing${sessions.length ? ` · ${sessions.length}` : ""}`}>
      {sessions.length === 0 ? (
        <p className="empty-inline">Nothing is playing.</p>
      ) : (
        <ul className="sessions">
          {sessions.map((s) => (
            <li key={s.id} className="session">
              <div className="session-main">
                <div className="session-title">
                  <span>
                    {s.title ?? `${s.target.mediaType === "movie" ? "Movie" : "Episode"} ${s.target.tmdbId}`}
                    {s.target.season !== undefined && <span className="mono">{` · S${String(s.target.season).padStart(2, "0")}E${String(s.target.episode ?? 0).padStart(2, "0")}`}</span>}
                  </span>
                  <Badge tone={s.mode === "direct" ? "ok" : s.mode === "remux" ? "accent" : "warn"}>{s.mode}</Badge>
                  <Badge>{s.source === "torbox" ? "TorBox" : "Local"}</Badge>
                  {s.paused && <Badge>Paused</Badge>}
                </div>
                <p className="session-meta">
                  {s.profileName ?? `Profile ${s.profileId}`} · file {s.fileId} · started {relativeTime(s.startedAt)} · last request {relativeTime(s.lastAccessAt)}
                </p>
                {s.reasons.length > 0 && <p className="session-reasons mono">{s.reasons.join(" · ")}</p>}
                {s.error && <p className="text-error small">{s.error}</p>}
              </div>
              <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void stop(s.id)} disabled={stopping === s.id}>
                {stopping === s.id ? "Stopping…" : "Stop"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={err} />
    </Card>
  );
}

function JobsCard({ jobs, onChanged }: { jobs: JobStatus[]; onChanged: () => void }) {
  const [starting, setStarting] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async (name: string) => {
    setStarting(name);
    setErr(null);
    try {
      await api.runJob(name);
      onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setStarting(null);
    }
  };
  return (
    <Card title="Jobs">
      <ul className="jobs">
        {jobs.map((j) => (
          <li key={j.name} className="job">
            <div className="job-main">
              <div className="job-title">
                <span>{jobLabel(j.name)}</span>
                {j.running ? <Badge tone="accent">Running</Badge> : j.lastError ? <Badge tone="error">Failed</Badge> : j.lastRunAt ? <Badge tone="ok">OK</Badge> : <Badge>Idle</Badge>}
              </div>
              {j.running && j.progress && j.progress.total > 0 ? (
                <div className="progress-wrap">
                  <progress className="progress" max={j.progress.total} value={j.progress.done} aria-label={`${jobLabel(j.name)} progress`} />
                  <span className="mono small muted">
                    {j.progress.label ? `${j.progress.label} · ` : ""}
                    {j.progress.done}/{j.progress.total}
                  </span>
                </div>
              ) : j.running ? (
                <div className="progress-wrap">
                  <progress className="progress" aria-label={`${jobLabel(j.name)} progress`} />
                </div>
              ) : null}
              <p className="job-meta">
                <span>{j.lastRunAt ? `Last run ${relativeTime(j.lastRunAt)}` : "Never run"}</span>
                {j.lastDurationMs !== undefined && <span> · took {formatDuration(j.lastDurationMs)}</span>}
                <span> · next {j.nextRunAt ? relativeTime(j.nextRunAt) : "manual only"}</span>
              </p>
              {j.lastError && <p className="text-error small mono">{j.lastError}</p>}
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void run(j.name)} disabled={j.running || starting === j.name}>
              {j.running ? "Running…" : "Run now"}
            </button>
          </li>
        ))}
      </ul>
      <ErrorText error={err} />
    </Card>
  );
}
