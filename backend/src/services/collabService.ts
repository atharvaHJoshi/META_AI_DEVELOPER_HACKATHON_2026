import type { Document, Meeting, MeetingActionItem, ForumThread, BoardTask } from "@miraiwerk/schemas";
import { assertProjectAccess, assertWorkspaceAccess, workspaceRole } from "../auth.js";
import { one, query, withTransaction } from "../db/pool.js";
import { ApiError, newId } from "../lib/http.js";
import { createTask } from "./taskService.js";

async function assertDocumentAccess(userId: string, document: { workspace_id: string; project_id: string | null }) {
  if (document.project_id) {
    await assertProjectAccess(userId, document.project_id);
  } else {
    await assertWorkspaceAccess(userId, document.workspace_id);
  }
}

export async function listDocuments(
  userId: string,
  workspaceId: string,
  projectId?: string | null,
): Promise<Document[]> {
  if (projectId) await assertProjectAccess(userId, projectId);
  else await assertWorkspaceAccess(userId, workspaceId);
  const result = await query<{
    id: string;
    workspace_id: string;
    project_id: string | null;
    title: string;
    doc_type: "markdown" | "diagram";
    content: string;
    status: string;
    created_by: string | null;
    created_by_name: string | null;
    updated_by_name: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT d.id, d.workspace_id, d.project_id, d.title, d.doc_type, d.content, d.status,
            d.created_by, c.name AS created_by_name, u.name AS updated_by_name,
            d.created_at, d.updated_at
     FROM documents d
     LEFT JOIN users c ON c.id = d.created_by
     LEFT JOIN users u ON u.id = d.updated_by
     WHERE d.workspace_id = $1
       AND ($2::text IS NULL OR d.project_id = $2)
     ORDER BY d.updated_at DESC`,
    [workspaceId, projectId ?? null],
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title,
    docType: row.doc_type,
    content: row.content,
    status: row.status,
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    updatedByName: row.updated_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createDocument(
  userId: string,
  workspaceId: string,
  input: { title: string; content?: string; docType?: "markdown" | "diagram"; projectId?: string | null },
): Promise<Document> {
  if (input.projectId) await assertProjectAccess(userId, input.projectId);
  else await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager", "member"]);
  const title = input.title.trim();
  if (title.length < 2) throw new ApiError(422, "INVALID_TITLE", "Document title is too short.");
  const id = newId("doc");
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO documents
        (id, workspace_id, project_id, title, doc_type, content, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)`,
      [id, workspaceId, input.projectId ?? null, title, input.docType ?? "markdown", input.content ?? "", userId],
    );
    await client.query(
      `INSERT INTO audit_events (id, project_id, actor_id, action, entity_type, entity_id, summary)
       SELECT $1, $2, $3, 'document.created', 'document', $4, $5
       WHERE $2::text IS NOT NULL`,
      [newId("audit"), input.projectId ?? null, userId, id, `Document created: ${title}`],
    );
  });
  const docs = await listDocuments(userId, workspaceId, input.projectId ?? null);
  return docs.find((doc) => doc.id === id)!;
}

export async function updateDocument(
  userId: string,
  documentId: string,
  input: { title?: string; content?: string; status?: string; docType?: "markdown" | "diagram" },
): Promise<Document> {
  const existing = await one<{ workspace_id: string; project_id: string | null }>(
    `SELECT workspace_id, project_id FROM documents WHERE id = $1`,
    [documentId],
  );
  if (!existing) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
  await assertDocumentAccess(userId, existing);
  await query(
    `UPDATE documents SET
       title = COALESCE($2, title),
       content = COALESCE($3, content),
       status = COALESCE($4, status),
       doc_type = COALESCE($5, doc_type),
       updated_by = $6,
       updated_at = now()
     WHERE id = $1`,
    [documentId, input.title?.trim() || null, input.content ?? null, input.status ?? null, input.docType ?? null, userId],
  );
  const docs = await listDocuments(userId, existing.workspace_id, existing.project_id);
  return docs.find((doc) => doc.id === documentId)!;
}

