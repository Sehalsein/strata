import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";
import { AuthError, authClient } from "@/lib/auth-client";
import { queryClient, queryKeys } from "@/lib/query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InlineError } from "@/components/page";

const MIN = 8;

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>Your other signed-in devices are signed out. This browser stays signed in.</DialogDescription>
        </DialogHeader>
        {open && <ChangePasswordForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const nextError = touched && next.length < MIN ? `Use at least ${MIN} characters.` : touched && next === current && next ? "Pick a password different from the current one." : null;
  const confirmError = touched && confirm !== next ? "The passwords don't match." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!current || next.length < MIN || next === current || confirm !== next) return;
    setPending(true);
    setError(null);
    setCurrentError(null);
    try {
      await authClient.changePassword({ currentPassword: current, newPassword: next });
      toast.success("Password changed. Other devices were signed out.");
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      onDone();
    } catch (err) {
      if (err instanceof AuthError && err.code === "INVALID_PASSWORD") setCurrentError("That isn't your current password.");
      else setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField label="Current password" error={currentError ?? (touched && !current ? "Enter your current password." : null)}>
          {(p) => <Input {...p} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />}
        </FormField>
        <FormField label="New password" description={`At least ${MIN} characters.`} error={nextError}>
          {(p) => <Input {...p} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}
        </FormField>
        <FormField label="Confirm new password" error={confirmError}>
          {(p) => <Input {...p} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}
        </FormField>
        <InlineError error={error} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Change password
          </Button>
        </DialogFooter>
      </FieldGroup>
    </form>
  );
}
