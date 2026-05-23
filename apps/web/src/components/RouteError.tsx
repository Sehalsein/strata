import { Link, useRouter } from "@tanstack/react-router";

type Props = {
  error: unknown;
  reset?: () => void;
};

const messageOf = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Something broke between us and the archive.";
};

/**
 * Default error component for TanStack Router. Catches render-time
 * errors from route components and presents a recoverable shell with a
 * Retry (re-mount the route) and a Go-home action. The 401 case is
 * handled upstream by the axios interceptor — by the time this renders,
 * the user is either authenticated or being redirected.
 */
export const RouteError = ({ error, reset }: Props) => {
  const router = useRouter();
  const message = messageOf(error);
  const onRetry = () => {
    reset?.();
    void router.invalidate();
  };

  return (
    <div className="flex min-h-[calc(100vh-180px)] items-center justify-center px-8">
      <div className="max-w-[520px] text-center">
        <div className="font-mono text-[10px] uppercase tracking-[0.28em] text-strata-accent">
          Page off the rails
        </div>
        <div className="mx-auto my-4 h-px w-12 bg-strata-accent" />
        <div
          className="font-display text-[48px] leading-[0.95] text-strata-paper"
          style={{
            fontVariationSettings: '"opsz" 144, "SOFT" 30, "WONK" 1',
            letterSpacing: "-0.04em",
          }}
        >
          Something broke.
        </div>
        <p className="mt-4 break-words font-mono text-[11px] uppercase tracking-[0.18em] text-strata-text/55">
          {message}
        </p>
        <div className="mt-7 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={onRetry}
            className="strata-btn-primary"
          >
            Try again
          </button>
          <Link to="/" className="strata-btn-secondary no-underline">
            Back to index
          </Link>
        </div>
      </div>
    </div>
  );
};