export async function deleteDocument(userId: string, documentId: string): Promise<void> {
  const existing = await one<{ workspace_id: string; project_id: string | null }>(
    `SELECT workspace_id, project_id FROM documents WHERE id = $1`,
    [documentId],
  );
  if (!existing) throw new ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
  await assertDocumentAccess(userId, existing);
  const role = await workspaceRole(userId, existing.workspace_id);
  if (!role || role === "viewer") throw new ApiError(403, "FORBIDDEN", "Viewers cannot delete documents.");
  await query(`DELETE FROM documents WHERE id = $1`, [documentId]);
}

export async function listMeetings(
  userId: string,
  workspaceId: string,
  projectId?: string | null,
): Promise<Meeting[]> {
  if (projectId) await assertProjectAccess(userId, projectId);
  else await assertWorkspaceAccess(userId, workspaceId);
  const result = await query<{
    id: string;
    workspace_id: string;
    project_id: string | null;
    title: string;
    agenda: string;
    notes: string;
    scheduled_at: string | null;
    duration_minutes: number;
    status: Meeting["status"];
    summary: string;
    action_items_json: unknown;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT m.id, m.workspace_id, m.project_id, m.title, m.agenda, m.notes,
            m.scheduled_at, m.duration_minutes, m.status, m.summary, m.action_items_json,
            u.name AS created_by_name, m.created_at, m.updated_at
     FROM meetings m LEFT JOIN users u ON u.id = m.created_by
     WHERE m.workspace_id = $1 AND ($2::text IS NULL OR m.project_id = $2)
     ORDER BY m.scheduled_at DESC NULLS LAST, m.created_at DESC`,
    [workspaceId, projectId ?? null],
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title,
    agenda: row.agenda,
    notes: row.notes,
    scheduledAt: row.scheduled_at,
    durationMinutes: row.duration_minutes,
    status: row.status,
    summary: row.summary,
    actionItems: Array.isArray(row.action_items_json)
      ? (row.action_items_json as MeetingActionItem[])
      : [],
    createdByName: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function createMeeting(
  userId: string,
  workspaceId: string,
  input: {
    title: string;
    agenda?: string;
    projectId?: string | null;
    scheduledAt?: string | null;
    durationMinutes?: number;
  },
): Promise<Meeting> {
  if (input.projectId) await assertProjectAccess(userId, input.projectId);
  else await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager", "member"]);
  const title = input.title.trim();
  if (title.length < 2) throw new ApiError(422, "INVALID_TITLE", "Meeting title is too short.");
  const id = newId("mtg");
  await query(
    `INSERT INTO meetings
      (id, workspace_id, project_id, title, agenda, scheduled_at, duration_minutes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      id,
      workspaceId,
      input.projectId ?? null,
      title,
      input.agenda ?? "",
      input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null,
      input.durationMinutes ?? 30,
      userId,
    ],
  );
  const meetings = await listMeetings(userId, workspaceId, input.projectId ?? null);
  return meetings.find((meeting) => meeting.id === id)!;
}

export async function updateMeeting(
  userId: string,
  meetingId: string,
  input: {
    title?: string;
    agenda?: string;
    notes?: string;
    scheduledAt?: string | null;
    durationMinutes?: number;
    status?: Meeting["status"];
    summary?: string;
    actionItems?: MeetingActionItem[];
  },
): Promise<Meeting> {
  const existing = await one<{ workspace_id: string; project_id: string | null }>(
    `SELECT workspace_id, project_id FROM meetings WHERE id = $1`,
    [meetingId],
  );
  if (!existing) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  if (existing.project_id) await assertProjectAccess(userId, existing.project_id);
  else await assertWorkspaceAccess(userId, existing.workspace_id);
  await query(
    `UPDATE meetings SET
       title = COALESCE($2, title),
       agenda = COALESCE($3, agenda),
       notes = COALESCE($4, notes),
       scheduled_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE scheduled_at END,
       duration_minutes = COALESCE($7, duration_minutes),
       status = COALESCE($8, status),
       summary = COALESCE($9, summary),
       action_items_json = COALESCE($10, action_items_json),
       updated_at = now()
     WHERE id = $1`,
    [
      meetingId,
      input.title?.trim() || null,
      input.agenda ?? null,
      input.notes ?? null,
      input.scheduledAt !== undefined,
      input.scheduledAt ? new Date(input.scheduledAt).toISOString() : null,
      input.durationMinutes ?? null,
      input.status ?? null,
      input.summary ?? null,
      input.actionItems ? JSON.stringify(input.actionItems) : null,
    ],
  );
  const meetings = await listMeetings(userId, existing.workspace_id, existing.project_id);
  return meetings.find((meeting) => meeting.id === meetingId)!;
}

