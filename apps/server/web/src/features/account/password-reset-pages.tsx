import { useEffect, useState } from "react";
import { CircleCheck, LoaderCircle, MailCheck, Smartphone } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { AuthScreen } from "@/features/auth/login-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const MIN_PASSWORD = 8;

/** The Strata apps for iPhone, iPad and Apple TV. */
const APP_STORE_URL = "https://apps.apple.com/us/app/strata-tv/id6804102192";

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

/**
 * /reset-password?token=…: the emailed link lands here (Better Auth checks the token first).
 * Choosing the new password happens in the Strata app, like everything else someone in a
 * household does, so this page hands the token over: it opens the app at "Choose a new
 * password" and points to the App Store for anyone without it. An admin without the app
 * can still choose it here.
 */
export function ResetPasswordPage({ serverName, onDone }: { serverName: string; onDone: () => void }) {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  const linkError = params.get("error");
  const link = token && !linkError ? `strata://reset-password?${new URLSearchParams({ server: window.location.origin, token })}` : null;
  const [inBrowser, setInBrowser] = useState(false);

  // Straight on to the app where it's installed; the buttons stay for when it isn't.
  useEffect(() => {
    if (link) window.location.href = link;
  }, [link]);

  if (!link) return <ResetPasswordForm token={null} onDone={onDone} />;
  if (inBrowser) return <ResetPasswordForm token={token} onDone={onDone} />;
  const where = serverName && serverName !== "Strata" ? serverName : "this Strata server";
  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <Smartphone className="text-muted-foreground mx-auto size-8" />
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription>For your account on {where}. You'll choose it in the Strata app on your iPhone or iPad.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild>
            <a href={link}>Open in Strata</a>
          </Button>
          <Button variant="outline" asChild>
            <a href={APP_STORE_URL}>Get Strata on the App Store</a>
          </Button>
          <p className="text-muted-foreground text-center text-xs">Got the app just now? Come back to this page and tap Open in Strata.</p>
          <Button variant="link" className="h-auto p-0 text-xs" onClick={() => setInBrowser(true)}>
            No iPhone or iPad? Choose it in this browser
          </Button>
        </CardContent>
      </Card>
    </AuthScreen>
  );
}

/** The new password, chosen in the browser (or why the link doesn't work). */
function ResetPasswordForm({ token, onDone }: { token: string | null; onDone: () => void }) {
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
          ) : !token ? (
            <div className="flex flex-col gap-4">
              <Alert variant="destructive">
                <AlertTitle>This link doesn't work</AlertTitle>
                <AlertDescription>It may have expired (links last an hour) or been used already. Ask for a new one: Forgot password? when signing in, in the Strata app or here.</AlertDescription>
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
