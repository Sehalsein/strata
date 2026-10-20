import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { relativeTime } from "../format";
import type { AdminStatus, Settings, UpdateStatus } from "../types";
import { Badge, Card, ErrorText, Field, useResource } from "./ui";

type SetFn = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <label className="switch-row">
      <input type="checkbox" className="switch" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="switch-label">{label}</span>
        <span className="field-hint">{hint}</span>
      </span>
    </label>
  );
}

export function DiscoveryCard({ draft, set }: { draft: Settings; set: SetFn }) {
  return (
    <Card title="Discovery">
      <div className="form-grid">
        <Switch checked={draft.discoveryEnabled} onChange={(v) => set("discoveryEnabled", v)} label="Find releases on TorBox" hint="Look for playable TorBox releases of titles that aren't in your library." />
        <Field label="Stream addon URL" hint="A Torrentio-compatible Stremio addon to search. Leave empty to turn it off.">
          {(id, d) => (
            <input id={id} aria-describedby={d} className="input mono" type="url" placeholder="https://torrentio.strem.fun" value={draft.torrentioUrl} onChange={(e) => set("torrentioUrl", e.target.value.trim())} spellCheck={false} autoCapitalize="off" />
          )}
        </Field>
        <Switch checked={draft.useTorboxSearch} onChange={(v) => set("useTorboxSearch", v)} label="Use TorBox search" hint="Also ask TorBox's own search for releases." />
        <Switch checked={draft.showUncached} onChange={(v) => set("showUncached", v)} label="Show uncached releases" hint="Offer releases TorBox hasn't cached yet; they download before they can play." />
        <Field label="Largest automatic pick" hint="In GB. Discovery won't auto-pick a bigger release. 0 means no limit.">
          {(id, d) => (
            <div className="input-suffix">
              <input
                id={id}
                aria-describedby={d}
                className="input mono"
                type="number"
                min={0}
                step={0.5}
                value={draft.maxReleaseSizeGb}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  set("maxReleaseSizeGb", Number.isFinite(n) ? Math.max(0, n) : draft.maxReleaseSizeGb);
                }}
              />
              <span>GB</span>
            </div>
          )}
        </Field>
      </div>
    </Card>
  );
}

