import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useSession } from "@/app/session";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { InvitationList, InviteDialog, MemberList, primaryRole } from "./household-people";

export default function MembersPage() {
  const { me } = useSession();
  const [inviting, setInviting] = useState(false);
  return (
    <Page className="max-w-5xl">
      <PageHeader
        title="Members"
        description={`Everyone in ${me.household?.name ?? "this household"}. Each person signs in with their own account, which keeps their progress and My List. A kids account only sees titles within its limit.`}
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus /> Invite
          </Button>
        }
      />
      <section>
        <MemberList selfId={me.user.id} />
      </section>
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Pending invitations</h2>
          <p className="text-muted-foreground text-sm">Links you've made that haven't been used yet.</p>
        </div>
        <InvitationList />
      </section>
      <InviteDialog open={inviting} onOpenChange={setInviting} allowOwner={primaryRole(me.household?.role ?? "") === "owner"} />
    </Page>
  );
}
