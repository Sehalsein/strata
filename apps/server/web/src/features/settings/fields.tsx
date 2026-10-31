import { useId, type ReactNode } from "react";
import type { Settings } from "@/lib/types";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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

/** Number input with a unit suffix ("min", "GB"). */
export function NumberInput({
  value,
  onChange,
  suffix,
  min,
  max,
  step,
  ...rest
}: { value: number; onChange: (v: number) => void; suffix?: string; min?: number; max?: number; step?: number; id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) {
  return (
    <div className="relative w-full max-w-48">
      <Input
        {...rest}
        type="number"
        className="pr-14 font-mono"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isFinite(n)) return;
          let v = step && step < 1 ? n : Math.round(n);
          if (min !== undefined) v = Math.max(min, v);
          if (max !== undefined) v = Math.min(max, v);
          onChange(v);
        }}
      />
      {suffix && <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">{suffix}</span>}
    </div>
  );
}
