import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Loader2,
  Rocket,
  UsersRound,
  Wand2,
} from "lucide-react";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { cn } from "../lib/format";
import { Alert, Button, Field, Input, PageHeader, Select, Textarea } from "../components/ui";

const STEPS = [
  { title: "Workspace", description: "Name the delivery workspace.", icon: Building2 },
  { title: "Delivery context", description: "Capacity, stack and constraints.", icon: Wand2 },
  { title: "Team", description: "Invite the first collaborators.", icon: UsersRound },
  { title: "Review", description: "Confirm and activate.", icon: CheckCircle2 },
];

interface OnboardingState {
  name: string;
  description: string;
  capacityPersonDays: string;
  teamSize: string;
  technology: string;
  nonNegotiables: string;
  releasePolicy: string;
  tone: string;
  invites: string;
}

export function OnboardingPage() {
  const { activeWorkspace, activeOrganization, refresh, switchWorkspace, canManageWorkspace } = useWorkspace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const existingStage = activeWorkspace?.onboardingStage ?? 1;
  const [step, setStep] = useState(Math.min(Math.max(existingStage - 1, 0), 3));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invites, setInvites] = useState<Array<{ email: string; role: "member" | "manager" | "viewer" }>>([]);
  const [state, setState] = useState<OnboardingState>({
    name: activeWorkspace?.name ?? "",
    description: activeWorkspace?.description ?? "",
    capacityPersonDays: "260",
    teamSize: "5",
    technology: "",
    nonNegotiables: "",
    releasePolicy: "Every release needs a rollback plan and a named on-call owner.",
    tone: "concise",
    invites: "",
  });

  const progress = useMemo(() => ((step + 1) / STEPS.length) * 100, [step]);

  const persist = async (stage: number, activate = false) => {
    if (!activeWorkspace) return;
    setSaving(true);
    setError(null);
    try {
      await api.workspaces.update(activeWorkspace.id, {
        name: state.name.trim(),
        description: state.description.trim(),
        onboardingStage: activate ? 8 : Math.max(stage + 1, 1),
        aiContext: {
          onboarding: {
            capacityPersonDays: Number(state.capacityPersonDays) || null,
            teamSize: Number(state.teamSize) || null,
            technology: state.technology,
            nonNegotiables: state.nonNegotiables,
          },
          releasePolicy: state.releasePolicy,
          tone: state.tone,
        },
      });
      if (invites.length > 0) {
        for (const invite of invites) {
          await api.workspaces.addMember(activeWorkspace.id, { email: invite.email, role: invite.role });
        }
        setInvites([]);
      }
      await refresh();
      if (activate) {
        setComplete(true);
        toast("Workspace activated. Your team can start planning.", "success");
      }
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Saved progress could not be updated.");
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (step === 0 && state.name.trim().length < 2) {
      setError("Give the workspace a name of at least two characters.");
      return;
    }
    if (step < STEPS.length - 1) {
      await persist(step);
      setStep(step + 1);
      return;
    }
    await persist(step, true);
  };

  if (!activeWorkspace) {
    return <NoWorkspaceSetup />;
  }

  if (!canManageWorkspace) {
    return (
      <div className="mx-auto max-w-2xl py-10">
        <Alert tone="warning" title="Onboarding is managed by workspace owners and managers">
          Your role does not allow changing workspace configuration. Ask an owner or manager to complete setup.
        </Alert>
        <Link to="/" className="btn-secondary mt-4 inline-flex">
          Return to overview
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow={
          <>
            <Building2 className="h-3.5 w-3.5" />
            {activeOrganization?.name} · onboarding
          </>
        }
        title={complete ? "Workspace activated" : "Set up your delivery workspace"}
        description={
          complete
            ? "Setup is complete. Project and AI context will use these settings."
            : "Four short steps establish the context that RippleMap and the AI assistant use. Progress is saved after each step."
        }
        actions={
          <Link to="/" className="btn-ghost">
            Skip for now <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      <div className="mb-6">
        <div className="mb-2 flex justify-between text-xs text-ink-muted">
          <span>Step {step + 1} of {STEPS.length}</span>
          <span className="font-mono">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${progress}%` }} />
        </div>
        <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const isDone = index < step || complete;
            return (
              <li
                key={item.title}
                className={cn(
                  "flex items-start gap-2 rounded-md border p-2.5",
                  index === step && !complete ? "border-primary-200 bg-primary-50" : "border-line bg-surface",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    isDone ? "bg-sage-500 text-white" : index === step && !complete ? "bg-primary-500 text-white" : "bg-surface-sunken text-ink-faint",
                  )}
                >
                  {isDone ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-ink">{item.title}</span>
                  <span className="block text-[10px] leading-4 text-ink-faint">{item.description}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="app-card">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-ink">{STEPS[step]!.title}</h2>
          <p className="mt-0.5 text-xs text-ink-muted">{STEPS[step]!.description}</p>
        </div>
        <div className="space-y-4 p-5">
          {error && <Alert tone="danger">{error}</Alert>}

          {step === 0 && (
            <>
              <Field label="Workspace name" htmlFor="ws-name" required>
                <Input
                  id="ws-name"
                  value={state.name}
                  onChange={(event) => setState({ ...state, name: event.target.value })}
                  placeholder="Platform Delivery"
                />
              </Field>
              <Field
                label="What does this workspace deliver?"
                htmlFor="ws-description"
                hint="One or two sentences. This context is shown to collaborators and included in AI prompts."
              >
                <Textarea
                  id="ws-description"
                  value={state.description}
                  onChange={(event) => setState({ ...state, description: event.target.value })}
                  placeholder="Commerce relaunch, payments reliability and platform operations."
                />
              </Field>
              <Alert tone="info" title="Organization">
                {activeOrganization?.name ?? "Your organization"} — organization and role settings are managed in
                Organization & Workspaces after onboarding.
              </Alert>
            </>
          )}

          {step === 1 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Stated capacity (person-days)" htmlFor="capacity" hint="Used only when a plan supplies capacity data.">
                  <Input
                    id="capacity"
                    type="number"
                    min="1"
                    value={state.capacityPersonDays}
                    onChange={(event) => setState({ ...state, capacityPersonDays: event.target.value })}
                  />
                </Field>
                <Field label="Team size" htmlFor="team-size">
                  <Input
                    id="team-size"
                    type="number"
                    min="1"
                    value={state.teamSize}
                    onChange={(event) => setState({ ...state, teamSize: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Technology and delivery stack" htmlFor="tech">
                <Input
                  id="tech"
                  value={state.technology}
                  onChange={(event) => setState({ ...state, technology: event.target.value })}
                  placeholder="React, TypeScript, Node.js, PostgreSQL"
                />
              </Field>
              <Field label="Non-negotiables" htmlFor="nonneg" hint="Release gates, compliance constraints or policies that must not be relaxed.">
                <Textarea
                  id="nonneg"
                  value={state.nonNegotiables}
                  onChange={(event) => setState({ ...state, nonNegotiables: event.target.value })}
                  placeholder="No duplicate payment capture. Every release needs a rollback plan."
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Release policy" htmlFor="release-policy">
                  <Input
                    id="release-policy"
                    value={state.releasePolicy}
                    onChange={(event) => setState({ ...state, releasePolicy: event.target.value })}
                  />
                </Field>
                <Field label="Assistant tone" htmlFor="tone">
                  <Select id="tone" value={state.tone} onChange={(event) => setState({ ...state, tone: event.target.value })}>
                    <option value="concise">Concise</option>
                    <option value="detailed">Detailed</option>
                    <option value="customer-first">Customer-first</option>
                  </Select>
                </Field>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <Field
                label="Invite a collaborator by email"
                htmlFor="invite"
                hint="If the email is not registered, a pending account is created and can be activated later. You can skip this step."
              >
                <div className="flex gap-2">
                  <Input
                    id="invite"
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="teammate@company.com"
                  />
                  <Button
                    type="button"
                    onClick={() => {
                      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(inviteEmail)) {
                        setError("Enter a valid email address before adding the invite.");
                        return;
                      }
                      setInvites([...invites, { email: inviteEmail.trim(), role: "member" }]);
                      setInviteEmail("");
                      setError(null);
                    }}
                  >
                    Add
                  </Button>
                </div>
              </Field>
              {invites.length > 0 ? (
                <ul className="divide-y divide-line-faint rounded-md border border-line">
                  {invites.map((invite) => (
                    <li key={invite.email} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="text-xs text-ink">{invite.email}</span>
                      <Select
                        className="w-32 py-1 text-xs"
                        value={invite.role}
                        onChange={(event) =>
                          setInvites(
                            invites.map((item) =>
                              item.email === invite.email
                                ? { ...item, role: event.target.value as typeof invite.role }
                                : item,
                            ),
                          )
                        }
                      >
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                        <option value="viewer">Viewer</option>
                      </Select>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="rounded-md border border-dashed border-line-strong bg-surface-muted px-4 py-8 text-center text-xs text-ink-muted">
                  No invites yet. Team management is also available in Organization & Workspaces.
                </p>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <dl className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Workspace", state.name],
                  ["Description", state.description || "Not set"],
                  ["Capacity", `${state.capacityPersonDays} person-days`],
                  ["Team size", state.teamSize],
                  ["Technology", state.technology || "Not set"],
                  ["Release policy", state.releasePolicy || "Not set"],
                  ["Invites", invites.length ? `${invites.length} pending` : "None"],
                  ["AI mode", "Configured server-side; no key is exposed to the browser"],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-line bg-surface-muted p-3">
                    <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">{label}</dt>
                    <dd className="mt-1 text-sm text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <Alert tone="info" title="What happens when you activate">
                The workspace is marked configured for onboarding. RippleMap uses project data, not this
                form, to compute impact. AI context is treated as preference data, never as observed evidence.
              </Alert>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0 || saving || complete}
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </Button>
          {complete ? (
            <div className="flex gap-2">
              <Link to="/organization" className="btn-secondary">
                Organization settings
              </Link>
              <Link to="/projects" className="btn-primary">
                Go to projects <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <Button type="button" variant="primary" onClick={() => void next()} loading={saving}>
              {step === STEPS.length - 1 ? (
                <>
                  <Rocket className="h-3.5 w-3.5" /> Activate workspace
                </>
              ) : (
                <>
                  Save and continue <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {activeWorkspace && (
        <p className="mt-3 text-center text-[10px] text-ink-faint">
          Saved progress is stored on the workspace. You can return to onboarding at any time.
        </p>
      )}
    </div>
  );
}

function NoWorkspaceSetup() {
  const { refresh, switchWorkspace } = useWorkspace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.organizations.create({
        name: name.trim(),
        workspaceName: workspaceName.trim() || `${name.trim()} workspace`,
      });
      await switchWorkspace(result.workspace.id);
      await refresh();
      toast("Organization and workspace created.", "success");
      navigate("/onboarding");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Organization creation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-lg py-10">
      <div className="app-card p-6">
        <Building2 className="h-6 w-6 text-primary-500" />
        <h1 className="mt-3 text-xl font-semibold text-ink">Create your organization</h1>
        <p className="mt-1 text-sm text-ink-muted">
          An organization contains workspaces; each workspace contains projects and teams.
        </p>
        <form className="mt-5 space-y-4" onSubmit={create}>
          <Field label="Organization name" htmlFor="org-name" required>
            <Input id="org-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </Field>
          <Field label="First workspace name" htmlFor="ws-name" hint="Defaults to “Organization name workspace”.">
            <Input id="ws-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Create organization <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </form>
      </div>
    </div>
  );
}
