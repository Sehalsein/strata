import { useCallback, useEffect, useState } from "react";
import { api, errorMessage, getToken, setToken, setUnauthorizedHandler } from "./api";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { navigate, usePath } from "./router";
import type { ServerInfo } from "./types";
import { LibraryPage } from "./pages/Library";
import { LoginPage } from "./pages/Login";
import { LogsPage } from "./pages/Logs";
import { OverviewPage } from "./pages/Overview";
import { ProfilesPage } from "./pages/Profiles";
import { DevicesPage } from "./pages/Devices";
import { SettingsPage } from "./pages/Settings";
import { SetupWizard, wizardInProgress } from "./pages/Setup";

type Phase = { kind: "loading" } | { kind: "offline"; message: string } | { kind: "setup" } | { kind: "login" } | { kind: "app" };

export function App() {
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  const boot = useCallback(async () => {
    setPhase({ kind: "loading" });
    try {
      const i = await api.info();
      setInfo(i);
      if (i.setupRequired) setPhase({ kind: "setup" });
      else if (!getToken()) setPhase({ kind: "login" });
      else if (wizardInProgress()) setPhase({ kind: "setup" });
      else setPhase({ kind: "app" });
    } catch (err) {
      setPhase({ kind: "offline", message: errorMessage(err) });
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setPhase({ kind: "login" }));
    void boot();
  }, [boot]);

  useEffect(() => {
    document.title = info?.serverName && info.serverName !== "Strata" ? `${info.serverName} · Strata` : "Strata";
  }, [info?.serverName]);

  switch (phase.kind) {
    case "loading":
      return (
        <div className="fullscreen-center">
          <Spinner label="Connecting" />
        </div>
      );
    case "offline":
      return (
        <div className="fullscreen-center">
          <div className="offline">
            <h1 className="display">Can't reach the server</h1>
            <p className="muted">{phase.message}</p>
            <button type="button" className="btn btn-primary" onClick={() => void boot()}>
              Try again
            </button>
          </div>
        </div>
      );
    case "setup":
      return (
        <SetupWizard
          info={info}
          onDone={() => {
            navigate("/", { replace: true });
            setPhase({ kind: "app" });
          }}
        />
      );
    case "login":
      return (
        <LoginPage
          serverName={info?.serverName}
          onLoggedIn={(token) => {
            setToken(token);
            setPhase({ kind: "app" });
          }}
        />
      );
    case "app":
      return (
        <AuthedApp
          info={info}
          onSignOut={async () => {
            try {
              await api.logout();
            } catch {
              /* token may already be gone */
            }
            setToken(null);
            setPhase({ kind: "login" });
          }}
          onServerNameChange={(serverName) => setInfo((i) => (i ? { ...i, serverName } : i))}
        />
      );
  }
}

function AuthedApp({ info, onSignOut, onServerNameChange }: { info: ServerInfo | null; onSignOut: () => void; onServerNameChange: (name: string) => void }) {
  const path = usePath();
  let page;
  if (path === "/" || path === "/overview") page = <OverviewPage />;
  else if (path.startsWith("/library")) page = <LibraryPage />;
  else if (path.startsWith("/settings")) page = <SettingsPage onServerNameChange={onServerNameChange} />;
  else if (path.startsWith("/profiles")) page = <ProfilesPage />;
  else if (path.startsWith("/devices")) page = <DevicesPage />;
  else if (path.startsWith("/logs")) page = <LogsPage />;
  else
    page = (
      <div className="empty-state">
        <h1 className="display">Not found</h1>
        <p className="muted">
          There's nothing at <code>{path}</code>.
        </p>
        <a className="btn btn-secondary" href="/" onClick={(e) => (e.preventDefault(), navigate("/"))}>
          Go to overview
        </a>
      </div>
    );
  return (
    <Layout path={path} serverName={info?.serverName ?? "Strata"} version={info?.version} onSignOut={onSignOut}>
      {page}
    </Layout>
  );
}
