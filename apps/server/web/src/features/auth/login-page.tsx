import { useState } from "react";
import { LoaderCircle } from "lucide-react";
import { ApiError, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export default function LoginPage({ serverName, onSignedIn }: { serverName?: string; onSignedIn: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<{ message: string; rateLimited: boolean } | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await authClient.signIn({ username: username.trim(), password });
      onSignedIn();
    } catch (err) {
      // 429 carries "Too many attempts. Try again in N minutes." from the server.
      setError({ message: errorMessage(err), rateLimited: err instanceof ApiError && err.status === 429 });
      setPending(false);
    }
  };

  return (
    <div className="bg-muted/30 relative flex min-h-svh items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ModeToggle />
      </div>
      <div className="flex w-full max-w-sm flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-semibold">
          <BrandMark size={30} />
          <span className="text-lg">Strata</span>
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-xl">{serverName && serverName !== "Strata" ? serverName : "Sign in"}</CardTitle>
            <CardDescription>Sign in to the admin dashboard</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} noValidate>
              <FieldGroup>
                <FormField label="Username">
                  {(p) => <Input {...p} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="off" spellCheck={false} required autoFocus />}
                </FormField>
                <FormField label="Password">
                  {(p) => <Input {...p} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />}
                </FormField>
                {error && (
                  <Alert variant={error.rateLimited ? "warning" : "destructive"}>
                    <AlertTitle>{error.rateLimited ? "Sign-in paused" : "Couldn't sign in"}</AlertTitle>
                    <AlertDescription>{error.message}</AlertDescription>
                  </Alert>
                )}
                <Button type="submit" className="w-full" disabled={pending || !username.trim() || !password}>
                  {pending && <LoaderCircle className="animate-spin" />}
                  {pending ? "Signing in…" : "Sign in"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
