import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck, CircleX, LoaderCircle, Tv } from "lucide-react";
import { useSession } from "@/app/session";
import { authClient } from "@/lib/auth-client";
import { queryKeys, useApiMutation } from "@/lib/query";
import { ErrorAlert, Page, PageHeader } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * /link?user_code=XXXX — the page a TV's QR code opens. Approving signs the TV in as this
 * account, in the household open here, able to watch but never administer.
 */
export default function LinkPage() {
  const [code, setCode] = useState(() => normalize(new URLSearchParams(location.search).get("user_code") ?? ""));
  const choose = (c: string) => {
    setCode(c);
    history.replaceState(null, "", c ? `/link?user_code=${encodeURIComponent(c)}` : "/link");
  };
  return (
    <Page className="max-w-xl">
      <PageHeader title="Link a TV" description="Sign in a TV without typing a password with the remote: choose “Sign in with a code” on the TV, then scan its QR code or enter the code here." />
      {code ? <Approve key={code} code={code} onReset={() => choose("")} /> : <EnterCode onSubmit={choose} />}
    </Page>
  );
}

function EnterCode({ onSubmit }: { onSubmit: (code: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <Card>
      <CardContent>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (normalize(value)) onSubmit(normalize(value));
          }}
        >
          <FieldGroup>
            <FormField label="Code on the TV">
              {(p) => <Input {...p} className="font-mono text-lg tracking-[0.3em] uppercase" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} autoFocus />}
            </FormField>
            <Button type="submit" disabled={!normalize(value)}>
              Continue
            </Button>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

function Approve({ code, onReset }: { code: string; onReset: () => void }) {
  const { me } = useSession();
  // Looking the code up while signed in claims it for this account.
  const lookup = useQuery({ queryKey: queryKeys.deviceCode(code), queryFn: () => authClient.lookUpDeviceCode(code), staleTime: Infinity, refetchOnWindowFocus: false });
  const [result, setResult] = useState<"approved" | "denied" | null>(null);
  const approve = useApiMutation(() => authClient.approveDevice(code), { onSuccess: () => setResult("approved") });
  const deny = useApiMutation(() => authClient.denyDevice(code), { onSuccess: () => setResult("denied") });
  const status = result ?? lookup.data?.status;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tv className="size-5" /> Sign in a TV
        </CardTitle>
        <CardDescription>Check that this code matches the one on the TV.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="bg-muted rounded-lg py-4 text-center font-mono text-3xl font-semibold tracking-[0.3em]" aria-label={`Code ${code.split("").join(" ")}`}>
          {code}
        </p>
        {lookup.isPending ? (
          <Skeleton className="h-16" />
        ) : lookup.error ? (
          <ErrorAlert error={lookup.error} title="That code doesn't work" />
        ) : status === "approved" ? (
          <Alert variant="info">
            <CircleCheck />
            <AlertTitle>TV signed in</AlertTitle>
            <AlertDescription>It's signed in as {me.user.name}{me.household ? ` in ${me.household.name}` : ""} and can watch, but not change anything. It appears under Devices.</AlertDescription>
          </Alert>
        ) : status === "denied" ? (
          <Alert>
            <CircleX />
            <AlertTitle>Denied</AlertTitle>
            <AlertDescription>The TV wasn't signed in.</AlertDescription>
          </Alert>
        ) : (
          <p className="text-muted-foreground text-sm">
            The TV signs in as <span className="text-foreground font-medium">{me.user.name}</span>
            {me.household ? (
              <>
                {" "}
                in <span className="text-foreground font-medium">{me.household.name}</span> (switch households at the top to pick another)
              </>
            ) : null}
            . It can watch but never change settings.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-end gap-2">
        {status === "pending" && !lookup.error ? (
          <>
            <Button variant="outline" onClick={() => deny.mutate()} disabled={deny.isPending || approve.isPending}>
              {deny.isPending && <LoaderCircle className="animate-spin" />}
              Deny
            </Button>
            <Button onClick={() => approve.mutate()} disabled={deny.isPending || approve.isPending}>
              {approve.isPending && <LoaderCircle className="animate-spin" />}
              Approve
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={onReset}>
            Link another TV
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
