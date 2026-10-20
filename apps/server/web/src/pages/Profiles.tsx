import { ProfileManager } from "../components/ProfileManager";
import { Card, PageHeader } from "../components/ui";

export function ProfilesPage() {
  return (
    <div className="page">
      <PageHeader title="Profiles" subtitle="Profiles are who’s watching, not logins: devices sign in with your server account, then pick a profile. Each has its own progress and My List, and an optional PIN asked for when it’s picked." />
      <Card>
        <ProfileManager />
      </Card>
    </div>
  );
}
