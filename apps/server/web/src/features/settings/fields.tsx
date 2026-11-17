import { useId, type ReactNode } from "react";
import type { Settings } from "@/lib/types";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";

export type SetFn = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

/** A labelled switch row: title + hint on the left, switch on the right. */
export function SwitchField({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description: ReactNode }) {
  const id = useId();
  return (
    <Field orientation="horizontal" className="rounded-lg border p-4">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription id={`${id}-d`}>{description}</FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onChange} aria-describedby={`${id}-d`} />
    </Field>
  );
}

/**
 * One of a few values, as a dropdown. A current value that isn't among the options (set
 * by hand before, or by an older version) is shown too, named by `describe`.
 */
export function ChoiceSelect<T extends string | number>({
  id,
  value,
  options,
  onChange,
  describe,
  className,
}: {
  id?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  describe?: (v: T) => string;
  className?: string;
}) {
  const all = options.some((o) => o.value === value) ? options : [...options, { value, label: describe?.(value) ?? String(value) }];
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(all.find((o) => String(o.value) === v)!.value)}>
      <SelectTrigger id={id} className={cn("w-full max-w-full sm:w-64", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {all.map((o) => (
          <SelectItem key={String(o.value)} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** "90" minutes → "1 hr 30 min"; whole days and hours as such. */
export function minutesLabel(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? "Every day" : `Every ${m / 1440} days`;
  if (m % 60 === 0) return m === 60 ? "Every hour" : `Every ${m / 60} hours`;
  return `Every ${m} minutes`;
}
