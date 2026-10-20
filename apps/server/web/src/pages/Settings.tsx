import { useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../api";
import { MediaFolders } from "../components/MediaFolders";
import { SecretKeyForm } from "../components/SecretKeyForm";
import { DiscoveryCard, NetworkCard, UpdatesCard } from "../components/SystemSettings";
import { Card, ErrorText, Field, Flash, PageHeader, Spinner, useFlash, useResource } from "../components/ui";
import type { Provider, Settings } from "../types";

const PROVIDER_LABEL: Record<Provider, string> = { local: "Local folders", torbox: "TorBox" };

export function SettingsPage({ onServerNameChange }: { onServerNameChange: (name: string) => void }) {
  const { data, error, loading, setData } = useResource(api.settings);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [flash, showFlash] = useFlash();

  useEffect(() => {
    if (data && !draft) setDraft(data.settings);
  }, [data, draft]);

  // Jump to #keys / #updates when linked from the overview.
  useEffect(() => {
    if (draft && location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, [!!draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => !!data && !!draft && JSON.stringify(data.settings) !== JSON.stringify(draft), [data, draft]);

  if (loading && !data) {
    return (
      <div className="center-pad">
        <Spinner />
      </div>
    );
  }
  if (!data || !draft) return <ErrorText error={error} />;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft({ ...draft, [key]: value });

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const patch: Partial<Settings> = {};
    for (const k of Object.keys(draft) as (keyof Settings)[]) {
      if (JSON.stringify(draft[k]) !== JSON.stringify(data.settings[k])) (patch as Record<string, unknown>)[k] = draft[k];
    }
    if (Object.keys(patch).length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const r = await api.updateSettings(patch);
      setData({ ...data, settings: r.settings });
      setDraft(r.settings);
      if (patch.serverName) onServerNameChange(r.settings.serverName);
      showFlash("Saved");
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const movePriority = (i: number, dir: -1 | 1) => {
    const next = [...draft.sourcePriority];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j]!, next[i]!];
    set("sourcePriority", next);
  };

  // Every provider must appear in the order list, even if an older config dropped one.
  const priority: Provider[] = [...draft.sourcePriority, ...(["local", "torbox"] as Provider[]).filter((p) => !draft.sourcePriority.includes(p))];

  const num = (v: string, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : fallback;
  };

  return (
    <div className="page settings">
      <PageHeader title="Settings" subtitle="Changes apply to every client of this server." />

      {/* Cards hold their own nested forms (keys), so the save bar is the settings form. */}
      <div className="stack-lg">
        <Card title="Server">
          <div className="form-grid">
            <Field label="Server name" hint="Shown in the apps when they find this server.">
              {(id, d) => <input id={id} aria-describedby={d} className="input" value={draft.serverName} maxLength={64} onChange={(e) => set("serverName", e.target.value)} required />}
            </Field>
            <Field label="Metadata language" hint="TMDB language tag, e.g. en-US, fr-FR, ja-JP.">
              {(id, d) => <input id={id} aria-describedby={d} className="input mono" value={draft.language} onChange={(e) => set("language", e.target.value)} spellCheck={false} autoCapitalize="off" />}
            </Field>
            <Field label="Region" hint="Two-letter country code for release dates and ratings, e.g. US, GB.">
              {(id, d) => <input id={id} aria-describedby={d} className="input mono" value={draft.region} maxLength={2} onChange={(e) => set("region", e.target.value.toUpperCase())} spellCheck={false} autoCapitalize="characters" />}
            </Field>
          </div>
        </Card>

        <NetworkCard draft={draft} set={set} />

        <Card title="Media folders">
          <MediaFolders value={draft.mediaFolders} onChange={(v) => set("mediaFolders", v)} />
        </Card>

        <Card title="Scanning & sync">
          <div className="form-grid">
            <Field label="Scan local folders every" hint="Minutes. 0 turns scheduled scans off.">
              {(id, d) => (
                <div className="input-suffix">
                  <input id={id} aria-describedby={d} className="input mono" type="number" min={0} value={draft.scanIntervalMinutes} onChange={(e) => set("scanIntervalMinutes", num(e.target.value, draft.scanIntervalMinutes))} />
                  <span>min</span>
                </div>
              )}
            </Field>
            <Field label="Sync TorBox every" hint="Minutes. 0 turns scheduled syncs off.">
              {(id, d) => (
                <div className="input-suffix">
                  <input id={id} aria-describedby={d} className="input mono" type="number" min={0} value={draft.torboxSyncMinutes} onChange={(e) => set("torboxSyncMinutes", num(e.target.value, draft.torboxSyncMinutes))} />
                  <span>min</span>
                </div>
              )}
            </Field>
            <Field label="Remove unplayed TorBox releases after" hint="Releases Strata added to find something to play are removed from TorBox once nobody has played them for this long. Anything you add in TorBox yourself is never touched. 0 keeps everything.">
              {(id, d) => (
                <div className="input-suffix">
                  <input id={id} aria-describedby={d} className="input mono" type="number" min={0} max={365} value={draft.torboxCleanupDays} onChange={(e) => set("torboxCleanupDays", num(e.target.value, draft.torboxCleanupDays))} />
                  <span>days</span>
                </div>
              )}
            </Field>
          </div>
        </Card>

        <Card title="Sources & quality">
          <div className="form-grid">
            <div className="field">
              <span className="field-label" id="priority-label">
                Source priority
              </span>
              <ol className="priority" aria-labelledby="priority-label">
                {priority.map((p, i) => (
                  <li key={p} className="priority-row">
                    <span className="priority-rank mono">{i + 1}</span>
                    <span className="priority-name">{PROVIDER_LABEL[p]}</span>
                    <span className="row-gap">
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === 0} onClick={() => movePriority(i, -1)} aria-label={`Move ${PROVIDER_LABEL[p]} up`}>
                        ↑
                      </button>
                      <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={i === priority.length - 1} onClick={() => movePriority(i, 1)} aria-label={`Move ${PROVIDER_LABEL[p]} down`}>
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
              <p className="field-hint">When a title exists in both, the first source wins.</p>
            </div>

            <div className="field">
              <span className="field-label" id="maxres-label">
                Maximum resolution
              </span>
              <div className="segmented" role="radiogroup" aria-labelledby="maxres-label">
                {[2160, 1080, 720].map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={draft.maxResolution === r} className={`segment ${draft.maxResolution === r ? "is-active" : ""}`} onClick={() => set("maxResolution", r)}>
                    {r === 2160 ? "4K" : `${r}p`}
                  </button>
                ))}
              </div>
              <p className="field-hint">Higher-resolution sources are ranked below ones within the cap.</p>
            </div>
          </div>
        </Card>

        <DiscoveryCard draft={draft} set={set} />

        <Card title="Transcoding">
          <div className="form-grid">
            <label className="switch-row">
              <input type="checkbox" className="switch" role="switch" checked={draft.hardwareAcceleration} onChange={(e) => set("hardwareAcceleration", e.target.checked)} />
              <span>
                <span className="switch-label">Hardware acceleration</span>
                <span className="field-hint">Use VideoToolbox / VAAPI / QSV when a full transcode is needed.</span>
              </span>
            </label>
            <Field label="Concurrent transcodes" hint="1–16. How many ffmpeg remux/transcode jobs may run at once.">
              {(id, d) => (
                <input
                  id={id}
                  aria-describedby={d}
                  className="input mono input-narrow"
                  type="number"
                  min={1}
                  max={16}
                  value={draft.maxTranscodes}
                  onChange={(e) => set("maxTranscodes", Math.min(16, Math.max(1, num(e.target.value, draft.maxTranscodes))))}
                />
              )}
            </Field>
          </div>
        </Card>

        <div id="updates" className="anchor-target">
          <UpdatesCard draft={draft} set={set} />
        </div>
      </div>

      <section id="keys" className="keys-section">
        <Card title="Provider keys">
          <div className="stack-lg">
            <SecretKeyForm
              secretKey="tmdbApiKey"
              label="TMDB API key"
              required
              configured={data.secrets.tmdbApiKey}
              onChanged={(v) => setData({ ...data, secrets: { ...data.secrets, tmdbApiKey: v } })}
              description={
                <>
                  v3 API key or v4 read access token from{" "}
                  <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">
                    themoviedb.org/settings/api
                  </a>
                  .
                </>
              }
            />
            <SecretKeyForm
              secretKey="torboxApiKey"
              label="TorBox API key"
              configured={data.secrets.torboxApiKey}
              onChanged={(v) => setData({ ...data, secrets: { ...data.secrets, torboxApiKey: v } })}
              description={
                <>
                  From{" "}
                  <a href="https://torbox.app/settings" target="_blank" rel="noreferrer">
                    torbox.app/settings
                  </a>
                  . Saving it starts a library sync.
                </>
              }
            />
          </div>
        </Card>
      </section>

      <form onSubmit={save} className={`savebar ${dirty ? "is-visible" : ""}`} aria-hidden={!dirty && !flash}>
        <ErrorText error={saveError} />
        <Flash message={flash} />
        {dirty && (
          <>
            <span className="muted small savebar-note">Unsaved changes</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setDraft(data.settings), setSaveError(null))}>
              Discard
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
