"""Bootstrap payload: projects, users, orgs, workspaces, AI mode, counts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from api.deps import current_user, workspace_id
from services.project_service import get_bootstrap

router = APIRouter(tags=["bootstrap"])


@router.get("/bootstrap")
def bootstrap(request: Request, user: dict = Depends(current_user)):
    return get_bootstrap(user["id"], workspace_id(request))
