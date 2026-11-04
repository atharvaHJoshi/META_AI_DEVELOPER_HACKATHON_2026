"""Organizations, workspaces, members, teams, workload, audit, onboarding."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from api.deps import current_user
from api.schemas import (
    AddTeamMemberInput,
    CreateOrganizationInput,
    CreateTeamInput,
    CreateWorkspaceInput,
    MemberInput,
    OnboardingInput,
    UpdateMemberRoleInput,
    UpdateWorkspaceInput,
)
from services import org_service

organizations_router = APIRouter(prefix="/organizations", tags=["organizations"])
workspaces_router = APIRouter(prefix="/workspaces", tags=["workspaces"])


@organizations_router.get("")
def list_organizations(user: dict = Depends(current_user)):
    return {"organizations": org_service.list_organizations(user["id"])}


@organizations_router.post("", status_code=201)
def create_organization(payload: CreateOrganizationInput, user: dict = Depends(current_user)):
    return org_service.create_organization(user["id"], payload.model_dump())


@organizations_router.get("/{organization_id}/members")
def list_organization_members(
    organization_id: str, user: dict = Depends(current_user)
):
    return {"members": org_service.list_organization_members(user["id"], organization_id)}


@organizations_router.post("/{organization_id}/members", status_code=201)
def add_organization_member(
    organization_id: str,
    payload: MemberInput,
    user: dict = Depends(current_user),
):
    org_service.add_organization_member(user["id"], organization_id, payload.model_dump())
    return {"ok": True}


@organizations_router.patch("/{organization_id}/members/{user_id}")
def update_organization_member_role(
    organization_id: str,
    user_id: str,
    payload: UpdateMemberRoleInput,
    user: dict = Depends(current_user),
):
    org_service.update_organization_member_role(
        user["id"], organization_id, user_id, payload.role
    )
    return {"ok": True}


@workspaces_router.get("")
def list_workspaces(
    organizationId: str | None = Query(default=None),
    user: dict = Depends(current_user),
):
    return {"workspaces": org_service.list_workspaces(user["id"], organizationId)}


@workspaces_router.post("", status_code=201)
def create_workspace(payload: CreateWorkspaceInput, user: dict = Depends(current_user)):
    return org_service.create_workspace(
        user["id"], payload.organizationId, payload.model_dump()
    )


@workspaces_router.get("/{workspace_id}")
def get_workspace(workspace_id: str, user: dict = Depends(current_user)):
    return org_service.get_workspace(user["id"], workspace_id)


@workspaces_router.patch("/{workspace_id}")
def update_workspace(
    workspace_id: str,
    payload: UpdateWorkspaceInput,
    user: dict = Depends(current_user),
):
    data = {key: value for key, value in payload.model_dump().items() if key in payload.model_fields_set}
    return org_service.update_workspace(user["id"], workspace_id, data)


@workspaces_router.get("/{workspace_id}/members")
def list_members(workspace_id: str, user: dict = Depends(current_user)):
    return {"members": org_service.list_workspace_members(user["id"], workspace_id)}


@workspaces_router.post("/{workspace_id}/members", status_code=201)
def add_member(
    workspace_id: str,
    payload: MemberInput,
    user: dict = Depends(current_user),
):
    org_service.add_workspace_member(user["id"], workspace_id, payload.model_dump())
    return {"ok": True}


@workspaces_router.patch("/{workspace_id}/members/{user_id}")
def update_member_role(
    workspace_id: str,
    user_id: str,
    payload: UpdateMemberRoleInput,
    user: dict = Depends(current_user),
):
    org_service.update_workspace_member_role(user["id"], workspace_id, user_id, payload.role)
    return {"ok": True}


@workspaces_router.delete("/{workspace_id}/members/{user_id}")
def remove_member(
    workspace_id: str,
    user_id: str,
    user: dict = Depends(current_user),
):
    org_service.remove_workspace_member(user["id"], workspace_id, user_id)
    return {"ok": True}


@workspaces_router.get("/{workspace_id}/teams")
def list_teams(workspace_id: str, user: dict = Depends(current_user)):
    return {"teams": org_service.list_teams(user["id"], workspace_id)}


@workspaces_router.post("/{workspace_id}/teams", status_code=201)
def create_team(
    workspace_id: str,
    payload: CreateTeamInput,
    user: dict = Depends(current_user),
):
    return org_service.create_team(user["id"], workspace_id, payload.model_dump())


@workspaces_router.post("/{workspace_id}/teams/{team_id}/members", status_code=201)
def add_team_member(
    workspace_id: str,
    team_id: str,
    payload: AddTeamMemberInput,
    user: dict = Depends(current_user),
):
    org_service.add_team_member(user["id"], workspace_id, team_id, payload.userId)
    return {"ok": True}


@workspaces_router.get("/{workspace_id}/workload")
def workload(workspace_id: str, user: dict = Depends(current_user)):
    return {"workload": org_service.workload(user["id"], workspace_id)}


@workspaces_router.get("/{workspace_id}/audit")
def audit(workspace_id: str, user: dict = Depends(current_user)):
    return {"events": org_service.workspace_audit(user["id"], workspace_id)}


@workspaces_router.post("/{workspace_id}/onboarding")
def onboarding(
    workspace_id: str,
    payload: OnboardingInput,
    user: dict = Depends(current_user),
):
    return org_service.update_workspace(
        user["id"],
        workspace_id,
        {
            "onboardingStage": payload.stage,
            "aiContext": payload.aiContext,
            "name": payload.name,
            "description": payload.description,
        },
    )
