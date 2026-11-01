import { useState } from "react";
import { CircleCheck, LoaderCircle, MailCheck } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { AuthScreen } from "@/features/auth/login-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const MIN_PASSWORD = 8;

/** /forgot-password: asks for the account's email and sends a reset link (always the same answer). */
export function ForgotPasswordPage({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState("sending");
    setError(null);
    try {
      await authClient.requestPasswordReset(email.trim());
      setState("sent");
    } catch (err) {
      setError(errorMessage(err));
      setState("idle");
    }
  };

  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Forgot your password?</CardTitle>
          <CardDescription>Enter your account's email and we'll send a link to choose a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          {state === "sent" ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <MailCheck className="text-ok size-10" />
              <p className="text-sm">If an account uses {email.trim()}, a link is on its way. It works for an hour; check your spam folder if it doesn't arrive.</p>
              <Button variant="outline" className="w-full" onClick={onBack}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <FieldGroup>
                <FormField label="Email">
                  {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus required />}
                </FormField>
                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>Couldn't send the link</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={state === "sending" || !/^\S+@\S+\.\S+$/.test(email.trim())}>
                  {state === "sending" && <LoaderCircle className="animate-spin" />}
                  Send the link
                </Button>
                <p className="text-muted-foreground text-center text-xs">No email on your account? Ask your household's admin to help you back in.</p>
                <Button type="button" variant="ghost" className="w-full" onClick={onBack}>
                  Back to sign in
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthScreen>
  );
}

/** /reset-password?token=…: the emailed link lands here to choose a new password. */
export function ResetPasswordPage({ onDone }: { onDone: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const linkError = params.get("error");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const mismatch = confirm.length > 0 && confirm !== password;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setState("saving");
    setError(null);
    try {
      await authClient.resetPassword(token, password);
      setState("done");
    } catch (err) {
      setError(errorMessage(err));
      setState("idle");
    }
  };

  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription>It signs you out on every other device.</CardDescription>
        </CardHeader>
        <CardContent>
          {state === "done" ? (
            <div className="flex flex-col items-center gap-4 text-center">
              <CircleCheck className="text-ok size-10" />
              <p className="text-sm">Your password is changed. Sign in with the new one.</p>
              <Button className="w-full" onClick={onDone}>
                Sign in
              </Button>
            </div>
          ) : !token || linkError ? (
            <div className="flex flex-col gap-4">
              <Alert variant="destructive">
                <AlertTitle>This link doesn't work</AlertTitle>
                <AlertDescription>It may have expired (links last an hour) or been used already. Ask for a new one.</AlertDescription>
              </Alert>
              <Button variant="outline" onClick={() => (window.location.href = "/forgot-password")}>
                Send a new link
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} noValidate>
              <FieldGroup>
                <FormField label="New password" description={`At least ${MIN_PASSWORD} characters. A short phrase works well.`}>
                  {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required />}
                </FormField>
                <FormField label="Confirm new password" error={mismatch ? "The passwords don't match." : null}>
                  {(p) => <Input {...p} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}
                </FormField>
                {error && (
                  <Alert variant="destructive">
                    <AlertTitle>Couldn't change it</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={state === "saving" || password.length < MIN_PASSWORD || confirm !== password}>
                  {state === "saving" && <LoaderCircle className="animate-spin" />}
                  Save new password
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthScreen>
  );
}
