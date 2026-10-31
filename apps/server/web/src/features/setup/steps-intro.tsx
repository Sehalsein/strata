import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Clapperboard, Film, House, KeyRound, LoaderCircle, Sparkles, Tv, UserRound, UserPlus } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { queryClient, queryKeys } from "@/lib/query";
import { InlineError } from "@/components/page";
import { Skeleton } from "@/components/ui/skeleton";
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
      icon={Sparkles}
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
  const [email, setEmail] = useState("");
  const [householdName, setHouseholdName] = useState("");
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
  const usernameError = touched && !/^[a-zA-Z0-9_.-]{2,64}$/.test(username.trim()) ? "2–64 letters, numbers, dots, dashes or underscores." : null;
  const emailError = touched && email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? "Enter a valid email, or leave it empty." : null;
  const passwordError = touched && password.length < 8 ? "Use at least 8 characters." : null;
  const confirmError = touched && confirm !== password ? "The passwords don't match." : null;
  const codeError = touched && needsCode && !setupCode.trim() ? "Enter the setup code from the server's log." : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (usernameError || !/^[a-zA-Z0-9_.-]{2,64}$/.test(username.trim()) || emailError || password.length < 8 || confirm !== password || (needsCode && !setupCode.trim())) return;
    setPending(true);
    setError(null);
    try {
      await authClient.setupAdmin({
        username: username.trim(),
        password,
        ...(email.trim() ? { email: email.trim().toLowerCase() } : {}),
        ...(householdName.trim() ? { householdName: householdName.trim() } : {}),
        setupCode: needsCode ? setupCode.trim() : undefined,
      });
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
        icon={UserRound}
        title="Create the admin account"
        description="The server's admin account: it runs the server from this dashboard and is your own account for watching. It also owns your household — the library, settings and people you'll invite."
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
          <FormField label="Email (optional)" description="You can sign in with it too." error={emailError}>
            {(p) => <Input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}
          </FormField>
          <FormField label="Household name" description={`Your household on this server. Defaults to “${username.trim() || "admin"}'s home”.`}>
            {(p) => <Input {...p} value={householdName} onChange={(e) => setHouseholdName(e.target.value)} placeholder={`${username.trim() || "admin"}'s home`} maxLength={64} />}
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

/** Cloud: the first step after signing up. The new account's household, named after them until they rename it. */
export function HouseholdStep({ onNext }: StepProps) {
  const household = useQuery({ queryKey: queryKeys.household, queryFn: authClient.getHousehold });
  const me = useQuery({ queryKey: queryKeys.me, queryFn: authClient.getMe, staleTime: Infinity });
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (household.data && name === null) setName(household.data.name);
  }, [household.data, name]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = household.data;
    const trimmed = (name ?? "").trim();
    if (!h || !trimmed) return;
    if (trimmed === h.name) return onNext();
    setSaving(true);
    setError(null);
    try {
      await authClient.renameHousehold(h.id, trimmed);
      await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.household }), queryClient.invalidateQueries({ queryKey: queryKeys.me })]);
      onNext();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const first = me.data?.user.name;
  return (
    <form onSubmit={save} noValidate>
      <StepCard
        icon={House}
        title={first ? `Welcome, ${first}` : "Welcome to Strata"}
        description="Your account comes with a household: your own library, keys and settings, shared with the people you invite. Let's set it up. It takes a few minutes, and you can change everything later in Settings."
        actions={
          <Button type="submit" size="lg" disabled={saving || !household.data || !(name ?? "").trim()}>
            {saving && <LoaderCircle className="animate-spin" />}
            Continue <ArrowRight />
          </Button>
        }
      >
        {name === null ? (
          household.error ? <InlineError error={errorMessage(household.error)} /> : <Skeleton className="h-16" />
        ) : (
          <FieldGroup className="max-w-md">
            <FormField label="Household name" description="Shown to the people you invite." error={!name.trim() ? "Give your household a name." : null}>
              {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoFocus />}
            </FormField>
          </FieldGroup>
        )}
        <ul className="grid gap-3 sm:grid-cols-3">
          <Need icon={Clapperboard} title="Connect TMDB" badge="Next">
            A free key that powers titles and artwork.
          </Need>
          <Need icon={UserPlus} title="Invite people" badge="Optional">
            Each gets their own progress and My List.
          </Need>
          <Need icon={Tv} title="Get the apps" badge="Last">
            Watch on iPhone, iPad, Mac and Apple TV.
          </Need>
        </ul>
        <InlineError error={error} />
      </StepCard>
    </form>
  );
}
