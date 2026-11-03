import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Flag,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import type { GeneratedPlan, PlanDraft, TaskDraft } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { formatDate, formatShortDate, hasRole, priorityTone, titleCase } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  PriorityBadge,
  Select,
  Spinner,
  Textarea,
} from "../components/ui";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

interface BriefForm {
  name: string;
  goal: string;
  description: string;
  startDate: string;
  targetDate: string;
  team: string;
  capacityPersonDays: string;
  technology: string;
  nonNegotiables: string;
}

const EMPTY: BriefForm = {
  name: "",
  goal: "",
  description: "",
  startDate: isoToday(),
  targetDate: "",
  team: "",
  capacityPersonDays: "",
  technology: "",
  nonNegotiables: "",
};

const EXAMPLE: BriefForm = {
  name: "Merchant onboarding refresh",
  goal: "Cut merchant activation time from nine days to two without weakening compliance checks.",
  description:
    "Merchants currently submit KYC documents by email, then wait for an operations analyst to re-key data into three systems. Design a self-serve onboarding flow with document capture, status tracking and an internal review queue. Compliance requires immutable evidence of every decision. The operations team has four analysts; no new headcount is approved. We do not yet know the current drop-off rate or the legal retention period for rejected documents.",
  startDate: isoToday(),
  targetDate: "",
  team: "2 frontend, 2 backend, 1 designer, 1 operations analyst (part-time)",
  capacityPersonDays: "180",
  technology: "React, Node.js, PostgreSQL, existing KYC vendor API",
  nonNegotiables: "No merchant can be activated before a compliance decision is recorded.",
};

