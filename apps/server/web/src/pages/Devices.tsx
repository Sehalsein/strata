import { useState } from "react";
import { api } from "../api";
import { Badge, Card, ErrorText, PageHeader, Spinner, useResource } from "../components/ui";
import { relativeTime } from "../format";
import type { Device } from "../types";

/** Every signed-in app and browser, with a way to sign each one out. */
export function DevicesPage() {
  const { data, error, loading, refresh } = useResource(api.devices);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const signOut = async (device: Device) => {
    if (!confirm(`Sign out ${device.deviceName ?? "this device"}? It will need to connect again.`)) return;
    setBusy(device.id);
    setActionError(null);
    try {
      await api.signOutDevice(device.id);
      refresh();
    } catch (err) {
      setActionError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Devices" subtitle="Apps and browsers signed in to this server. Signing one out sends it back to the Connect screen." />
      <Card>
        {loading && !data ? (
          <Spinner />
        ) : error ? (
          <ErrorText error={error} />
        ) : (
          <ul className="profile-list">
            {data?.items.map((d) => (
              <li key={d.id} className="profile-row">
                <div className="profile-main">
                  <span className="profile-name">{d.deviceName ?? "Unknown device"}</span>
                  <span className="profile-meta">
                    {d.isCurrent ? <Badge tone="ok">This browser</Badge> : d.viewerOnly ? <Badge>Watch only</Badge> : <Badge tone="accent">Admin</Badge>}{" "}
                    <span className="muted">
                      {d.profileName ? `${d.profileName} · ` : ""}active {relativeTime(d.lastSeenAt)} · signed in {relativeTime(d.createdAt)}
                    </span>
                  </span>
                </div>
                {!d.isCurrent && (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy === d.id} onClick={() => signOut(d)}>
                    Sign out
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {actionError ? <ErrorText error={actionError} /> : null}
      </Card>
    </div>
  );
}
