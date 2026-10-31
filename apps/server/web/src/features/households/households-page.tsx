import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRightLeft, Building2, LoaderCircle, Plus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/app/session";
import { api, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { relativeTime } from "@/lib/format";
import { queryKeys, useApiMutation } from "@/lib/query";
import type { HouseholdSummary } from "@/lib/types";
import { EmptyState, ErrorAlert, InlineError, Page, PageHeader } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FieldGroup, FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InviteDialog } from "@/features/members/household-people";

/**
 * Every household on the server (server admin). Each has its own library, settings, TorBox
 * key and people. A new one is made here, then its owner invited by link.
 */
export default function HouseholdsPage() {
  const { me, authChanged } = useSession();
  const all = useQuery({ queryKey: queryKeys.allHouseholds, queryFn: api.households });
  const mine = useQuery({ queryKey: queryKeys.households, queryFn: authClient.listHouseholds });
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState<HouseholdSummary | null>(null);
  const [switching, setSwitching] = useState<string | null>(null);
  const memberOf = new Set((mine.data ?? []).map((h) => h.id));

  const switchTo = async (h: HouseholdSummary) => {
    setSwitching(h.id);
    try {
      await authClient.setActiveHousehold(h.id);
      await authChanged();
      toast.success(`Switched to ${h.name}`);
    } catch (err) {
      toast.error(errorMessage(err));
      setSwitching(null);
    }
  };

  const items = [...(all.data?.items ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Page className="max-w-4xl">
      <PageHeader
        title="Households"
        description="Each household on this server has its own library, settings, TorBox key and people. Create one, then invite its owner with a link."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> New household
          </Button>
        }
      />
      <ErrorAlert error={all.error} title="Couldn't load households" onRetry={() => void all.refetch()} />
      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Household</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="pr-4">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {all.isPending ? (
              Array.from({ length: 3 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={3} className="px-4">
                    <Skeleton className="h-8" />
                  </TableCell>
                </TableRow>
              ))
            ) : items.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3} className="p-4">
                  <EmptyState icon={Building2} title="No households" className="border-0" />
                </TableCell>
              </TableRow>
            ) : (
              items.map((h) => {
                const current = h.id === me.household?.id;
                const member = memberOf.has(h.id);
                return (
                  <TableRow key={h.id}>
                    <TableCell className="pl-4 font-medium">
                      {h.name}
                      {current && (
                        <Badge variant="success" className="ml-2">
                          Open here
                        </Badge>
                      )}
                      {!member && (
                        <Badge variant="secondary" className="ml-2">
                          Not a member
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground" title={new Date(h.createdAt).toLocaleString()}>
                      {relativeTime(new Date(h.createdAt).getTime())}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      {member && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setInviting(h)}>
                            <UserPlus /> Invite
                          </Button>
                          {!current && (
                            <Button variant="ghost" size="sm" onClick={() => void switchTo(h)} disabled={!!switching}>
                              {switching === h.id ? <LoaderCircle className="animate-spin" /> : <ArrowRightLeft />}
                              Switch to
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      <CreateHouseholdDialog open={creating} onOpenChange={setCreating} onCreated={(h) => setInviting(h)} />
      <InviteDialog
        open={!!inviting}
        onOpenChange={(o) => !o && setInviting(null)}
        householdId={inviting?.id}
        householdName={inviting?.name}
        defaultRole="owner"
        allowOwner
      />
    </Page>
  );
}

function CreateHouseholdDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: (h: HouseholdSummary) => void }) {
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const create = useApiMutation(() => authClient.createHousehold(name.trim()), {
    success: (h) => `Created ${h.name}`,
    silentError: true,
    invalidate: [queryKeys.allHouseholds, queryKeys.households],
    onSuccess: (h) => {
      onOpenChange(false);
      setName("");
      setTouched(false);
      onCreated(h);
    },
  });
  const nameError = touched && !name.trim() ? "Give the household a name." : null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New household</DialogTitle>
          <DialogDescription>You'll be its first owner; next, invite the person who'll run it.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setTouched(true);
            if (name.trim()) create.mutate();
          }}
        >
          <FieldGroup>
            <FormField label="Name" error={nameError}>
              {(p) => <Input {...p} value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="The Smiths" autoFocus />}
            </FormField>
            <InlineError error={create.error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <LoaderCircle className="animate-spin" />}
                Create household
              </Button>
            </DialogFooter>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
