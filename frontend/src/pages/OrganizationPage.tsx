import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  Crown,
  FolderKanban,
  MailPlus,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserPlus,
  UsersRound,
} from "lucide-react";
import type { WorkspaceMember, WorkspaceRole } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { cn, formatDate, hasRole, roleLabel, titleCase } from "../lib/format";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  ErrorBlock,
  Field,
  Input,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  StatCard,
  Table,
  Td,
  Textarea,
  Th,
} from "../components/ui";

const ROLES: WorkspaceRole[] = ["admin", "manager", "member", "viewer"];

export function OrganizationPage() {
  const {
    organizations,
    workspaces,
    activeOrganization,
    activeWorkspace,
    role,
    refresh,
    switchWorkspace,
    canManageWorkspace,
  } = useWorkspace();
  const { toast } = useToast();
  const orgId = activeOrganization?.id ?? "";
  const wsId = activeWorkspace?.id ?? "";
  const [tab, setTab] = useState<"organization" | "workspace">("organization");
  const [addOpen, setAddOpen] = useState<"org" | "workspace" | "new-org" | "new-workspace" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [memberForm, setMemberForm] = useState({ email: "", role: "member" as WorkspaceRole });
  const [orgForm, setOrgForm] = useState({ name: "", workspaceName: "", description: "" });
  const [workspaceForm, setWorkspaceForm] = useState({ name: "", description: "" });
  const [settings, setSettings] = useState({ name: activeWorkspace?.name ?? "", description: activeWorkspace?.description ?? "" });

  const members = useAsync<{ orgMembers: WorkspaceMember[]; wsMembers: WorkspaceMember[] }>(
    async () => {
      const [org, workspace] = await Promise.all([
        orgId ? api.organizations.members(orgId) : Promise.resolve({ members: [] }),
        wsId ? api.workspaces.members(wsId) : Promise.resolve({ members: [] }),
      ]);
      return { orgMembers: org.members, wsMembers: workspace.members };
    },
    [orgId, wsId],
  );

  useEffect(() => {
    setSettings({ name: activeWorkspace?.name ?? "", description: activeWorkspace?.description ?? "" });
  }, [activeWorkspace?.id, activeWorkspace?.name, activeWorkspace?.description]);

  const orgRole = activeOrganization?.role ?? null;
  const canManageOrg = orgRole === "owner" || orgRole === "admin";
  const canGrantOwner = orgRole === "owner";
  const orgMembers = members.data?.orgMembers ?? [];
  const wsMembers = members.data?.wsMembers ?? [];
  const currentOrgWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.organizationId === (activeOrganization?.id ?? "")),
    [workspaces, activeOrganization?.id],
  );

  const refreshAll = async () => {
    await Promise.all([refresh(), members.reload()]);
  };

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!memberForm.email.trim()) return;
    setBusy("add-member");
    setActionError(null);
    try {
      if (addOpen === "org") {
        await api.organizations.addMember(orgId, { email: memberForm.email.trim(), role: memberForm.role });
      } else {
        await api.workspaces.addMember(wsId, { email: memberForm.email.trim(), role: memberForm.role });
      }
      await refreshAll();
      setMemberForm({ email: "", role: "member" });
      setAddOpen(null);
      toast("Member added. Invited accounts are created in pending status until they sign in.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The member could not be added.");
    } finally {
      setBusy(null);
    }
  };

  const changeOrgRole = async (member: WorkspaceMember, next: WorkspaceRole) => {
    if (!orgId || member.role === next) return;
    setBusy(`org-${member.userId}`);
    setActionError(null);
    try {
      await api.organizations.updateMember(orgId, member.userId, next);
      await refreshAll();
      toast(`${member.name} is now ${roleLabel(next)} in the organization.`, "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The organization role could not be changed.");
    } finally {
      setBusy(null);
    }
  };

  const changeWsRole = async (member: WorkspaceMember, next: WorkspaceRole) => {
    if (!wsId || member.role === next) return;
    setBusy(`ws-${member.userId}`);
    setActionError(null);
    try {
      await api.workspaces.updateMember(wsId, member.userId, next);
      await refreshAll();
      toast(`${member.name} is now ${roleLabel(next)} in this workspace.`, "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The workspace role could not be changed.");
    } finally {
      setBusy(null);
    }
  };

  const removeMember = async (member: WorkspaceMember) => {
    if (!wsId) return;
    if (!window.confirm(`Remove ${member.name} from ${activeWorkspace?.name}?`)) return;
    setBusy(`remove-${member.userId}`);
    setActionError(null);
    try {
      await api.workspaces.removeMember(wsId, member.userId);
      await refreshAll();
      toast("Workspace member removed.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The member could not be removed.");
    } finally {
      setBusy(null);
    }
  };

  const createOrganization = async (event: React.FormEvent) => {
    event.preventDefault();
    if (orgForm.name.trim().length < 2) return;
    setBusy("new-org");
    setActionError(null);
    try {
      const result = await api.organizations.create({
        name: orgForm.name.trim(),
        workspaceName: orgForm.workspaceName.trim() || undefined,
        description: orgForm.description.trim(),
      });
      await refresh();
      await switchWorkspace(result.workspace.id);
      setAddOpen(null);
      setOrgForm({ name: "", workspaceName: "", description: "" });
      toast("Organization and first workspace created.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The organization could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const createWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!orgId || workspaceForm.name.trim().length < 2) return;
    setBusy("new-workspace");
    setActionError(null);
    try {
      const created = await api.workspaces.create({
        organizationId: orgId,
        name: workspaceForm.name.trim(),
        description: workspaceForm.description.trim(),
      });
      await refresh();
      await switchWorkspace(created.id);
      setAddOpen(null);
      setWorkspaceForm({ name: "", description: "" });
      toast("Workspace created.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The workspace could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const saveWorkspace = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!wsId) return;
    setBusy("settings");
    setActionError(null);
    try {
      await api.workspaces.update(wsId, {
        name: settings.name.trim(),
        description: settings.description.trim(),
      });
      await refresh();
      toast("Workspace settings saved.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Workspace settings could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  if (!activeOrganization || !activeWorkspace) {
    return (
      <div>
        <PageHeader title="Organization & Workspaces" />
        <Card>
          <EmptyState icon={Building2} title="No active organization" description="Create an organization to provision your first workspace." />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow="Administration"
        title="Organization & Workspaces"
        description="Manage the organization, workspace settings and people. Navigation visibility is not authorization: every role change is verified by the API."
        actions={
          <Button variant="primary" onClick={() => { setActionError(null); setAddOpen("new-workspace"); }}>
            <Plus className="h-4 w-4" /> New workspace
          </Button>
        }
        meta={
          <>
            <Badge tone="outline">{activeOrganization.name}</Badge>
            <span>{currentOrgWorkspaces.length} workspaces · {activeOrganization.memberCount} organization members</span>
            <span>· Your organization role: {roleLabel(orgRole)}</span>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Organization" value={activeOrganization.name} hint={`${activeOrganization.workspaceCount} workspaces`} icon={Building2} tone="primary" />
        <StatCard label="Active workspace" value={activeWorkspace.name} hint={`${activeWorkspace.memberCount} members · ${activeWorkspace.projectCount} projects`} icon={FolderKanban} tone="sage" />
        <StatCard label="Your workspace role" value={roleLabel(role)} hint="Controls project access and workspace settings" icon={ShieldCheck} tone={hasRole(role, "admin") ? "sage" : "neutral"} />
        <StatCard label="Organization role" value={roleLabel(orgRole)} hint="Organization roles are separate from workspace roles" icon={UsersRound} tone={canManageOrg ? "primary" : "neutral"} />
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-1 border-b border-line">
        {[
          ["organization", "Organization & members"],
          ["workspace", "Workspace settings & members"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value as "organization" | "workspace")}
            className={cn(
              "border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              tab === value ? "border-primary-500 text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {actionError && <div className="mt-4"><Alert tone="danger" title="Administration action failed">{actionError}</Alert></div>}
      {members.error && <div className="mt-4"><ErrorBlock message={members.error} onRetry={() => void members.reload()} /></div>}

      {tab === "organization" ? (
        <div className="mt-5 space-y-5">
          <Card>
            <CardHeader
              title="Organization profile"
              description="The organization groups workspaces and controls organization-level membership."
              actions={canManageOrg ? <Button size="sm" variant="primary" onClick={() => { setActionError(null); setAddOpen("new-org"); }}><Plus className="h-3.5 w-3.5" /> New organization</Button> : undefined}
            />
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <div>
                <p className="meta-label">Name</p>
                <p className="mt-1 text-sm font-semibold text-ink">{activeOrganization.name}</p>
              </div>
              <div>
                <p className="meta-label">Slug</p>
                <p className="mt-1 font-mono text-xs text-ink-muted">{activeOrganization.slug}</p>
              </div>
              <div>
                <p className="meta-label">Your role</p>
                <p className="mt-1 text-sm font-semibold text-ink">{roleLabel(orgRole)}</p>
              </div>
            </div>
            {activeOrganization.description && <p className="border-t border-line px-5 py-3 text-xs leading-5 text-ink-muted">{activeOrganization.description}</p>}
          </Card>

          <Card>
            <CardHeader
              title="Organization members"
              description="Organization roles are inherited as a secondary source of workspace access. Workspace-specific roles override where applicable."
              actions={canManageOrg ? <Button size="sm" variant="secondary" onClick={() => { setActionError(null); setAddOpen("org"); }}><UserPlus className="h-3.5 w-3.5" /> Add member</Button> : undefined}
            />
            {members.loading ? (
              <LoadingBlock label="Loading organization members" />
            ) : orgMembers.length === 0 ? (
              <EmptyState icon={UsersRound} title="No organization members" compact />
            ) : (
              <Table>
                <thead><tr><Th>Member</Th><Th>Title</Th><Th>Organization role</Th><Th>Joined</Th></tr></thead>
                <tbody>
                  {orgMembers.map((member) => (
                    <tr key={member.userId}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={member.name} color={member.avatarColor} size="sm" />
                          <div>
                            <p className="text-xs font-semibold text-ink">{member.name}</p>
                            <p className="text-[10px] text-ink-faint">{member.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td><span className="text-xs text-ink-muted">{member.title || "—"}</span></Td>
                      <Td>
                        {canManageOrg ? (
                          <Select
                            value={member.role}
                            onChange={(event) => void changeOrgRole(member, event.target.value as WorkspaceRole)}
                            disabled={busy === `org-${member.userId}` || (member.role === "owner" && !canGrantOwner)}
                            className="w-auto min-w-[130px] py-1 text-xs"
                            aria-label={`Organization role for ${member.name}`}
                          >
                            {member.role === "owner" && <option value="owner">Owner</option>}
                            {ROLES.map((candidate) => <option key={candidate} value={candidate}>{roleLabel(candidate)}</option>)}
                          </Select>
                        ) : (
                          <Badge tone={member.role === "owner" ? "primary" : "neutral"}>{member.role === "owner" && <Crown className="h-3 w-3" />}{roleLabel(member.role)}</Badge>
                        )}
                      </Td>
                      <Td><span className="text-[10px] text-ink-faint">{member.createdAt ? formatDate(member.createdAt) : "—"}</span></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Workspaces in this organization" description="Switch the active workspace from the topbar, or open its administration below." />
            <ul className="divide-y divide-line-faint">
              {currentOrgWorkspaces.map((workspace) => (
                <li key={workspace.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="flex items-center gap-2 text-xs font-semibold text-ink">
                      {workspace.name}
                      {workspace.id === activeWorkspace.id && <Badge tone="primary">Active</Badge>}
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-faint">{workspace.memberCount} members · {workspace.projectCount} projects · your role {roleLabel(workspace.role)}</p>
                  </div>
                  <Button size="sm" variant={workspace.id === activeWorkspace.id ? "secondary" : "ghost"} onClick={() => { setTab("workspace"); if (workspace.id !== activeWorkspace.id) void switchWorkspace(workspace.id); }}>
                    {workspace.id === activeWorkspace.id ? <Check className="h-3.5 w-3.5" /> : "Manage"}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : (
        <div className="mt-5 space-y-5">
          <Card>
            <CardHeader title="Workspace settings" description="Name and description are visible to every member. Only owners, admins and managers can edit them." />
            <form onSubmit={saveWorkspace} className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Workspace name" htmlFor="ws-settings-name">
                  <Input id="ws-settings-name" value={settings.name} onChange={(event) => setSettings({ ...settings, name: event.target.value })} disabled={!canManageWorkspace} />
                </Field>
                <Field label="Workspace id" htmlFor="ws-settings-id">
                  <Input id="ws-settings-id" value={activeWorkspace.id} readOnly className="font-mono" />
                </Field>
              </div>
              <Field label="Description" htmlFor="ws-settings-description" hint="What this workspace delivers and who it serves.">
                <Textarea id="ws-settings-description" value={settings.description} onChange={(event) => setSettings({ ...settings, description: event.target.value })} disabled={!canManageWorkspace} />
              </Field>
              {canManageWorkspace && <div className="flex justify-end"><Button type="submit" variant="primary" loading={busy === "settings"}><Save className="h-3.5 w-3.5" /> Save settings</Button></div>}
            </form>
          </Card>

          <Card>
            <CardHeader
              title="Workspace members"
              description="Only workspace membership (or inherited organization membership) grants access. API checks remain authoritative."
              actions={canManageWorkspace ? <Button size="sm" variant="secondary" onClick={() => { setActionError(null); setAddOpen("workspace"); }}><UserPlus className="h-3.5 w-3.5" /> Add member</Button> : undefined}
            />
            {members.loading ? (
              <LoadingBlock label="Loading workspace members" />
            ) : wsMembers.length === 0 ? (
              <EmptyState icon={UsersRound} title="No explicit workspace members" description="Organization membership may still grant access. Add a workspace member for an explicit role." compact />
            ) : (
              <Table>
                <thead><tr><Th>Member</Th><Th>Title</Th><Th>Workspace role</Th><Th>Joined</Th><Th><span className="sr-only">Actions</span></Th></tr></thead>
                <tbody>
                  {wsMembers.map((member) => (
                    <tr key={member.userId}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={member.name} color={member.avatarColor} size="sm" />
                          <div>
                            <p className="text-xs font-semibold text-ink">{member.name}</p>
                            <p className="text-[10px] text-ink-faint">{member.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td><span className="text-xs text-ink-muted">{member.title || "—"}</span></Td>
                      <Td>
                        {hasRole(role, "admin") ? (
                          <Select
                            value={member.role}
                            onChange={(event) => void changeWsRole(member, event.target.value as WorkspaceRole)}
                            disabled={busy === `ws-${member.userId}` || (member.role === "owner" && role !== "owner")}
                            className="w-auto min-w-[130px] py-1 text-xs"
                            aria-label={`Workspace role for ${member.name}`}
                          >
                            {member.role === "owner" && <option value="owner">Owner</option>}
                            {ROLES.map((candidate) => <option key={candidate} value={candidate}>{roleLabel(candidate)}</option>)}
                          </Select>
                        ) : (
                          <Badge tone={member.role === "owner" ? "primary" : "neutral"}>{roleLabel(member.role)}</Badge>
                        )}
                      </Td>
                      <Td><span className="text-[10px] text-ink-faint">{member.createdAt ? formatDate(member.createdAt) : "—"}</span></Td>
                      <Td>
                        {hasRole(role, "admin") && (
                          <Button size="sm" variant="ghost" aria-label={`Remove ${member.name}`} onClick={() => void removeMember(member)} loading={busy === `remove-${member.userId}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader title="Workspace access model" description="How project and workspace roles combine." />
            <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Owner", "Full workspace control, plan approval and member administration."],
                ["Admin", "Workspace administration and plan approval; ownership transfer is restricted."],
                ["Manager", "Project management and plan approval; settings access is narrower."],
                ["Member", "Contribute to projects and tickets; cannot approve plan versions."],
                ["Viewer", "Read-only access. The API rejects write attempts even if a control is exposed."],
              ].map(([label, text]) => (
                <div key={label} className="rounded-md border border-line bg-surface-muted p-3">
                  <p className="text-xs font-semibold text-ink">{label}</p>
                  <p className="mt-1 text-[10px] leading-4 text-ink-muted">{text}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-5 py-3">
              <p className="text-[10px] leading-4 text-ink-faint">Project membership is primary for project data. Workspace and organization roles provide secondary access. Approval is limited to owner and PM project roles.</p>
            </div>
          </Card>
        </div>
      )}

      <Modal
        open={addOpen === "org" || addOpen === "workspace"}
        onOpenChange={(open) => { if (!open) setAddOpen(null); }}
        title={addOpen === "org" ? "Add organization member" : "Add workspace member"}
        description={addOpen === "org" ? "Add a person to the organization. They may inherit access to workspaces based on their organization role." : "Add a person to this workspace with an explicit workspace role."}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(null)}>Cancel</Button>
            <Button variant="primary" onClick={(event) => void addMember(event as unknown as React.FormEvent)} loading={busy === "add-member"} disabled={!memberForm.email.trim()}><MailPlus className="h-3.5 w-3.5" /> Add member</Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={addMember}>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          <Field label="Email address" htmlFor="member-email" required hint="If the account does not exist, it is created in pending status with no known password.">
            <Input id="member-email" type="email" value={memberForm.email} onChange={(event) => setMemberForm({ ...memberForm, email: event.target.value })} required />
          </Field>
          <Field label="Role" htmlFor="member-role">
            <Select id="member-role" value={memberForm.role} onChange={(event) => setMemberForm({ ...memberForm, role: event.target.value as WorkspaceRole })}>
              {ROLES.map((candidate) => <option key={candidate} value={candidate}>{roleLabel(candidate)}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>

      <Modal
        open={addOpen === "new-org"}
        onOpenChange={(open) => { if (!open) setAddOpen(null); }}
        title="New organization"
        description="Create a separate organization with its own first workspace. You become its owner."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(null)}>Cancel</Button>
            <Button variant="primary" onClick={(event) => void createOrganization(event as unknown as React.FormEvent)} loading={busy === "new-org"} disabled={orgForm.name.trim().length < 2}><Building2 className="h-3.5 w-3.5" /> Create organization</Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={createOrganization}>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          <Field label="Organization name" htmlFor="new-org-name" required>
            <Input id="new-org-name" value={orgForm.name} onChange={(event) => setOrgForm({ ...orgForm, name: event.target.value })} placeholder="Acme Delivery" required />
          </Field>
          <Field label="First workspace name" htmlFor="new-org-workspace" hint="Defaults to the organization name plus “workspace”.">
            <Input id="new-org-workspace" value={orgForm.workspaceName} onChange={(event) => setOrgForm({ ...orgForm, workspaceName: event.target.value })} placeholder="Platform" />
          </Field>
          <Field label="Description" htmlFor="new-org-description">
            <Textarea id="new-org-description" value={orgForm.description} onChange={(event) => setOrgForm({ ...orgForm, description: event.target.value })} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={addOpen === "new-workspace"}
        onOpenChange={(open) => { if (!open) setAddOpen(null); }}
        title="New workspace"
        description={`Create a workspace inside ${activeOrganization.name}. You become its owner.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(null)}>Cancel</Button>
            <Button variant="primary" onClick={(event) => void createWorkspace(event as unknown as React.FormEvent)} loading={busy === "new-workspace"} disabled={workspaceForm.name.trim().length < 2}><Plus className="h-3.5 w-3.5" /> Create workspace</Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={createWorkspace}>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          <Field label="Workspace name" htmlFor="new-workspace-name" required>
            <Input id="new-workspace-name" value={workspaceForm.name} onChange={(event) => setWorkspaceForm({ ...workspaceForm, name: event.target.value })} placeholder="Payments Platform" required />
          </Field>
          <Field label="Description" htmlFor="new-workspace-description">
            <Textarea id="new-workspace-description" value={workspaceForm.description} onChange={(event) => setWorkspaceForm({ ...workspaceForm, description: event.target.value })} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
