import { useState } from "react";
import { api, errorMessage } from "../api";
import type { Profile } from "../types";
import { Dialog } from "./Dialog";
import { Badge, ErrorText, Field, Spinner, useResource } from "./ui";

const PIN_RE = /^\d{4,8}$/;

export function ProfileManager({ compact }: { compact?: boolean }) {
  const { data: profiles, error, loading, refresh } = useResource(api.profiles);
  const [editing, setEditing] = useState<Profile | null>(null);
  const [rowError, setRowError] = useState<{ id: number; message: string } | null>(null);

  const remove = async (p: Profile) => {
    if (!confirm(`Delete the profile “${p.name}”? Its watch progress and watchlist go with it.`)) return;
    setRowError(null);
    try {
      await api.deleteProfile(p.id);
      await refresh();
    } catch (err) {
      setRowError({ id: p.id, message: errorMessage(err) });
    }
  };

  return (
    <div className="profiles">
      {loading && !profiles ? (
        <div className="center-pad">
          <Spinner />
        </div>
      ) : error ? (
        <ErrorText error={error} />
      ) : (
        <ul className="profile-list">
          {profiles?.map((p) => (
            <li key={p.id} className="profile-row">
              <span className="avatar" aria-hidden="true" style={{ background: avatarFill(p.id) }}>
                {p.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="profile-main">
                <span className="profile-name">{p.name}</span>
                <span className="profile-meta">{p.hasPin ? <Badge tone="accent">PIN</Badge> : <span className="muted">No PIN</span>}</span>
                {rowError?.id === p.id && <ErrorText error={rowError.message} />}
              </div>
              {!compact && (
                <div className="row-gap profile-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => void remove(p)} disabled={profiles.length <= 1} title={profiles.length <= 1 ? "The last profile can't be deleted" : undefined}>
                    Delete
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <AddProfileForm onAdded={() => void refresh()} />

      <EditProfileDialog
        profile={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void refresh();
        }}
      />
    </div>
  );
}

function AddProfileForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (pin && !PIN_RE.test(pin)) {
      setError("PIN must be 4–8 digits.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      await api.createProfile(name.trim(), pin || undefined);
      setName("");
      setPin("");
      onAdded();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="add-profile" onSubmit={submit}>
      <h3 className="subhead">Add a profile</h3>
      <div className="add-profile-fields">
        <Field label="Name">{(id) => <input id={id} className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoComplete="off" />}</Field>
        <Field label="PIN (optional)">
          {(id) => (
            <input
              id={id}
              className="input mono"
              inputMode="numeric"
              pattern="\d{4,8}"
              maxLength={8}
              placeholder="4–8 digits"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              autoComplete="off"
            />
          )}
        </Field>
        <button type="submit" className="btn btn-primary add-profile-btn" disabled={!name.trim() || pending}>
          {pending ? "Adding…" : "Add profile"}
        </button>
      </div>
      <ErrorText error={error} />
    </form>
  );
}

function EditProfileDialog({ profile, onClose, onSaved }: { profile: Profile | null; onClose: () => void; onSaved: () => void }) {
  return (
    <Dialog open={!!profile} onClose={onClose} title={profile ? `Edit ${profile.name}` : "Edit profile"}>
      {profile && <EditProfileBody key={profile.id} profile={profile} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function EditProfileBody({ profile, onClose, onSaved }: { profile: Profile; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(profile.name);
  const [pinMode, setPinMode] = useState<"keep" | "set" | "remove">("keep");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const patch: { name?: string; pin?: string | null } = {};
    if (name.trim() && name.trim() !== profile.name) patch.name = name.trim();
    if (pinMode === "set") {
      if (!PIN_RE.test(pin)) {
        setError("PIN must be 4–8 digits.");
        return;
      }
      patch.pin = pin;
    }
    if (pinMode === "remove") patch.pin = null;
    if (Object.keys(patch).length === 0) return onClose();
    setPending(true);
    setError(null);
    try {
      await api.updateProfile(profile.id, patch);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      <Field label="Name">{(id) => <input id={id} className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}</Field>
      <fieldset className="fieldset">
        <legend className="field-label">PIN</legend>
        <div className="radio-row">
          <label className="radio">
            <input type="radio" name="pinmode" checked={pinMode === "keep"} onChange={() => setPinMode("keep")} />
            {profile.hasPin ? "Keep current PIN" : "No PIN"}
          </label>
          <label className="radio">
            <input type="radio" name="pinmode" checked={pinMode === "set"} onChange={() => setPinMode("set")} />
            {profile.hasPin ? "Change PIN" : "Set a PIN"}
          </label>
          {profile.hasPin && (
            <label className="radio">
              <input type="radio" name="pinmode" checked={pinMode === "remove"} onChange={() => setPinMode("remove")} />
              Remove PIN
            </label>
          )}
        </div>
        {pinMode === "set" && (
          <Field label="New PIN" hint="4–8 digits. Asked for when this profile is picked on a device.">
            {(id, d) => (
              <input id={id} aria-describedby={d} className="input mono" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoComplete="off" autoFocus />
            )}
          </Field>
        )}
      </fieldset>
      <ErrorText error={error} />
      <div className="dialog-foot-buttons">
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

const AVATAR_FILLS = ["var(--sand)", "var(--accent)", "var(--local)", "var(--torbox)"];

/** Same pick as the apps (FNV-1a over the profile id), so a profile has one color everywhere. */
function avatarFill(id: number): string {
  let hash = 2166136261;
  for (const byte of new TextEncoder().encode(String(id))) hash = Math.imul(hash ^ byte, 16777619) >>> 0;
  return AVATAR_FILLS[hash % AVATAR_FILLS.length]!;
}
