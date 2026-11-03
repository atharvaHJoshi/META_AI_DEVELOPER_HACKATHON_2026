import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ListChecks,
  Loader2,
  Plus,
  Sparkles,
  Video,
} from "lucide-react";
import type { Meeting } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { cn, formatDateTime, hasRole, titleCase } from "../lib/format";
import {
  Alert,
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
  Textarea,
} from "../components/ui";

function toLocalInput(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function MeetingsPage() {
  const { activeWorkspace, projects, role } = useWorkspace();
  const { toast } = useToast();
  const workspaceId = activeWorkspace?.id ?? "";
  const { data, loading, error, reload } = useAsync<{ meetings: Meeting[] }>(
    () => api.meetings.list(workspaceId),
    [workspaceId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newMeeting, setNewMeeting] = useState({ title: "", agenda: "", projectId: "", scheduledAt: "", durationMinutes: "30" });
  const [edit, setEdit] = useState<{
    title: string;
    agenda: string;
    notes: string;
    scheduledAt: string;
    durationMinutes: string;
    status: Meeting["status"];
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [convertProject, setConvertProject] = useState("");
  const [summarizeLabel, setSummarizeLabel] = useState<string | null>(null);

  const meetings = data?.meetings ?? [];
  const selected = meetings.find((meeting) => meeting.id === selectedId) ?? null;
  const canEdit = hasRole(role, "member");

  useEffect(() => {
    if (!selectedId && meetings[0]) setSelectedId(meetings[0].id);
    if (selectedId && !meetings.some((meeting) => meeting.id === selectedId)) {
      setSelectedId(meetings[0]?.id ?? null);
    }
  }, [meetings, selectedId]);

  useEffect(() => {
    if (!selected) {
      setEdit(null);
      return;
    }
    setEdit({
      title: selected.title,
      agenda: selected.agenda,
      notes: selected.notes,
      scheduledAt: toLocalInput(selected.scheduledAt),
      durationMinutes: String(selected.durationMinutes),
      status: selected.status,
    });
    setConvertProject(selected.projectId ?? projects[0]?.id ?? "");
    setActionError(null);
    setNotice(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.updatedAt]);

  const projectName = (projectId: string | null) =>
    projectId ? projects.find((project) => project.id === projectId)?.name ?? projectId : "Workspace-level";

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newMeeting.title.trim().length < 2) return;
    setBusy("create");
    setActionError(null);
    try {
      const created = await api.meetings.create(workspaceId, {
        title: newMeeting.title.trim(),
        agenda: newMeeting.agenda.trim(),
        projectId: newMeeting.projectId || null,
        scheduledAt: fromLocalInput(newMeeting.scheduledAt),
        durationMinutes: Number(newMeeting.durationMinutes) || 30,
      });
      await reload();
      setSelectedId(created.id);
      setCreateOpen(false);
      setNewMeeting({ title: "", agenda: "", projectId: "", scheduledAt: "", durationMinutes: "30" });
      toast("Meeting scheduled.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The meeting could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!selected || !edit) return;
    setBusy("save");
    setActionError(null);
    try {
      await api.meetings.update(selected.id, {
        title: edit.title.trim(),
        agenda: edit.agenda,
        notes: edit.notes,
        scheduledAt: fromLocalInput(edit.scheduledAt),
        durationMinutes: Number(edit.durationMinutes) || 30,
        status: edit.status,
      });
      await reload();
      toast("Meeting saved.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The meeting could not be saved.");
    } finally {
      setBusy(null);
    }
  };

  const summarize = async () => {
    if (!selected) return;
    setBusy("summarize");
    setActionError(null);
    setNotice(null);
    setSummarizeLabel("Summarising notes and extracting action items");
    try {
      const result = await api.meetings.summarize(selected.id);
      await reload();
      setNotice(
        `${result.assistant.degraded ? "Labelled deterministic fallback" : `${result.assistant.provider} · ${result.assistant.model}`} produced ${result.actionItems.length} action item${result.actionItems.length === 1 ? "" : "s"}. ${result.assistant.notice ?? ""}`.trim(),
      );
      toast("Meeting summarised. Review the action items before converting them to tasks.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The meeting could not be summarised.");
    } finally {
      setBusy(null);
      setSummarizeLabel(null);
    }
  };

  const convert = async () => {
    if (!selected || !convertProject) return;
    setBusy("convert");
    setActionError(null);
    try {
      const result = await api.meetings.convertActions(selected.id, convertProject);
      await reload();
      setNotice(
        result.tasks.length === 0
          ? "No new tasks were created. Already-converted action items are left unchanged."
          : `${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"} created from meeting action items.`,
      );
      toast("Action items converted into project tasks.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "Action items could not be converted.");
    } finally {
      setBusy(null);
    }
  };

  const upcoming = useMemo(
    () => meetings.filter((meeting) => meeting.status === "scheduled").length,
    [meetings],
  );
  const completed = useMemo(
    () => meetings.filter((meeting) => meeting.status === "completed").length,
    [meetings],
  );

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Meetings"
        description="Capture agendas, notes and decisions. AI summaries and action items are labelled; converting an action item into a task is an explicit human action."
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => { setActionError(null); setCreateOpen(true); }}>
              <Plus className="h-4 w-4" /> Schedule meeting
            </Button>
          ) : undefined
        }
        meta={
          <>
            <Badge tone="outline">{meetings.length} meetings</Badge>
            <span>{upcoming} scheduled · {completed} completed</span>
            <span>· Notes stay inside this workspace</span>
          </>
        }
      />

      {loading ? (
        <LoadingBlock label="Loading meetings" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void reload()} />
      ) : meetings.length === 0 ? (
        <Card>
          <EmptyState
            icon={Video}
            title="No meetings recorded"
            description="Schedule a meeting, capture notes, then extract action items into the project plan."
            action={canEdit ? <Button variant="primary" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> Schedule meeting</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
          <Card className="h-fit overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <p className="text-xs font-semibold text-ink">Meeting log</p>
              <p className="mt-0.5 text-[10px] text-ink-faint">Scheduled and recorded sessions</p>
            </div>
            <ul className="max-h-[calc(100vh-260px)] divide-y divide-line-faint overflow-y-auto">
              {meetings.map((meeting) => (
                <li key={meeting.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(meeting.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
                      meeting.id === selectedId ? "bg-primary-50" : "hover:bg-surface-muted",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("text-xs font-semibold", meeting.id === selectedId ? "text-primary-700" : "text-ink")}>{meeting.title}</p>
                      <Badge tone={meeting.status === "completed" ? "sage" : meeting.status === "cancelled" ? "danger" : "primary"}>{titleCase(meeting.status)}</Badge>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-[10px] text-ink-faint">
                      <CalendarDays className="h-3 w-3" />
                      {meeting.scheduledAt ? formatDateTime(meeting.scheduledAt) : "Unscheduled"}
                      <span>·</span>
                      {projectName(meeting.projectId)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-faint">
                      {meeting.actionItems.length} action items{meeting.summary ? " · summarised" : ""}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {!selected || !edit ? (
            <Card><EmptyState icon={Video} title="Select a meeting" description="Choose a meeting to review notes and action items." /></Card>
          ) : (
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title={selected.title}
                  description={`${projectName(selected.projectId)} · ${selected.scheduledAt ? formatDateTime(selected.scheduledAt) : "Unscheduled"} · ${selected.durationMinutes} minutes`}
                  actions={
                    <>
                      <Badge tone={selected.status === "completed" ? "sage" : selected.status === "cancelled" ? "danger" : "primary"}>{titleCase(selected.status)}</Badge>
                      {canEdit && (
                        <Button size="sm" variant="primary" onClick={() => void save()} loading={busy === "save"}>
                          Save changes
                        </Button>
                      )}
                    </>
                  }
                />
                <div className="space-y-4 p-5">
                  {actionError && <Alert tone="danger">{actionError}</Alert>}
                  {notice && <Alert tone="info" title="Result">{notice}</Alert>}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Title" htmlFor="meeting-title">
                      <Input id="meeting-title" value={edit.title} onChange={(event) => setEdit({ ...edit, title: event.target.value })} disabled={!canEdit} />
                    </Field>
                    <Field label="Status" htmlFor="meeting-status">
                      <Select id="meeting-status" value={edit.status} onChange={(event) => setEdit({ ...edit, status: event.target.value as Meeting["status"] })} disabled={!canEdit}>
                        {["scheduled", "in_progress", "completed", "cancelled"].map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
                      </Select>
                    </Field>
                    <Field label="Date and time" htmlFor="meeting-when">
                      <Input id="meeting-when" type="datetime-local" value={edit.scheduledAt} onChange={(event) => setEdit({ ...edit, scheduledAt: event.target.value })} disabled={!canEdit} />
                    </Field>
                    <Field label="Duration (minutes)" htmlFor="meeting-duration">
                      <Input id="meeting-duration" type="number" min="5" max="480" value={edit.durationMinutes} onChange={(event) => setEdit({ ...edit, durationMinutes: event.target.value })} disabled={!canEdit} />
                    </Field>
                  </div>
                  <Field label="Agenda" htmlFor="meeting-agenda">
                    <Textarea id="meeting-agenda" value={edit.agenda} onChange={(event) => setEdit({ ...edit, agenda: event.target.value })} disabled={!canEdit} />
                  </Field>
                  <Field label="Notes" htmlFor="meeting-notes" hint="Write what was actually discussed and decided. AI summary uses these notes.">
                    <Textarea id="meeting-notes" className="min-h-36" value={edit.notes} onChange={(event) => setEdit({ ...edit, notes: event.target.value })} disabled={!canEdit} />
                  </Field>
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Summary and action items"
                  description="Summaries are stored on the meeting. Action items become project tasks only when you choose to convert them."
                  actions={
                    canEdit ? (
                      <Button size="sm" variant="secondary" onClick={() => void summarize()} loading={busy === "summarize"} disabled={!edit.notes.trim() && !edit.agenda.trim()}>
                        {busy === "summarize" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {summarizeLabel ?? "Summarise with AI"}
                      </Button>
                    ) : undefined
                  }
                />
                <div className="space-y-4 p-5">
                  {selected.summary ? (
                    <div className="rounded-md border border-line bg-surface-muted p-3">
                      <p className="label mb-1">Stored summary</p>
                      <p className="whitespace-pre-wrap text-xs leading-5 text-ink-soft">{selected.summary}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-muted">No summary yet. Add notes or an agenda, then request a summary.</p>
                  )}

                  <div>
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <p className="label mb-0">Action items</p>
                      {selected.actionItems.length > 0 && canEdit && (
                        <div className="flex flex-wrap items-center gap-2">
                          {!selected.projectId && (
                            <Select value={convertProject} onChange={(event) => setConvertProject(event.target.value)} className="w-auto max-w-[220px]" aria-label="Project for converted action items">
                              <option value="">Choose project</option>
                              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                            </Select>
                          )}
                          <Button size="sm" variant="primary" onClick={() => void convert()} loading={busy === "convert"} disabled={!convertProject}>
                            <ClipboardCheck className="h-3.5 w-3.5" /> Convert to tasks
                          </Button>
                        </div>
                      )}
                    </div>
                    {selected.actionItems.length === 0 ? (
                      <p className="text-xs text-ink-faint">No action items recorded.</p>
                    ) : (
                      <ul className="space-y-2">
                        {selected.actionItems.map((item, index) => (
                          <li key={`${item.title}-${index}`} className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line px-3 py-2">
                            <div>
                              <p className="text-xs font-medium text-ink">{item.title}</p>
                              <p className="mt-0.5 text-[10px] text-ink-faint">
                                {item.owner || "Unassigned"}{item.dueDate ? ` · due ${item.dueDate}` : ""}
                              </p>
                            </div>
                            {item.taskId ? (
                              <Badge tone="sage"><CheckCircle2 className="h-3 w-3" /> Task created</Badge>
                            ) : (
                              <Badge tone="outline"><ListChecks className="h-3 w-3" /> Not converted</Badge>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {!canEdit && <Alert tone="info" title="Read-only role">Your role can read meetings but cannot edit notes or convert action items.</Alert>}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Schedule meeting"
        description="Create a workspace or project meeting. Agenda and notes can be added now or later."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={(event) => void create(event as unknown as React.FormEvent)} loading={busy === "create"} disabled={newMeeting.title.trim().length < 2}>Schedule</Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={create}>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          <Field label="Title" htmlFor="new-meeting-title" required>
            <Input id="new-meeting-title" value={newMeeting.title} onChange={(event) => setNewMeeting({ ...newMeeting, title: event.target.value })} placeholder="Payments release readiness review" required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Date and time" htmlFor="new-meeting-when">
              <Input id="new-meeting-when" type="datetime-local" value={newMeeting.scheduledAt} onChange={(event) => setNewMeeting({ ...newMeeting, scheduledAt: event.target.value })} />
            </Field>
            <Field label="Duration (minutes)" htmlFor="new-meeting-duration">
              <Input id="new-meeting-duration" type="number" min="5" max="480" value={newMeeting.durationMinutes} onChange={(event) => setNewMeeting({ ...newMeeting, durationMinutes: event.target.value })} />
            </Field>
          </div>
          <Field label="Project" htmlFor="new-meeting-project" hint="Optional. Workspace-level meetings are visible to all workspace members.">
            <Select id="new-meeting-project" value={newMeeting.projectId} onChange={(event) => setNewMeeting({ ...newMeeting, projectId: event.target.value })}>
              <option value="">Workspace-level</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
          </Field>
          <Field label="Agenda" htmlFor="new-meeting-agenda">
            <Textarea id="new-meeting-agenda" value={newMeeting.agenda} onChange={(event) => setNewMeeting({ ...newMeeting, agenda: event.target.value })} placeholder="Review incident evidence, release gate and open risks." />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
