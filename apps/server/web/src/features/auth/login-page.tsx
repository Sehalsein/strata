import { useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function LoginPage({
  serverName,
  onSignedIn,
  adding,
  onCancel,
}: {
  serverName?: string;
  onSignedIn: () => void;
  /** Someone is already signed in: this adds another account to the browser. */
  adding?: boolean;
  onCancel?: () => void;
}) {
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
  const [error, setError] = useState<{ message: string; rateLimited: boolean } | null>(null);
  const [pending, setPending] = useState(false);

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
        {onCancel && (
          <Button type="button" variant="ghost" className="w-full" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </FieldGroup>
    </form>
  );
}