export async function convertActionItemsToTasks(
  userId: string,
  meetingId: string,
  projectId: string,
): Promise<BoardTask[]> {
  const meeting = await one<{
    workspace_id: string;
    project_id: string | null;
    action_items_json: unknown;
  }>(`SELECT workspace_id, project_id, action_items_json FROM meetings WHERE id = $1`, [meetingId]);
  if (!meeting) throw new ApiError(404, "MEETING_NOT_FOUND", "Meeting not found.");
  await assertWorkspaceAccess(userId, meeting.workspace_id);
  if (meeting.project_id && meeting.project_id !== projectId) {
    throw new ApiError(422, "PROJECT_MISMATCH", "The meeting belongs to another project.");
  }
  await assertProjectAccess(userId, projectId, ["owner", "pm", "member"]);
  const items = Array.isArray(meeting.action_items_json)
    ? (meeting.action_items_json as MeetingActionItem[])
    : [];
  if (items.length === 0) return [];

  const created: BoardTask[] = [];
  const updatedItems: MeetingActionItem[] = [];
  for (const item of items) {
    if (item.taskId) {
      updatedItems.push(item);
      continue;
    }
    const task = await createTask(userId, projectId, {
      title: item.title.slice(0, 200),
      description: `Created from meeting action item. Owner: ${item.owner || "unassigned"}.`,
      priority: "P2",
      sourceTicketId: null,
      labels: ["meeting-action"],
    });
    created.push(task);
    updatedItems.push({ ...item, taskId: task.id });
  }
  await query(
    `UPDATE meetings SET action_items_json = $2, updated_at = now() WHERE id = $1`,
    [meetingId, JSON.stringify(updatedItems)],
  );
  return created;
}

