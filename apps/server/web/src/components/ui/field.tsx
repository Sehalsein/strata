import * as React from "react";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/*
 * Form layout primitives after shadcn's Field component: a label, the control, a description
 * and an error message, wired together with ids by the <FormField> helper below.
 */

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-group" className={cn("flex w-full flex-col gap-5", className)} {...props} />;
}

function Field({ className, orientation = "vertical", ...props }: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  return (
    <div
      role="group"
      data-slot="field"
      data-orientation={orientation}
      className={cn(
        "group/field flex w-full gap-2 data-[invalid=true]:[&>[data-slot=field-label]]:text-destructive",
        orientation === "vertical" ? "flex-col" : "flex-row items-start justify-between gap-4",
        className,
      )}
      {...props}
    />
  );
}

function FieldContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="field-content" className={cn("flex flex-1 flex-col gap-1 leading-snug", className)} {...props} />;
}

function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={cn("leading-snug", className)} {...props} />;
}

function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-muted-foreground text-sm leading-normal font-normal [&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-brand-text", className)}
      {...props}
    />
  );
}

function FieldError({ className, children, ...props }: React.ComponentProps<"p">) {
  if (!children) return null;
  return (
    <p role="alert" data-slot="field-error" className={cn("text-destructive text-sm font-normal", className)} {...props}>
      {children}
    </p>
  );
}

function FieldSet({ className, ...props }: React.ComponentProps<"fieldset">) {
  return <fieldset data-slot="field-set" className={cn("flex flex-col gap-3", className)} {...props} />;
}

function FieldLegend({ className, ...props }: React.ComponentProps<"legend">) {
  return <legend data-slot="field-legend" className={cn("mb-1 text-sm font-medium", className)} {...props} />;
}

/**
 * Label + control + hint + error with accessible wiring. `children` receives the props to spread
 * onto the control (id, aria-describedby, aria-invalid).
 */
function FormField({
  label,
  description,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  error?: React.ReactNode;
  className?: string;
  children: (control: { id: string; "aria-describedby"?: string; "aria-invalid"?: boolean }) => React.ReactNode;
}) {
  const id = React.useId();
  const descId = description ? `${id}-desc` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [descId, errId].filter(Boolean).join(" ") || undefined;
  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {description && <FieldDescription id={descId}>{description}</FieldDescription>}
      {error && <FieldError id={errId}>{error}</FieldError>}
    </Field>
  );
}

export { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet, FormField };
