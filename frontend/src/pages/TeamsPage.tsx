import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ShieldCheck, UsersRound } from "lucide-react";
import type { Team, WorkspaceMember } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError, type WorkspaceWorkload } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { cn, roleLabel } from "../lib/format";
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
  ProgressBar,
  Select,
  StatCard,
} from "../components/ui";

interface TeamData {
  workload: WorkspaceWorkload[];
  members: WorkspaceMember[];
  teams: Team[];
}

export function TeamsPage() {
  const { activeWorkspace, canManageWorkspace, users, role } = useWorkspace();
  const { toast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [teamDescription, setTeamDescription] = useState("");
  const [leadId, setLeadId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addTeam, setAddTeam] = useState<Team | null>(null);
  const [addUserId, setAddUserId] = useState("");

  const { data, loading, error: loadError, reload } = useAsync<TeamData | null>(
    async () => {
      if (!activeWorkspace) return null;
      const [workload, members, teams] = await Promise.all([
        api.workspaces.workload(activeWorkspace.id),
        api.workspaces.members(activeWorkspace.id),
        api.workspaces.teams(activeWorkspace.id),
      ]);
      return { workload: workload.workload, members: members.members, teams: teams.teams };
    },
    [activeWorkspace?.id],
  );

  const summary = useMemo(() => {
    const workload = data?.workload ?? [];
    const open = workload.reduce((sum, member) => sum + member.openTasks, 0);
    const blocked = workload.reduce((sum, member) => sum + member.blockedTasks, 0);
    const unassigned = data?.members.filter((member) => !workload.some((row) => row.userId === member.userId) || (workload.find((row) => row.userId === member.userId)?.openTasks ?? 0) === 0) ?? [];
    return { open, blocked, unassigned };
  }, [data]);

  const createTeam = async () => {
    if (!activeWorkspace) return;
    if (teamName.trim().length < 2) {
      setError("Team name must be at least two characters.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.workspaces.createTeam(activeWorkspace.id, {
        name: teamName.trim(),
        description: teamDescription.trim(),
        leadId: leadId || null,
      });
      await reload();
      setCreateOpen(false);
      setTeamName("");
      setTeamDescription("");
      setLeadId("");
      toast("Team created.", "success");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Team creation failed.");
    } finally {
      setSaving(false);
    }
  };

  const addMember = async () => {
    if (!activeWorkspace || !addTeam || !addUserId) return;
    setSaving(true);
    try {
      await api.workspaces.addTeamMember(activeWorkspace.id, addTeam.id, addUserId);
      await reload();
      setAddTeam(null);
      setAddUserId("");
      toast("Team member added.", "success");
    } catch (cause) {
      toast(cause instanceof ApiError ? cause.message : "Member could not be added.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!activeWorkspace) {
    return <Alert tone="warning">Select a workspace to view teams.</Alert>;
  }

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace.name}
        title="Teams & Workload"
        description="Cross-project task estimates by member and team structure. Workload uses planned task estimates; it never invents individual capacity."
        actions={
          canManageWorkspace ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New team
            </Button>
          ) : (
            <Badge tone="neutral"><ShieldCheck className="h-3 w-3" /> {roleLabel(role)} access</Badge>
          )
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Workspace members" value={data?.members.length ?? 0} hint="Everyone with access to this workspace" icon={UsersRound} tone="primary" />
        <StatCard label="Teams" value={data?.teams.length ?? 0} hint="Structured groups inside the workspace" icon={UsersRound} />
        <StatCard label="Open assigned tasks" value={summary.open} hint="Counted from current task board state" icon={UsersRound} tone={summary.open > 0 ? "primary" : "sage"} />
        <StatCard label="Blocked tasks" value={summary.blocked} hint="Work explicitly marked blocked" icon={ShieldCheck} tone={summary.blocked > 0 ? "danger" : "sage"} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <Card>
          <CardHeader
            title="Workload by member"
            description="Open task estimates, not calendar capacity. Capacity is not fabricated when the plan does not supply it."
            actions={<Link to="/organization" className="text-xs font-semibold text-primary-600 hover:underline">Manage members</Link>}
          />
          {loading ? (
            <LoadingBlock label="Loading workload" />
          ) : loadError ? (
            <div className="p-4"><ErrorBlock message={loadError} onRetry={() => void reload()} /></div>
          ) : !data?.workload.length ? (
            <EmptyState icon={UsersRound} title="No assigned work" description="Assign tasks to workspace members to see estimates here." compact />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th className="table-head border-b border-line">Member</th>
                    <th className="table-head border-b border-line">Role</th>
                    <th className="table-head border-b border-line">Open tasks</th>
                    <th className="table-head border-b border-line">Estimate</th>
                    <th className="table-head border-b border-line">Relative load</th>
                    <th className="table-head border-b border-line">Blocked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.workload.map((member) => {
                    const max = Math.max(...data.workload.map((row) => row.estimateDays), 1);
                    return (
                      <tr key={member.userId} className="hover:bg-surface-muted">
                        <td className="table-cell border-b border-line-faint">
                          <div className="flex items-center gap-2">
                            <Avatar name={member.name} color={member.avatarColor} size="sm" />
                            <span className="text-xs font-semibold text-ink">{member.name}</span>
                          </div>
                        </td>
                        <td className="table-cell border-b border-line-faint"><Badge tone="neutral">{roleLabel(member.role)}</Badge></td>
                        <td className="table-cell border-b border-line-faint font-mono text-xs">{member.openTasks}</td>
                        <td className="table-cell border-b border-line-faint font-mono text-xs">{member.estimateDays}d</td>
                        <td className="table-cell w-40 border-b border-line-faint">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                              <div className={cn("h-full rounded-full", member.blockedTasks > 0 ? "bg-warning-500" : "bg-primary-400")} style={{ width: `${Math.min(100, (member.estimateDays / max) * 100)}%` }} />
                            </div>
                            <span className="w-8 text-right font-mono text-[9px] text-ink-faint">{Math.round((member.estimateDays / max) * 100)}%</span>
                          </div>
                        </td>
                        <td className="table-cell border-b border-line-faint">
                          {member.blockedTasks > 0 ? <Badge tone="danger">{member.blockedTasks}</Badge> : <span className="text-ink-faint">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-line px-4 py-2.5 text-[10px] text-ink-faint">
            Relative load compares members within this table; it is not a utilisation percentage or a capacity breach.
          </p>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Teams" description="Teams group members; project assignment remains explicit." />
            {loading ? (
              <LoadingBlock label="Loading teams" />
            ) : !data?.teams.length ? (
              <EmptyState icon={UsersRound} title="No teams" description="Create a team to group members for planning and workload review." compact action={canManageWorkspace ? <Button onClick={() => setCreateOpen(true)}>Create team</Button> : undefined} />
            ) : (
              <ul className="divide-y divide-line-faint">
                {data.teams.map((team) => (
                  <li key={team.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-ink">{team.name}</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{team.description || "No description"}</p>
                        <p className="mt-1 text-[10px] text-ink-faint">
                          {team.memberCount} members{team.leadName ? ` · Lead ${team.leadName}` : ""}
                        </p>
                      </div>
                      {canManageWorkspace && (
                        <Button size="sm" variant="ghost" onClick={() => { setAddTeam(team); setAddUserId(""); }}>Add</Button>
                      )}
                    </div>
                    {team.members.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {team.members.map((member) => (
                          <span key={member.userId} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted py-0.5 pl-0.5 pr-2 text-[10px] text-ink-muted">
                            <Avatar name={member.name} color={member.avatarColor} size="xs" />
                            {member.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Unassigned members" description="Members with no open assigned task estimates." />
            {summary.unassigned.length === 0 ? (
              <p className="px-4 py-5 text-xs text-ink-muted">Every member has at least one open assigned task.</p>
            ) : (
              <ul className="divide-y divide-line-faint">
                {summary.unassigned.map((member) => (
                  <li key={member.userId} className="flex items-center gap-2 px-4 py-2.5">
                    <Avatar name={member.name} color={member.avatarColor} size="sm" />
                    <div>
                      <p className="text-xs font-semibold text-ink">{member.name}</p>
                      <p className="text-[10px] text-ink-faint">{member.title || roleLabel(member.role)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-5">
        <Alert tone="info" title="Capacity is evidence-based">
          MIRAIWERK does not infer available hours from a person’s role or title. RippleMap capacity utilisation is
          displayed only when the project plan supplies stated capacity. Workload here is a planning aid, not a
          performance metric.
        </Alert>
      </div>

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create team"
        description="Teams group workspace members. They do not grant project access by themselves."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void createTeam()}>Create team</Button>
          </>
        }
      >
        <div className="space-y-3">
          {error && <Alert tone="danger">{error}</Alert>}
          <Field label="Team name" htmlFor="team-name" required>
            <Input id="team-name" value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Payments" />
          </Field>
          <Field label="Description" htmlFor="team-description">
            <Input id="team-description" value={teamDescription} onChange={(event) => setTeamDescription(event.target.value)} />
          </Field>
          <Field label="Lead" htmlFor="team-lead">
            <Select id="team-lead" value={leadId} onChange={(event) => setLeadId(event.target.value)}>
              <option value="">No lead</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}
            </Select>
          </Field>
        </div>
      </Modal>

      <Modal
        open={addTeam !== null}
        onOpenChange={(open) => { if (!open) setAddTeam(null); }}
        title={`Add member to ${addTeam?.name ?? "team"}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddTeam(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!addUserId} onClick={() => void addMember()}>Add member</Button>
          </>
        }
      >
        <Field label="Workspace member" htmlFor="team-member">
          <Select id="team-member" value={addUserId} onChange={(event) => setAddUserId(event.target.value)}>
            <option value="">Select a member</option>
            {(data?.members ?? [])
              .filter((member) => !addTeam?.members.some((existing) => existing.userId === member.userId))
              .map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
          </Select>
        </Field>
      </Modal>
    </div>
  );
}
