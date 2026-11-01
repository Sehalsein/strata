import type { ReactNode } from "react";
import { CircleAlert, type LucideIcon } from "lucide-react";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/** Page title, one-line description and actions, shared by every admin page. */
export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground max-w-prose text-sm">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto flex w-full max-w-6xl flex-col gap-6", className)}>{children}</div>;
}

/** A failed load, with an optional retry. */
export function ErrorAlert({ error, title = "Something went wrong", onRetry, className }: { error: unknown; title?: string; onRetry?: () => void; className?: string }) {
  if (!error) return null;
  return (
    <Alert variant="destructive" className={className}>
      <CircleAlert />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{typeof error === "string" ? error : errorMessage(error)}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-1" onClick={onRetry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Inline error text under a form or row. */
export function InlineError({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className={cn("text-destructive text-sm", className)}>
      {typeof error === "string" ? error : errorMessage(error)}
    </p>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center", className)}>
      {Icon && (
        <div className="bg-muted text-muted-foreground mb-1 flex size-10 items-center justify-center rounded-full">
          <Icon className="size-5" />
        </div>
      )}
      <p className="font-medium">{title}</p>
      {description && <p className="text-muted-foreground max-w-sm text-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Key/value rows for status cards. */
export function KeyValueList({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid gap-2.5 text-sm", className)}>{children}</dl>;
}

export function KeyValue({ k, children, mono }: { k: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-baseline gap-3">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className={cn("min-w-0 break-words", mono && "font-mono text-[13px]")}>{children}</dd>
    </div>
  );
}

/** Generic placeholder while a page's first load is in flight. */
export function PageSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <Page>
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: cards }, (_, i) => (
          <Skeleton key={i} className="h-40" />
        ))}
      </div>
      <Skeleton className="h-64" />
    </Page>
  );
}

export function LiveIndicator({ lost }: { lost?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-xs font-medium", lost ? "text-destructive" : "text-muted-foreground")} title={lost ? undefined : "Refreshes every 3 seconds"}>
      <span className={cn("relative flex size-2")}>
        {!lost && <span className="bg-ok absolute inline-flex size-full animate-ping rounded-full opacity-60" />}
        <span className={cn("relative inline-flex size-2 rounded-full", lost ? "bg-destructive" : "bg-ok")} />
      </span>
      {lost ? "Connection lost — retrying" : "Live"}
    </span>
  );
}
