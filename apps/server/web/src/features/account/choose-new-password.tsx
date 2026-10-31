import { useState } from "react";
import { KeyRound, LoaderCircle } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { AuthScreen } from "@/features/auth/login-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const MIN_PASSWORD = 8;

/**
 * Shown instead of the dashboard after signing in with a temporary password from an
 * admin: a new password first (Better Auth's change-password), then everything else.
 */
export function ChooseNewPasswordScreen({ name, onDone, onSignOut }: { name: string; onDone: () => Promise<void> | void; onSignOut: () => void }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reused = password.length > 0 && password === current;
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authClient.changePassword({ currentPassword: current, newPassword: password });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <KeyRound className="text-muted-foreground mx-auto size-8" />
          <CardTitle className="text-xl">Choose your own password</CardTitle>
          <CardDescription>{name}, you signed in with a temporary password. Pick one only you know to carry on.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate>
            <FieldGroup>
              <FormField label="Temporary password">
                {(p) => <Input {...p} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" autoFocus />}
              </FormField>
              <FormField label="New password" description={`At least ${MIN_PASSWORD} characters. A short phrase works well.`} error={reused ? "Choose something other than the temporary password." : null}>
                {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
              </FormField>
              <FormField label="Confirm new password" error={mismatch ? "The passwords don't match." : null}>
                {(p) => <Input {...p} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}
              </FormField>
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Couldn't save it</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={pending || !current || password.length < MIN_PASSWORD || confirm !== password || reused}>
                {pending && <LoaderCircle className="animate-spin" />}
                Save and continue
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={onSignOut}>
                Sign out
              </Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </AuthScreen>
  );
}
