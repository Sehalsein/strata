import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, LoaderCircle, Pencil, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/session";
import { errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { queryKeys, useApiMutation } from "@/lib/query";
import { cn } from "@/lib/utils";
import { InlineError } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { InviteDialog } from "@/features/members/household-people";

function roleLabel(role: string | undefined): string {
  if (!role) return "";
  return role.split(",").includes("owner") ? "Owner" : role.split(",").includes("admin") ? "Admin" : "Member";
}

/** A household's initials in a rounded square, like a team avatar. */
function HouseholdMark({ name, className }: { name: string; className?: string }) {
  const initials =
    name
      .split(/\s+/)
      .filter((w) => /[\p{L}\p{N}]/u.test(w))
      .slice(0, 2)
      .map((w) => [...w][0]!.toUpperCase())
      .join("") || "?";
  return (
    <div className={cn("bg-primary text-primary-foreground flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold", className)} aria-hidden>
      {initials}
    </div>
  );
}

/**
 * The sidebar's top: the household this dashboard is showing, always in view, and the menu
 * to switch to another, invite people to it, rename it, or (server admin) start a new one.
 * Switching reloads everything for that household.
 */
export function HouseholdSwitcher() {
  const { info, me, isServerAdmin, can, authChanged } = useSession();
  const { isMobile } = useSidebar();
  const households = useQuery({ queryKey: queryKeys.households, queryFn: authClient.listHouseholds, staleTime: 60_000 });
  const [switching, setSwitching] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [inviting, setInviting] = useState(false);
  const active = me.household;
  const list = [...(households.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const isAdmin = can("householdAdmin");

  const switchTo = async (id: string, name: string) => {
    if (id === active?.id) return;
    setSwitching(id);
    try {
      await authClient.setActiveHousehold(id);
      await authChanged();
      toast.success(`Switched to ${name}`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSwitching(null);
    }
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground" tooltip={active?.name ?? "Choose a household"}>
              {switching ? (
                <div className="flex aspect-square size-8 items-center justify-center">
                  <LoaderCircle className="animate-spin" />
                </div>
              ) : (
                <HouseholdMark name={active?.name ?? "?"} />
              )}
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{active?.name ?? "Choose a household"}</span>
                <span className="text-muted-foreground truncate text-xs">{[info.serverName, roleLabel(active?.role)].filter(Boolean).join(" · ")}</span>
              </div>
              <ChevronsUpDown className="text-muted-foreground ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-60" side={isMobile ? "bottom" : "right"} align="start" sideOffset={4}>
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Households</DropdownMenuLabel>
            {households.isPending && <DropdownMenuItem disabled>Loading…</DropdownMenuItem>}
            {list.map((h) => (
              <DropdownMenuItem key={h.id} onSelect={() => void switchTo(h.id, h.name)} className="gap-2">
                <HouseholdMark name={h.name} className="size-6 rounded-md text-[10px]" />
                <span className="flex-1 truncate">{h.name}</span>
                {h.id === active?.id && <Check className="size-4" />}
              </DropdownMenuItem>
            ))}
            {active && isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setInviting(true)}>
                  <UserPlus /> Invite to {active.name}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setRenaming(true)}>
                  <Pencil /> Rename {active.name}
                </DropdownMenuItem>
              </>
            )}
            {isServerAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setCreating(true)}>
                  <Plus /> New household
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>

      <CreateHouseholdDialog open={creating} onOpenChange={setCreating} onCreated={(h) => void switchTo(h.id, h.name)} />
      {active && <RenameHouseholdDialog key={active.id} open={renaming} onOpenChange={setRenaming} id={active.id} current={active.name} />}
      {active && <InviteDialog open={inviting} onOpenChange={setInviting} householdId={active.id} householdName={active.name} />}
    </SidebarMenu>
  );
}

function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  initial = "",
  submitLabel,
  pending,
  error,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  initial?: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(false);
  const nameError = touched && !name.trim() ? "Give the household a name." : null;
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setName(initial);
          setTouched(false);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (name.trim()) onSubmit(name.trim());
          }}
        >
          <FieldGroup>
            <FormField label="Name" error={nameError}>
              {(p) => <Input {...p} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="The Smiths" autoFocus />}
            </FormField>
            <InlineError error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <LoaderCircle className="animate-spin" />}
                {submitLabel}
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The server admin starts a household: they're its first owner, and it opens here. */
function CreateHouseholdDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (h: { id: string; name: string }) => void }) {
  const create = useApiMutation((name: string) => authClient.createHousehold(name), {
    success: (h) => `Created ${h.name}`,
    silentError: true,
    invalidate: [queryKeys.households],
    onSuccess: (h) => {
      onOpenChange(false);
      onCreated(h);
    },
  });
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New household"
      description="Its own library, settings, TorBox key and people. You'll be its first owner; then invite the people who'll use it from Members."
      submitLabel="Create household"
      pending={create.isPending}
      error={create.error}
      onSubmit={(name) => create.mutate(name)}
    />
  );
}

function RenameHouseholdDialog({ open, onOpenChange, id, current }: { open: boolean; onOpenChange: (open: boolean) => void; id: string; current: string }) {
  const { authChanged } = useSession();
  const rename = useApiMutation((name: string) => authClient.renameHousehold(id, name), {
    success: (h) => `Renamed to ${h.name}`,
    silentError: true,
    invalidate: [queryKeys.households],
    onSuccess: async () => {
      onOpenChange(false);
      await authChanged();
    },
  });
  return (
    <NameDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename household"
      description="Everyone in it sees the new name."
      initial={current}
      submitLabel="Save"
      pending={rename.isPending}
      error={rename.error}
      onSubmit={(name) => rename.mutate(name)}
    />
  );
}
