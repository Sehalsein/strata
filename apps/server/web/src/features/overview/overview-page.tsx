import { useQuery } from "@tanstack/react-query";
import { Download, Info, MonitorSmartphone, RefreshCw, TriangleAlert, Tv } from "lucide-react";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { Link } from "@/lib/router";
import { useSession } from "@/app/session";
import { ErrorAlert, LiveIndicator, Page, PageHeader, PageSkeleton } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { JobsCard } from "./jobs-card";
import { SessionsCard } from "./sessions-card";
import { SetupChecklist } from "./setup-checklist";
import { LibraryCard, ProvidersCard, ServerCard } from "./status-cards";

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
  const { isServerAdmin, cloud } = useSession();
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
        description={<>Up {formatDuration(data.uptimeMs)}</>}
        actions={
          <>
            <LiveIndicator lost={status.isError} />
            {isServerAdmin && !cloud && (
              <Button variant="outline" size="sm" asChild>
                <Link href="/settings?checkUpdate=1#updates">
                  <RefreshCw /> Check for updates
                </Link>
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-col gap-3 empty:hidden">
        {isServerAdmin && !cloud && data.update?.updateAvailable && (
          <Alert variant="info">
            <Download />
            <AlertTitle>Update available</AlertTitle>
            <AlertDescription>
              <p>
                Strata v{data.update.latestVersion} is ready to install (running v{data.version}).
                {data.update.state === "waiting-for-idle" && " It installs when the last stream stops."}
                {data.update.state === "downloading" && " Downloading…"}
              </p>
              <Button size="sm" variant="outline" asChild className="mt-1">
                <Link href="/settings#updates">{data.update.state === "available" ? "Update now" : "View"}</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {!cloud && !data.ffmpeg && data.ffmpegSetup?.state === "downloading" && (
          <Alert variant="info">
            <Info />
            <AlertTitle>Setting up ffmpeg</AlertTitle>
            <AlertDescription>A one-time download of the ffmpeg Strata uses to play files that can't direct-play (MKV, DTS/TrueHD audio, some codecs). It only takes a minute.</AlertDescription>
          </Alert>
        )}
        {!cloud && !data.ffmpeg && data.ffmpegSetup?.state !== "downloading" && (
          <Alert variant="warning">
            <TriangleAlert />
            <AlertTitle>ffmpeg isn't set up</AlertTitle>
            <AlertDescription>
              <p>
                Files that can't direct-play (MKV, DTS/TrueHD audio, some codecs) need ffmpeg.{" "}
                {data.ffmpegSetup?.state === "failed" ? (
                  <>Strata couldn't download it ({data.ffmpegSetup.error}). Run “Set up ffmpeg” under Jobs to try again, or install ffmpeg on the server and restart Strata.</>
                ) : (
                  <>There's no build for this platform; install ffmpeg on the server and restart Strata.</>
                )}
              </p>
            </AlertDescription>
          </Alert>
        )}
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ServerCard status={data} />
        <LibraryCard stats={data.library} />
        <ProvidersCard status={data} />
      </div>

      <SessionsCard sessions={data.sessions} />
      <JobsCard jobs={data.jobs} isServerAdmin={isServerAdmin} />
    </Page>
  );
}
