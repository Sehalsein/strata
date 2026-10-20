import { useEffect, useState } from "react";
import { ApiError, api, errorMessage, getToken, setToken } from "../api";
import { BrandMark } from "../components/Layout";
import { MediaFolders } from "../components/MediaFolders";
import { ProfileManager } from "../components/ProfileManager";
import { SecretKeyForm } from "../components/SecretKeyForm";
import { ErrorText, Field, Notice, Spinner } from "../components/ui";
import type { MediaFolder, ServerInfo, SettingsResponse } from "../types";

const STEPS = [
  { key: "account", label: "Admin account" },
  { key: "folders", label: "Media folders" },
  { key: "keys", label: "Keys" },
  { key: "profiles", label: "Profiles" },
  { key: "done", label: "Finish" },
] as const;

const STEP_KEY = "strata.wizardStep";

function storedStep(): number | null {
  try {
    const v = sessionStorage.getItem(STEP_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function storeStep(n: number | null) {
  try {
    if (n === null) sessionStorage.removeItem(STEP_KEY);
    else sessionStorage.setItem(STEP_KEY, String(n));
  } catch {
    /* ignore */
  }
}

/** True when the admin was created in this tab but the remaining steps aren't finished. */
export function wizardInProgress(): boolean {
  const s = storedStep();
  return s !== null && s > 0 && !!getToken();
}

export function SetupWizard({ info, onDone }: { info: ServerInfo | null; onDone: () => void }) {
  const [step, setStepState] = useState(() => (info?.setupRequired ? 0 : (storedStep() ?? 0)));
  const setStep = (n: number) => {
    setStepState(n);
    storeStep(n);
    window.scrollTo(0, 0);
  };

  const finish = () => {
    storeStep(null);
    onDone();
  };

  return (
    <div className="wizard">
      <aside className="wizard-rail">
        <div className="brand">
          <BrandMark size={30} />
          <span className="brand-name">Strata</span>
        </div>
        <p className="wizard-kicker">Server setup{info?.version ? <span className="mono"> · v{info.version}</span> : null}</p>
        <ol className="steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.key} className={`step ${i === step ? "is-current" : ""} ${i < step ? "is-done" : ""}`} aria-current={i === step ? "step" : undefined}>
              <span className="step-num" aria-hidden="true">
                {i < step ? "✓" : String(i + 1).padStart(2, "0")}
              </span>
              <span className="step-label">{s.label}</span>
            </li>
          ))}
        </ol>
      </aside>

      <main className="wizard-main" id="main">
        <p className="wizard-progress mono" aria-hidden="true">
          Step {step + 1} of {STEPS.length}
        </p>
        {step === 0 && <AccountStep onNext={() => setStep(1)} />}
        {step === 1 && <FoldersStep onNext={() => setStep(2)} />}
        {step === 2 && <KeysStep onBack={() => setStep(1)} onNext={() => setStep(3)} />}
        {step === 3 && <ProfilesStep onBack={() => setStep(2)} onNext={() => setStep(4)} />}
        {step === 4 && <DoneStep onBack={() => setStep(3)} onFinish={finish} />}
      </main>
    </div>
  );
}

function StepHead({ title, lede }: { title: string; lede: React.ReactNode }) {
  return (
    <header className="step-head">
      <h1 className="display">{title}</h1>
      <p className="lede">{lede}</p>
    </header>
  );
}

function AccountStep({ onNext }: { onNext: () => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== confirm) return setError("The passwords don't match.");
    setPending(true);
    setError(null);
    try {
      const { token } = await api.setupAdmin(username.trim(), password);
      setToken(token);
      onNext();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setAlreadyDone(true);
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="step-body" onSubmit={submit}>
      <StepHead title="Create the admin account" lede="This account manages the server from this dashboard. It also gets the first viewing profile." />
      <div className="form-narrow stack">
        <Field label="Username">
          {(id) => <input id={id} className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} required maxLength={64} />}
        </Field>
        <Field label="Password" hint="At least 8 characters.">
          {(id, d) => <input id={id} aria-describedby={d} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />}
        </Field>
        <Field label="Confirm password">{(id) => <input id={id} className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}</Field>
        <ErrorText error={error} />
        {alreadyDone && (
          <Notice tone="info" title="Setup was already completed">
            <a href="/" onClick={() => location.reload()}>
              Sign in instead
            </a>
            .
          </Notice>
        )}
      </div>
      <div className="step-foot">
        <span />
        <button type="submit" className="btn btn-primary btn-lg" disabled={pending || !username.trim()}>
          {pending ? "Creating…" : "Create account"}
        </button>
      </div>
    </form>
  );
}

