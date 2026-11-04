"""Organizations, workspaces, members, teams — ported from orgService.ts."""

from __future__ import annotations

from django.db import connection, transaction

from core.common import iso_datetime, new_id, slugify
from core.errors import ApiError
from platform_app import models
from services import authz

ORGANIZATION_ROLES = ("owner", "admin", "manager", "member", "viewer")


def _unique_slug(table: str, base: str) -> str:
    candidate = base
    suffix = 2
    while True:
        if table == "organizations":
            exists = models.Organization.objects.filter(slug=candidate).exists()
        else:
            exists = models.Workspace.objects.filter(slug=candidate).exists()
        if not exists:
            return candidate
        candidate = f"{base}-{suffix}"
        suffix += 1


def list_organizations(user_id: str) -> list[dict]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT o.id, o.name, o.slug, o.description, om.role,
                   (SELECT count(*)::int FROM workspaces w WHERE w.organization_id = o.id) AS workspace_count,
                   (SELECT count(*)::int FROM organization_members m WHERE m.organization_id = o.id) AS member_count
            FROM organizations o
            JOIN organization_members om ON om.organization_id = o.id AND om.user_id = %s
            ORDER BY o.name
            """,
            [user_id],
        )
        rows = cursor.fetchall()
    return [
        {
            "id": row[0],
            "name": row[1],
            "slug": row[2],
            "description": row[3],
            "role": row[4],
            "workspaceCount": row[5],
            "memberCount": row[6],
        }
        for row in rows
    ]


def list_workspaces(user_id: str, organization_id: str | None = None) -> list[dict]:
    # Port of the CASE semantics in listWorkspaces(): the workspace role wins,
    # falling back to the organization role; only memberships grant visibility.
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT w.id, w.organization_id, w.name, w.slug, w.description,
                   w.onboarding_stage,
                   CASE
                     WHEN COALESCE(wm.role, 'viewer') = 'owner' OR COALESCE(om.role, 'viewer') = 'owner' THEN 'owner'
                     WHEN COALESCE(wm.role, 'viewer') = 'admin' OR COALESCE(om.role, 'viewer') = 'admin' THEN 'admin'
                     WHEN COALESCE(wm.role, 'viewer') = 'manager' OR COALESCE(om.role, 'viewer') = 'manager' THEN 'manager'
                     WHEN COALESCE(wm.role, 'viewer') = 'member' OR COALESCE(om.role, 'viewer') = 'member' THEN 'member'
                     ELSE 'viewer'
                   END AS role,
                   (SELECT count(*)::int FROM workspace_members m WHERE m.workspace_id = w.id) AS member_count,
                   (SELECT count(*)::int FROM projects p WHERE p.workspace_id = w.id) AS project_count
            FROM workspaces w
            LEFT JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = %s
            LEFT JOIN organization_members om ON om.organization_id = w.organization_id AND om.user_id = %s
            WHERE (wm.user_id = %s OR om.user_id = %s)
              AND (%s::text IS NULL OR w.organization_id = %s)
            ORDER BY project_count DESC, w.name
            """,
            [user_id, user_id, user_id, user_id, organization_id, organization_id],
        )
        rows = cursor.fetchall()
        columns = [column[0] for column in cursor.description]
    return [
        {
            "id": row[0],
            "organizationId": row[1],
            "name": row[2],
            "slug": row[3],
            "description": row[4],
            "onboardingStage": row[5],
            "role": row[6],
            "memberCount": row[7],
            "projectCount": row[8],
        }
        for row in rows
    ]


def get_workspace(user_id: str, workspace_id: str) -> dict:
    for workspace in list_workspaces(user_id):
        if workspace["id"] == workspace_id:
            return workspace
    raise ApiError(404, "WORKSPACE_NOT_FOUND", "Workspace not found.")


