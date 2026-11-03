import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleHelp,
  MessagesSquare,
  Plus,
  Search,
  Send,
  ShieldQuestion,
  Tag,
} from "lucide-react";
import type { ForumThread } from "@miraiwerk/schemas";
import { useWorkspace } from "../context/WorkspaceContext";
import { useToast } from "../context/ToastContext";
import { api, ApiError } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { cn, formatDateTime, hasRole, relativeTime, titleCase } from "../lib/format";
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
  Textarea,
} from "../components/ui";

const CATEGORIES = ["general", "decision", "question", "risk"];

export function DiscussionsPage() {
  const { activeWorkspace, projects, role } = useWorkspace();
  const { toast } = useToast();
  const workspaceId = activeWorkspace?.id ?? "";
  const { data, loading, error, reload } = useAsync<{ threads: ForumThread[] }>(
    () => api.threads.list(workspaceId),
    [workspaceId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newThread, setNewThread] = useState({ title: "", body: "", category: "general", projectId: "" });
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const threadId = selectedId ?? data?.threads[0]?.id ?? "";
  const detail = useAsync<ForumThread | null>(
    async () => (threadId ? api.threads.get(threadId) : null),
    [threadId],
  );

  const threads = data?.threads ?? [];
  const selected = threadId ? detail.data ?? threads.find((thread) => thread.id === threadId) ?? null : null;
  const canPost = hasRole(role, "member");

  useEffect(() => {
    if (!selectedId && threads[0]) setSelectedId(threads[0].id);
    if (selectedId && !threads.some((thread) => thread.id === selectedId)) setSelectedId(threads[0]?.id ?? null);
  }, [threads, selectedId]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return threads
      .filter((thread) => (filter === "all" ? true : filter === "solved" ? thread.solved : filter === "open" ? !thread.solved : thread.category === filter))
      .filter((thread) => !needle || `${thread.title} ${thread.body} ${thread.category}`.toLowerCase().includes(needle));
  }, [threads, filter, search]);

  const projectName = (projectId: string | null) =>
    projectId ? projects.find((project) => project.id === projectId)?.name ?? projectId : "Workspace";

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newThread.title.trim().length < 3 || newThread.body.trim().length < 3) return;
    setBusy("create");
    setActionError(null);
    try {
      const created = await api.threads.create(workspaceId, {
        title: newThread.title.trim(),
        body: newThread.body.trim(),
        category: newThread.category,
        projectId: newThread.projectId || null,
      });
      await reload();
      setSelectedId(created.id);
      setCreateOpen(false);
      setNewThread({ title: "", body: "", category: "general", projectId: "" });
      toast("Discussion started.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The discussion could not be created.");
    } finally {
      setBusy(null);
    }
  };

  const sendReply = async () => {
    if (!selected || reply.trim().length < 1) return;
    setBusy("reply");
    setActionError(null);
    try {
      await api.threads.reply(selected.id, reply.trim());
      setReply("");
      await Promise.all([detail.reload(), reload()]);
      toast("Reply posted.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The reply could not be posted.");
    } finally {
      setBusy(null);
    }
  };

  const toggleSolved = async () => {
    if (!selected) return;
    setBusy("solve");
    setActionError(null);
    try {
      await api.threads.solve(selected.id, !selected.solved);
      await Promise.all([detail.reload(), reload()]);
      toast(selected.solved ? "Discussion reopened." : "Discussion marked solved.", "success");
    } catch (cause) {
      setActionError(cause instanceof ApiError ? cause.message : "The discussion could not be updated.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow={activeWorkspace?.name}
        title="Discussions"
        description="Asynchronous decisions, questions and risks with a permanent thread. Solved threads remain searchable; nothing is deleted silently."
        actions={
          canPost ? (
            <Button variant="primary" onClick={() => { setActionError(null); setCreateOpen(true); }}>
              <Plus className="h-4 w-4" /> Start discussion
            </Button>
          ) : undefined
        }
        meta={
          <>
            <Badge tone="outline">{threads.length} threads</Badge>
            <span>{threads.filter((thread) => !thread.solved).length} open · {threads.filter((thread) => thread.solved).length} solved</span>
          </>
        }
      />

      {loading ? (
        <LoadingBlock label="Loading discussions" />
      ) : error ? (
        <ErrorBlock message={error} onRetry={() => void reload()} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
          <Card className="h-fit overflow-hidden">
            <div className="space-y-2 border-b border-line p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search threads…" className="pl-8" aria-label="Search discussions" />
              </div>
              <div className="flex flex-wrap gap-1">
                {["all", "open", "solved", ...CATEGORIES].map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setFilter(value)}
                    className={cn(
                      "rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors",
                      filter === value ? "bg-primary-50 text-primary-700" : "text-ink-muted hover:bg-surface-sunken",
                    )}
                  >
                    {titleCase(value)}
                  </button>
                ))}
              </div>
            </div>
            {visible.length === 0 ? (
              <EmptyState icon={MessagesSquare} title={threads.length === 0 ? "No discussions yet" : "No matches"} description={threads.length === 0 ? "Start a thread to record a decision or open question." : "Change the filter or search."} compact />
            ) : (
              <ul className="max-h-[calc(100vh-310px)] divide-y divide-line-faint overflow-y-auto">
                {visible.map((thread) => (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(thread.id)}
                      className={cn(
                        "w-full px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
                        thread.id === threadId ? "bg-primary-50" : "hover:bg-surface-muted",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn("line-clamp-2 text-xs font-semibold", thread.id === threadId ? "text-primary-700" : "text-ink")}>{thread.title}</p>
                        {thread.solved ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sage-500" /> : <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500" />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                        <Badge tone={thread.category === "risk" ? "danger" : thread.category === "decision" ? "primary" : "neutral"}>{titleCase(thread.category)}</Badge>
                        <span>{thread.replyCount} replies</span>
                        <span>·</span>
                        <span>{relativeTime(thread.updatedAt)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {!selected ? (
            <Card><EmptyState icon={MessagesSquare} title="Select a discussion" description="Choose a thread to read the conversation." /></Card>
          ) : (
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title={selected.title}
                  description={`${projectName(selected.projectId)} · started ${formatDateTime(selected.createdAt)}${selected.createdByName ? ` by ${selected.createdByName}` : ""}`}
                  actions={
                    <>
                      <Badge tone={selected.solved ? "sage" : "amber"} dot>{selected.solved ? "Solved" : "Open"}</Badge>
                      {canPost && (
                        <Button size="sm" variant="secondary" onClick={() => void toggleSolved()} loading={busy === "solve"}>
                          {selected.solved ? "Reopen" : "Mark solved"}
                        </Button>
                      )}
                    </>
                  }
                />
                <div className="space-y-4 p-5">
                  {actionError && <Alert tone="danger">{actionError}</Alert>}
                  <div className="flex gap-3">
                    <Avatar name={selected.createdByName ?? "Unknown"} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-ink">{selected.createdByName ?? "Unknown author"}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{selected.body}</p>
                    </div>
                  </div>
                </div>
              </Card>

              <Card>
                <CardHeader title={`Replies (${selected.replies?.length ?? 0})`} description="Replies are append-only and ordered by time." />
                {detail.loading && !selected.replies ? (
                  <LoadingBlock label="Loading replies" />
                ) : !selected.replies || selected.replies.length === 0 ? (
                  <p className="px-5 py-6 text-xs text-ink-muted">No replies yet.</p>
                ) : (
                  <ul className="divide-y divide-line-faint">
                    {selected.replies.map((item) => (
                      <li key={item.id} className="flex gap-3 px-5 py-4">
                        <Avatar name={item.createdByName ?? "Unknown"} size="sm" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-ink">{item.createdByName ?? "Unknown author"}</p>
                            <span className="text-[10px] text-ink-faint">{formatDateTime(item.createdAt)}</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{item.body}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="border-t border-line p-4">
                  {canPost ? (
                    <div className="space-y-2">
                      <Textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Add evidence, a decision or a follow-up question…" aria-label="Reply" />
                      <div className="flex justify-end">
                        <Button variant="primary" onClick={() => void sendReply()} loading={busy === "reply"} disabled={!reply.trim()}>
                          <Send className="h-3.5 w-3.5" /> Post reply
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Alert tone="info" title="Read-only role">Your role can read discussions but cannot reply or change status.</Alert>
                  )}
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      <Modal
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Start discussion"
        description="Capture a question, decision or risk with enough context for someone to respond."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={(event) => void create(event as unknown as React.FormEvent)} loading={busy === "create"} disabled={newThread.title.trim().length < 3 || newThread.body.trim().length < 3}>Start thread</Button>
          </>
        }
      >
        <form className="space-y-3" onSubmit={create}>
          {actionError && <Alert tone="danger">{actionError}</Alert>}
          <Field label="Title" htmlFor="thread-title" required>
            <Input id="thread-title" value={newThread.title} onChange={(event) => setNewThread({ ...newThread, title: event.target.value })} placeholder="Should the payments release gate move?" required />
          </Field>
          <Field label="Body" htmlFor="thread-body" required hint="State the context, evidence and what decision is needed.">
            <Textarea id="thread-body" className="min-h-32" value={newThread.body} onChange={(event) => setNewThread({ ...newThread, body: event.target.value })} required />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category" htmlFor="thread-category">
              <Select id="thread-category" value={newThread.category} onChange={(event) => setNewThread({ ...newThread, category: event.target.value })}>
                {CATEGORIES.map((category) => <option key={category} value={category}>{titleCase(category)}</option>)}
              </Select>
            </Field>
            <Field label="Project" htmlFor="thread-project">
              <Select id="thread-project" value={newThread.projectId} onChange={(event) => setNewThread({ ...newThread, projectId: event.target.value })}>
                <option value="">Workspace-level</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </Select>
            </Field>
          </div>
        </form>
      </Modal>
    </div>
  );
}
