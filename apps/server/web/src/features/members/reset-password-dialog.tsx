import { useState } from "react";
import { Check, Copy, KeyRound, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** "K7QM-W2XP-9HTR": easy to read out and type (no 0/O, 1/I), about 60 bits of chance. */
function temporaryPassword(): string {
  // 32 characters: the low 5 bits of a random byte pick one, evenly (32 divides 256).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => alphabet[b & 0b11111]!);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/**
 * Resets a member's password to a temporary one, shown once to pass on. Better Auth's
 * admin set-user-password does it; the server signs them out everywhere and has them
 * choose their own password at their next sign-in.
 */
export function ResetPasswordDialog({ member, onOpenChange }: { member: { userId: string; name: string } | null; onOpenChange: (open: boolean) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const reset = async () => {
    if (!member) return;
    setPending(true);
    setError(null);
    const next = temporaryPassword();
    try {
      await authClient.setTemporaryPassword(member.userId, next);
      setPassword(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const copy = async () => {
    if (!password) return;
    await navigator.clipboard.writeText(password).catch(() => toast.error("Couldn't copy. Select it and copy instead."));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog
      open={!!member}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setPassword(null);
          setError(null);
          setCopied(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{password ? `${member?.name}'s temporary password` : `Reset ${member?.name}'s password?`}</DialogTitle>
          <DialogDescription>
            {password
              ? "Give it to them yourself. It's shown only now. When they sign in with it, they'll choose their own password before anything else."
              : `${member?.name} is signed out on every device, and gets a temporary password from you to sign in with. Devices that joined at home without a password, and TVs, stay signed in.`}
          </DialogDescription>
        </DialogHeader>

        {password ? (
          <div className="flex items-center gap-2">
            <code className="bg-muted flex-1 rounded-md px-4 py-3 text-center font-mono text-lg tracking-widest select-all">{password}</code>
            <Button variant="outline" size="icon" onClick={() => void copy()} aria-label="Copy the temporary password">
              {copied ? <Check /> : <Copy />}
            </Button>
          </div>
        ) : (
          error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )
        )}

        <DialogFooter>
          {password ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => void reset()} disabled={pending}>
                {pending ? <LoaderCircle className="animate-spin" /> : <KeyRound />} Reset password
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