def create_organization(
    user_id: str, input_data: dict
) -> dict:
    org_name = (input_data.get("name") or "").strip()
    if len(org_name) < 2:
        raise ApiError(422, "INVALID_NAME", "Organization name is too short.")
    workspace_name = (input_data.get("workspaceName") or f"{org_name} workspace").strip()
    org_id = new_id("org")
    ws_id = new_id("ws")
    org_slug = _unique_slug("organizations", slugify(org_name))
    ws_slug = _unique_slug("workspaces", slugify(workspace_name))

    with transaction.atomic():
        models.Organization.objects.create(
            id=org_id,
            name=org_name,
            slug=org_slug,
            description=input_data.get("description") or "",
            created_by=user_id,
        )
        models.OrganizationMember.objects.create(
            organization_id=org_id, user_id=user_id, role="owner"
        )
        models.Workspace.objects.create(
            id=ws_id,
            organization_id=org_id,
            name=workspace_name,
            slug=ws_slug,
            created_by=user_id,
        )
        models.WorkspaceMember.objects.create(
            workspace_id=ws_id, user_id=user_id, role="owner"
        )
        from services.auth_service import record_security_audit

        record_security_audit(
            user_id,
            "organization.created",
            "success",
            {},
            {"organizationId": org_id, "workspaceId": ws_id},
        )

    organizations = list_organizations(user_id)
    workspaces = list_workspaces(user_id)
    organization = next((item for item in organizations if item["id"] == org_id), None)
    workspace = next((item for item in workspaces if item["id"] == ws_id), None)
    if organization is None or workspace is None:
        raise ApiError(
            500, "ORGANIZATION_CREATE_FAILED",
            "Organization could not be loaded after creation.",
        )
    return {"organization": organization, "workspace": workspace}


def ensure_personal_workspace(user_id: str, name: str) -> None:
    if models.WorkspaceMember.objects.filter(user_id=user_id).exists():
        return
    first_name = (name.split(" ")[0] if name else "Personal") or "Personal"
    create_organization(
        user_id, {"name": f"{first_name}'s organization", "workspaceName": "General"}
    )


def create_workspace(
    user_id: str, organization_id: str, input_data: dict
) -> dict:
    authz.assert_organization_access(
        user_id, organization_id, ["owner", "admin", "manager"]
    )
    name = (input_data.get("name") or "").strip()
    if len(name) < 2:
        raise ApiError(422, "INVALID_NAME", "Workspace name is too short.")
    id_ = new_id("ws")
    slug = _unique_slug("workspaces", slugify(name))
    with transaction.atomic():
        models.Workspace.objects.create(
            id=id_,
            organization_id=organization_id,
            name=name,
            slug=slug,
            description=input_data.get("description") or "",
            created_by=user_id,
        )
        models.WorkspaceMember.objects.create(
            workspace_id=id_, user_id=user_id, role="owner"
        )
    return get_workspace(user_id, id_)


def update_workspace(user_id: str, workspace_id: str, input_data: dict) -> dict:
    authz.assert_workspace_access(
        user_id, workspace_id, ["owner", "admin", "manager"]
    )
    updates: dict = {}
    if input_data.get("name") is not None:
        name = str(input_data["name"]).strip()
        if name:
            updates["name"] = name
    if input_data.get("description") is not None:
        updates["description"] = input_data["description"]
    if input_data.get("onboardingStage") is not None:
        updates["onboarding_stage"] = input_data["onboardingStage"]
    if input_data.get("aiContext") is not None:
        updates["ai_context_json"] = input_data["aiContext"]
    if updates:
        updates["updated_at"] = _now()
        models.Workspace.objects.filter(id=workspace_id).update(**updates)
    return get_workspace(user_id, workspace_id)


def _now():
    from django.utils import timezone

    return timezone.now()


MEMBER_ROLE_ORDER = {"owner": 0, "admin": 1, "manager": 2, "member": 3, "viewer": 4}


def list_workspace_members(user_id: str, workspace_id: str) -> list[dict]:
    authz.assert_workspace_access(user_id, workspace_id)
    rows = list(
        models.WorkspaceMember.objects.filter(workspace_id=workspace_id)
        .select_related("user")
        .order_by("role", "user__name")
    )
    rows.sort(key=lambda row: (MEMBER_ROLE_ORDER.get(row.role, 4), row.user.name))
    return [
        {
            "userId": row.user_id,
            "name": row.user.name,
            "email": row.user.email,
            "title": row.user.title,
            "avatarColor": row.user.avatar_color,
            "role": row.role,
            "createdAt": iso_datetime(row.created_at),
        }
        for row in rows
    ]


def list_organization_members(user_id: str, organization_id: str) -> list[dict]:
    authz.assert_organization_access(user_id, organization_id)
    rows = list(
        models.OrganizationMember.objects.filter(organization_id=organization_id)
        .select_related("user")
    )
    rows.sort(key=lambda row: (MEMBER_ROLE_ORDER.get(row.role, 4), row.user.name))
    return [
        {
            "userId": row.user_id,
            "name": row.user.name,
            "email": row.user.email,
            "title": row.user.title,
            "avatarColor": row.user.avatar_color,
            "role": row.role,
            "createdAt": iso_datetime(row.created_at),
        }
        for row in rows
    ]


