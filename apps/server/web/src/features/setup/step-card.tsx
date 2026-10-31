import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

/** One wizard step: title, lede, body and a footer with Back on the left and actions on the right. */
export function StepCard({ title, description, children, onBack, actions }: { title: string; description?: ReactNode; children?: ReactNode; onBack?: () => void; actions: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl tracking-tight">{title}</CardTitle>
        {description && <CardDescription className="text-base">{description}</CardDescription>}
      </CardHeader>
      {children && <CardContent className="flex flex-col gap-6">{children}</CardContent>}
      <CardFooter className="flex-col-reverse gap-2 border-t sm:flex-row sm:justify-between">
        {onBack ? (
          <Button type="button" variant="ghost" onClick={onBack}>
            <ArrowLeft /> Back
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">{actions}</div>
      </CardFooter>
    </Card>
  );
}
