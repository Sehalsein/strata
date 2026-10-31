import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, LoaderCircle } from "lucide-react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { authClient } from "@/lib/auth-client";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function LoginPage({
  serverName,
  onSignedIn,
  onAccountCreated,
  adding,
  onCancel,
}: {
  serverName?: string;
  onSignedIn: () => void;
  /** Cloud: a new account was made (and signed in); onboarding comes next. */
  onAccountCreated?: () => void;
  /** Someone is already signed in: this adds another account to the browser. */
  adding?: boolean;
  onCancel?: () => void;
}) {
  const info = useQuery({ queryKey: queryKeys.info, queryFn: api.info, staleTime: 60_000 });
  const [tab, setTab] = useState(() => (window.location.pathname === "/signup" ? "create" : "signin"));
  if (info.data?.signIn?.signUp && !adding && onAccountCreated) {
    return (
      <AuthScreen>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{tab === "create" ? "Create your account" : "Welcome back"}</CardTitle>
            <CardDescription>{tab === "create" ? "Your own streaming service, with your keys, for your household." : "Sign in to run your household"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={tab} onValueChange={setTab} className="gap-5">
              <TabsList className="w-full">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="create">Create account</TabsTrigger>
              </TabsList>
              <TabsContent value="signin">
                <SignInForm onSignedIn={onSignedIn} />
              </TabsContent>
              <TabsContent value="create">
                <CreateAccountForm onCreated={onAccountCreated} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
        <p className="text-muted-foreground text-center text-xs">
          Joining someone's household? Open the invitation link they sent you. ·{" "}
          <a href="/privacy" className="hover:text-foreground underline underline-offset-4">
            Privacy
          </a>
        </p>
      </AuthScreen>
    );
  }
  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">{adding ? "Add an account" : serverName && serverName !== "Strata" ? serverName : "Sign in"}</CardTitle>
          <CardDescription>{adding ? "Sign in with another account. Switch between them from the account menu." : "Sign in with your Strata account"}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm onSignedIn={onSignedIn} onCancel={onCancel} />
        </CardContent>
      </Card>
    </AuthScreen>
  );
}

/** The centered brand + card layout of the signed-out screens (sign-in, invitations). */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/30 relative flex min-h-svh items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-semibold">
          <BrandMark size={30} />
          <span className="text-lg">Strata</span>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SignInForm({ onSignedIn, onCancel, submitLabel = "Sign in" }: { onSignedIn: () => void | Promise<void>; onCancel?: () => void; submitLabel?: string }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; rateLimited: boolean } | null>(() => {
    // Back from Google without a sign-in (an account that hasn't connected it, say).
    if (!new URLSearchParams(window.location.search).has("auth_error")) return null;
    history.replaceState(null, "", window.location.pathname);
    return { message: "That Google account isn't connected to a Strata account. Sign in with your password, then connect Google from the account menu.", rateLimited: false };
  });
  const [pending, setPending] = useState(false);
  const [other, setOther] = useState<"google" | "passkey" | null>(null);
  // Google and passkeys show only where the server is set up for them.
  const info = useQuery({ queryKey: queryKeys.info, queryFn: api.info, staleTime: 60_000 });
  const methods = info.data?.signIn;

  const signInWith = async (method: "google" | "passkey") => {
    setOther(method);
    setError(null);
    try {
      if (method === "google") {
        await authClient.signInWithGoogle(); // leaves the page
        return;
      }
      await authClient.signInWithPasskey();
      await onSignedIn();
    } catch (err) {
      setError({ message: errorMessage(err), rateLimited: err instanceof ApiError && err.status === 429 });
    }
    setOther(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authClient.signIn({ username: username.trim(), password });
      await onSignedIn();
    } catch (err) {
      setError({ message: errorMessage(err), rateLimited: err instanceof ApiError && err.status === 429 });
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField label="Username or email">
          {(p) => <Input {...p} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} required autoFocus />}
        </FormField>
        <FormField label="Password">
          {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}
        </FormField>
        {error && (
          <Alert variant={error.rateLimited ? "warning" : "destructive"}>
            <AlertTitle>{error.rateLimited ? "Sign-in paused" : "Couldn't sign in"}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={pending || !username.trim() || !password}>
          {pending && <LoaderCircle className="animate-spin" />}
          {pending ? "Signing in…" : submitLabel}
        </Button>
        {methods?.passwordReset && (
          <a href="/forgot-password" className="text-muted-foreground hover:text-foreground -mt-2 self-end text-xs underline-offset-4 hover:underline">
            Forgot password?
          </a>
        )}
        {(methods?.google || methods?.passkey) && (
          <>
            <div className="text-muted-foreground flex items-center gap-3 text-xs">
              <span className="bg-border h-px flex-1" /> or <span className="bg-border h-px flex-1" />
            </div>
            {methods.passkey && (
              <Button type="button" variant="outline" className="w-full" onClick={() => void signInWith("passkey")} disabled={!!other || pending}>
                {other === "passkey" ? <LoaderCircle className="animate-spin" /> : <KeyRound />} Sign in with a passkey
              </Button>
            )}
            {methods.google && (
              <Button type="button" variant="outline" className="w-full" onClick={() => void signInWith("google")} disabled={!!other || pending}>
                {other === "google" ? <LoaderCircle className="animate-spin" /> : <GoogleMark />} Continue with Google
              </Button>
            )}
          </>
        )}
        {onCancel && (
          <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </FieldGroup>
    </form>
  );
}

const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,64}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cloud: anyone makes an account, and the server gives it a household of its own. */
function CreateAccountForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<{ message: string; rateLimited: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  const nameError = touched && !name.trim() ? "What should we call you?" : null;
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? "Enter a valid email." : null;
  const usernameError = touched && !USERNAME_RE.test(username.trim()) ? "2–64 letters, numbers, dots, dashes or underscores." : null;
  const passwordError = touched && password.length < 8 ? "Use at least 8 characters." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!name.trim() || !EMAIL_RE.test(email.trim()) || !USERNAME_RE.test(username.trim()) || password.length < 8) return;
    setPending(true);
    setError(null);
    try {
      await authClient.createAccount({ name: name.trim(), email: email.trim().toLowerCase(), username: username.trim(), password });
      onCreated();
    } catch (err) {
      setError({ message: errorMessage(err), rateLimited: err instanceof ApiError && err.status === 429 });
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <FieldGroup>
        <FormField label="Your name" error={nameError}>
          {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={64} autoFocus />}
        </FormField>
        <FormField label="Email" error={emailError}>
          {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
        </FormField>
        <FormField label="Username" description="You sign in with this or your email." error={usernameError}>
          {(p) => <Input {...p} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} maxLength={64} />}
        </FormField>
        <FormField label="Password" description={passwordError ? undefined : "At least 8 characters."} error={passwordError}>
          {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
        </FormField>
        {error && (
          <Alert variant={error.rateLimited ? "warning" : "destructive"}>
            <AlertTitle>{error.rateLimited ? "Too many attempts" : "Couldn't create the account"}</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        )}
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <LoaderCircle className="animate-spin" />}
          {pending ? "Creating your account…" : "Create account"}
        </Button>
      </FieldGroup>
    </form>
  );
}

/** Google's "G", for its sign-in button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z" />
      <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9Z" />
    </svg>
  );
}