def _resolve_target_user(actor_id: str, input_data: dict):
    user_id = input_data.get("userId")
    if user_id:
        return models.User.objects.filter(id=user_id).only("id").first()
    email = (input_data.get("email") or "").strip().lower()
    if email:
        target = (
            models.User.objects.filter(email__iexact=email).only("id").first()
        )
        if target is None:
            new_id_ = new_id("usr")
            name = email.split("@")[0] or "Invited member"
            models.User.objects.create(
                id=new_id_, name=name, email=email, title="", status="pending"
            )
            return models.User(id=new_id_)
        return target
    return None


def add_workspace_member(actor_id: str, workspace_id: str, input_data: dict) -> None:
    authz.assert_workspace_access(actor_id, workspace_id, ["owner", "admin", "manager"])
    role = input_data.get("role") or "member"
    if role == "owner":
        raise ApiError(
            403, "ROLE_NOT_ASSIGNABLE",
            "Only the existing owner can transfer ownership.",
        )
    target = _resolve_target_user(actor_id, input_data)
    if target is None:
        raise ApiError(422, "MEMBER_REQUIRED", "Provide a user id or email.")

    with transaction.atomic():
        models.WorkspaceMember.objects.update_or_create(
            workspace_id=workspace_id, user_id=target.id, defaults={"role": role}
        )
        from services.auth_service import record_security_audit

        record_security_audit(
            actor_id,
            "workspace.member_added",
            "success",
            {},
            {"workspaceId": workspace_id, "memberId": target.id, "role": role},
        )


def add_organization_member(actor_id: str, organization_id: str, input_data: dict) -> None:
    authz.assert_organization_access(actor_id, organization_id, ["owner", "admin"])
    role = input_data.get("role") or "member"
    if role == "owner":
        raise ApiError(
            403, "ROLE_NOT_ASSIGNABLE",
            "Ownership transfer is not supported here.",
        )
    target = _resolve_target_user(actor_id, input_data)
    if target is None:
        raise ApiError(422, "MEMBER_REQUIRED", "Provide a user id or email.")
    models.OrganizationMember.objects.update_or_create(
        organization_id=organization_id, user_id=target.id, defaults={"role": role}
    )


def update_workspace_member_role(
    actor_id: str, workspace_id: str, member_id: str, role: str
) -> None:
    actor_role = authz.assert_workspace_access(actor_id, workspace_id, ["owner", "admin"])
    if member_id == actor_id and role != "owner" and actor_role == "owner":
        owners = models.WorkspaceMember.objects.filter(
            workspace_id=workspace_id, role="owner"
        ).count()
        if owners <= 1:
            raise ApiError(
                409, "LAST_OWNER", "The workspace must retain at least one owner."
            )
    if role == "owner" and actor_role != "owner":
        raise ApiError(403, "FORBIDDEN", "Only an owner can grant ownership.")
    updated = models.WorkspaceMember.objects.filter(
        workspace_id=workspace_id, user_id=member_id
    ).update(role=role)
    if updated == 0:
        raise ApiError(404, "MEMBER_NOT_FOUND", "Member not found.")


def update_organization_member_role(
    actor_id: str, organization_id: str, member_id: str, role: str
) -> None:
    actor_role = authz.assert_organization_access(actor_id, organization_id, ["owner", "admin"])
    if role == "owner" and actor_role != "owner":
        raise ApiError(403, "FORBIDDEN", "Only an owner can grant ownership.")
    updated = models.OrganizationMember.objects.filter(
        organization_id=organization_id, user_id=member_id
    ).update(role=role)
    if updated == 0:
        raise ApiError(404, "MEMBER_NOT_FOUND", "Member not found.")


def remove_workspace_member(actor_id: str, workspace_id: str, member_id: str) -> None:
    authz.assert_workspace_access(actor_id, workspace_id, ["owner", "admin"])
    member = (
        models.WorkspaceMember.objects.filter(workspace_id=workspace_id, user_id=member_id)
        .values("role")
        .first()
    )
    if member is None:
        raise ApiError(404, "MEMBER_NOT_FOUND", "Member not found.")
    if member["role"] == "owner":
        owners = models.WorkspaceMember.objects.filter(
            workspace_id=workspace_id, role="owner"
        ).count()
        if owners <= 1:
            raise ApiError(
                409, "LAST_OWNER", "The workspace must retain at least one owner."
            )
    models.WorkspaceMember.objects.filter(
        workspace_id=workspace_id, user_id=member_id
    ).delete()


