import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AuthScreen } from "@/features/auth/login-page";

/** The Strata apps for iPhone, iPad and Apple TV. */
const APP_STORE_URL = "https://apps.apple.com/us/app/strata-tv/id6804102192";

/**
 * /invite/:id — the link a household's admin passed on. Joining happens in the Strata app
 * (the dashboard is only for running households), so this page hands the invitation over:
 * it opens the app at "You're invited", where the person creates their account or signs in
 * to one they have, and points to the App Store for anyone without it.
 */
export default function InvitePage({ invitationId, serverName }: { invitationId: string; serverName: string }) {
  const info = useQuery({ queryKey: ["invitation", invitationId], queryFn: () => api.invitation(invitationId), retry: false });
  const link = info.data?.link;

  // Straight on to the app where it's installed; the buttons stay for when it isn't.
  useEffect(() => {
    if (link) window.location.href = link;
  }, [link]);

  const where = serverName && serverName !== "Strata" ? serverName : "this Strata server";
  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <Smartphone className="text-muted-foreground mx-auto size-8" />
          <CardTitle className="text-xl">{info.isError ? "This invitation can't be used" : "You're invited"}</CardTitle>
          <CardDescription>
            {info.isError
              ? errorMessage(info.error)
              : info.data
                ? `Join ${info.data.household} on ${where} as ${info.data.email}. You'll create your account in the Strata app on your iPhone or iPad.`
                : `Join a household on ${where} in the Strata app.`}
          </CardDescription>
        </CardHeader>
        {!info.isError && (
          <CardContent className="flex flex-col gap-3">
            {link ? (
              <Button asChild>
                <a href={link}>Open in Strata</a>
              </Button>
            ) : (
              <Skeleton className="h-9 w-full" />
            )}
            <Button variant="outline" asChild>
              <a href={APP_STORE_URL}>Get Strata on the App Store</a>
            </Button>
            <p className="text-muted-foreground text-center text-xs">Got the app just now? Come back to this page and tap Open in Strata.</p>
          </CardContent>
        )}
      </Card>
    </AuthScreen>
  );
}
