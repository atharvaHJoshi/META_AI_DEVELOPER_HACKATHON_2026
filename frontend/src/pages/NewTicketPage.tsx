import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  FileWarning,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { TicketType } from "@miraiwerk/schemas";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { hasRole } from "../lib/format";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
  Textarea,
} from "../components/ui";

interface TicketForm {
  title: string;
  description: string;
  source: string;
  ticketType: string;
  affectedComponent: string;
  reportedImpact: string;
  evidence: string;
  reporter: string;
  environment: string;
  severityReported: "critical" | "high" | "medium" | "low" | "unspecified";
}

const EMPTY: TicketForm = {
  title: "",
  description: "",
  source: "manual",
  ticketType: "",
  affectedComponent: "",
  reportedImpact: "",
  evidence: "",
  reporter: "",
  environment: "production",
  severityReported: "unspecified",
};

const TEMPLATES: Array<{ key: string; label: string; description: string; patch: Partial<TicketForm> }> = [
  {
    key: "incident",
    label: "Production incident",
    description: "Observed failure with operational evidence.",
    patch: {
      title: "Customers charged twice after checkout retry",
      description:
        "When the payment confirmation request times out, the client retries automatically after five seconds. Some customers receive two captures for one order. Automatic retries are still enabled and the payments release gate is scheduled this week.",
      source: "manual",
      ticketType: "incident",
      affectedComponent: "Payments / checkout retry",
      reportedImpact: "14 customers charged twice since 09:10 UTC; support has refunded 6 so far.",
      evidence:
        "Transactions pi_8841 and pi_8842 share idempotency key idem_5521 and produced two capture.succeeded webhooks. Logs show the retry does not reuse the original idempotency key.",
      environment: "production",
      severityReported: "critical",
    },
  },
  {
    key: "feature",
    label: "Feature request",
    description: "A customer ask without an agreed success metric.",
    patch: {
      title: "Add saved payment methods for returning customers",
      description:
        "Returning customers should be able to save a payment method and reuse it at checkout. The request comes from customer success after repeated feedback. No success metric or scope boundary has been agreed.",
      source: "customer-success",
      ticketType: "feature_request",
      affectedComponent: "Checkout / payments",
      reportedImpact: "Repeat buyers re-enter payment details every time. Conversion impact is not measured.",
      evidence: "Eight customer interview notes mention saved payment methods; no funnel metric is attached.",
      environment: "production",
      severityReported: "low",
    },
  },
  {
    key: "vague",
    label: "Vague report",
    description: "A real signal with missing reproduction and impact.",
    patch: {
      title: "Something about checkout seems off on some devices",
      description:
        "The checkout experience seems off on some devices. We do not have a reproducible example, logs, affected-user details, or a clear description of the expected outcome yet.",
      source: "manual",
      ticketType: "",
      affectedComponent: "",
      reportedImpact: "",
      evidence: "",
      environment: "",
      severityReported: "unspecified",
    },
  },
  {
    key: "duplicate",
    label: "Look-alike duplicate",
    description: "Similar wording, possibly a different root cause.",
    patch: {
      title: "Duplicate charge reported after checkout retry",
      description:
        "A customer reports a duplicate charge after a checkout retry. Finance confirms this is an invoice export duplicate, not a payment capture. The monthly invoice CSV lists the same charge line twice after a plan upgrade with proration.",
      source: "finance",
      ticketType: "bug",
      affectedComponent: "Finance / invoice export",
      reportedImpact: "Finance manually corrects affected invoices before month-end close. No customer has been overcharged by the processor.",
      evidence:
        "Two invoice CSV rows share invoice_id INV-2031 and line_item_id li_908. The payment processor export contains one capture for the same period.",
      environment: "production",
      severityReported: "medium",
    },
  },
];

