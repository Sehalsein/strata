import SettingsPage from "@/features/settings/settings-page";

/** The backoffice's settings: the server's own (every household's), for the system admin. */
export default function ServerSettingsPage() {
  return <SettingsPage scope="server" />;
}