export function NetworkCard({ draft, set }: { draft: Settings; set: SetFn }) {
  const { data } = useResource<AdminStatus>(api.status);
  const net = data?.network;
  return (
    <Card title="Network">
      <div className="form-grid">
        <dl className="kvs">
          <div className="kv">
            <dt>Host</dt>
            <dd className="mono">{net ? net.host : "—"}</dd>
          </div>
          <div className="kv">
            <dt>Port</dt>
            <dd className="mono">{net ? net.port : "—"}</dd>
          </div>
          <div className="kv">
            <dt>LAN URL</dt>
            <dd className="mono">
              {net?.urls.length ? (
                net.urls.map((u) => (
                  <div key={u}>
                    <a href={u}>{u}</a>
                  </div>
                ))
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
        <p className="field-hint">
          Port and bind address are set when the server starts (<code className="code-inline">--port</code>, <code className="code-inline">--host</code>, or <code className="code-inline">STRATA_PORT</code> / <code className="code-inline">STRATA_HOST</code>), so a change here can't lock you out of the dashboard.
        </p>
        <Switch
          checked={draft.bonjourEnabled}
          onChange={(v) => set("bonjourEnabled", v)}
          label="Bonjour discovery"
          hint={`Advertise this server on the local network so the Strata apps find it automatically.${net && draft.bonjourEnabled && !net.bonjour ? " (Not advertising right now — see Logs.)" : ""}`}
        />
        <Switch
          checked={draft.localJoin}
          onChange={(v) => set("localJoin", v)}
          label="No password at home"
          hint="Devices on your home network skip sign-in and go straight to picking a profile (PINs still apply). They can watch but can't change settings. Away from home, devices sign in with your account."
        />
      </div>
    </Card>
  );
}

const STATE_LABEL: Record<UpdateStatus["state"], string> = {
  idle: "Up to date",
  checking: "Checking…",
  available: "Update available",
  downloading: "Downloading…",
  "waiting-for-idle": "Waiting for streams to finish",
  restarting: "Restarting…",
  error: "Error",
};

const BUSY: UpdateStatus["state"][] = ["checking", "downloading", "waiting-for-idle", "restarting"];

export function UpdatesCard({ draft, set }: { draft: Settings; set: SetFn }) {
  const [busyPoll, setBusyPoll] = useState(false);
  const { data: status, error, setData, refresh } = useResource<UpdateStatus>(api.updateStatus, { pollMs: busyPoll ? 2000 : undefined });
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | null>(null);
  const [startedFrom, setStartedFrom] = useState<string | null>(null);

  const busy = !!status && BUSY.includes(status.state);
  useEffect(() => setBusyPoll(busy || !!startedFrom), [busy, startedFrom]);

  // After a restart the server comes back as the new version.
  const restartedInto = startedFrom && status && status.currentVersion !== startedFrom ? status.currentVersion : null;
  useEffect(() => {
    if (restartedInto) setStartedFrom(null);
  }, [restartedInto]);

  const check = async () => {
    setPending("check");
    setActionError(null);
    try {
      setData(await api.checkUpdate());
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const apply = async () => {
    if (!status?.latest) return;
    if (!confirm(`Install v${status.latest.version}? Strata restarts once nothing is playing.`)) return;
    setPending("apply");
    setActionError(null);
    try {
      setStartedFrom(status.currentVersion);
      setData(await api.applyUpdate());
    } catch (err) {
      setStartedFrom(null);
      setActionError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const progress = status?.progress;
  const manifestCustom = draft.updateManifestUrl !== "";

  return (
    <Card
      title="Updates"
      actions={
        status && (
          <Badge tone={status.state === "error" ? "error" : status.updateAvailable ? "accent" : busy ? "neutral" : "ok"}>{status.state === "idle" && status.updateAvailable ? "Update available" : STATE_LABEL[status.state]}</Badge>
        )
      }
    >
      <div className="form-grid">
        <dl className="kvs">
          <div className="kv">
            <dt>Running</dt>
            <dd className="mono">
              {status ? `v${status.currentVersion}` : "—"} {status && <span className="muted">· {status.platform}</span>}
            </dd>
          </div>
          <div className="kv">
            <dt>Latest</dt>
            <dd className="mono">
              {status?.latest ? `v${status.latest.version}` : "—"}
              {status?.lastCheckedAt && <span className="muted"> · checked {relativeTime(status.lastCheckedAt)}</span>}
            </dd>
          </div>
        </dl>

        {restartedInto && <p className="field-hint">Updated to v{restartedInto}.</p>}
        {status?.disabledReason && <p className="field-hint">{status.disabledReason}</p>}
        {status?.state === "downloading" && progress && (
          <div className="progress-wrap">
            <progress className="progress" value={progress.received} max={progress.total || undefined} />
            <span className="muted small mono">{Math.round((progress.received / Math.max(1, progress.total)) * 100)}%</span>
          </div>
        )}
        {status?.state === "waiting-for-idle" && <p className="field-hint">The update is downloaded and verified. Strata restarts when the last stream stops.</p>}
        {status?.lastError && <ErrorText error={status.lastError} />}
        <ErrorText error={actionError ?? (error && !busyPoll ? error : null)} />

        <div className="row-gap">
          <button type="button" className="btn btn-secondary btn-sm" onClick={check} disabled={pending !== null || busy}>
            {pending === "check" || status?.state === "checking" ? "Checking…" : "Check now"}
          </button>
          {status?.updateAvailable && !status.disabledReason && (
            <button type="button" className="btn btn-primary btn-sm" onClick={apply} disabled={pending !== null || busy}>
              {pending === "apply" ? "Starting…" : `Update to v${status.latest?.version}`}
            </button>
          )}
          {busy && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void refresh()}>
              Refresh
            </button>
          )}
        </div>

        <div className="field">
          <span className="field-label" id="channel-label">
            Channel
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="channel-label">
            {(["stable", "nightly"] as const).map((ch) => (
              <button key={ch} type="button" role="radio" aria-checked={draft.updateChannel === ch} className={`segment ${draft.updateChannel === ch ? "is-active" : ""}`} onClick={() => set("updateChannel", ch)}>
                {ch === "stable" ? "Stable" : "Nightly"}
              </button>
            ))}
          </div>
          <p className="field-hint">Nightly is built from every change and is unreviewed. Switching back to stable from a nightly installs the stable release. Save before checking.</p>
        </div>

        <Switch checked={draft.autoUpdate} onChange={(v) => set("autoUpdate", v)} label="Install updates automatically" hint="Checked every 6 hours; installs when nothing is playing." />

        <details open={manifestCustom}>
          <summary className="field-label">Advanced</summary>
          <Field
            label="Manifest URL override"
            hint={
              <>
                Leave empty to use the feed built into this server. <code className="code-inline">{"{channel}"}</code> becomes stable or nightly; the signature is read from the same URL plus <code className="code-inline">.sig</code> and must still match the built-in key.
              </>
            }
          >
            {(id, d) => (
              <input
                id={id}
                aria-describedby={d}
                className="input mono"
                type="url"
                placeholder={!manifestCustom && status?.manifestUrl ? status.manifestUrl : "https://…/manifest.json"}
                value={draft.updateManifestUrl}
                onChange={(e) => set("updateManifestUrl", e.target.value.trim())}
                spellCheck={false}
                autoCapitalize="off"
              />
            )}
          </Field>
          {manifestCustom && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("updateManifestUrl", "")}>
              Use the built-in feed
            </button>
          )}
        </details>
      </div>
    </Card>
  );
}
