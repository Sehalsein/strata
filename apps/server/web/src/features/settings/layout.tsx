import { useId, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** A titled group of setting rows, divided by hairlines. */
export function SettingsSection({ title, description, action, children, className }: { title: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cn("gap-0 py-0", className)}>
      <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4">
        <div className="space-y-1">
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {action}
      </div>
      <div className="divide-y border-t">{children}</div>
    </Card>
  );
}

/**
 * One setting: what it is and why on the left, its control on the right (stacked on
 * narrow screens). `htmlFor` ties the label to the control.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  badge,
  error,
  children,
  wide,
}: {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  badge?: ReactNode;
  error?: string | null;
  children: ReactNode;
  /** The control takes the full width under the label (lists, folder pickers). */
  wide?: boolean;
}) {
  return (
    <div className={cn("grid gap-3 px-5 py-4", !wide && "sm:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] sm:items-center sm:gap-8")}>
      <div className="min-w-0 space-y-1">
        <label htmlFor={htmlFor} className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {label}
          {badge}
        </label>
        {description && <p className="text-muted-foreground text-sm [&_a]:underline [&_a]:underline-offset-4">{description}</p>}
      </div>
      <div className={cn("min-w-0", !wide && "sm:flex sm:justify-end")}>
        <div className={cn(!wide && "w-full sm:w-auto")}>
          {children}
          {error && <p className="text-destructive mt-1.5 text-xs">{error}</p>}
        </div>
      </div>
    </div>
  );
}

/** A setting that's on or off. */
export function ToggleRow({ label, description, checked, onChange, badge }: { label: ReactNode; description?: ReactNode; checked: boolean; onChange: (v: boolean) => void; badge?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div className="min-w-0 space-y-1">
        <label htmlFor={id} className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {label}
          {badge}
        </label>
        {description && <p id={`${id}-d`} className="text-muted-foreground text-sm">{description}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={description ? `${id}-d` : undefined} />
    </div>
  );
}
