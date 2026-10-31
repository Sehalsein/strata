import { Page, PageHeader } from "@/components/page";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileManager } from "./profile-manager";

export default function ProfilesPage() {
  return (
    <Page className="max-w-3xl">
      <PageHeader
        title="Profiles"
        description="Profiles are who’s watching, not logins: devices sign in with your server account, then pick a profile. Each has its own progress and My List, and an optional PIN asked for when it’s picked."
      />
      <Card>
        <CardContent>
          <ProfileManager />
        </CardContent>
      </Card>
    </Page>
  );
}
