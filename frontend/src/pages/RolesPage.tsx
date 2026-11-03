import { useState } from "react";
import {
  Check,
  CheckCircle2,
  LockKeyhole,
  Minus,
  ShieldCheck,
  UserCog,
  UsersRound,
  XCircle,
} from "lucide-react";
import type { WorkspaceMember, WorkspaceRole } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { hasRole, roleLabel, titleCase } from "../lib/format";
import {
  Alert,
  Avatar,
  Badge,
  Card,
  CardHeader,
  LoadingBlock,
  PageHeader,
  Select,
  Table,
  Td,
  Th,
  StatCard,
} from "../components/ui";

const ROLES: WorkspaceRole[] = ["owner", "admin", "manager", "member", "viewer"];

const CAPABILITIES: Array<{ label: string; description: string; allowed: WorkspaceRole[] }> = [
  { label: "Read workspace data", description: "Projects, tasks, roadmaps, tickets and plans in accessible projects.", allowed: ROLES },
  { label: "Contribute to projects", description: "Create and edit tasks, tickets, documents, meetings and discussions.", allowed: ["owner", "admin", "manager", "member"] },
  { label: "Create projects and plans", description: "Generate an AI plan draft and approve the baseline that creates a project.", allowed: ["owner", "admin", "manager", "member"] },
  { label: "Review RippleMap", description: "Simulate options and inspect impact without necessarily approving.", allowed: ROLES },
  { label: "Approve plan changes", description: "Commit an accepted or split option and create an immutable plan version.", allowed: ["owner", "admin", "manager"] },
  { label: "Manage workspace members", description: "Add, remove and change workspace roles.", allowed: ["owner", "admin"] },
  { label: "Manage workspace settings", description: "Rename the workspace, update its description and onboarding context.", allowed: ["owner", "admin", "manager"] },
  { label: "Read audit events", description: "View security audit events scoped to this workspace.", allowed: ["owner", "admin", "manager"] },
  { label: "Manage organization", description: "Add organization members and change organization-level roles.", allowed: ["owner", "admin"] },
  { label: "Transfer ownership", description: "Grant the owner role. The last workspace owner cannot be demoted.", allowed: ["owner"] },
];

