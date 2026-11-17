import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, KeyRound, LoaderCircle, Pencil, Plus, Trash, X } from "lucide-react";
import { useSession } from "@/app/session";
import { authClient } from "@/lib/auth-client";
import { relativeTime } from "@/lib/format";
import { useApiMutation } from "@/lib/query";
import type { SavedPasskey } from "@/lib/types";
import { passkeyAvailability } from "./passkey-availability";
import { InlineError } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const keys = { google: ["auth", "google"] as const, passkeys: ["auth", "passkeys"] as const };

/**
 * Ways into the signed-in account besides its password: Google, once connected here, and
 * passkeys saved on this device or a phone. Each shows only where the server is set up for it.
 */
export function SignInMethodsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { info } = useSession();
  const methods = info.signIn;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign-in methods</DialogTitle>
          <DialogDescription>Other ways into this account. Your password keeps working.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          {methods?.google && <GoogleSection enabled={open} />}
          {methods?.passkey && <PasskeySection enabled={open} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoogleSection({ enabled }: { enabled: boolean }) {
  const connected = useQuery({ queryKey: keys.google, queryFn: authClient.googleConnected, enabled });
  const connect = useApiMutation(() => authClient.connectGoogle());
  const disconnect = useApiMutation(() => authClient.disconnectGoogle(), { success: "Google disconnected", invalidate: [keys.google] });
  return (
    <section className="flex items-center justify-between gap-4">
      <div>
        <p className="flex items-center gap-2 font-medium">
          Google {connected.data && <Badge variant="success">Connected</Badge>}
        </p>
        <p className="text-muted-foreground text-sm">{connected.data ? "“Continue with Google” signs you in." : "Connect your Google account to sign in with it."}</p>
      </div>
      {connected.isPending ? (
        <Skeleton className="h-8 w-24" />
      ) : connected.data ? (
        <Button variant="outline" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
          Disconnect
        </Button>
      ) : (
        <Button size="sm" onClick={() => connect.mutate()} disabled={connect.isPending}>
          {connect.isPending && <LoaderCircle className="animate-spin" />} Connect
        </Button>
      )}
    </section>
  );
}

function PasskeySection({ enabled }: { enabled: boolean }) {
  const { me, info } = useSession();
  const available = passkeyAvailability(info.signIn);
  const passkeys = useQuery({ queryKey: keys.passkeys, queryFn: authClient.listPasskeys, enabled });
  const [name, setName] = useState("");
  const add = useApiMutation(() => authClient.addPasskey(name.trim() || `${me.user.name}'s passkey`), {
    success: "Passkey saved",
    silentError: true,
    invalidate: [keys.passkeys],
    onSuccess: () => setName(""),
  });
  const remove = useApiMutation((id: string) => authClient.deletePasskey(id), { success: "Passkey removed", invalidate: [keys.passkeys] });
  return (
    <section className="flex flex-col gap-3">
      <div>
        <p className="font-medium">Passkeys</p>
        <p className="text-muted-foreground text-sm">Sign in with Face ID, Touch ID or your phone instead of typing a password.</p>
      </div>
      {passkeys.isPending ? (
        <Skeleton className="h-10" />
      ) : (passkeys.data ?? []).length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {passkeys.data!.map((p) => (
            <PasskeyRow key={p.id} passkey={p} onRemove={() => remove.mutate(p.id)} />
          ))}
        </ul>
      ) : null}
      {available?.ok === false ? (
        <Alert>
          <KeyRound />
          <AlertTitle>Passkeys can't be added here</AlertTitle>
          <AlertDescription>
            <p>
              {available.reason}
              {available.address && (
                <>
                  {" "}
                  <a href={available.address} className="text-foreground underline underline-offset-4">
                    Open it there
                  </a>
                </>
              )}
            </p>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate();
            }}
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. MacBook" maxLength={64} aria-label="Passkey name" />
            <Button type="submit" variant="outline" disabled={add.isPending}>
              {add.isPending ? <LoaderCircle className="animate-spin" /> : <Plus />} Add passkey
            </Button>
          </form>
          {available?.localOnly && (
            <p className="text-muted-foreground text-xs">
              Passkeys made here work at this address on this computer only. To use them from other devices, give the server an HTTPS address (STRATA_PUBLIC_URL); passkeys made before that change stop working.
            </p>
          )}
        </>
      )}
      <InlineError error={add.error} />
    </section>
  );
}

/** One saved passkey: its name (renamed in place) and when it was added. */
function PasskeyRow({ passkey: p, onRemove }: { passkey: SavedPasskey; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(p.name ?? "");
  const rename = useApiMutation(() => authClient.renamePasskey(p.id, name.trim()), {
    success: "Passkey renamed",
    invalidate: [keys.passkeys],
    onSuccess: () => setEditing(false),
  });
  const label = p.name || "Passkey";
  if (editing)
    return (
      <li>
        <form
          className="flex items-center gap-2 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) rename.mutate();
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} aria-label="Passkey name" autoFocus onFocus={(e) => e.target.select()} className="h-8" />
          <Button type="submit" variant="ghost" size="icon-sm" disabled={!name.trim() || rename.isPending} aria-label="Save name">
            {rename.isPending ? <LoaderCircle className="animate-spin" /> : <Check />}
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => (setEditing(false), setName(p.name ?? ""))} aria-label="Cancel renaming">
            <X />
          </Button>
        </form>
      </li>
    );
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <KeyRound className="text-muted-foreground size-4" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <p className="text-muted-foreground text-xs">Added {relativeTime(new Date(p.createdAt).getTime())}</p>
      </div>
      <Button variant="ghost" size="icon-sm" onClick={() => setEditing(true)} aria-label={`Rename ${label}`}>
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={onRemove} aria-label={`Remove ${label}`}>
        <Trash />
      </Button>
    </li>
  );
}