function FoldersStep({ onNext }: { onNext: () => void }) {
  const [folders, setFolders] = useState<MediaFolder[] | null>(null);
  const [loadError, setLoadError] = useState<unknown>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.settings().then(
      (r) => setFolders(r.settings.mediaFolders),
      (err) => setLoadError(err),
    );
  }, []);

  const save = async () => {
    if (!folders) return;
    setPending(true);
    setError(null);
    try {
      await api.updateSettings({ mediaFolders: folders });
      onNext();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="step-body">
      <StepHead
        title="Add your media folders"
        lede={
          <>
            Pick folders on <em>this server</em> that hold movies or shows. Strata scans them and matches each file to TMDB. Network shares mounted on the server work too.
          </>
        }
      />
      {loadError ? <ErrorText error={loadError} /> : folders ? <MediaFolders value={folders} onChange={setFolders} /> : <Spinner />}
      <ErrorText error={error} />
      <div className="step-foot">
        <button type="button" className="btn btn-ghost" onClick={onNext}>
          Skip for now
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void save()} disabled={pending || !folders}>
          {pending ? "Saving…" : "Save & continue"}
        </button>
      </div>
    </div>
  );
}

function KeysStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>();

  useEffect(() => {
    api.settings().then(setData, setLoadError);
  }, []);

  const setConfigured = (key: "tmdbApiKey" | "torboxApiKey", v: boolean) => setData((d) => (d ? { ...d, secrets: { ...d.secrets, [key]: v } } : d));

  return (
    <div className="step-body">
      <StepHead title="Connect TMDB and TorBox" lede="Each key is checked with its provider, then stored encrypted on this server. You can change them later in Settings." />
      {loadError ? (
        <ErrorText error={loadError} />
      ) : !data ? (
        <Spinner />
      ) : (
        <div className="stack-lg">
          <SecretKeyForm
            secretKey="tmdbApiKey"
            label="TMDB API key"
            required
            configured={data.secrets.tmdbApiKey}
            onChanged={(v) => setConfigured("tmdbApiKey", v)}
            description={
              <>
                Powers the catalog: titles, artwork and matching. Paste either the v3 API key or the v4 read access token from{" "}
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
            onChanged={(v) => setConfigured("torboxApiKey", v)}
            description={
              <>
                Optional. Lets Strata play titles from your TorBox library. Find it at{" "}
                <a href="https://torbox.app/settings" target="_blank" rel="noreferrer">
                  torbox.app/settings
                </a>
                .
              </>
            }
          />
          {!data.secrets.tmdbApiKey && (
            <Notice tone="warn" title="The catalog needs a TMDB key">
              You can continue without one and add it later in Settings, but browsing and matching won't work until you do.
            </Notice>
          )}
        </div>
      )}
      <div className="step-foot">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
          {data?.secrets.tmdbApiKey ? "Continue" : "Continue without TMDB"}
        </button>
      </div>
    </div>
  );
}

function ProfilesStep({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
  return (
    <div className="step-body">
      <StepHead title="Who's watching?" lede="Each profile keeps its own progress and watchlist. Add a PIN to keep a profile private. Your own profile is already here." />
      <ProfileManager compact />
      <div className="step-foot">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
          Continue
        </button>
      </div>
    </div>
  );
}

function DoneStep({ onBack, onFinish }: { onBack: () => void; onFinish: () => void }) {
  const [pending, setPending] = useState(false);
  const finish = async () => {
    setPending(true);
    try {
      await api.runJob("scanLocal");
    } catch {
      /* the scan also runs on its schedule */
    }
    onFinish();
  };
  return (
    <div className="step-body">
      <StepHead title="You're set" lede="Strata will scan your folders now. On your Apple devices, open Strata and pick this server — it shows up on the local network automatically." />
      <ul className="done-list">
        <li>Unmatched files can be fixed from Library.</li>
        <li>Keys, folders and playback limits live in Settings.</li>
        <li>Active streams and background jobs show on the Overview.</li>
      </ul>
      <div className="step-foot">
        <button type="button" className="btn btn-ghost" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={() => void finish()} disabled={pending}>
          {pending ? "Starting…" : "Open dashboard"}
        </button>
      </div>
    </div>
  );
}
