import { useState, type ReactNode } from "react";
import { CircleCheck, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { queryClient, queryKeys } from "@/lib/query";
import type { SecretKey, SettingsResponse } from "@/lib/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

/**
 * Enter / replace / remove one provider key. The server checks a key with its provider before
 * storing it, so "Verify & save" is also the key test; a rejection comes back inline.
 */
export function SecretKeyForm({
  secretKey,
  label,
  description,
  configured,
  required,
  guide,
  onChanged,
}: {
  secretKey: SecretKey;
  label: string;
  description: ReactNode;
  configured: boolean;
  required?: boolean;
  /** How to get a key, shown while there's none to show. */
  guide?: ReactNode;
  onChanged?: (configured: boolean) => void;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(!configured);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputId = `secret-${secretKey}`;

  const setConfigured = (v: boolean) => {
    queryClient.setQueryData<SettingsResponse>(queryKeys.settings, (d) => (d ? { ...d, secrets: { ...d.secrets, [secretKey]: v } } : d));
    void queryClient.invalidateQueries({ queryKey: queryKeys.status });
    onChanged?.(v);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim()) {
      setError("Paste a key first.");
      return;
    }
    setPending(true);
    setError(null);
    setSaved(false);
    try {
      await api.setSecret(secretKey, value.trim());
      setValue("");
      setEditing(false);
      setSaved(true);
      setConfigured(true);
      toast.success(`${label} verified and saved`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    try {
      await api.setSecret(secretKey, null);
      setEditing(true);
      setSaved(false);
      setConfigured(false);
      toast.success(`${label} removed`);
    } catch (err) {
      toast.error(errorMessage(err));
      throw err;
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">{label}</h3>
        {configured ? <Badge variant="success">Configured</Badge> : required ? <Badge variant="warning">Required</Badge> : <Badge variant="secondary">Optional</Badge>}
      </div>
      <p className="text-muted-foreground text-sm [&_a]:underline [&_a]:underline-offset-4">{description}</p>
      {editing && guide && <div className="-mt-1">{guide}</div>}

      {configured && !editing ? (
        <div className="bg-muted/40 flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-muted-foreground flex items-center gap-2 text-sm">
            <CircleCheck className="text-ok size-4" />
            {saved ? "Key verified and saved." : "A key is stored, encrypted on the server."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={save} noValidate>
          <Input
            id={inputId}
            aria-label={label}
            className="font-mono"
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
          <Button type="submit" disabled={pending} className="shrink-0">
            {pending && <LoaderCircle className="animate-spin" />}
            {pending ? "Checking…" : "Verify & save"}
          </Button>
          {configured && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setValue("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          )}
        </form>
      )}
      <FieldError id={`${inputId}-err`}>{error}</FieldError>
      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={`Remove the ${label}?`}
        description="Strata stops using this provider until a new key is added."
        confirmLabel="Remove key"
        onConfirm={remove}
      />
    </div>
  );
}
