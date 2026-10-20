import { ProfileManager } from "../components/ProfileManager";
import { Card, PageHeader } from "../components/ui";

export function ProfilesPage() {
  return (
    <div className="page">
      <PageHeader title="Profiles" subtitle="Each profile has its own progress, watchlist and preferences. A PIN is asked for when the profile is picked on a device." />
      <Card>
        <ProfileManager />
      </Card>
    </div>
  );
}
