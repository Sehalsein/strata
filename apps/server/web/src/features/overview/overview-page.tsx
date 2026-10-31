import { useQuery } from "@tanstack/react-query";
import { Download, RefreshCw, TriangleAlert, Info } from "lucide-react";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { Link } from "@/lib/router";
import { ErrorAlert, LiveIndicator, Page, PageHeader, PageSkeleton } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { JobsCard } from "./jobs-card";
import { SessionsCard } from "./sessions-card";
import { SetupChecklist } from "./setup-checklist";
import { LibraryCard, ProvidersCard, ServerCard } from "./status-cards";

export default function OverviewPage() {
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
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings?checkUpdate=1#updates">
                <RefreshCw /> Check for updates
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-col gap-3 empty:hidden">
        {data.update?.updateAvailable && (
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
        {!data.ffmpeg && data.ffmpegSetup?.state === "downloading" && (
          <Alert variant="info">
            <Info />
            <AlertTitle>Setting up ffmpeg</AlertTitle>
            <AlertDescription>A one-time download of the ffmpeg Strata uses to play files that can't direct-play (MKV, DTS/TrueHD audio, some codecs). It only takes a minute.</AlertDescription>
          </Alert>
        )}
        {!data.ffmpeg && data.ffmpegSetup?.state !== "downloading" && (
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
              <p>The catalog and file matching are off until a TMDB key is added.</p>
              <Button size="sm" variant="outline" asChild className="mt-1">
                <Link href="/settings#keys">Add key</Link>
              </Button>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <SetupChecklist status={data} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ServerCard status={data} />
        <LibraryCard stats={data.library} />
        <ProvidersCard status={data} />
      </div>

      <SessionsCard sessions={data.sessions} />
      <JobsCard jobs={data.jobs} />
    </Page>
  );
}
