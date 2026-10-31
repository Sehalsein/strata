import { useState } from "react";
import { UserPlus } from "lucide-react";
import { useSession } from "@/app/session";
import { Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card>
        <CardContent>
          <MemberList selfId={me.user.id} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pending invitations</CardTitle>
          <CardDescription>Links you've made that haven't been used yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <InvitationList />
        </CardContent>
      </Card>
      <InviteDialog open={inviting} onOpenChange={setInviting} allowOwner={primaryRole(me.household?.role ?? "") === "owner"} />
    </Page>
  );
}