export function RolesPage() {
  const { activeWorkspace, activeOrganization, role } = useWorkspace();
  const { toast } = useToast();
  const workspaceId = activeWorkspace?.id ?? "";
  const { data, loading, error, reload } = useAsync<{ members: WorkspaceMember[] }>(
    () => api.workspaces.members(workspaceId),
    [workspaceId],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const members = data?.members ?? [];
  const canAssign = hasRole(role, "admin");

  const changeRole = async (member: WorkspaceMember, next: WorkspaceRole) => {
    if (!workspaceId || member.role === next) return;
    setBusy(member.userId);
    setActionError(null);
    try {
      await api.workspaces.updateMember(workspaceId, member.userId, next);
      await reload();
      toast(`${member.name} is now ${roleLabel(next)}.`, "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The role could not be changed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={`${activeOrganization?.name ?? "Organization"} · administration`}
        title="Roles & Permissions"
        description="What each workspace role can do, and where project membership takes precedence. These rules are enforced server-side; hiding a navigation item is not an authorization control."
        actions={<Badge tone="primary"><ShieldCheck className="h-3.5 w-3.5" /> Server-enforced RBAC</Badge>}
        meta={
          <>
            <span>Workspace: {activeWorkspace?.name ?? "—"}</span>
            <span>· Your role: {roleLabel(role)}</span>
            <span>· Project approval: owner or PM only</span>
          </>
        }
      />

      {actionError && <div className="mb-4"><Alert tone="danger" title="Role change failed">{actionError}</Alert></div>}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Workspace roles" value="5" hint="Owner, admin, manager, member, viewer" icon={ShieldCheck} tone="primary" />
        <StatCard label="Explicit members" value={members.length} hint="Organization members may inherit access" icon={UsersRound} tone="neutral" />
        <StatCard label="Your effective role" value={roleLabel(role)} hint="Highest of workspace and organization roles" icon={UserCog} tone="sage" />
        <StatCard label="Approval authority" value={hasRole(role, "manager") ? "Review + approve" : "Review only"} hint="Plan versions require owner or PM project role" icon={LockKeyhole} tone={hasRole(role, "manager") ? "sage" : "amber"} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader title="Capability matrix" description="Direct workspace role capabilities. A project member role can grant project-specific contribution, but cannot grant approval beyond the project role rules." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead>
                <tr>
                  <th className="table-head border-b border-line">Capability</th>
                  {ROLES.map((candidate) => <th key={candidate} className="table-head border-b border-line text-center">{roleLabel(candidate)}</th>)}
                </tr>
              </thead>
              <tbody>
                {CAPABILITIES.map((capability) => (
                  <tr key={capability.label}>
                    <td className="table-cell border-b border-line-faint">
                      <p className="text-xs font-semibold text-ink">{capability.label}</p>
                      <p className="mt-0.5 max-w-md text-[10px] leading-4 text-ink-faint">{capability.description}</p>
                    </td>
                    {ROLES.map((candidate) => {
                      const allowed = capability.allowed.includes(candidate);
                      return (
                        <td key={candidate} className="table-cell border-b border-line-faint text-center">
                          {allowed ? <CheckCircle2 className="mx-auto h-4 w-4 text-sage-500" aria-label="Allowed" /> : <Minus className="mx-auto h-4 w-4 text-line-strong" aria-label="Not allowed" />}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line px-5 py-3">
            <p className="text-[10px] leading-4 text-ink-faint">
              The API independently authorizes every request. A viewer who manually calls a write endpoint receives 403. Project data additionally checks project membership and treats owner/admin as owner, manager as PM, member as member and viewer as viewer.
            </p>
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Decision authority" description="Approval is intentionally narrower than contribution." />
            <ul className="divide-y divide-line-faint">
              {[
                ["Create a ticket", "Member or higher", true],
                ["Analyse a ticket", "Member or higher", true],
                ["Simulate RippleMap", "Any workspace member", true],
                ["Approve plan change", "Project owner or PM", true],
                ["Reject or clarify", "Project owner or PM", true],
                ["Delete plan history", "Never — immutable", false],
              ].map(([action, who, allowed]) => (
                <li key={String(action)} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <p className="text-xs font-semibold text-ink">{action}</p>
                    <p className="mt-0.5 text-[10px] text-ink-faint">{who}</p>
                  </div>
                  {allowed ? <Check className="mt-0.5 h-4 w-4 text-sage-500" /> : <XCircle className="mt-0.5 h-4 w-4 text-danger-500" />}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Role hierarchy" description="Organization roles and workspace roles combine; the higher effective role is used for workspace access." />
            <ol className="space-y-2 p-5">
              {ROLES.slice().reverse().map((candidate, index) => (
                <li key={candidate} className="flex items-center gap-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-muted font-mono text-[10px] text-ink-muted">{ROLES.length - index}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-ink">{roleLabel(candidate)}</p>
                    <p className="text-[10px] text-ink-faint">{candidate === "owner" ? "Ultimate workspace authority" : candidate === "admin" ? "Administration, not ownership transfer" : candidate === "manager" ? "Delivery management and approval" : candidate === "member" ? "Contribution without approval" : "Read-only"}</p>
                  </div>
                  {candidate === role && <Badge tone="primary">You</Badge>}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Workspace role assignment"
          description={canAssign ? "Only owners and admins can change workspace roles. Ownership can only be granted by an owner." : "You can view role assignments. Only owners and admins can change them."}
          actions={<Badge tone="outline">{members.length} members</Badge>}
        />
        {loading ? (
          <LoadingBlock label="Loading role assignments" />
        ) : error ? (
          <p className="px-5 py-4 text-xs text-danger-600">{error}</p>
        ) : (
          <Table>
            <thead><tr><Th>Member</Th><Th>Current role</Th><Th>Change role</Th><Th>Access source</Th></tr></thead>
            <tbody>
              {members.map((member) => (
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
                  <Td><Badge tone={member.role === "owner" ? "primary" : member.role === "viewer" ? "neutral" : "outline"}>{roleLabel(member.role)}</Badge></Td>
                  <Td>
                    {canAssign ? (
                      <Select
                        value={member.role}
                        onChange={(event) => void changeRole(member, event.target.value as WorkspaceRole)}
                        disabled={busy === member.userId || (member.role === "owner" && role !== "owner")}
                        className="w-auto min-w-[130px] py-1 text-xs"
                        aria-label={`Workspace role for ${member.name}`}
                      >
                        {member.role === "owner" && <option value="owner">Owner</option>}
                        {ROLES.filter((candidate) => candidate !== "owner").map((candidate) => <option key={candidate} value={candidate}>{roleLabel(candidate)}</option>)}
                      </Select>
                    ) : (
                      <span className="text-[10px] text-ink-faint">Owner/admin only</span>
                    )}
                  </Td>
                  <Td><span className="text-[10px] text-ink-muted">Explicit workspace membership</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="border-t border-line px-5 py-3 text-[10px] text-ink-faint">
          Project-specific membership is managed through project access rules and remains authoritative for project data. {titleCase("owner")} and {titleCase("admin")} workspace roles map to project owner; manager maps to PM.
        </div>
      </Card>
    </div>
  );
}
