import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { InlineError } from "@/components/page";
import { QrCode } from "@/components/qr-code";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * An invitation's QR code: scanned with the iPhone's or iPad's camera (or in the app), it
 * opens the Strata app, where the person creates their account (or signs in) and joins. It
 * names the server at an address phones can reach, even when this dashboard is open on the
 * server's own machine.
 */
export function InviteQr({ invitationId, email }: { invitationId: string; email: string }) {
  const info = useQuery({ queryKey: ["invitation", invitationId], queryFn: () => api.invitation(invitationId), staleTime: 60_000 });
  return (
    <div className="flex flex-col items-center gap-3">
      {info.data ? <QrCode value={info.data.link} label={`Invitation for ${email}`} className="size-56" /> : <Skeleton className="size-56" />}
      <InlineError error={info.error} />
      {info.data && <p className="text-muted-foreground max-w-64 text-center text-xs">For {email}, until it's used. It joins {info.data.server}.</p>}
    </div>
  );
}

/** A pending invitation's QR code, in a dialog. */
export function InviteQrDialog({ invitation, onOpenChange }: { invitation: { id: string; email: string } | null; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={!!invitation} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Invitation for {invitation?.email}</DialogTitle>
          <DialogDescription>Scan with the camera on an iPhone or iPad that has Strata: it opens the app, where they create their account (or sign in to one they have) and join.</DialogDescription>
        </DialogHeader>
        <div className="py-2">{invitation && <InviteQr invitationId={invitation.id} email={invitation.email} />}</div>
      </DialogContent>
    </Dialog>
  );
}
