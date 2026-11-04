"""Notification centre and notification preferences."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from api.deps import current_user, require_workspace_id
from api.schemas import UpdateNotificationPreferencesInput
from services import notification_service

router = APIRouter(tags=["notifications"])


@router.get("/notifications")
def list_notifications(
    request: Request,
    status: str = Query(default="all", pattern="^(all|unread)$"),
    limit: int = Query(default=20, ge=1, le=50),
    offset: int = Query(default=0, ge=0),
    user: dict = Depends(current_user),
):
    workspace_id = require_workspace_id(request)
    return notification_service.list_notifications(
        user["id"], workspace_id, status=status, limit=limit, offset=offset
    )


@router.get("/notifications/unread-count")
def unread_count(request: Request, user: dict = Depends(current_user)):
    workspace_id = require_workspace_id(request)
    result = notification_service.list_notifications(
        user["id"], workspace_id, status="unread", limit=1, offset=0
    )
    return {"unreadCount": result["unreadCount"]}


@router.post("/notifications/{notification_id}/read")
def mark_read(notification_id: str, user: dict = Depends(current_user)):
    return notification_service.mark_read(user["id"], notification_id)


@router.post("/notifications/read-all")
def mark_all_read(request: Request, user: dict = Depends(current_user)):
    workspace_id = require_workspace_id(request)
    return notification_service.mark_all_read(user["id"], workspace_id)


@router.get("/notification-preferences")
def list_preferences(user: dict = Depends(current_user)):
    return notification_service.list_preferences(user["id"])


@router.patch("/notification-preferences")
def update_preferences(
    payload: UpdateNotificationPreferencesInput, user: dict = Depends(current_user)
):
    return notification_service.update_preferences(
        user["id"], [item.model_dump() for item in payload.preferences]
    )
