import { Suspense, useEffect, useState } from "react";
import { ArrowLeft, ChevronsUpDown, Fingerprint, KeyRound, ShieldCheck, Lock, LogOut, SearchX, ShieldEllipsis, UserPlus, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage } from "@/lib/api";
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
import { SignInMethodsDialog } from "@/features/auth/sign-in-methods-dialog";
import { YourDataDialog } from "@/features/account/your-data-dialog";
import { HouseholdSwitcher } from "@/features/households/household-switcher";
import { BACKOFFICE_GROUPS, matchRoute, NAV_GROUPS, routes } from "./routes";
import { useSession } from "./session";

/** The route for `path` as this account sees it: to anyone but the system admin the backoffice doesn't exist. */
function useRoute(path: string) {
  const { can } = useSession();
  const route = matchRoute(path);
  return route?.backoffice && !can("systemAdmin") ? undefined : route;
}

export default function AppLayout() {
  const path = usePath();
  const { can } = useSession();
  const route = useRoute(path);
  const allowed = !!route && can(route.access);
  const Page_ = allowed ? route.component : undefined;

  return (
    <SidebarProvider>
      <a href="#main" className="bg-background sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        Skip to content
      </a>
      <AppSidebar path={path} />
      <SidebarInset>
        <TopBar title={route?.title ?? "Not found"} />
        <div id="main" tabIndex={-1} className="flex flex-1 flex-col px-4 py-6 outline-none md:px-8">
          <Suspense fallback={<PageSkeleton />}>{Page_ ? <Page_ key={route!.path} /> : route ? <NotAllowed /> : <NotFound path={path} />}</Suspense>
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

/**
 * The household's pages, or (under /backoffice) the system admin's: the backoffice has a
 * sidebar of its own, with the way back to the household at the top.
 */
function AppSidebar({ path }: { path: string }) {
  const { info, can } = useSession();
  const { isMobile, setOpenMobile } = useSidebar();
  const active = useRoute(path);
  const backoffice = !!active?.backoffice;
  const close = () => isMobile && setOpenMobile(false);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        {backoffice ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex items-center gap-2 px-2 py-1.5 group-data-[collapsible=icon]:hidden">
                <div className="bg-primary text-primary-foreground flex size-8 items-center justify-center rounded-lg">
                  <ShieldEllipsis className="size-4" />
                </div>
                <div className="min-w-0 leading-tight">
                  <p className="truncate text-sm font-semibold">Backoffice</p>
                  <p className="text-muted-foreground truncate text-xs">{info.serverName}</p>
                </div>
              </div>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="Back to the dashboard">
                <Link href="/" onClick={close}>
                  <ArrowLeft />
                  <span>Back to the dashboard</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <HouseholdSwitcher />
        )}
      </SidebarHeader>
      <SidebarContent>
        {(backoffice ? BACKOFFICE_GROUPS : NAV_GROUPS).map((group) => {
          const items = routes.filter((r) => r.group === group && !r.hidden && !!r.backoffice === backoffice && can(r.access));
          if (items.length === 0) return null;
          return (
            <SidebarGroup key={group}>
              <SidebarGroupLabel>{group}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((r) => (
                    <SidebarMenuItem key={r.path}>
                      <SidebarMenuButton asChild isActive={active === r} tooltip={r.title}>
                        <Link href={r.path} aria-current={active === r ? "page" : undefined} onClick={close}>
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
        {!backoffice && can("systemAdmin") && (
          <SidebarGroup className="mt-auto">
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild tooltip="Backoffice">
                    <Link href="/backoffice" onClick={close}>
                      <ShieldEllipsis />
                      <span>Backoffice</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <Link href="/" className="text-muted-foreground flex items-center gap-2 px-2 text-xs" onClick={close} title={`Strata v${info.version}`}>
          <BrandMark size={16} />
          <span className="truncate group-data-[collapsible=icon]:hidden">
            Strata <span className="font-mono">v{info.version}</span>
          </span>
        </Link>
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
        <span className="text-muted-foreground hidden truncate text-xs lg:inline">
          {info.serverName} · v{info.version}
        </span>
      </div>
      <ModeToggle />
      <AccountMenu />
    </header>
  );
}

function roleLabel(role: string | undefined): string {
  if (!role) return "";
  return role.split(",").includes("owner") ? "Owner" : role.split(",").includes("admin") ? "Admin" : "Member";
}

/** The signed-in account, the other accounts saved in this browser, and signing out. */
function AccountMenu() {
  const { info, me, isServerAdmin, authChanged, addAccount } = useSession();
  const [changing, setChanging] = useState(false);
  const [methods, setMethods] = useState(false);
  const [yourData, setYourData] = useState(false);
  const hasOtherMethods = !!(info.signIn?.google || info.signIn?.passkey);
  // Back from connecting Google.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("google") !== "connected") return;
    history.replaceState(null, "", window.location.pathname);
    toast.success("Google connected: you can sign in with it now.");
  }, []);
  const accounts = useQuery({ queryKey: queryKeys.accounts, queryFn: authClient.listAccounts, staleTime: 30_000 });
  const others = (accounts.data ?? []).filter((a) => a.user.id !== me.user.id);
  const current = (accounts.data ?? []).find((a) => a.user.id === me.user.id);
  const name = me.user.name || me.user.username || "Account";
  const subtitle = [isServerAdmin ? "System admin" : null, me.household ? `${roleLabel(me.household.role)} · ${me.household.name}` : "No household"].filter(Boolean).join(" · ");

  const run = async (fn: () => Promise<void>, done?: string) => {
    try {
      await fn();
      await authChanged();
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Account">
            {me.user.image ? <img src={me.user.image} alt="" className="size-5 rounded-full" /> : <UserRound />}
            <span className="hidden max-w-32 truncate sm:inline">{name}</span>
            <ChevronsUpDown className="text-muted-foreground size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate">{name}</span>
            {me.user.username && me.user.username !== name && <span className="text-muted-foreground truncate text-xs font-normal">@{me.user.username}</span>}
            <span className="text-muted-foreground truncate text-xs font-normal">{subtitle}</span>
          </DropdownMenuLabel>
          {others.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Switch account</DropdownMenuLabel>
              {others.map((a) => (
                <DropdownMenuItem key={a.session.token} onSelect={() => void run(() => authClient.switchAccount(a.session.token), `Signed in as ${a.user.name}`)}>
                  <UserRound />
                  <span className="truncate">{a.user.name}</span>
                </DropdownMenuItem>
              ))}
            </>
          )}
          {isServerAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/backoffice">
                  <ShieldEllipsis /> Backoffice
                </Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={addAccount}>
            <UserPlus /> Add account
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setChanging(true)}>
            <KeyRound /> Change password
          </DropdownMenuItem>
          {hasOtherMethods && (
            <DropdownMenuItem onSelect={() => setMethods(true)}>
              <Fingerprint /> Sign-in methods
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setYourData(true)}>
            <ShieldCheck /> Your data
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void run(() => (current ? authClient.signOutAccount(current.session.token) : authClient.signOutAll()), others.length ? `Signed ${name} out` : undefined)}
          >
            <LogOut /> {others.length ? `Sign out ${name}` : "Sign out"}
          </DropdownMenuItem>
          {others.length > 0 && (
            <DropdownMenuItem onSelect={() => void run(() => authClient.signOutAll())}>
              <LogOut /> Sign out of all accounts
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangePasswordDialog open={changing} onOpenChange={setChanging} />
      {hasOtherMethods && <SignInMethodsDialog open={methods} onOpenChange={setMethods} />}
      <YourDataDialog open={yourData} onOpenChange={setYourData} />
    </>
  );
}

function NotAllowed() {
  const { me } = useSession();
  return (
    <Page>
      <EmptyState
        icon={Lock}
        title="Not available to you"
        description={me.household ? "This page is for the household's owner and admins, or the server's admin." : "Join a household first: ask its owner for an invitation link."}
        action={
          <Button asChild variant="outline">
            <Link href="/">Go to overview</Link>
          </Button>
        }
      />
    </Page>
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
