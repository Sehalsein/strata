import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, RefreshCw, ServerOff } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { queryClient, queryKeys } from "@/lib/query";
import { navigate } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { wizardInProgress } from "@/features/setup/wizard-state";
import { SessionContext, type Session } from "./session";

const AppLayout = lazy(() => import("./app-layout"));
const LoginPage = lazy(() => import("@/features/auth/login-page"));
const SetupWizard = lazy(() => import("@/features/setup/setup-wizard"));

/**
 * Boot: ask the server who it is, then show setup (no admin yet, or the wizard is mid-way),
 * sign-in (no token) or the dashboard. A 401 from any call drops back to sign-in.
 */
export function App() {
  const info = useQuery({ queryKey: queryKeys.info, queryFn: api.info, staleTime: Infinity, retry: false, refetchOnWindowFocus: false });
  const [authed, setAuthed] = useState(() => authClient.hasSession());
  const [inWizard, setInWizard] = useState(() => wizardInProgress());

  useEffect(
    () =>
      authClient.onSessionExpired(() => {
        setAuthed(false);
        setInWizard(false);
        // Drop cached admin data so the next account doesn't see it.
        queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "info" });
      }),
    [],
  );

  const serverName = info.data?.serverName;
  useEffect(() => {
    document.title = serverName && serverName !== "Strata" ? `${serverName} · Strata` : "Strata";
  }, [serverName]);

  const signOut = useCallback(async () => {
    await authClient.signOut();
    setAuthed(false);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "info" });
  }, []);

  const session = useMemo<Session | null>(() => (info.data ? { info: info.data, signOut } : null), [info.data, signOut]);

  if (info.isPending) return <FullscreenSpinner />;
  if (info.isError || !info.data) {
    return (
      <div className="flex min-h-svh items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
            <ServerOff className="size-6" />
          </div>
          <h1 className="text-xl font-semibold">Can't reach the server</h1>
          <p className="text-muted-foreground text-sm">{errorMessage(info.error)}</p>
          <Button onClick={() => void info.refetch()} disabled={info.isFetching}>
            {info.isFetching ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            Try again
          </Button>
        </div>
      </div>
    );
  }

  let screen;
  if (info.data.setupRequired || inWizard) {
    screen = (
      <SetupWizard
        info={info.data}
        onDone={(to = "/") => {
          setInWizard(false);
          setAuthed(true);
          void queryClient.invalidateQueries({ queryKey: queryKeys.info });
          navigate(to, { replace: true });
        }}
        onAccountCreated={() => setInWizard(true)}
      />
    );
  } else if (!authed) {
    screen = (
      <LoginPage
        serverName={info.data.serverName}
        onSignedIn={() => setAuthed(true)}
      />
    );
  } else {
    screen = (
      <SessionContext.Provider value={session}>
        <AppLayout />
      </SessionContext.Provider>
    );
  }

  return <Suspense fallback={<FullscreenSpinner />}>{screen}</Suspense>;
}

function FullscreenSpinner() {
  return (
    <div className="flex min-h-svh items-center justify-center" role="status" aria-label="Loading">
      <BrandMark size={36} className="animate-pulse" />
    </div>
  );
}
