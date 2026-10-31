import { useState } from "react";
import { ArrowRight, Clapperboard, Film, KeyRound, LoaderCircle, Tv } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { StepProps } from "./setup-wizard";
import { StepCard } from "./step-card";
import { passwordStrength } from "./wizard-state";

export function WelcomeStep({ onNext }: StepProps) {
  return (
    <StepCard
      title="Welcome to Strata"
      description="Your own streaming service: Strata builds a catalog from TMDB and plays your files — from folders on this machine or straight from TorBox — on your iPhone, iPad, Mac and Apple TV."
      actions={
        <Button onClick={onNext} size="lg">
          Get started <ArrowRight />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium">You'll need</h3>
        <ul className="grid gap-3 sm:grid-cols-2">
          <Need icon={Clapperboard} title="A TMDB API key" badge="Required to browse">
            Free from themoviedb.org. It powers titles, artwork and matching your files.
          </Need>
          <Need icon={Film} title="Your media" badge="Optional">
            Folders of movies and shows on this server, a TorBox account, or both.
          </Need>
          <Need icon={KeyRound} title="A TorBox API key" badge="Optional">
            Plays titles straight from your TorBox library.
          </Need>
          <Need icon={Tv} title="The Strata apps" badge="Later">
            On your Apple devices, to watch. You'll connect them at the end.
          </Need>
        </ul>
        <p className="text-muted-foreground text-sm">It takes about five minutes. You can change everything later in Settings.</p>
      </div>
    </StepCard>
  );
}

function Need({ icon: Icon, title, badge, children }: { icon: typeof Film; title: string; badge: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-lg border p-3">
      <div className="bg-primary/12 text-brand-text flex size-9 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-4" />
      </div>
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {title}
          <Badge variant={badge === "Required to browse" ? "accent" : "secondary"}>{badge}</Badge>
        </p>
        <p className="text-muted-foreground text-sm">{children}</p>
      </div>
    </li>
  );
}

const STRENGTH_COLORS = ["bg-muted", "bg-destructive", "bg-warn", "bg-ok", "bg-ok"];

export function AccountStep({ info, onNext, onBack }: StepProps) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [setupCode, setSetupCode] = useState("");
  // The server says when the code is needed; a rejection that mentions it reveals the field too.
  const [needsCode, setNeedsCode] = useState(info.setupCodeRequired === true);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<{ message: string; rateLimited?: boolean } | null>(null);
  const [alreadyDone, setAlreadyDone] = useState(false);
  const [pending, setPending] = useState(false);

  const strength = passwordStrength(password);
  const usernameError = touched && !username.trim() ? "Choose a username." : null;
  const passwordError = touched && password.length < 8 ? "Use at least 8 characters." : null;
  const confirmError = touched && confirm !== password ? "The passwords don't match." : null;
  const codeError = touched && needsCode && !setupCode.trim() ? "Enter the setup code from the server's log." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!username.trim() || password.length < 8 || confirm !== password || (needsCode && !setupCode.trim())) return;
    setPending(true);
    setError(null);
    try {
      await authClient.setupAdmin({ username: username.trim(), password, setupCode: needsCode ? setupCode.trim() : undefined });
      onNext();
    } catch (err) {
      const msg = errorMessage(err);
      if (err instanceof ApiError && err.status === 409) setAlreadyDone(true);
      if (/setup code/i.test(msg)) setNeedsCode(true);
      setError({ message: msg, rateLimited: err instanceof ApiError && err.status === 429 });
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <StepCard
        title="Create the admin account"
        description="This account manages the server from this dashboard and signs in the apps when you're away from home. It also gets the first viewing profile."
        onBack={onBack}
        actions={
          <Button type="submit" size="lg" disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            {pending ? "Creating…" : "Create account"}
          </Button>
        }
      >
        <FieldGroup className="max-w-md">
          <FormField label="Username" error={usernameError}>
            {(p) => <Input {...p} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} maxLength={64} />}
          </FormField>
          <FormField
            label="Password"
            error={passwordError}
            description={
              password ? (
                <span className="flex items-center gap-2">
                  <span className="flex flex-1 gap-1" aria-hidden="true">
                    {[1, 2, 3, 4].map((n) => (
                      <span key={n} className={cn("h-1 flex-1 rounded-full", strength.score >= n ? STRENGTH_COLORS[strength.score] : "bg-muted")} />
                    ))}
                  </span>
                  <span className="w-16 text-right text-xs">{strength.label}</span>
                </span>
              ) : (
                "At least 8 characters. Longer is stronger; a short phrase works well."
              )
            }
          >
            {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
          </FormField>
          <FormField label="Confirm password" error={confirmError}>
            {(p) => <Input {...p} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}
          </FormField>
          {needsCode && (
            <FormField label="Setup code" description="Shown in the server's log when it starts" error={codeError}>
              {(p) => <Input {...p} className="font-mono tracking-widest" value={setupCode} onChange={(e) => setSetupCode(e.target.value)} autoComplete="one-time-code" autoCapitalize="off" spellCheck={false} />}
            </FormField>
          )}
          {error && (
            <Alert variant={error.rateLimited ? "warning" : "destructive"}>
              <AlertTitle>{error.rateLimited ? "Too many attempts" : "Couldn't create the account"}</AlertTitle>
              <AlertDescription>
                <p>{error.message}</p>
                {alreadyDone && (
                  <Button type="button" variant="link" className="h-auto p-0" onClick={() => location.assign("/")}>
                    Sign in instead
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </FieldGroup>
      </StepCard>
    </form>
  );
}
