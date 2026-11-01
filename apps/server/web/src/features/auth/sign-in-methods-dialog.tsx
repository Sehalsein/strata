import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, Plus, Trash } from "lucide-react";
import { useSession } from "@/app/session";
import { authClient } from "@/lib/auth-client";
import { relativeTime } from "@/lib/format";
import { useApiMutation } from "@/lib/query";
import { InlineError } from "@/components/page";
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
  const { me } = useSession();
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
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <KeyRound className="text-muted-foreground size-4" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{p.name || "Passkey"}</p>
                <p className="text-muted-foreground text-xs">Added {relativeTime(new Date(p.createdAt).getTime())}</p>
              </div>
              <Button variant="ghost" size="icon-sm" className="text-destructive" onClick={() => remove.mutate(p.id)} aria-label={`Remove ${p.name || "passkey"}`}>
                <Trash />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
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
      <InlineError error={add.error} />
    </section>
  );
}
