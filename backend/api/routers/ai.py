"""AI status, document drafting and per-workspace AI usage telemetry."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from api.deps import current_user
from api.schemas import DraftDocumentInput, ProjectQuestionInput
from core.errors import ApiError
from django.db import connection

from services import assistant_service, authz, project_qa

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status")
def ai_status():
    return assistant_service.assistant_status()


@router.post("/documents/draft")
def draft_document(
    payload: DraftDocumentInput,
    user: dict = Depends(current_user),
):
    return assistant_service.draft_document(user["id"], payload.workspaceId, payload.model_dump())


@router.post("/projects/{project_id}/ask")
def ask_project(
    project_id: str,
    payload: ProjectQuestionInput,
    user: dict = Depends(current_user),
):
    return project_qa.answer_project_question(user["id"], project_id, payload.question)


@router.get("/usage")
def ai_usage(
    request: Request,
    workspaceId: str = Query(default=""),
    user: dict = Depends(current_user),
):
    if not workspaceId:
        return {"usage": []}
    authz.assert_workspace_access(user["id"], workspaceId)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT workflow, provider, model, count(*)::int AS calls,
                   count(*) FILTER (WHERE degraded)::int AS degraded,
                   sum((usage_json->>'inputTokens')::int) AS input_tokens,
                   sum((usage_json->>'outputTokens')::int) AS output_tokens,
                   max(created_at) AS last_call
            FROM ai_calls
            WHERE workspace_id = %s
            GROUP BY workflow, provider, model
            ORDER BY calls DESC
            """,
            [workspaceId],
        )
        rows = cursor.fetchall()
        columns = [column[0] for column in cursor.description]
    usage = [dict(zip(columns, row)) for row in rows]
    for item in usage:
        last_call = item.get("last_call")
        from core.common import iso_datetime

        item["last_call"] = iso_datetime(last_call)
    return {"usage": usage}
