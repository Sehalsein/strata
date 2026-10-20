import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { errorMessage } from "../api";

export function Spinner({ label = "Loading" }: { label?: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export function Notice({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "error" | "ok"; title?: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : undefined}>
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div className="notice-text">{children}</div>}
      </div>
      {action && <div className="notice-action">{action}</div>}
    </div>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="field-error" role="alert">
      {typeof error === "string" ? error : errorMessage(error)}
    </p>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "ok" | "warn" | "error"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: unknown; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {children(id, hint ? hintId : undefined)}
      {hint && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
      <ErrorText error={error} />
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2 className="card-title">{title}</h2>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

/** Loads data once and on demand; optionally polls while the tab is visible. */
export function useResource<T>(load: () => Promise<T>, opts: { pollMs?: number; deps?: unknown[] } = {}) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const value = await loadRef.current();
      if (mine !== seq.current) return;
      setData(value);
      setError(undefined);
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, opts.deps ?? []);

  useEffect(() => {
    if (!opts.pollMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, opts.pollMs);
    return () => clearInterval(id);
  }, [opts.pollMs, refresh]);

  return { data, error, loading, refresh, setData };
}

/** Wraps an async action with a pending flag and error capture. */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      setPending(true);
      setError(undefined);
      try {
        return await fn(...args);
      } catch (err) {
        setError(err);
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [fn],
  );
  return { run, pending, error, setError };
}

/** A transient "Saved" acknowledgement. */
export function useFlash(ms = 2200): [string | null, (msg: string) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = useCallback(
    (m: string) => {
      setMsg(m);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setMsg(null), ms);
    },
    [ms],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return [msg, flash];
}

export function Flash({ message }: { message: string | null }) {
  return (
    <span className="flash" role="status" aria-live="polite">
      {message}
    </span>
  );
}
