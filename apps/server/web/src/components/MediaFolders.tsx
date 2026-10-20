import { useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import type { FsListing, MediaFolder, MediaFolderKind } from "../types";
import { Dialog } from "./Dialog";
import { Spinner } from "./ui";

const KINDS: { value: MediaFolderKind; label: string }[] = [
  { value: "auto", label: "Mixed (auto-detect)" },
  { value: "movies", label: "Movies" },
  { value: "shows", label: "TV shows" },
];

/** Editable list of media folders with a server-side folder picker. Controlled. */
export function MediaFolders({ value, onChange }: { value: MediaFolder[]; onChange: (next: MediaFolder[]) => void }) {
  const [browsing, setBrowsing] = useState(false);

  const add = (path: string, kind: MediaFolderKind) => {
    if (value.some((f) => f.path === path)) return;
    onChange([...value, { path, kind }]);
  };

  return (
    <div className="folders">
      {value.length === 0 ? (
        <p className="empty-inline">No folders yet. Add the folders that hold your movies and shows.</p>
      ) : (
        <ul className="folder-list">
          {value.map((f, i) => (
            <li key={f.path} className="folder-row">
              <FolderGlyph />
              <code className="folder-path" title={f.path}>
                <bdi dir="ltr">{f.path}</bdi>
              </code>
              <label className="sr-only" htmlFor={`kind-${i}`}>
                Content type for {f.path}
              </label>
              <select
                id={`kind-${i}`}
                className="input input-sm folder-kind"
                value={f.kind}
                onChange={(e) => onChange(value.map((x, j) => (j === i ? { ...x, kind: e.target.value as MediaFolderKind } : x)))}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label={`Remove ${f.path}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn btn-secondary" onClick={() => setBrowsing(true)}>
        Add folder…
      </button>
      <FolderBrowser
        open={browsing}
        onClose={() => setBrowsing(false)}
        existing={value.map((f) => f.path)}
        onPick={(path, kind) => {
          add(path, kind);
          setBrowsing(false);
        }}
      />
    </div>
  );
}

function FolderBrowser({ open, onClose, onPick, existing }: { open: boolean; onClose: () => void; onPick: (path: string, kind: MediaFolderKind) => void; existing: string[] }) {
  const [listing, setListing] = useState<FsListing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [typed, setTyped] = useState("");
  const [kind, setKind] = useState<MediaFolderKind>("auto");

  const go = async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const l = await api.fs(path);
      setListing(l);
      setTyped(l.path);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setKind("auto");
      void go(listing?.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const already = listing ? existing.includes(listing.path) : false;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Choose a folder"
      wide
      footer={
        <>
          <div className="browser-kind">
            <label htmlFor="browser-kind" className="field-label-inline">
              Contains
            </label>
            <select id="browser-kind" className="input input-sm" value={kind} onChange={(e) => setKind(e.target.value as MediaFolderKind)}>
              {KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div className="dialog-foot-buttons">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!listing || already || loading} onClick={() => listing && onPick(listing.path, kind)}>
              {already ? "Already added" : "Add this folder"}
            </button>
          </div>
        </>
      }
    >
      <form
        className="browser-path"
        onSubmit={(e) => {
          e.preventDefault();
          if (typed.trim()) void go(typed.trim());
        }}
      >
        <label htmlFor="browser-path" className="sr-only">
          Folder path
        </label>
        <input id="browser-path" className="input mono" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} autoCapitalize="off" autoCorrect="off" />
        <button type="submit" className="btn btn-secondary">
          Go
        </button>
      </form>

      {listing && listing.shortcuts.length > 0 && (
        <div className="browser-shortcuts" aria-label="Shortcuts">
          {listing.shortcuts.map((s) => (
            <button key={s.path} type="button" className="chip" onClick={() => void go(s.path)}>
              {s.name}
            </button>
          ))}
        </div>
      )}

      {error && <p className="field-error" role="alert">{error}</p>}

      <div className="browser-list" aria-busy={loading}>
        {loading && !listing ? (
          <div className="center-pad">
            <Spinner />
          </div>
        ) : listing ? (
          <ul>
            {listing.parent && (
              <li>
                <button type="button" className="browser-item" onClick={() => void go(listing.parent!)}>
                  <span className="browser-up" aria-hidden="true">
                    ↰
                  </span>
                  <span>Parent folder</span>
                </button>
              </li>
            )}
            {listing.dirs.map((d) => (
              <li key={d.path}>
                <button type="button" className="browser-item" onClick={() => void go(d.path)}>
                  <FolderGlyph />
                  <span className="browser-name">{d.name}</span>
                  <span className="browser-chev" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            ))}
            {listing.dirs.length === 0 && <li className="empty-inline browser-empty">No subfolders here.</li>}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}

function FolderGlyph() {
  return (
    <svg className="folder-glyph" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <path d="M2.5 5.5a1 1 0 0 1 1-1h4l1.6 1.8h7.4a1 1 0 0 1 1 1v8.2a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}
