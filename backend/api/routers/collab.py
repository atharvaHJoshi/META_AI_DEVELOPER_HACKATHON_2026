"""Collaboration: documents, meetings, forum threads."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.deps import current_user
from api.schemas import (
    CreateDocumentInput,
    CreateMeetingInput,
    CreateThreadInput,
    MeetingActionsInput,
    ReplyInput,
    SolvedInput,
    UpdateDocumentInput,
    UpdateMeetingInput,
)
from services import assistant_service, collab_service

router = APIRouter(tags=["collab"])


@router.get("/workspaces/{workspace_id}/documents")
def list_documents(
    workspace_id: str,
    projectId: str | None = Query(default=None),
    user: dict = Depends(current_user),
):
    return {"documents": collab_service.list_documents(user["id"], workspace_id, projectId)}


@router.post("/workspaces/{workspace_id}/documents", status_code=201)
def create_document(
    workspace_id: str,
    payload: CreateDocumentInput,
    user: dict = Depends(current_user),
):
    return collab_service.create_document(user["id"], workspace_id, payload.model_dump())


@router.patch("/documents/{document_id}")
def update_document(
    document_id: str,
    payload: UpdateDocumentInput,
    user: dict = Depends(current_user),
):
    data = {key: value for key, value in payload.model_dump().items() if key in payload.model_fields_set}
    return collab_service.update_document(user["id"], document_id, data)


@router.delete("/documents/{document_id}")
def delete_document(document_id: str, user: dict = Depends(current_user)):
    collab_service.delete_document(user["id"], document_id)
    return {"ok": True}


@router.get("/workspaces/{workspace_id}/meetings")
def list_meetings(
    workspace_id: str,
    projectId: str | None = Query(default=None),
    user: dict = Depends(current_user),
):
    return {"meetings": collab_service.list_meetings(user["id"], workspace_id, projectId)}


@router.post("/workspaces/{workspace_id}/meetings", status_code=201)
def create_meeting(
    workspace_id: str,
    payload: CreateMeetingInput,
    user: dict = Depends(current_user),
):
    return collab_service.create_meeting(user["id"], workspace_id, payload.model_dump())


@router.patch("/meetings/{meeting_id}")
def update_meeting(
    meeting_id: str,
    payload: UpdateMeetingInput,
    user: dict = Depends(current_user),
):
    data = {key: value for key, value in payload.model_dump().items() if key in payload.model_fields_set}
    return collab_service.update_meeting(user["id"], meeting_id, data)


@router.post("/meetings/{meeting_id}/summarize")
def summarize_meeting(meeting_id: str, user: dict = Depends(current_user)):
    return assistant_service.summarize_meeting(user["id"], meeting_id)


@router.post("/meetings/{meeting_id}/actions", status_code=201)
def convert_action_items(
    meeting_id: str,
    payload: MeetingActionsInput,
    user: dict = Depends(current_user),
):
    tasks = collab_service.convert_action_items_to_tasks(
        user["id"], meeting_id, payload.projectId
    )
    return {"tasks": tasks}


@router.get("/workspaces/{workspace_id}/threads")
def list_threads(
    workspace_id: str,
    projectId: str | None = Query(default=None),
    user: dict = Depends(current_user),
):
    return {"threads": collab_service.list_threads(user["id"], workspace_id, projectId)}


@router.post("/workspaces/{workspace_id}/threads", status_code=201)
def create_thread(
    workspace_id: str,
    payload: CreateThreadInput,
    user: dict = Depends(current_user),
):
    return collab_service.create_thread(user["id"], workspace_id, payload.model_dump())


@router.get("/threads/{thread_id}")
def get_thread(thread_id: str, user: dict = Depends(current_user)):
    return collab_service.get_thread(user["id"], thread_id)


@router.post("/threads/{thread_id}/replies", status_code=201)
def reply_to_thread(
    thread_id: str,
    payload: ReplyInput,
    user: dict = Depends(current_user),
):
    return collab_service.reply_to_thread(user["id"], thread_id, payload.body)


@router.patch("/threads/{thread_id}")
def set_thread_solved(
    thread_id: str,
    payload: SolvedInput,
    user: dict = Depends(current_user),
):
    return collab_service.set_thread_solved(user["id"], thread_id, payload.solved)
