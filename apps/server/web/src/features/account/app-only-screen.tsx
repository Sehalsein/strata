import { LogOut, Smartphone } from "lucide-react";
import { AuthScreen } from "@/features/auth/login-page";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * The dashboard is for running households (their owners and admins, and the server's
 * admin). Anyone else signing in here, or someone who still has to replace a temporary
 * password, is pointed to the Strata app.
 */
export function AppOnlyScreen({ name, reason, onSignOut }: { name: string; reason: "member" | "temporary-password"; onSignOut: () => void }) {
  return (
    <AuthScreen>
      <Card>
        <CardHeader className="text-center">
          <Smartphone className="text-muted-foreground mx-auto size-8" />
          <CardTitle className="text-xl">{reason === "member" ? "Watch in the Strata app" : "Choose your password in the app"}</CardTitle>
          <CardDescription>
            {reason === "member"
              ? `Hi ${name}. This dashboard is for the people who run your household. Everything else, from watching to your account, is in the Strata app on your iPhone, iPad or Apple TV.`
              : `${name}, you signed in with a temporary password. Open the Strata app on your iPhone or iPad, sign in with it there, and choose your own. Then come back here.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" className="w-full" onClick={onSignOut}>
            <LogOut /> Sign out
          </Button>
        </CardContent>
      </Card>
    </AuthScreen>
  );
}
