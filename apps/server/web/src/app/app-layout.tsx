import { Suspense, useState } from "react";
import { ChevronsUpDown, KeyRound, LogOut, SearchX, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authClient } from "@/lib/auth-client";
import { queryKeys } from "@/lib/query";
import { Link, usePath } from "@/lib/router";
import { BrandMark } from "@/components/brand-mark";
import { ModeToggle } from "@/components/mode-toggle";
import { EmptyState, Page, PageSkeleton } from "@/components/page";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ChangePasswordDialog } from "@/features/auth/change-password-dialog";
import { matchRoute, NAV_GROUPS, routes } from "./routes";
import { useSession } from "./session";

export default function AppLayout() {
  const path = usePath();
  const route = matchRoute(path);
  const Page_ = route?.component;

  return (
    <SidebarProvider>
      <a href="#main" className="bg-background sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <AppSidebar path={path} />
      <SidebarInset>
        <TopBar title={route?.title ?? "Not found"} />
        <div id="main" tabIndex={-1} className="flex flex-1 flex-col px-4 py-6 outline-none md:px-8">
          <Suspense fallback={<PageSkeleton />}>{Page_ ? <Page_ key={route.path} /> : <NotFound path={path} />}</Suspense>
          {/* Required by TMDB's API terms. */}
          <footer className="text-muted-foreground mx-auto mt-12 w-full max-w-6xl text-xs">
            Movie and show data from{" "}
            <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="underline">
              TMDB
            </a>
            . This product uses the TMDB API but is not endorsed or certified by TMDB.
          </footer>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar({ path }: { path: string }) {
  const { info } = useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = matchRoute(path);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Strata">
              <Link href="/" onClick={() => isMobile && setOpenMobile(false)}>
                <div className="flex aspect-square size-8 items-center justify-center">
                  <BrandMark size={24} />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Strata</span>
                  <span className="text-muted-foreground truncate text-xs" title={info.serverName}>
                    {info.serverName !== "Strata" ? info.serverName : "Media server"}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        {NAV_GROUPS.map((group) => {
          const items = routes.filter((r) => r.group === group);
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel>{group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((r) => (
                    <SidebarMenuItem key={r.path}>
                      <SidebarMenuButton asChild isActive={active === r} tooltip={r.title}>
                        <Link href={r.path} aria-current={active === r ? "page" : undefined} onClick={() => isMobile && setOpenMobile(false)}>
                          <r.icon />
                          <span>{r.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
      <SidebarFooter>
        <p className="text-muted-foreground truncate px-2 font-mono text-xs group-data-[collapsible=icon]:hidden">v{info.version}</p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function TopBar({ title }: { title: string }) {
  const { info } = useSession();
  return (
    <header className="bg-background/80 sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4 backdrop-blur md:px-6">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-sm font-medium">{title}</span>
        <span className="text-muted-foreground hidden truncate text-xs sm:inline">
          {info.serverName} · v{info.version}
        </span>
      </div>
      <ModeToggle />
      <UserMenu />
    </header>
  );
}

function UserMenu() {
  const { signOut } = useSession();
  const [changing, setChanging] = useState(false);
  const me = useQuery({ queryKey: queryKeys.me, queryFn: authClient.getCurrentUser, staleTime: Infinity });
  const name = me.data?.username ?? "Admin";
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5">
            <UserRound />
            <span className="hidden max-w-32 truncate sm:inline">{name}</span>
            <ChevronsUpDown className="text-muted-foreground size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate">{name}</span>
            <span className="text-muted-foreground text-xs font-normal">Server admin</span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <KeyRound /> Change password
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut /> Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
    </>
  );
}

function NotFound({ path }: { path: string }) {
  return (
    <Page>
      <EmptyState
        icon={SearchX}
        title="Not found"
        description={
          <>
            There's nothing at <code>{path}</code>.
          </>
        }
        action={
          <Button asChild variant="outline">
            <Link href="/">Go to overview</Link>
          </Button>
        }
      />
    </Page>
  );
}