export async function listThreads(
  userId: string,
  workspaceId: string,
  projectId?: string | null,
): Promise<ForumThread[]> {
  if (projectId) await assertProjectAccess(userId, projectId);
  else await assertWorkspaceAccess(userId, workspaceId);
  const result = await query<{
    id: string;
    workspace_id: string;
    project_id: string | null;
    title: string;
    body: string;
    category: string;
    solved: boolean;
    created_by_name: string | null;
    reply_count: number;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT t.id, t.workspace_id, t.project_id, t.title, t.body, t.category, t.solved,
            u.name AS created_by_name,
            (SELECT count(*)::int FROM forum_replies r WHERE r.thread_id = t.id) AS reply_count,
            t.created_at, t.updated_at
     FROM forum_threads t LEFT JOIN users u ON u.id = t.created_by
     WHERE t.workspace_id = $1 AND ($2::text IS NULL OR t.project_id = $2)
     ORDER BY t.solved ASC, t.updated_at DESC`,
    [workspaceId, projectId ?? null],
  );
  return result.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    title: row.title,
    body: row.body,
    category: row.category,
    solved: row.solved,
    createdByName: row.created_by_name,
    replyCount: row.reply_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getThread(userId: string, threadId: string): Promise<ForumThread> {
  const thread = await one<{
    id: string;
    workspace_id: string;
    project_id: string | null;
    title: string;
    body: string;
    category: string;
    solved: boolean;
    created_by_name: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT t.id, t.workspace_id, t.project_id, t.title, t.body, t.category, t.solved,
            u.name AS created_by_name, t.created_at, t.updated_at
     FROM forum_threads t LEFT JOIN users u ON u.id = t.created_by WHERE t.id = $1`,
    [threadId],
  );
  if (!thread) throw new ApiError(404, "THREAD_NOT_FOUND", "Discussion not found.");
  if (thread.project_id) await assertProjectAccess(userId, thread.project_id);
  else await assertWorkspaceAccess(userId, thread.workspace_id);
  const replies = await query<{
    id: string;
    thread_id: string;
    body: string;
    created_by: string | null;
    created_by_name: string | null;
    created_at: string;
  }>(
    `SELECT r.id, r.thread_id, r.body, r.created_by, u.name AS created_by_name, r.created_at
     FROM forum_replies r LEFT JOIN users u ON u.id = r.created_by
     WHERE r.thread_id = $1 ORDER BY r.created_at`,
    [threadId],
  );
  return {
    id: thread.id,
    workspaceId: thread.workspace_id,
    projectId: thread.project_id,
    title: thread.title,
    body: thread.body,
    category: thread.category,
    solved: thread.solved,
    createdByName: thread.created_by_name,
    replyCount: replies.rows.length,
    createdAt: thread.created_at,
    updatedAt: thread.updated_at,
    replies: replies.rows.map((reply) => ({
      id: reply.id,
      threadId: reply.thread_id,
      body: reply.body,
      createdBy: reply.created_by,
      createdByName: reply.created_by_name,
      createdAt: reply.created_at,
    })),
  };
}

export async function createThread(
  userId: string,
  workspaceId: string,
  input: { title: string; body: string; category?: string; projectId?: string | null },
): Promise<ForumThread> {
  if (input.projectId) await assertProjectAccess(userId, input.projectId, ["owner", "pm", "member"]);
  else await assertWorkspaceAccess(userId, workspaceId, ["owner", "admin", "manager", "member"]);
  const id = newId("thr");
  await query(
    `INSERT INTO forum_threads (id, workspace_id, project_id, title, body, category, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, workspaceId, input.projectId ?? null, input.title.trim(), input.body, input.category ?? "general", userId],
  );
  return getThread(userId, id);
}

export async function replyToThread(userId: string, threadId: string, body: string): Promise<ForumThread> {
  const thread = await one<{ workspace_id: string; project_id: string | null }>(
    `SELECT workspace_id, project_id FROM forum_threads WHERE id = $1`,
    [threadId],
  );
  if (!thread) throw new ApiError(404, "THREAD_NOT_FOUND", "Discussion not found.");
  if (thread.project_id) await assertProjectAccess(userId, thread.project_id, ["owner", "pm", "member"]);
  else await assertWorkspaceAccess(userId, thread.workspace_id, ["owner", "admin", "manager", "member"]);
  await query(
    `INSERT INTO forum_replies (id, thread_id, body, created_by) VALUES ($1,$2,$3,$4)`,
    [newId("rep"), threadId, body, userId],
  );
  await query(`UPDATE forum_threads SET updated_at = now() WHERE id = $1`, [threadId]);
  return getThread(userId, threadId);
}

export async function setThreadSolved(userId: string, threadId: string, solved: boolean): Promise<ForumThread> {
  const thread = await one<{ workspace_id: string; project_id: string | null }>(
    `SELECT workspace_id, project_id FROM forum_threads WHERE id = $1`,
    [threadId],
  );
  if (!thread) throw new ApiError(404, "THREAD_NOT_FOUND", "Discussion not found.");
  if (thread.project_id) await assertProjectAccess(userId, thread.project_id, ["owner", "pm", "member"]);
  else await assertWorkspaceAccess(userId, thread.workspace_id, ["owner", "admin", "manager", "member"]);
  await query(`UPDATE forum_threads SET solved = $2, updated_at = now() WHERE id = $1`, [threadId, solved]);
  return getThread(userId, threadId);
}
