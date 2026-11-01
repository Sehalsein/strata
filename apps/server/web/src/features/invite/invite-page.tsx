import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { Me } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { AuthScreen, SignInForm } from "@/features/auth/login-page";

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,64}$/;

/**
 * /invite/:id — the link a household's admin passed on. Public: a new person makes their
 * account here (sign-up needs the invitation's id), someone with an account signs in, and
 * either way the invitation is accepted and its household opened.
 */
export default function InvitePage({ invitationId, serverName, me, onJoined }: { invitationId: string; serverName: string; me: Me | null; onJoined: () => Promise<void> }) {
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const acceptAsMe = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      await authClient.acceptInvitation(invitationId);
      await onJoined();
    } catch (err) {
      setAcceptError(errorMessage(err));
      setAccepting(false);
    }
  };

  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">You're invited</CardTitle>
          <CardDescription>
            Join a household on {serverName && serverName !== "Strata" ? serverName : "this Strata server"}. {mode === "signup" ? "Create your account with the email the invitation is for." : "Sign in with the account the invitation's email belongs to."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {me && (
            <>
              <div className="flex flex-col gap-2">
                <Button onClick={() => void acceptAsMe()} disabled={accepting}>
                  {accepting && <LoaderCircle className="animate-spin" />}
                  Join as {me.user.name}
                </Button>
                {acceptError && <p className="text-destructive text-sm" role="alert">{acceptError}</p>}
              </div>
              <Separator />
            </>
          )}
          {mode === "signup" ? (
            <SignUpForm invitationId={invitationId} onJoined={onJoined} />
          ) : (
            <SignInForm
              submitLabel="Sign in and join"
              onSignedIn={async () => {
                await authClient.acceptInvitation(invitationId);
                await onJoined();
              }}
            />
          )}
          <Button variant="link" className="h-auto p-0" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
            {mode === "signup" ? "I already have an account" : "I'm new here: create an account"}
          </Button>
        </CardContent>
      </Card>
    </AuthScreen>
  );
}

function SignUpForm({ invitationId, onJoined }: { invitationId: string; onJoined: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<{ message: string; rateLimited: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  const emailError = touched && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "Enter the email you were invited with." : null;
  const usernameError = touched && !USERNAME_RE.test(username.trim()) ? "2–64 letters, numbers, dots, dashes or underscores." : null;
  const passwordError = touched && password.length < 8 ? "Use at least 8 characters." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || !USERNAME_RE.test(username.trim()) || password.length < 8) return;
    setPending(true);
    setError(null);
    try {
      await authClient.signUp({ email: email.trim().toLowerCase(), username: username.trim(), name: name.trim() || username.trim(), password, invitationId });
      await onJoined();
    } catch (err) {
      setError({ message: errorMessage(err), rateLimited: err instanceof ApiError && err.status === 429 });
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField label="Email" error={emailError}>
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />}
        </FormField>
        <FormField label="Username" description="What you sign in with." error={usernameError}>
          {(p) => <Input {...p} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} maxLength={64} />}
        </FormField>
        <FormField label="Name" description="Shown to your household. Defaults to your username.">
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={64} />}
        </FormField>
        <FormField label="Password" description="At least 8 characters." error={passwordError}>
          {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </FormField>
        {error && (
          <Alert variant={error.rateLimited ? "warning" : "destructive"}>
            <AlertTitle>{error.rateLimited ? "Too many attempts" : "Couldn't join"}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" />}
          {pending ? "Joining…" : "Create account and join"}
        </Button>
      </FieldGroup>
    </form>
  );
}
