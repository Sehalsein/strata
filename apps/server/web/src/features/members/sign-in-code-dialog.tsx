import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { InlineError } from "@/components/page";
import { QrCode } from "@/components/qr-code";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * A member's sign-in QR code: scanning it with the iPhone's or iPad's camera opens Strata
 * signed in as them, in this household, able to watch. Each code works once and a new one
 * shows every 30 seconds while the dialog is open.
 */
export function SignInCodeDialog({ member, onOpenChange }: { member: { id: string; name: string } | null; onOpenChange: (open: boolean) => void }) {
  const open = !!member;
  const code = useQuery({
    queryKey: ["sign-in-code", member?.id],
    queryFn: () => api.signInCode(member!.id),
    enabled: open,
    gcTime: 0,
    staleTime: 0,
    refetchInterval: (q) => (q.state.data?.refreshInSeconds ?? 30) * 1000,
    refetchIntervalInBackground: false,
  });
  const left = useSecondsLeft(code.dataUpdatedAt, code.data?.refreshInSeconds ?? 30, open && !!code.data);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Sign in as {member?.name}</DialogTitle>
          <DialogDescription>Scan with the camera on an iPhone or iPad that has Strata: it opens signed in as {member?.name}, able to watch. Nothing to type.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          {code.data ? <QrCode value={code.data.link} label={`Sign-in code for ${member?.name}`} className="size-60" /> : <Skeleton className="size-60" />}
          <InlineError error={code.error} />
          <div className="flex w-60 flex-col gap-1.5">
            <div className="bg-muted h-1 overflow-hidden rounded-full">
              <div className="bg-primary h-full transition-[width] duration-1000 ease-linear" style={{ width: `${(left / (code.data?.refreshInSeconds ?? 30)) * 100}%` }} />
            </div>
            <div className="text-muted-foreground flex items-center justify-between text-xs">
              <span>{code.data ? `New code in ${left}s` : "Making a code…"}</span>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => void code.refetch()} disabled={code.isFetching}>
                <RefreshCw className={code.isFetching ? "animate-spin" : undefined} /> New code
              </Button>
            </div>
          </div>
          {code.data && <p className="text-muted-foreground text-center text-xs">Each code works once. It signs in to {code.data.server}.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Seconds until the next code, ticking once a second. */
function useSecondsLeft(since: number, period: number, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return Math.max(0, Math.ceil(period - (now - since) / 1000));
}