export function NewTicketPage() {
  const { projects, role, activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const initialProject = params.get("project") ?? projects[0]?.id ?? "";
  const [projectId, setProjectId] = useState(initialProject);
  const [form, setForm] = useState<TicketForm>({ ...EMPTY, reporter: user?.name ?? "" });
  const [analyzeNow, setAnalyzeNow] = useState(true);
  const [saving, setSaving] = useState(false);
  const [stage, setStage] = useState("Create ticket");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user && !form.reporter) setForm((current) => ({ ...current, reporter: user.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const update = (patch: Partial<TicketForm>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) {
      setError("Select a project for this ticket.");
      return;
    }
    if (form.title.trim().length < 4 || form.description.trim().length < 10) {
      setError("A clear title and description are required. Do not submit a placeholder.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      setStage("Creating ticket");
      const created = await api.tickets.create({
        projectId,
        title: form.title.trim(),
        description: form.description.trim(),
        source: form.source.trim() || "manual",
        ticketType: form.ticketType ? (form.ticketType as TicketType) : null,
        affectedComponent: form.affectedComponent.trim(),
        reportedImpact: form.reportedImpact.trim(),
        evidence: form.evidence.trim(),
        reporter: form.reporter.trim(),
        environment: form.environment.trim(),
        severityReported: form.severityReported,
      });

      if (analyzeNow) {
        setStage("Analysing against the approved plan");
        try {
          await api.tickets.analyze(created.ticket.id);
          toast("Ticket analysed. Review the proposal in RippleMap before approving.", "success");
        } catch (cause) {
          toast(cause instanceof ApiError ? `Ticket saved, but analysis failed: ${cause.message}` : "Ticket saved, but analysis failed.", "error");
        }
      } else {
        toast("Ticket created without analysis. You can analyse it from the detail page.", "success");
      }
      navigate(`/tickets/${created.ticket.id}`);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The ticket could not be created.");
    } finally {
      setSaving(false);
      setStage("Create ticket");
    }
  };

  if (!hasRole(role, "member")) {
    return (
      <div>
        <PageHeader title="New ticket" />
        <Alert tone="warning" title="Read-only access">
          Your workspace role can read tickets but cannot create them. This is enforced by the API.
        </Alert>
        <Link to="/tickets" className="btn-secondary mt-4 inline-flex"><ArrowLeft className="h-4 w-4" /> Ticket inbox</Link>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title="New ticket" description="A ticket must be analysed against a project plan." />
        <Card><div className="p-6"><Alert tone="warning" title="No project available">Create a project before filing a change ticket.</Alert></div></Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        eyebrow={<><Link to="/tickets" className="inline-flex items-center gap-1 hover:text-ink"><ArrowLeft className="h-3.5 w-3.5" /> Ticket inbox</Link><span className="text-line-strong">/</span>{activeWorkspace?.name}</>}
        title="New ticket"
        description="Describe the signal and the evidence you actually have. The analyser separates observed evidence from inferred links and unknowns."
        actions={
          <Badge tone="outline"><Sparkles className="h-3 w-3" /> Plan v{projects.find((project) => project.id === projectId)?.currentPlanVersion ?? "—"} baseline</Badge>
        }
      />

      <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[1.45fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Ticket brief"
              description="Choose a template to see the expected level of evidence, or write your own."
              actions={
                <div className="flex flex-wrap gap-1">
                  {TEMPLATES.map((template) => (
                    <Button key={template.key} type="button" size="sm" variant="ghost" onClick={() => setForm({ ...form, ...template.patch, reporter: form.reporter })}>
                      <Wand2 className="h-3 w-3" /> {template.label}
                    </Button>
                  ))}
                </div>
              }
            />
            <div className="space-y-4 p-5">
              <Field label="Project" htmlFor="ticket-project" required hint="Access is checked against project membership and workspace role.">
                <Select id="ticket-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name} · plan v{project.currentPlanVersion}</option>)}
                </Select>
              </Field>
              <Field label="Title" htmlFor="ticket-title" required>
                <Input id="ticket-title" value={form.title} onChange={(event) => update({ title: event.target.value })} placeholder="Customers charged twice after checkout retry" required />
              </Field>
              <Field label="Description" htmlFor="ticket-description" required hint="What happened, where, since when, and what is not known.">
                <Textarea id="ticket-description" className="min-h-36" value={form.description} onChange={(event) => update({ description: event.target.value })} required />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type" htmlFor="ticket-type">
                  <Select id="ticket-type" value={form.ticketType} onChange={(event) => update({ ticketType: event.target.value })}>
                    <option value="">Let analysis classify</option>
                    <option value="bug">Bug</option>
                    <option value="incident">Incident</option>
                    <option value="feature_request">Feature request</option>
                    <option value="technical_debt">Technical debt</option>
                    <option value="clarification">Clarification</option>
                  </Select>
                </Field>
                <Field label="Reported severity" htmlFor="ticket-severity">
                  <Select id="ticket-severity" value={form.severityReported} onChange={(event) => update({ severityReported: event.target.value as TicketForm["severityReported"] })}>
                    <option value="unspecified">Unspecified</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </Select>
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Affected component" htmlFor="ticket-component">
                  <Input id="ticket-component" value={form.affectedComponent} onChange={(event) => update({ affectedComponent: event.target.value })} placeholder="Payments / checkout retry" />
                </Field>
                <Field label="Environment" htmlFor="ticket-environment">
                  <Input id="ticket-environment" value={form.environment} onChange={(event) => update({ environment: event.target.value })} placeholder="production" />
                </Field>
              </div>
              <Field label="Reported impact" htmlFor="ticket-impact" hint="Quantify if possible. Say “unknown” rather than guessing.">
                <Textarea id="ticket-impact" value={form.reportedImpact} onChange={(event) => update({ reportedImpact: event.target.value })} />
              </Field>
              <Field label="Evidence" htmlFor="ticket-evidence" hint="Logs, metrics, transaction IDs, interview notes. Evidence is not the same as a hypothesis.">
                <Textarea id="ticket-evidence" className="min-h-28" value={form.evidence} onChange={(event) => update({ evidence: event.target.value })} placeholder="Transaction IDs, log excerpts, counts, links to source records…" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Reporter" htmlFor="ticket-reporter">
                  <Input id="ticket-reporter" value={form.reporter} onChange={(event) => update({ reporter: event.target.value })} />
                </Field>
                <Field label="Source" htmlFor="ticket-source" hint="Where the signal originated.">
                  <Input id="ticket-source" value={form.source} onChange={(event) => update({ source: event.target.value })} placeholder="manual, support, monitoring…" />
                </Field>
              </div>
              {error && <Alert tone="danger" title="Ticket not created">{error}</Alert>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" className="h-4 w-4 rounded border-line-strong" checked={analyzeNow} onChange={(event) => setAnalyzeNow(event.target.checked)} />
                Analyse immediately after saving
              </label>
              <div className="flex gap-2">
                <Link to="/tickets" className="btn-ghost">Cancel</Link>
                <Button type="submit" variant="primary" loading={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                  {saving ? stage : "Save ticket"}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Evidence first" description="What the analysis will do." />
            <ul className="space-y-3 p-5">
              {[
                { icon: CheckCircle2, title: "Observed", text: "Directly supported by ticket fields, project records or policy." },
                { icon: Sparkles, title: "Inferred", text: "A plausible link the model proposes. It is labelled and challengeable." },
                { icon: CircleHelp, title: "Unknown", text: "Missing information stays missing. Clarifying questions are generated instead of fabricated answers." },
              ].map((item) => (
                <li key={item.title} className="flex gap-2.5">
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" />
                  <div>
                    <p className="text-xs font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-[11px] leading-5 text-ink-muted">{item.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="What happens next" />
            <ol className="space-y-2 p-5 text-[11px] leading-5 text-ink-muted">
              <li><strong className="text-ink">1.</strong> The ticket is saved and analysis starts against the current approved plan version.</li>
              <li><strong className="text-ink">2.</strong> A proposal with a recommendation, evidence and possible accept/split changes is created.</li>
              <li><strong className="text-ink">3.</strong> RippleMap simulates every option deterministically. Users with approval permission decide.</li>
              <li><strong className="text-ink">4.</strong> Only then is a new immutable plan version created.</li>
            </ol>
          </Card>
          <Alert tone="info" title="No automatic approval">
            A high-confidence recommendation is still only a proposal. The backend rejects approval attempts from roles without approval permission.
          </Alert>
        </div>
      </form>
    </div>
  );
}
