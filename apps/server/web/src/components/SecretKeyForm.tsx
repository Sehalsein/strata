import { useState, type ReactNode } from "react";
import { api, errorMessage } from "../api";
import type { SecretKey } from "../types";
import { Badge } from "./ui";

/**
 * Enter / replace / remove one provider key. The server validates keys against the provider
 * before storing them, so a rejection comes back as an inline error.
 */
export function SecretKeyForm({
  secretKey,
  label,
  description,
  configured,
  required,
  onChanged,
}: {
  secretKey: SecretKey;
  label: string;
  description: ReactNode;
  configured: boolean;
  required?: boolean;
  onChanged: (configured: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!configured);
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const inputId = `secret-${secretKey}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    setPending("save");
    setError(null);
    setSaved(false);
    try {
      await api.setSecret(secretKey, value.trim());
      setValue("");
      setEditing(false);
      setSaved(true);
      onChanged(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  const remove = async () => {
    if (!confirm(`Remove the ${label}?`)) return;
    setPending("remove");
    setError(null);
    try {
      await api.setSecret(secretKey, null);
      setEditing(true);
      setSaved(false);
      onChanged(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="secret">
      <div className="secret-head">
        <h3 className="secret-title">{label}</h3>
        {configured ? <Badge tone="ok">Configured</Badge> : required ? <Badge tone="warn">Required</Badge> : <Badge>Optional</Badge>}
      </div>
      <p className="secret-desc">{description}</p>

      {configured && !editing ? (
        <div className="secret-configured">
          <span className="mono muted">{saved ? "Key verified and saved." : "A key is stored, encrypted on the server."}</span>
          <div className="row-gap">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
              Replace
            </button>
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={remove} disabled={pending !== null}>
              {pending === "remove" ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <form className="secret-form" onSubmit={save}>
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
          <input
            id={inputId}
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="off"
            placeholder="Paste key"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-err` : undefined}
          />
          <button type="submit" className="btn btn-primary" disabled={!value.trim() || pending !== null}>
            {pending === "save" ? "Checking…" : "Verify & save"}
          </button>
          {configured && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditing(false);
                setValue("");
                setError(null);
              }}
            >
              Cancel
            </button>
          )}
        </form>
      )}
      {error && (
        <p className="field-error" id={`${inputId}-err`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
