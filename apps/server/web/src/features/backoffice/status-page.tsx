import { useQuery } from "@tanstack/react-query";
import { Download, Info, ScrollText, Server, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api";
import { formatDuration } from "@/lib/format";
import { queryKeys } from "@/lib/query";
import { Link } from "@/lib/router";
import { useSession } from "@/app/session";
import { ErrorAlert, LiveIndicator, Page, PageHeader, PageSkeleton } from "@/components/page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { JobsCard } from "@/features/overview/jobs-card";
import { ServerCard } from "@/features/overview/status-cards";

/** The backoffice's front page: how the server is doing, what needs the system admin, and its jobs. */
export default function StatusPage() {
  const { cloud } = useSession();
  const status = useQuery({ queryKey: queryKeys.status, queryFn: api.status, refetchInterval: 3000 });
  const data = status.data;

  if (status.isPending) return <PageSkeleton />;
  if (!data) {
    return (
      <Page>
        <PageHeader title="Status" />
        <ErrorAlert error={status.error} title="Couldn't load the server status" onRetry={() => void status.refetch()} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Status" description={<>Up {formatDuration(data.uptimeMs)}</>} actions={<LiveIndicator lost={status.isError} />} />

      <div className="flex flex-col gap-3 empty:hidden">
        {!cloud && data.update?.updateAvailable && (
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
                <Link href="/backoffice/settings#updates">{data.update.state === "available" ? "Update now" : "View"}</Link>
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
                  <>Strata couldn't download it ({data.ffmpegSetup.error}). Run “Set up ffmpeg” under Server jobs to try again, or install ffmpeg on the server and restart Strata.</>
                ) : (
                  <>There's no build for this platform; install ffmpeg on the server and restart Strata.</>
                )}
              </p>
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ServerCard status={data} />
        <Shortcut icon={Server} title="Server settings" description="Name, library rules and limits for every household." href="/backoffice/settings" />
        <Shortcut icon={ScrollText} title="Logs" description="What the server has been doing, newest first." href="/backoffice/logs" />
      </div>

      <JobsCard jobs={data.jobs} scope="server" />
    </Page>
  );
}

function Shortcut({ icon: Icon, title, description, href }: { icon: typeof Server; title: string; description: string; href: string }) {
  return (
    <Card className="justify-between">
      <CardHeader>
        <div className="bg-primary/12 text-brand-text mb-2 flex size-9 items-center justify-center rounded-lg">
          <Icon className="size-4" />
        </div>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button variant="outline" size="sm" asChild>
          <Link href={href}>Open</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}
