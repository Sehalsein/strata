import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw, ServerOff } from "lucide-react";
import { api, errorMessage, privacyUrl } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { queryClient, queryKeys } from "@/lib/query";
import { navigate, usePath } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { storeStep, wizardInProgress } from "@/features/setup/wizard-state";
import { SessionContext, type Access, type Session } from "./session";

const AppLayout = lazy(() => import("./app-layout"));
const LoginPage = lazy(() => import("@/features/auth/login-page"));
const SetupWizard = lazy(() => import("@/features/setup/setup-wizard"));
const InvitePage = lazy(() => import("@/features/invite/invite-page"));
const PrivacyPage = lazy(() => import("@/features/account/privacy-page"));
const AppOnlyScreen = lazy(() => import("@/features/account/app-only-screen").then((m) => ({ default: m.AppOnlyScreen })));
const LinkPage = lazy(() => import("@/features/link/link-page"));
const ForgotPasswordPage = lazy(() => import("@/features/account/password-reset-pages").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/features/account/password-reset-pages").then((m) => ({ default: m.ResetPasswordPage })));

/** Every cached response but the server's info and who's signed in: dropped whenever the account or household changes. */
const accountData = (q: { queryKey: readonly unknown[] }) => q.queryKey[0] !== "info" && !(q.queryKey[0] === "auth" && q.queryKey[1] === "me");

/**
 * Boot: ask the server who it is, then show setup (no admin yet, or the wizard is mid-way),
 * an invitation (/invite/:id, signed in or not), sign-in (nobody signed in on this browser)
 * or the dashboard. A 401 from any call drops back to sign-in.
 */
export function App() {
  const path = usePath();
  const info = useQuery({ queryKey: queryKeys.info, queryFn: api.info, staleTime: Infinity, retry: false, refetchOnWindowFocus: false });
  const me = useQuery({ queryKey: queryKeys.me, queryFn: authClient.getMe, staleTime: Infinity, retry: false, refetchOnWindowFocus: false, enabled: info.data?.setupRequired === false });
  // Mid-wizard (signed in, steps left): set by the account step, or read back after a reload.
  const [inWizardState, setInWizard] = useState(() => {
    // Back from signing up with Google (cloud): onboarding, from its first step.
    if (!new URLSearchParams(window.location.search).has("welcome")) return false;
    history.replaceState(null, "", window.location.pathname);
    storeStep(0);
    return true;
  });
  const [wizardDismissed, setWizardDismissed] = useState(false);
  const inWizard = inWizardState || (!wizardDismissed && !!me.data && wizardInProgress(info.data?.mode === "cloud"));
  const [addingAccount, setAddingAccount] = useState(false);
  // Bumped on every auth change so the signed-in app remounts with fresh queries.
  const [epoch, setEpoch] = useState(0);

  const authChanged = useCallback(async () => {
    await queryClient.fetchQuery({ queryKey: queryKeys.me, queryFn: authClient.getMe, staleTime: 0 });
    queryClient.removeQueries({ predicate: accountData });
    setAddingAccount(false);
    setEpoch((e) => e + 1);
  }, []);

  useEffect(
    () =>
      authClient.onSessionExpired(() => {
        setInWizard(false);
        setWizardDismissed(true);
        // Drop cached admin data so the next account doesn't see it; re-ask who's signed in
        // (another saved account may still be).
        queryClient.removeQueries({ predicate: accountData });
        void authChanged();
      }),
    [authChanged],
  );

  const serverName = info.data?.serverName;
  useEffect(() => {
    document.title = serverName && serverName !== "Strata" ? `${serverName} · Strata` : "Strata";
  }, [serverName]);

  const session = useMemo<Session | null>(() => {
    if (!info.data || !me.data) return null;
    const m = me.data;
    const isServerAdmin = m.permissions.administerServer;
    const householdAdmin = m.permissions.administerHousehold;
    const can = (access: Access) =>
      access === "any" ? true : access === "systemAdmin" ? isServerAdmin : access === "serverAdmin" ? isServerAdmin && householdAdmin : householdAdmin;
    return { info: info.data, me: m, isServerAdmin, isHouseholdAdmin: householdAdmin, cloud: info.data.mode === "cloud", capabilities: info.data.capabilities, can, authChanged, addAccount: () => setAddingAccount(true) };
  }, [info.data, me.data, authChanged]);

  if (info.isPending) return <FullscreenSpinner />;
  if (info.isError || !info.data) {
    return <Unreachable error={info.error} retrying={info.isFetching} onRetry={() => void info.refetch()} />;
  }

  const inviteId = /^\/invite\/([^/]+)\/?$/.exec(path)?.[1];
  const toSignIn = () => navigate("/", { replace: true });
  let screen;
  // Pages anyone can open, signed in or not.
  if (path === "/privacy" && info.data.siteUrl) {
    // The cloud's privacy page is on its public site.
    location.replace(privacyUrl(info.data));
    return <FullscreenSpinner />;
  }
  if (path === "/privacy") {
    screen = <PrivacyPage />;
  } else if (path === "/forgot-password") {
    screen = <ForgotPasswordPage onBack={toSignIn} />;
  } else if (path === "/reset-password") {
    screen = (
      <ResetPasswordPage
        onDone={async () => {
          await authChanged();
          toSignIn();
        }}
      />
    );
  } else if (inviteId && !info.data.setupRequired) {
    screen = (
      <InvitePage
        invitationId={decodeURIComponent(inviteId)}
        serverName={info.data.serverName}
        me={me.data ?? null}
        onJoined={async () => {
          await authChanged();
          navigate("/", { replace: true });
        }}
      />
    );
  } else if (info.data.setupRequired || inWizard) {
    screen = (
      <SetupWizard
        info={info.data}
        onDone={async (to = "/") => {
          await queryClient.invalidateQueries({ queryKey: queryKeys.info });
          await authChanged();
          setInWizard(false);
          setWizardDismissed(true);
          navigate(to, { replace: true });
        }}
        onAccountCreated={() => setInWizard(true)}
      />
    );
  } else if (me.isPending) {
    screen = <FullscreenSpinner />;
  } else if (me.isError) {
    screen = <Unreachable error={me.error} retrying={me.isFetching} onRetry={() => void me.refetch()} />;
  } else if (session && !addingAccount && path === "/link" && !(session.isHouseholdAdmin || session.isServerAdmin)) {
    // A TV's QR code opens this on anyone's phone: approving it needs no dashboard.
    screen = (
      <SessionContext.Provider value={session}>
        <div className="mx-auto max-w-xl px-4 py-10">
          <LinkPage />
        </div>
      </SessionContext.Provider>
    );
  } else if (session && !addingAccount && (me.data?.mustChangePassword || !(session.isHouseholdAdmin || session.isServerAdmin))) {
    // The dashboard is for running households; everyone else uses the app, and a
    // temporary password is replaced there too.
    screen = (
      <AppOnlyScreen
        name={me.data!.user.name}
        reason={me.data?.mustChangePassword ? "temporary-password" : "member"}
        onSignOut={async () => {
          await authClient.signOutAll();
          await authChanged();
        }}
      />
    );
  } else if (!session || addingAccount) {
    screen = (
      <LoginPage
        serverName={info.data.serverName}
        adding={!!session}
        onSignedIn={() => void authChanged()}
        onAccountCreated={() => {
          // A new cloud account: onboarding, from its first step.
          storeStep(0);
          setWizardDismissed(false);
          setInWizard(true);
          void authChanged();
        }}
        onCancel={session ? () => setAddingAccount(false) : undefined}
      />
    );
  } else {
    screen = (
      <SessionContext.Provider value={session}>
        <AppLayout key={epoch} />
      </SessionContext.Provider>
    );
  }

  return <Suspense fallback={<FullscreenSpinner />}>{screen}</Suspense>;
}

function Unreachable({ error, retrying, onRetry }: { error: unknown; retrying: boolean; onRetry: () => void }) {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
          <ServerOff className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">Can't reach the server</h1>
        <p className="text-muted-foreground text-sm">{errorMessage(error)}</p>
        <Button onClick={onRetry} disabled={retrying}>
          {retrying ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          Try again
        </Button>
      </div>
    </div>
  );
}

function FullscreenSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <BrandMark size={36} className="animate-pulse" />
    </div>
  );
}
