import { useQuery } from "@tanstack/react-query";
import { MonitorSmartphone, TriangleAlert, Tv } from "lucide-react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query";
import { Link } from "@/lib/router";
import { useSession } from "@/app/session";
import { ErrorAlert, LiveIndicator, Page, PageHeader, PageSkeleton } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { JobsCard } from "./jobs-card";
import { SessionsCard } from "./sessions-card";
import { SetupChecklist } from "./setup-checklist";
import { LibraryCard, ProvidersCard } from "./status-cards";

export default function OverviewPage() {
  const { isHouseholdAdmin } = useSession();
  return isHouseholdAdmin ? <AdminOverview /> : <MemberOverview />;
}

/** Members (and anyone without a household to run): what they can do here. */
function MemberOverview() {
  const { me, info } = useSession();
  return (
    <Page className="max-w-3xl">
      <PageHeader title={`Hi, ${me.user.name}`} description={me.household ? `You're a member of ${me.household.name} on ${info.serverName}.` : `You're signed in to ${info.serverName}.`} />
      {!me.household && (
        <Alert variant="warning">
          <TriangleAlert />
          <AlertTitle>You're not in a household yet</AlertTitle>
          <AlertDescription>Ask a household's owner for an invitation link, then open it while signed in to join.</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MonitorSmartphone className="size-4" /> Your devices
            </CardTitle>
            <CardDescription>See where you're signed in and sign devices out.</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button variant="outline" size="sm" asChild>
              <Link href="/devices">Open Devices</Link>
            </Button>
          </CardFooter>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tv className="size-4" /> Link a TV
            </CardTitle>
            <CardDescription>Approve the code an Apple TV shows to sign it in as you.</CardDescription>
          </CardHeader>
          <CardFooter className="mt-auto">
            <Button variant="outline" size="sm" asChild>
              <Link href="/link">Link a TV</Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
      <p className="text-muted-foreground text-sm">Watch in the Strata apps on your iPhone, iPad, Mac or Apple TV. The household's owner and admins manage its library, settings and members.</p>
    </Page>
  );
}

function AdminOverview() {
  const { isServerAdmin, me } = useSession();
  const status = useQuery({ queryKey: queryKeys.status, queryFn: api.status, refetchInterval: 3000 });
  const data = status.data;

  if (status.isPending) return <PageSkeleton />;
  if (!data) {
    return (
      <Page>
        <PageHeader title="Overview" />
        <ErrorAlert error={status.error} title="Couldn't load the server status" onRetry={() => void status.refetch()} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Overview"
        description={me.household?.name}
        actions={<LiveIndicator lost={status.isError} />}
      />

      <div className="flex flex-col gap-3 empty:hidden">
        {!data.tmdb.configured && (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>No TMDB key</AlertTitle>
            <AlertDescription>
              <p>This household's catalog and file matching are off until it has a TMDB key.</p>
              <Button size="sm" variant="outline" asChild className="mt-1">
                <Link href="/settings#connections">Add key</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <SetupChecklist status={data} isServerAdmin={isServerAdmin} />

      <div className="grid gap-4 md:grid-cols-2">
        <LibraryCard stats={data.library} />
        <ProvidersCard status={data} />
      </div>

      <SessionsCard sessions={data.sessions} />
      {data.jobs.length > 0 && <JobsCard jobs={data.jobs} scope="household" />}
    </Page>
  );
}
