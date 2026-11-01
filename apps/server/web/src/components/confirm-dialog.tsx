import { useRef, useState, type ReactNode } from "react";
import { LoaderCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Confirmation for destructive actions. The dialog stays open (with a spinner) while
 * `onConfirm` runs and closes when it resolves; a rejection keeps it open so the caller's
 * toast explains what went wrong.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = true,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown> | void;
}) {
  const [pending, setPending] = useState(false);
  // Callers usually derive the text from the item being acted on and clear it on close; keep
  // what was shown so the closing animation doesn't flash a blank or fallback text.
  const shown = useRef({ title, description, confirmLabel });
  if (open) shown.current = { title, description, confirmLabel };
  const confirm = async () => {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      /* the caller reports the error */
    } finally {
      setPending(false);
    }
  };
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{shown.current.title}</AlertDialogTitle>
          {shown.current.description && <AlertDialogDescription>{shown.current.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button variant={destructive ? "destructive" : "default"} onClick={() => void confirm()} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            {shown.current.confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
