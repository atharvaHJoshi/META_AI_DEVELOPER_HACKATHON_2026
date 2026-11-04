"""Projects: list/create, plan retrieval, plan generation, tickets, history."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from api.deps import current_user, workspace_id
from api.schemas import CreateProjectInput, GeneratePlanInput
from core.errors import ApiError
from services import plan_service, project_service

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("")
def list_projects(request: Request, user: dict = Depends(current_user)):
    return {"projects": project_service.list_projects(user["id"], workspace_id(request))}


@router.post("/generate-plan")
def generate_plan(payload: GeneratePlanInput):
    return plan_service.generate_plan(payload.model_dump(), None)


@router.post("", status_code=201)
def create_project(
    payload: CreateProjectInput,
    request: Request,
    user: dict = Depends(current_user),
):
    plan = project_service.create_project(
        user["id"],
        payload.model_dump(),
        payload.generation.model_dump() if payload.generation else None,
        {"workspaceId": workspace_id(request)},
    )
    return plan


@router.get("/{project_id}/plan")
def get_plan(project_id: str, user: dict = Depends(current_user)):
    return project_service.get_project_plan(user["id"], project_id)


@router.get("/{project_id}/tickets")
def list_tickets(project_id: str, user: dict = Depends(current_user)):
    return {"tickets": project_service.list_tickets(user["id"], project_id)}


@router.get("/{project_id}/history")
def history(project_id: str, user: dict = Depends(current_user)):
    return project_service.get_project_history(user["id"], project_id)
