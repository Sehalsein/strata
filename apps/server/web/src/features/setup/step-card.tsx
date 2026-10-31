import { createContext, useContext, type ReactNode } from "react";
import { ArrowLeft, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Where the wizard is, for each step's eyebrow. */
export const WizardContext = createContext<{ index: number; total: number; label: string } | null>(null);

/**
 * One onboarding step: an eyebrow (step and name), a big title and lede, the step's body,
 * and a bar pinned to the bottom with Back on the left and the step's actions on the right.
 */
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
  const where = useContext(WizardContext);
  return (
    <section className="flex flex-1 flex-col">
      <div className="flex flex-col gap-4">
        <p className="text-brand-text flex items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase">
          {Icon && <Icon className="size-4" />}
          {where && (
            <span>
              Step {where.index + 1} of {where.total} · {where.label}
            </span>
          )}
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
        {description && <p className="text-muted-foreground max-w-xl text-base text-pretty sm:text-lg">{description}</p>}
      </div>
      {children && <div className="mt-10 flex flex-col gap-8">{children}</div>}
      <div className="flex-1" />
      <div className="sticky bottom-0 z-10 -mx-5 mt-12 bg-gradient-to-t from-background via-background/95 to-transparent px-5 pt-8 pb-6 sm:-mx-8 sm:px-8">
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
      </div>
    </section>
  );
}
