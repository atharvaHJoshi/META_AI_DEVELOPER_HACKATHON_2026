import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  FileCode2,
  FilePlus2,
  FileText,
  Loader2,
  Network,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Document } from "@miraiwerk/schemas";
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

const STATUSES = ["draft", "in_review", "published"];

type DocumentDraft = {
  documentId: string;
  updatedAt: string;
  title: string;
  content: string;
  status: string;
  docType: "markdown" | "diagram";
};

export function DocsPage() {
  const { activeWorkspace, role } = useWorkspace();
  const { toast } = useToast();
  const workspaceId = activeWorkspace?.id ?? "";
  const { data, loading, error, reload } = useAsync<{ documents: Document[] }>(
    () => api.docs.list(workspaceId),
    [workspaceId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftState, setDraftState] = useState<DocumentDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Document | null>(null);
  const [busy, setBusy] = useState(false);
  const [newDoc, setNewDoc] = useState({ title: "", docType: "markdown" as "markdown" | "diagram", projectId: "" });
  const [aiOpen, setAiOpen] = useState(false);
  const [outline, setOutline] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  const documents = data?.documents ?? [];
  const selected = documents.find((document) => document.id === selectedId) ?? null;
  const canEdit = hasRole(role, "member");
  // Never expose a draft that belongs to a different document or server
  // revision: switching/creating documents must not paint stale content into
  // the editor, and the save button must reflect only real edits.
  const draft: DocumentDraft | null = !selected
    ? null
    : draftState &&
        draftState.documentId === selected.id &&
        draftState.updatedAt === selected.updatedAt
      ? draftState
      : {
          documentId: selected.id,
          updatedAt: selected.updatedAt,
          title: selected.title,
          content: selected.content,
          status: selected.status,
          docType: selected.docType,
        };
  const isDirty = Boolean(
    selected &&
      draft &&
      (selected.title !== draft.title ||
        selected.content !== draft.content ||
        selected.status !== draft.status ||
        selected.docType !== draft.docType),
  );

  useEffect(() => {
    if (!selectedId && documents[0]) setSelectedId(documents[0].id);
    if (selectedId && !documents.some((document) => document.id === selectedId)) {
      setSelectedId(documents[0]?.id ?? null);
    }
  }, [documents, selectedId]);

  useEffect(() => {
    setSaveError(null);
    setAiNotice(null);
  }, [selected?.id, selected?.updatedAt]);

  const select = (document: Document) => {
    if (document.id === selectedId) return;
    if (isDirty && !window.confirm("Discard unsaved changes to the current document?")) return;
    setDraftState(null);
    setSelectedId(document.id);
  };

  const save = async () => {
    if (!selected || !draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.docs.update(selected.id, {
        title: draft.title.trim(),
        content: draft.content,
        status: draft.status,
        docType: draft.docType,
      });
      await reload();
      toast("Document saved.", "success");
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : "The document could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newDoc.title.trim().length < 2) return;
    setBusy(true);
    setSaveError(null);
    try {
      const created = await api.docs.create(workspaceId, {
        title: newDoc.title.trim(),
        docType: newDoc.docType,
        projectId: newDoc.projectId || null,
      });
      await reload();
      setSelectedId(created.id);
      setCreateOpen(false);
      setNewDoc({ title: "", docType: "markdown", projectId: "" });
      toast("Document created.", "success");
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : "The document could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setSaveError(null);
    try {
      await api.docs.remove(deleteTarget.id);
      await reload();
      setDeleteTarget(null);
      toast("Document deleted.", "success");
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : "The document could not be deleted.");
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    if (!draft || outline.trim().length < 10) {
      setAiError("Provide an outline of at least ten characters.");
      return;
    }
    setAiBusy(true);
    setAiError(null);
    setAiNotice(null);
    try {
      const result = await api.docs.draft({
        workspaceId,
        projectId: selected?.projectId ?? null,
        title: draft.title.trim() || "Untitled document",
        outline: outline.trim(),
      });
      setDraftState({ ...draft, content: result.text });
      setAiNotice(result.degraded ? `${result.notice} — labelled deterministic draft.` : `${result.provider} · ${result.model}. Review before saving.`);
      toast("AI draft inserted into the editor. Review and save when ready.", "success");
      setAiOpen(false);
    } catch (cause) {
      setAiError(cause instanceof ApiError ? cause.message : "The AI draft could not be generated.");
    } finally {
      setAiBusy(false);
    }
  };

  const grouped = useMemo(() => {
    const markdown = documents.filter((document) => document.docType === "markdown");
    const diagram = documents.filter((document) => document.docType === "diagram");
    return { markdown, diagram };
  }, [documents]);

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Documentation & Diagrams"
        description="Decision records, delivery notes and dependency diagrams kept next to the plan. Content is persisted in the workspace; diagram source is stored, rendering is explicitly marked as unavailable."
        actions={
          canEdit ? (
            <Button variant="primary" onClick={() => setCreateOpen(true)}>
              <FilePlus2 className="h-4 w-4" /> New document
            </Button>
          ) : undefined
        }
        meta={
          <>
            <Badge tone="outline">{documents.length} documents</Badge>
            <span>{grouped.markdown.length} notes · {grouped.diagram.length} diagrams</span>
            <span>· Workspace-scoped, permission enforced by the API</span>
          </>
        }
      />

      {loading ? (
        <LoadingBlock label="Loading workspace documentation" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void reload()} />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <Card className="h-fit overflow-hidden">
            <div className="border-b border-line px-4 py-3">
              <p className="text-xs font-semibold text-ink">Library</p>
              <p className="mt-0.5 text-[10px] text-ink-faint">Markdown notes and diagram source</p>
            </div>
            {documents.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No documents"
                description="Create a decision record or architecture note."
                action={canEdit ? <Button size="sm" onClick={() => setCreateOpen(true)}>Create document</Button> : undefined}
                compact
              />
            ) : (
              <nav className="max-h-[calc(100vh-260px)] overflow-y-auto p-2" aria-label="Documents">
                <DocGroup
                  label="Notes"
                  icon={FileText}
                  documents={grouped.markdown}
                  selectedId={selectedId}
                  onSelect={select}
                />
                <DocGroup
                  label="Diagrams"
                  icon={Network}
                  documents={grouped.diagram}
                  selectedId={selectedId}
                  onSelect={select}
                />
              </nav>
            )}
          </Card>

          {!selected || !draft ? (
            <Card>
              <EmptyState
                icon={FileCode2}
                title="Select a document"
                description="Choose a document from the library, or create a new one."
                action={canEdit ? <Button onClick={() => setCreateOpen(true)}><FilePlus2 className="h-4 w-4" /> New document</Button> : undefined}
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={draft.docType === "diagram" ? "primary" : "neutral"}>
                    {draft.docType === "diagram" ? <Network className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    {titleCase(draft.docType)}
                  </Badge>
                  <span className="text-[10px] text-ink-faint">
                    Updated {formatDateTime(selected.updatedAt)}
                    {selected.updatedByName ? ` by ${selected.updatedByName}` : ""}
                  </span>
                  {isDirty && <Badge tone="amber" dot>Unsaved changes</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {canEdit && (
                    <Button size="sm" variant="secondary" onClick={() => { setAiError(null); setAiOpen(true); }}>
                      <Sparkles className="h-3.5 w-3.5" /> AI draft
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="primary" onClick={() => void save()} loading={saving} disabled={!isDirty}>
                      <Save className="h-3.5 w-3.5" /> Save
                    </Button>
                  )}
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(selected)} aria-label={`Delete ${selected.title}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-4 p-5">
                {saveError && <Alert tone="danger">{saveError}</Alert>}
                {aiNotice && <Alert tone="info" title="AI draft inserted">{aiNotice}</Alert>}
                <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
                  <Field label="Title" htmlFor="doc-title">
                    <Input id="doc-title" value={draft.title} onChange={(event) => setDraftState({ ...draft, title: event.target.value })} disabled={!canEdit} />
                  </Field>
                  <Field label="Status" htmlFor="doc-status">
                    <Select id="doc-status" value={draft.status} onChange={(event) => setDraftState({ ...draft, status: event.target.value })} disabled={!canEdit}>
                      {STATUSES.map((status) => <option key={status} value={status}>{titleCase(status)}</option>)}
                      {!STATUSES.includes(draft.status) && <option value={draft.status}>{titleCase(draft.status)}</option>}
                    </Select>
                  </Field>
                </div>

                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <label htmlFor="doc-content" className="field-label mb-0">
                      {draft.docType === "diagram" ? "Diagram source (Mermaid-compatible text)" : "Markdown content"}
                    </label>
                    <span className="font-mono text-[10px] text-ink-faint">{draft.content.length.toLocaleString()} chars</span>
                  </div>
                  <Textarea
                    id="doc-content"
                    value={draft.content}
                    onChange={(event) => setDraftState({ ...draft, content: event.target.value })}
                    className={cn("min-h-[420px] font-mono text-xs leading-6", draft.docType === "diagram" && "bg-surface-muted")}
                    placeholder={
                      draft.docType === "diagram"
                        ? "graph TD\n  ticket[Ticket] --> proposal[Decision proposal]\n  proposal --> ripple[RippleMap simulation]\n  ripple --> approval[Human approval]"
                        : "# Context\n\n## Decision\n\n## Evidence\n\n## Consequences"
                    }
                    disabled={!canEdit}
                    spellCheck={draft.docType === "markdown"}
                  />
                </div>

                {draft.docType === "diagram" && (
                  <Alert tone="warning" title="Diagram rendering is deferred">
                    Diagram source is stored and versioned with the document, but this build does not include a Mermaid
                    renderer. No graphical preview is fabricated. The source remains reviewable and exportable by copying it.
                  </Alert>
                )}

                {selected.projectId && (
                  <p className="text-[10px] text-ink-faint">
                    Linked project: <span className="font-mono">{selected.projectId}</span> · Project membership is checked by the API.
                  </p>
                )}
                {!canEdit && (
                  <Alert tone="info" title="Read-only role">
                    Your workspace role can read documentation but cannot edit or delete it. This restriction is enforced by the server.
                  </Alert>
                )}
              </div>
            </Card>
          )}
        </div>
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="New document"
        description="Create a project note or an architecture diagram source."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={(event) => void create(event as unknown as React.FormEvent)} loading={busy} disabled={newDoc.title.trim().length < 2}>
              Create
            </Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={create}>
          {saveError && <Alert tone="danger">{saveError}</Alert>}
          <Field label="Title" htmlFor="new-doc-title" required>
            <Input id="new-doc-title" value={newDoc.title} onChange={(event) => setNewDoc({ ...newDoc, title: event.target.value })} placeholder="Payments release decision record" required />
          </Field>
          <Field label="Type" htmlFor="new-doc-type">
            <Select id="new-doc-type" value={newDoc.docType} onChange={(event) => setNewDoc({ ...newDoc, docType: event.target.value as "markdown" | "diagram" })}>
              <option value="markdown">Markdown note</option>
              <option value="diagram">Diagram source</option>
            </Select>
          </Field>
          <Field label="Project link" htmlFor="new-doc-project" hint="Optional. Leave empty for a workspace-level document.">
            <Input id="new-doc-project" value={newDoc.projectId} onChange={(event) => setNewDoc({ ...newDoc, projectId: event.target.value })} placeholder="prj_…" />
          </Field>
        </form>
      </Modal>

      <Modal
        open={aiOpen}
        onOpenChange={setAiOpen}
        title="Draft with AI"
        description="Gemini (or the labelled deterministic fallback) drafts content from your outline. Nothing is saved until you review and save."
        footer={
          <>
            <Button variant="ghost" onClick={() => setAiOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => void generate()} loading={aiBusy}>
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />} Generate draft
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {aiError && <Alert tone="danger">{aiError}</Alert>}
          <Field label="Outline" htmlFor="ai-outline" required hint="State the decision, evidence, constraints and open questions. The draft will not be auto-saved.">
            <Textarea id="ai-outline" className="min-h-32" value={outline} onChange={(event) => setOutline(event.target.value)} placeholder="Decision: defer payments release gate by one week. Evidence: double-charge incident…" />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete document"
        description="This permanently removes the document content. It cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void remove()} loading={busy}>Delete document</Button>
          </>
        }
      >
        {saveError && <Alert tone="danger">{saveError}</Alert>}
        <p className="text-sm text-ink-soft">Delete <strong>{deleteTarget?.title}</strong>?</p>
      </Modal>
    </div>
  );
}

function DocGroup({
  label,
  icon: Icon,
  documents,
  selectedId,
  onSelect,
}: {
  label: string;
  icon: typeof FileText;
  documents: Document[];
  selectedId: string | null;
  onSelect: (document: Document) => void;
}) {
  if (documents.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1 flex items-center gap-1.5 px-2 font-mono text-[9px] uppercase tracking-[0.12em] text-ink-faint">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <ul className="space-y-0.5">
        {documents.map((document) => (
          <li key={document.id}>
            <button
              type="button"
              onClick={() => onSelect(document)}
              className={cn(
                "w-full rounded-md px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
                document.id === selectedId ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:bg-surface-sunken hover:text-ink",
              )}
            >
              <span className="block truncate text-xs font-semibold">{document.title}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-ink-faint">
                {titleCase(document.status)} · {formatDateTime(document.updatedAt)}
                {document.status === "published" && <CheckCircle2 className="h-2.5 w-2.5 text-sage-500" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
