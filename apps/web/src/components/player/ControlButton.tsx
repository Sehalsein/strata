import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Visually-joined pill made of two halves: a primary click target on the
 * left (icon + optional label + value) and an optional chevron menu trigger
 * on the right. Render the chevron half via `menuSlot` so that callers can
 * wrap it in a Radix `DropdownMenuTrigger asChild` — Radix requires the
 * trigger to be a single element, so we don't fight that here.
 */
type PrimaryProps = {
  icon: React.ReactNode;
  label?: string;
  value?: string;
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  menuSlot?: React.ReactNode;
};

export const ControlButton = forwardRef<HTMLDivElement, PrimaryProps>(
  (
    { icon, label, value, ariaLabel, active, disabled, onClick, menuSlot },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-stretch overflow-hidden rounded-sm border border-strata-paper/20 bg-strata-bg/40 transition",
        active && "border-strata-accent/60 bg-strata-accent/[0.08]",
        !disabled && "hover:border-strata-paper/45",
        disabled && "opacity-40",
      )}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-pressed={active}
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "inline-flex h-9 items-center gap-2 px-3 text-strata-paper transition",
          !disabled && "hover:bg-strata-paper/[0.05]",
          disabled && "cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center",
            active ? "text-strata-accent" : "text-strata-paper/85",
          )}
        >
          {icon}
        </span>
        {label && (
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-strata-paper/65">
            {label}
          </span>
        )}
        {value && (
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-strata-paper">
            {value}
          </span>
        )}
      </button>
      {menuSlot}
    </div>
  ),
);
ControlButton.displayName = "ControlButton";

/** Chevron button intended to be placed in a `ControlButton menuSlot`. */
export const ControlMenuTrigger = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { ariaLabel: string }
>(({ ariaLabel, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={ariaLabel}
    {...props}
    className={cn(
      "inline-flex h-9 w-7 items-center justify-center border-l border-strata-paper/15 text-strata-paper/55 transition hover:bg-strata-paper/[0.06] hover:text-strata-paper disabled:cursor-not-allowed",
      className,
    )}
  >
    <ChevronDown className="h-3 w-3" />
  </button>
));
ControlMenuTrigger.displayName = "ControlMenuTrigger";
