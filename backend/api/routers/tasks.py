"""Tasks, dependencies, milestones — project delivery surface."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.deps import current_user
from api.schemas import (
    CreateMilestoneInput,
    CreateTaskInput,
    DependencyInput,
    UpdateMilestoneInput,
    UpdateTaskInput,
)
from services import task_service

router = APIRouter(tags=["tasks"])


@router.get("/projects/{project_id}/tasks")
def list_tasks(project_id: str, user: dict = Depends(current_user)):
    return {"tasks": task_service.list_project_tasks(user["id"], project_id)}


@router.post("/projects/{project_id}/tasks", status_code=201)
def create_task(
    project_id: str,
    payload: CreateTaskInput,
    user: dict = Depends(current_user),
):
    return task_service.create_task(user["id"], project_id, payload.model_dump())


@router.patch("/tasks/{task_id}")
def update_task(
    task_id: str,
    payload: UpdateTaskInput,
    user: dict = Depends(current_user),
):
    data = {key: value for key, value in payload.model_dump().items() if key in payload.model_fields_set}
    return task_service.update_task(user["id"], task_id, data)


@router.post("/projects/{project_id}/dependencies", status_code=201)
def add_dependency(
    project_id: str,
    payload: DependencyInput,
    user: dict = Depends(current_user),
):
    task_service.add_task_dependency(
        user["id"], project_id, payload.predecessorId, payload.successorId
    )
    return {"ok": True}


@router.delete("/projects/{project_id}/dependencies")
def remove_dependency(
    project_id: str,
    payload: DependencyInput,
    user: dict = Depends(current_user),
):
    task_service.remove_task_dependency(
        user["id"], project_id, payload.predecessorId, payload.successorId
    )
    return {"ok": True}


@router.get("/projects/{project_id}/roadmap")
def roadmap(project_id: str, user: dict = Depends(current_user)):
    return task_service.project_roadmap(user["id"], project_id)


@router.post("/projects/{project_id}/milestones", status_code=201)
def create_milestone(
    project_id: str,
    payload: CreateMilestoneInput,
    user: dict = Depends(current_user),
):
    return task_service.create_milestone(user["id"], project_id, payload.model_dump())


@router.patch("/milestones/{milestone_id}")
def update_milestone(
    milestone_id: str,
    payload: UpdateMilestoneInput,
    user: dict = Depends(current_user),
):
    data = {key: value for key, value in payload.model_dump().items() if key in payload.model_fields_set}
    return task_service.update_milestone(user["id"], milestone_id, data)