export function AIPlanGeneratorPage() {
  const { activeWorkspace, aiMode, role } = useWorkspace();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState<BriefForm>(EMPTY);
  const [generated, setGenerated] = useState<GeneratedPlan | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  const totalEstimate = useMemo(
    () => draft?.tasks.reduce((sum, task) => sum + task.estimateDays, 0) ?? 0,
    [draft],
  );

  const generate = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (form.goal.trim().length < 3 || form.description.trim().length < 10) {
      setError("A goal and a scope description are required. Describe what must change and what is already known.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await api.projects.generatePlan({
        name: form.name.trim() || "Untitled project",
        goal: form.goal.trim(),
        description: form.description.trim(),
        startDate: form.startDate,
        targetDate: form.targetDate || null,
        constraints: {
          team: form.team.trim() || undefined,
          capacityPersonDays: form.capacityPersonDays ? Number(form.capacityPersonDays) : undefined,
          technology: form.technology.trim() || undefined,
          nonNegotiables: form.nonNegotiables.trim() || undefined,
        },
      });
      setGenerated(result);
      setDraft(result.draft);
      toast(
        result.degraded
          ? "Plan generated with the labelled deterministic fallback."
          : `Plan drafted with ${result.provider === "gemini" ? "Gemini" : result.provider}.`,
        "success",
      );
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Plan generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const createProject = async () => {
    if (!draft) return;
    setCreating(true);
    setCreateError(null);
    try {
      const project = await api.projects.create({
        draft,
        generation: generated
          ? { provider: generated.provider, model: generated.model, degraded: generated.degraded }
          : undefined,
        constraints: {
          team: form.team.trim() || undefined,
          capacityPersonDays: form.capacityPersonDays ? Number(form.capacityPersonDays) : undefined,
          technology: form.technology.trim() || undefined,
          nonNegotiables: form.nonNegotiables.trim() || undefined,
        },
      });
      toast("Baseline approved. The project and plan v1 were created.", "success");
      navigate(`/projects/${project.project.id}`);
    } catch (cause) {
      setCreateError(cause instanceof ApiError ? cause.message : "The project could not be created.");
    } finally {
      setCreating(false);
    }
  };

  if (!activeWorkspace) {
    return <Alert tone="warning">Select a workspace before generating a plan.</Alert>;
  }

  if (!hasRole(role, "member") && draft === null) {
    // Viewers cannot create plans; the server also enforces this.
    return (
      <div>
        <PageHeader title="AI Plan Generator" description="Generate a reviewed baseline plan for a new project." />
        <Alert tone="warning" title="Ask a member, manager or owner to generate a plan">
          Your role can read plans but cannot create a new project. This restriction is enforced by the API, not just by
          hiding this page.
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={<><Sparkles className="h-3.5 w-3.5" /> {activeWorkspace.name}</>}
        title="AI Plan Generator"
        description="Describe the goal and constraints. Gemini drafts requirements, milestones, tasks and assumptions. Deterministic scheduling happens only after you approve the baseline."
        actions={
          draft ? (
            <Button variant="ghost" onClick={() => { setDraft(null); setGenerated(null); setCreateError(null); }}>
              <ArrowLeft className="h-3.5 w-3.5" /> Edit brief
            </Button>
          ) : undefined
        }
        meta={
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full ${aiMode?.usesGemini ? "bg-sage-500" : aiMode?.usesMeta ? "bg-primary-500" : "bg-warning-500"}`} />
              {aiMode?.label ?? "AI status loading"}
            </span>
            <span className="text-line-strong">·</span>
            <span>No API key is sent to the browser.</span>
          </>
        }
      />

      {!draft || !generated ? (
        <form onSubmit={generate} className="space-y-5">
          <Card>
            <CardHeader
              title="Project brief"
              description="Write what you know. Unknown facts belong in the brief, not invented assumptions."
              actions={
                <Button type="button" variant="ghost" size="sm" onClick={() => setForm(EXAMPLE)}>
                  <Wand2 className="h-3.5 w-3.5" /> Use example
                </Button>
              }
            />
            <div className="space-y-4 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Project name" htmlFor="plan-name" required>
                  <Input id="plan-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Merchant onboarding refresh" required />
                </Field>
                <Field label="Target date (optional)" htmlFor="plan-target" hint="Leave empty if the date is genuinely unknown.">
                  <Input id="plan-target" type="date" value={form.targetDate} min={form.startDate} onChange={(event) => setForm({ ...form, targetDate: event.target.value })} />
                </Field>
              </div>
              <Field label="Goal" htmlFor="plan-goal" required hint="Outcome, not activity. Include the constraint that makes it hard.">
                <Input id="plan-goal" value={form.goal} onChange={(event) => setForm({ ...form, goal: event.target.value })} placeholder="Cut activation time from nine days to two without weakening compliance." required />
              </Field>
              <Field label="Scope description" htmlFor="plan-description" required hint="Current state, desired state, evidence, unknowns and non-negotiables.">
                <Textarea id="plan-description" className="min-h-40" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Describe the workflow, users, systems, constraints and what is not yet known…" required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Start date" htmlFor="plan-start" required>
                  <Input id="plan-start" type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} required />
                </Field>
                <Field label="Stated capacity (person-days)" htmlFor="plan-capacity" hint="Optional. RippleMap uses this only as observed capacity input.">
                  <Input id="plan-capacity" type="number" min="1" max="10000" value={form.capacityPersonDays} onChange={(event) => setForm({ ...form, capacityPersonDays: event.target.value })} placeholder="180" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Team shape" htmlFor="plan-team">
                  <Input id="plan-team" value={form.team} onChange={(event) => setForm({ ...form, team: event.target.value })} placeholder="2 frontend, 2 backend, 1 designer" />
                </Field>
                <Field label="Technology" htmlFor="plan-tech">
                  <Input id="plan-tech" value={form.technology} onChange={(event) => setForm({ ...form, technology: event.target.value })} placeholder="React, Node.js, PostgreSQL" />
                </Field>
              </div>
              <Field label="Non-negotiables" htmlFor="plan-nonneg" hint="Policies that must not be relaxed by a plan change.">
                <Textarea id="plan-nonneg" value={form.nonNegotiables} onChange={(event) => setForm({ ...form, nonNegotiables: event.target.value })} placeholder="No merchant can be activated before a compliance decision is recorded." />
              </Field>
              {error && <Alert tone="danger" title="The plan was not generated">{error}</Alert>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
              <p className="max-w-lg text-[10px] leading-4 text-ink-faint">
                Generation is a draft. It does not create a project or mutate any existing plan. All AI output is validated with Zod before reaching this screen.
              </p>
              <Button type="submit" variant="primary" loading={generating}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? "Generating draft…" : "Generate plan draft"}
              </Button>
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-3">
            {[
              { icon: ShieldAlert, title: "Human approval", text: "A plan is committed only when you approve the baseline. The API enforces project creation permission." },
              { icon: Layers, title: "Immutable versions", text: "Future changes happen through ticket proposals and RippleMap decisions, producing a new immutable version." },
              { icon: FileText, title: "Visible provenance", text: "Provider, model, latency and fallback labels are preserved with the draft and project generation record." },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border border-line bg-surface p-4">
                <item.icon className="h-4 w-4 text-primary-500" />
                <p className="mt-2 text-xs font-semibold text-ink">{item.title}</p>
                <p className="mt-1 text-[11px] leading-5 text-ink-muted">{item.text}</p>
              </div>
            ))}
          </div>
        </form>
      ) : (
        <DraftReview
          generated={generated}
          draft={draft}
          onChange={setDraft}
          onCreate={() => void createProject()}
          creating={creating}
          error={createError}
          totalEstimate={totalEstimate}
          onRegenerate={() => void generate()}
          generating={generating}
        />
      )}
    </div>
  );
}

function DraftReview({
  generated,
  draft,
  onChange,
  onCreate,
  creating,
  error,
  totalEstimate,
  onRegenerate,
  generating,
}: {
  generated: GeneratedPlan;
  draft: PlanDraft;
  onChange: (draft: PlanDraft) => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
  totalEstimate: number;
  onRegenerate: () => void;
  generating: boolean;
}) {
  const tasksByMilestone = useMemo(() => {
    const map = new Map<string, TaskDraft[]>();
    for (const task of draft.tasks) {
      const key = task.milestoneTempId ?? "unassigned";
      map.set(key, [...(map.get(key) ?? []), task]);
    }
    return map;
  }, [draft.tasks]);

  const updateTask = (tempId: string, patch: Partial<TaskDraft>) => {
    onChange({
      ...draft,
      tasks: draft.tasks.map((task) => (task.tempId === tempId ? { ...task, ...patch } : task)),
    });
  };

  const removeTask = (tempId: string) => {
    if (draft.tasks.length <= 1) return;
    onChange({ ...draft, tasks: draft.tasks.filter((task) => task.tempId !== tempId) });
  };

  return (
    <div className="space-y-5 animate-slide-up">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={generated.provider === "gemini" ? "sage" : generated.provider === "meta" ? "primary" : "amber"} dot>
                {generated.provider === "gemini" ? "Gemini draft" : generated.provider === "meta" ? "Meta model draft" : "Deterministic fallback"}
              </Badge>
              <span className="font-mono text-[10px] text-ink-faint">{generated.model}</span>
              <span className="font-mono text-[10px] text-ink-faint">{generated.latencyMs}ms</span>
              {generated.degraded && <Badge tone="amber" dot>degraded fallback</Badge>}
            </div>
            <h2 className="mt-2 text-lg font-semibold text-ink">Review the generated baseline</h2>
            <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-muted">
              Edit the project brief or task estimates now. Nothing is committed until you approve. The deterministic
              scheduler assigns dates when the project is created.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onRegenerate} loading={generating}>
              <RefreshCw className="h-3.5 w-3.5" /> Regenerate
            </Button>
            <Button variant="primary" onClick={onCreate} loading={creating}>
              <CheckCircle2 className="h-4 w-4" /> Approve baseline
            </Button>
          </div>
        </div>

        {generated.notice && (
          <div className="border-b border-line px-5 py-3">
            <Alert tone={generated.degraded ? "warning" : "info"} title="How this draft was produced">
              {generated.notice}
            </Alert>
          </div>
        )}

        <div className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Project name" htmlFor="draft-name">
              <Input id="draft-name" value={draft.name} onChange={(event) => onChange({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="Start date" htmlFor="draft-start">
              <Input id="draft-start" type="date" value={draft.startDate} onChange={(event) => onChange({ ...draft, startDate: event.target.value })} />
            </Field>
          </div>
          <Field label="Goal" htmlFor="draft-goal">
            <Input id="draft-goal" value={draft.goal} onChange={(event) => onChange({ ...draft, goal: event.target.value })} />
          </Field>
          <Field label="Scope description" htmlFor="draft-description">
            <Textarea id="draft-description" className="min-h-28" value={draft.description} onChange={(event) => onChange({ ...draft, description: event.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Requirements", draft.requirements.length],
              ["Milestones", draft.milestones.length],
              ["Tasks", draft.tasks.length],
              ["Estimated effort", `${totalEstimate}d`],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md border border-line bg-surface-muted p-3">
                <p className="label">{label}</p>
                <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
          {error && <Alert tone="danger" title="The baseline was not created">{error}</Alert>}
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader title="Proposed milestones and work" description="Estimates and priorities are editable. Dependencies are preserved from the validated draft." />
          <div className="space-y-4 p-4">
            {draft.milestones.map((milestone) => {
              const tasks = tasksByMilestone.get(milestone.tempId) ?? [];
              return (
                <div key={milestone.tempId} className="rounded-lg border border-line">
                  <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-surface-muted px-4 py-3">
                    <div>
                      <p className="flex items-center gap-2 text-xs font-semibold text-ink">
                        {milestone.title}
                        {milestone.releaseGate && <Badge tone="outline"><Flag className="h-2.5 w-2.5" /> Release gate</Badge>}
                      </p>
                      {milestone.description && <p className="mt-1 text-[11px] leading-5 text-ink-muted">{milestone.description}</p>}
                    </div>
                    <Badge tone={milestone.targetDate ? "primary" : "neutral"}>
                      {milestone.targetDate ? formatShortDate(milestone.targetDate) : "Target unknown"}
                    </Badge>
                  </div>
                  <div className="divide-y divide-line-faint">
                    {tasks.length === 0 ? (
                      <p className="px-4 py-3 text-[11px] text-ink-faint">No tasks assigned to this milestone.</p>
                    ) : (
                      tasks.map((task) => (
                        <div key={task.tempId} className="grid gap-2 px-4 py-2.5 sm:grid-cols-[1fr_90px_80px_32px] sm:items-center">
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-ink">{task.title}</p>
                            <p className="mt-0.5 text-[10px] text-ink-faint">{task.ownerRole} · {task.dependencies.length} dependencies</p>
                          </div>
                          <Input
                            aria-label={`Estimate for ${task.title}`}
                            type="number"
                            min="0.5"
                            max="60"
                            step="0.5"
                            value={task.estimateDays}
                            onChange={(event) => updateTask(task.tempId, { estimateDays: Number(event.target.value) || 0.5 })}
                            className="py-1 text-xs"
                          />
                          <Select
                            aria-label={`Priority for ${task.title}`}
                            value={task.priority}
                            onChange={(event) => updateTask(task.tempId, { priority: event.target.value as TaskDraft["priority"] })}
                            className="py-1 text-xs"
                          >
                            {["P0", "P1", "P2", "P3"].map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                          </Select>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeTask(task.tempId)}
                            disabled={draft.tasks.length <= 1}
                            aria-label={`Remove ${task.title}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Requirements" description="Explicit requirements are observed from the brief; inferred ones are labelled." />
            <ul className="divide-y divide-line-faint">
              {draft.requirements.map((requirement) => (
                <li key={requirement.tempId} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">{requirement.title}</p>
                    <Badge tone={requirement.source === "explicit" ? "sage" : "amber"}>{titleCase(requirement.source)}</Badge>
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-ink-muted">{requirement.description}</p>
                  {requirement.acceptanceCriteria.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {requirement.acceptanceCriteria.slice(0, 3).map((criterion) => (
                        <li key={criterion} className="flex gap-1 text-[10px] text-ink-faint"><CheckCircle2 className="mt-0.5 h-2.5 w-2.5 shrink-0" />{criterion}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Assumptions and unknowns" description="These stay visible in the project plan." />
            <div className="space-y-3 p-4">
              <div>
                <p className="label mb-1.5">Assumptions (inferred)</p>
                {draft.assumptions.length ? (
                  <ul className="space-y-1.5">
                    {draft.assumptions.map((assumption) => (
                      <li key={assumption} className="flex gap-1.5 text-[11px] leading-5 text-ink-muted"><Badge tone="amber">Assumed</Badge>{assumption}</li>
                    ))}
                  </ul>
                ) : <p className="text-[11px] text-ink-faint">None recorded.</p>}
              </div>
              <div>
                <p className="label mb-1.5">Missing information (unknown)</p>
                {draft.missingInformation.length ? (
                  <ul className="space-y-1.5">
                    {draft.missingInformation.map((item) => (
                      <li key={item} className="flex gap-1.5 text-[11px] leading-5 text-ink-muted"><Badge tone="neutral">Unknown</Badge>{item}</li>
                    ))}
                  </ul>
                ) : <p className="text-[11px] text-ink-faint">None recorded.</p>}
              </div>
              {draft.risks.length > 0 && (
                <div>
                  <p className="label mb-1.5">Risks</p>
                  <ul className="space-y-2">
                    {draft.risks.map((risk) => (
                      <li key={risk.title} className="rounded-md border border-line bg-surface-muted p-2.5">
                        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-ink">
                          <AlertTriangle className="h-3 w-3 text-warning-500" /> {risk.title}
                          <Badge tone={risk.severity === "high" ? "danger" : risk.severity === "medium" ? "amber" : "neutral"}>{risk.severity}</Badge>
                        </p>
                        <p className="mt-1 text-[10px] leading-4 text-ink-muted">{risk.mitigation}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