def list_teams(user_id: str, workspace_id: str) -> list[dict]:
    authz.assert_workspace_access(user_id, workspace_id)
    teams = list(
        models.Team.objects.filter(workspace_id=workspace_id)
        .select_related("lead")
        .order_by("name")
    )
    members = (
        models.TeamMember.objects.filter(team__workspace_id=workspace_id)
        .select_related("user", "team")
    )
    member_names = {
        (m.team_id, m.user_id): (m.user.name, m.user.avatar_color) for m in members
    }
    workspace_roles = {
        (m["workspace_id"], m["user_id"]): m["role"]
        for m in models.WorkspaceMember.objects.filter(
            workspace_id=workspace_id
        ).values("workspace_id", "user_id", "role")
    }
    return [
        {
            "id": team.id,
            "workspaceId": team.workspace_id,
            "name": team.name,
            "description": team.description,
            "leadId": team.lead_id,
            "leadName": team.lead.name if team.lead_id else None,
            "memberCount": sum(1 for key in member_names if key[0] == team.id),
            "members": [
                {
                    "userId": user_id,
                    "name": member_names[(team.id, user_id)][0],
                    "avatarColor": member_names[(team.id, user_id)][1],
                    "role": workspace_roles.get((workspace_id, user_id), "member"),
                }
                for (team_id, user_id) in sorted(member_names)
                if team_id == team.id
            ],
        }
        for team in teams
    ]


def create_team(user_id: str, workspace_id: str, input_data: dict):
    authz.assert_workspace_access(user_id, workspace_id, ["owner", "admin", "manager"])
    name = (input_data.get("name") or "").strip()
    if len(name) < 2:
        raise ApiError(422, "INVALID_NAME", "Team name is too short.")
    id_ = new_id("team")
    with transaction.atomic():
        models.Team.objects.create(
            id=id_,
            workspace_id=workspace_id,
            name=name,
            description=input_data.get("description") or "",
            lead_id=input_data.get("leadId"),
        )
        if input_data.get("leadId"):
            models.TeamMember.objects.get_or_create(
                team_id=id_, user_id=input_data["leadId"]
            )
    teams = list_teams(user_id, workspace_id)
    return next((team for team in teams if team["id"] == id_), None)


def add_team_member(user_id: str, workspace_id: str, team_id: str, member_id: str) -> None:
    authz.assert_workspace_access(user_id, workspace_id, ["owner", "admin", "manager"])
    exists = models.Team.objects.filter(id=team_id, workspace_id=workspace_id).exists()
    if not exists:
        raise ApiError(404, "TEAM_NOT_FOUND", "Team not found.")
    models.TeamMember.objects.get_or_create(team_id=team_id, user_id=member_id)


def workload(user_id: str, workspace_id: str) -> list[dict]:
    authz.assert_workspace_access(user_id, workspace_id)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT u.id AS user_id, u.name, u.avatar_color, wm.role,
                   count(t.id) FILTER (WHERE t.status <> 'done')::int AS open_tasks,
                   COALESCE(sum(t.estimate_days) FILTER (WHERE t.status <> 'done'), 0)::float AS estimate_days,
                   count(t.id) FILTER (WHERE t.status = 'in_progress')::int AS in_progress,
                   count(t.id) FILTER (WHERE t.status = 'blocked')::int AS blocked
            FROM workspace_members wm
            JOIN users u ON u.id = wm.user_id
            LEFT JOIN tasks t ON t.assignee_id = u.id
              AND t.project_id IN (SELECT id FROM projects WHERE workspace_id = %s)
            WHERE wm.workspace_id = %s
            GROUP BY u.id, u.name, u.avatar_color, wm.role
            ORDER BY estimate_days DESC, u.name
            """,
            [workspace_id, workspace_id],
        )
        rows = cursor.fetchall()
    return [
        {
            "userId": row[0],
            "name": row[1],
            "avatarColor": row[2],
            "role": row[3],
            "openTasks": row[4],
            "estimateDays": row[5],
            "inProgress": row[6],
            "blockedTasks": row[7],
        }
        for row in rows
    ]


def workspace_audit(user_id: str, workspace_id: str) -> list[dict]:
    authz.assert_workspace_access(user_id, workspace_id, ["owner", "admin", "manager"])
    rows = (
        models.SecurityAudit.objects.filter(metadata__workspaceId=workspace_id)
        .select_related("user")
        .order_by("-created_at")[:100]
    )
    return [
        {
            "id": row.id,
            "action": row.action,
            "outcome": row.outcome,
            "actorName": row.user.name if row.user_id else None,
            "metadata": row.metadata,
            "createdAt": iso_datetime(row.created_at),
        }
        for row in rows
    ]
