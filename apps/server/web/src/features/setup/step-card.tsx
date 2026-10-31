import type { ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One onboarding step: an icon, a big title and lede, the step's body on a card, then Back on the left and actions on the right. */
export function StepCard({
  icon: Icon,
  title,
  description,
  children,
  onBack,
  actions,
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  onBack?: () => void;
  actions: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        {Icon && (
          <div className="bg-primary/12 text-brand-text flex size-12 items-center justify-center rounded-2xl">
            <Icon className="size-6" />
          </div>
        )}
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h1>
        {description && <p className="text-muted-foreground max-w-2xl text-base text-pretty sm:text-lg">{description}</p>}
      </div>
      {children && <div className="bg-card flex flex-col gap-6 rounded-2xl border p-5 shadow-xs sm:p-7">{children}</div>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">{actions}</div>
      </div>
    </section>
  );
}
