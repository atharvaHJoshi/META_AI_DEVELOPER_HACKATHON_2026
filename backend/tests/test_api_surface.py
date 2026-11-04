"""Write-surface integration tests for the MIRAIWERK API.

Complements ``test_api_integration.py`` (which covers the core decision loop) by
exercising the remaining mutating routes end-to-end through the ASGI app:
registration/login/session/password flows, organization and workspace
administration, teams, tasks, milestones, dependencies, collaboration documents,
meetings, discussions, AI assists, and reject/clarify decision outcomes.

Hermetic in the same sense as the main suite: deterministic AI provider, own
users/workspaces, and full cleanup through the Django ORM afterwards.
"""

from __future__ import annotations

import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

os.environ["DJANGO_SETTINGS_MODULE"] = "miraiwerk.settings"
os.environ["AI_PROVIDER"] = "deterministic"
os.environ["DJANGO_ALLOW_ASYNC_UNSAFE"] = "true"
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("GOOGLE_AI_API_KEY", None)
os.environ.pop("MODEL_API_KEY", None)
os.environ.pop("META_API_KEY", None)

import django  # noqa: E402

django.setup()

import pytest  # noqa: E402
from django.db import connection  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from miraiwerk.asgi import application  # noqa: E402
from platform_app import models  # noqa: E402

PREFIX = secrets.token_hex(4)
PASSWORD = f"Surface!{PREFIX}9"
NEW_PASSWORD = f"Rotated!{PREFIX}9"
OWNER_EMAIL = f"surface.owner.{PREFIX}@miraiwerk.test"
MEMBER_EMAIL = f"surface.member.{PREFIX}@miraiwerk.test"
VIEWER_EMAIL = f"surface.viewer.{PREFIX}@miraiwerk.test"
TEST_EMAILS = [OWNER_EMAIL, MEMBER_EMAIL, VIEWER_EMAIL]

client = TestClient(application)

state: dict = {
    "orgIds": [],
    "workspaceIds": [],
    "projectId": None,
    "milestoneId": None,
    "ownerToken": None,
    "memberToken": None,
    "viewerToken": None,
    "ownerId": None,
    "memberId": None,
    "viewerId": None,
    "workspaceId": None,
    "teamId": None,
    "meetingId": None,
    "documentId": None,
    "threadId": None,
}


def _register(email: str, full_name: str) -> dict:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": PASSWORD, "fullName": full_name},
    )
    assert response.status_code == 201, response.text
    payload = response.json()
    state["orgIds"].extend(org["id"] for org in payload["organizations"])
    state["workspaceIds"].extend(ws["id"] for ws in payload["workspaces"])
    return payload


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _cleanup() -> None:
    # Django emulates cascades in Python, so the ORM removes dependent rows in
    # the right order even though the database FKs are NO ACTION.
    project_ids = list(
        models.Project.objects.filter(workspace_id__in=state["workspaceIds"]).values_list(
            "id", flat=True
        )
    )
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('miraiwerk.audit_maintenance', 'on', false)")
    try:
        models.AiCall.objects.filter(workspace_id__in=state["workspaceIds"]).delete()
        models.AiCall.objects.filter(project_id__in=project_ids).delete()
        models.Notification.objects.filter(workspace_id__in=state["workspaceIds"]).delete()
        models.NotificationPreference.objects.filter(
            user_id__in=[state["ownerId"], state["memberId"], state["viewerId"]]
        ).delete()
        models.Project.objects.filter(id__in=project_ids).delete()
        models.Workspace.objects.filter(id__in=state["workspaceIds"]).delete()
        models.Organization.objects.filter(id__in=state["orgIds"]).delete()
        models.SecurityAudit.objects.filter(user_id__in=[
            state["ownerId"], state["memberId"], state["viewerId"]
        ]).delete()
        models.User.objects.filter(email__in=TEST_EMAILS).delete()
    finally:
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('miraiwerk.audit_maintenance', 'off', false)")


@pytest.fixture(scope="module", autouse=True)
def fixtures():
    owner = _register(OWNER_EMAIL, "Surface Owner")
    member = _register(MEMBER_EMAIL, "Surface Member")
    viewer = _register(VIEWER_EMAIL, "Surface Viewer")

    state["ownerToken"] = owner["accessToken"]
    state["memberToken"] = member["accessToken"]
    state["viewerToken"] = viewer["accessToken"]
    state["ownerId"] = owner["user"]["id"]
    state["memberId"] = member["user"]["id"]
    state["viewerId"] = viewer["user"]["id"]

    # A dedicated workspace under the owner's organization.
    owner_org = owner["organizations"][0]["id"]
    created_ws = client.post(
        "/api/workspaces",
        headers=_auth(state["ownerToken"]),
        json={"organizationId": owner_org, "name": f"Surface Workspace {PREFIX}"},
    )
    assert created_ws.status_code == 201, created_ws.text
    workspace = created_ws.json()
    state["workspaceId"] = workspace["id"]
    state["workspaceIds"].append(workspace["id"])

    for email, role in ((MEMBER_EMAIL, "member"), (VIEWER_EMAIL, "viewer")):
        added = client.post(
            f"/api/workspaces/{workspace['id']}/members",
            headers=_auth(state["ownerToken"]),
            json={"email": email, "role": role},
        )
        assert added.status_code == 201, added.text

    draft = {
        "name": f"Surface Project {PREFIX}",
        "goal": "Exercise every write route without touching demo data.",
        "description": "A deterministic integration fixture for the write API surface.",
        "startDate": "2026-11-02",
        "targetDate": "2026-12-18",
        "requirements": [
            {
                "tempId": "req_surface",
                "title": "Reliable checkout",
                "description": "Checkout must not duplicate captures.",
                "acceptanceCriteria": ["One capture per order"],
                "source": "explicit",
                "status": "confirmed",
            }
        ],
        "milestones": [
            {
                "tempId": "ms_surface",
                "title": "Surface baseline",
                "description": "",
                "targetDate": "2026-11-27",
                "releaseGate": False,
            }
        ],
        "tasks": [
            {
                "tempId": "task_base_one",
                "title": "Baseline implementation",
                "description": "",
                "requirementTempId": "req_surface",
                "milestoneTempId": "ms_surface",
                "estimateDays": 3,
                "priority": "P2",
                "ownerRole": "Engineering",
                "dependencies": [],
            },
            {
                "tempId": "task_base_two",
                "title": "Baseline validation",
                "description": "",
                "requirementTempId": "req_surface",
                "milestoneTempId": "ms_surface",
                "estimateDays": 2,
                "priority": "P2",
                "ownerRole": "QA",
                "dependencies": ["task_base_one"],
            },
        ],
        "assumptions": [],
        "missingInformation": [],
        "risks": [],
    }
    created = client.post(
        "/api/projects",
        headers={**_auth(state["ownerToken"]), "x-workspace-id": workspace["id"]},
        json={"draft": draft},
    )
    assert created.status_code == 201, created.text
    payload = created.json()
    state["projectId"] = payload["project"]["id"]
    state["milestoneId"] = payload["milestones"][0]["id"]

    yield

    _cleanup()


def test_registration_created_personal_org_and_workspace() -> None:
    me = client.get("/api/auth/me", headers=_auth(state["ownerToken"]))
    assert me.status_code == 200
    payload = me.json()
    assert payload["user"]["email"] == OWNER_EMAIL
    assert payload["organizations"]
    assert payload["workspaces"]


def test_profile_update_and_validation() -> None:
    response = client.patch(
        "/api/auth/profile",
        headers=_auth(state["ownerToken"]),
        json={"name": "Surface Owner Updated", "title": "Integration Lead"},
    )
    assert response.status_code == 200
    assert response.json()["user"]["name"] == "Surface Owner Updated"
    assert response.json()["user"]["title"] == "Integration Lead"

    invalid = client.patch(
        "/api/auth/profile",
        headers=_auth(state["ownerToken"]),
        json={"avatarColor": "not-a-colour"},
    )
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"


def test_login_creates_a_session_that_can_be_revoked() -> None:
    login = client.post(
        "/api/auth/login", json={"email": OWNER_EMAIL, "password": PASSWORD}
    )
    assert login.status_code == 200

    sessions = client.get("/api/auth/sessions", headers=_auth(state["ownerToken"]))
    assert sessions.status_code == 200
    listed = sessions.json()["sessions"]
    assert len(listed) >= 2

    target = next(item for item in listed if not item["current"])
    revoked = client.delete(
        f"/api/auth/sessions/{target['id']}", headers=_auth(state["ownerToken"])
    )
    assert revoked.status_code == 200
    assert revoked.json() == {"ok": True}

    missing = client.delete(
        f"/api/auth/sessions/{target['id']}", headers=_auth(state["ownerToken"])
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "SESSION_NOT_FOUND"


def test_demo_login_unknown_identity_is_404() -> None:
    response = client.post(
        "/api/auth/demo", json={"email": f"nobody.{PREFIX}@miraiwerk.test"}
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "DEMO_USER_NOT_FOUND"


def test_password_forgot_and_reset_round_trip() -> None:
    forgot = client.post(
        "/api/auth/password/forgot", json={"email": VIEWER_EMAIL}
    )
    assert forgot.status_code == 200
    token = forgot.json()["devToken"]
    assert token

    reset = client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": NEW_PASSWORD},
    )
    assert reset.status_code == 200

    old_password = client.post(
        "/api/auth/login", json={"email": VIEWER_EMAIL, "password": PASSWORD}
    )
    assert old_password.status_code == 401

    new_password = client.post(
        "/api/auth/login", json={"email": VIEWER_EMAIL, "password": NEW_PASSWORD}
    )
    assert new_password.status_code == 200

    reused = client.post(
        "/api/auth/password/reset",
        json={"token": token, "password": PASSWORD},
    )
    assert reused.status_code == 400
    assert reused.json()["error"]["code"] == "INVALID_RESET_TOKEN"


def test_logout_revokes_refresh_token() -> None:
    login = client.post(
        "/api/auth/login", json={"email": MEMBER_EMAIL, "password": PASSWORD}
    )
    assert login.status_code == 200
    refresh_token = login.json()["refreshToken"]

    logout = client.post(
        "/api/auth/logout",
        headers=_auth(state["memberToken"]),
        json={"refreshToken": refresh_token},
    )
    assert logout.status_code == 200

    reused = client.post("/api/auth/refresh", json={"refreshToken": refresh_token})
    assert reused.status_code == 401
    assert reused.json()["error"]["code"] == "SESSION_REVOKED"


def test_oauth_status_and_unconfigured_start() -> None:
    status = client.get("/api/auth/oauth/status")
    assert status.status_code == 200
    assert "meta" in status.json()
    assert "configured" in status.json()["meta"]

    start = client.get("/api/auth/oauth/meta/start")
    if start.status_code == 503:
        assert start.json()["error"]["code"] == "META_OAUTH_NOT_CONFIGURED"
    else:
        # Configured on this machine: it must redirect to Meta.
        assert start.status_code in (302, 307)


def test_organization_membership_administration() -> None:
    org_id = client.get("/api/auth/me", headers=_auth(state["ownerToken"])).json()[
        "organizations"
    ][0]["id"]

    listed = client.get(
        f"/api/organizations/{org_id}/members", headers=_auth(state["ownerToken"])
    )
    assert listed.status_code == 200
    assert any(item["userId"] == state["ownerId"] for item in listed.json()["members"])

    added = client.post(
        f"/api/organizations/{org_id}/members",
        headers=_auth(state["ownerToken"]),
        json={"email": MEMBER_EMAIL, "role": "member"},
    )
    assert added.status_code == 201

    demoted = client.patch(
        f"/api/organizations/{org_id}/members/{state['memberId']}",
        headers=_auth(state["ownerToken"]),
        json={"role": "viewer"},
    )
    assert demoted.status_code == 200

    listed_again = client.get(
        f"/api/organizations/{org_id}/members", headers=_auth(state["ownerToken"])
    )
    member = next(
        item for item in listed_again.json()["members"] if item["userId"] == state["memberId"]
    )
    assert member["role"] == "viewer"

    forbidden = client.patch(
        f"/api/organizations/{org_id}/members/{state['ownerId']}",
        headers=_auth(state["viewerToken"]),
        json={"role": "owner"},
    )
    assert forbidden.status_code == 403


def test_workspace_update_and_onboarding() -> None:
    workspace_id = state["workspaceId"]
    updated = client.patch(
        f"/api/workspaces/{workspace_id}",
        headers=_auth(state["ownerToken"]),
        json={"name": f"Surface Workspace Renamed {PREFIX}", "description": "Updated."},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == f"Surface Workspace Renamed {PREFIX}"

    onboarding = client.post(
        f"/api/workspaces/{workspace_id}/onboarding",
        headers=_auth(state["ownerToken"]),
        json={
            "stage": 4,
            "aiContext": {"tone": "concise", "nonNegotiables": ["No duplicate capture"]},
        },
    )
    assert onboarding.status_code == 200
    assert onboarding.json()["onboardingStage"] == 4

    detail = client.get(
        f"/api/workspaces/{workspace_id}", headers=_auth(state["ownerToken"])
    )
    assert detail.status_code == 200
    assert detail.json()["onboardingStage"] == 4

    viewer_patch = client.patch(
        f"/api/workspaces/{workspace_id}",
        headers=_auth(state["viewerToken"]),
        json={"name": "Viewer edit"},
    )
    assert viewer_patch.status_code == 403


def test_workspace_member_role_change_and_removal() -> None:
    workspace_id = state["workspaceId"]
    changed = client.patch(
        f"/api/workspaces/{workspace_id}/members/{state['memberId']}",
        headers=_auth(state["ownerToken"]),
        json={"role": "manager"},
    )
    assert changed.status_code == 200

    members = client.get(
        f"/api/workspaces/{workspace_id}/members", headers=_auth(state["ownerToken"])
    )
    member = next(
        item for item in members.json()["members"] if item["userId"] == state["memberId"]
    )
    assert member["role"] == "manager"

    removed = client.delete(
        f"/api/workspaces/{workspace_id}/members/{state['memberId']}",
        headers=_auth(state["ownerToken"]),
    )
    assert removed.status_code == 200

    # Re-add so later project-scoped tests can use the member token.
    re_added = client.post(
        f"/api/workspaces/{workspace_id}/members",
        headers=_auth(state["ownerToken"]),
        json={"email": MEMBER_EMAIL, "role": "member"},
    )
    assert re_added.status_code == 201


def test_team_creation_and_membership() -> None:
    workspace_id = state["workspaceId"]
    created = client.post(
        f"/api/workspaces/{workspace_id}/teams",
        headers=_auth(state["ownerToken"]),
        json={
            "name": f"Surface Team {PREFIX}",
            "description": "Integration team.",
            "leadId": state["ownerId"],
        },
    )
    assert created.status_code == 201, created.text
    team = created.json()
    state["teamId"] = team["id"]

    added = client.post(
        f"/api/workspaces/{workspace_id}/teams/{team['id']}/members",
        headers=_auth(state["ownerToken"]),
        json={"userId": state["memberId"]},
    )
    assert added.status_code == 201

    teams = client.get(
        f"/api/workspaces/{workspace_id}/teams", headers=_auth(state["ownerToken"])
    )
    assert teams.status_code == 200
    match = next(item for item in teams.json()["teams"] if item["id"] == team["id"])
    assert match["memberCount"] >= 2

    viewer_create = client.post(
        f"/api/workspaces/{workspace_id}/teams",
        headers=_auth(state["viewerToken"]),
        json={"name": "Viewer team"},
    )
    assert viewer_create.status_code == 403


def test_task_create_update_and_assignment() -> None:
    project_id = state["projectId"]
    created = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=_auth(state["ownerToken"]),
        json={
            "title": "Surface new task",
            "description": "Created through the write API.",
            "estimateDays": 2,
            "priority": "P1",
            "ownerRole": "Engineering",
            "milestoneId": state["milestoneId"],
            "assigneeId": state["memberId"],
            "labels": ["surface", "integration"],
        },
    )
    assert created.status_code == 201, created.text
    task = created.json()
    assert task["status"] == "planned"
    assert task["assigneeId"] == state["memberId"]
    assert task["labels"] == ["surface", "integration"]
    state["newTaskId"] = task["id"]

    updated = client.patch(
        f"/api/tasks/{task['id']}",
        headers=_auth(state["memberToken"]),
        json={"status": "in_progress", "priority": "P0", "estimateDays": 4},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "in_progress"
    assert updated.json()["priority"] == "P0"
    assert updated.json()["estimateDays"] == 4

    invalid_assignee = client.patch(
        f"/api/tasks/{task['id']}",
        headers=_auth(state["ownerToken"]),
        json={"assigneeId": "usr_missing"},
    )
    assert invalid_assignee.status_code == 422
    assert invalid_assignee.json()["error"]["code"] == "INVALID_ASSIGNEE"

    missing = client.patch(
        "/api/tasks/task_missing",
        headers=_auth(state["ownerToken"]),
        json={"title": "Nothing here"},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "TASK_NOT_FOUND"


def test_dependencies_add_and_remove() -> None:
    project_id = state["projectId"]
    second = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=_auth(state["ownerToken"]),
        json={"title": "Surface dependent task", "estimateDays": 1},
    )
    assert second.status_code == 201
    second_id = second.json()["id"]

    added = client.post(
        f"/api/projects/{project_id}/dependencies",
        headers=_auth(state["ownerToken"]),
        json={"predecessorId": state["newTaskId"], "successorId": second_id},
    )
    assert added.status_code == 201

    tasks = client.get(
        f"/api/projects/{project_id}/tasks", headers=_auth(state["ownerToken"])
    )
    dependent = next(item for item in tasks.json()["tasks"] if item["id"] == second_id)
    assert state["newTaskId"] in dependent["dependencyIds"]

    self_dependency = client.post(
        f"/api/projects/{project_id}/dependencies",
        headers=_auth(state["ownerToken"]),
        json={"predecessorId": second_id, "successorId": second_id},
    )
    assert self_dependency.status_code == 422
    assert self_dependency.json()["error"]["code"] == "INVALID_DEPENDENCY"

    removed = client.request(
        "DELETE",
        f"/api/projects/{project_id}/dependencies",
        headers=_auth(state["ownerToken"]),
        json={"predecessorId": state["newTaskId"], "successorId": second_id},
    )
    assert removed.status_code == 200

    removed_again = client.request(
        "DELETE",
        f"/api/projects/{project_id}/dependencies",
        headers=_auth(state["ownerToken"]),
        json={"predecessorId": state["newTaskId"], "successorId": second_id},
    )
    assert removed_again.status_code == 404
    assert removed_again.json()["error"]["code"] == "DEPENDENCY_NOT_FOUND"


def test_milestone_create_and_update() -> None:
    project_id = state["projectId"]
    created = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=_auth(state["ownerToken"]),
        json={
            "title": "Surface release gate",
            "description": "Added through the write API.",
            "targetDate": "2026-12-04",
            "releaseGate": True,
        },
    )
    assert created.status_code == 201, created.text
    milestone = created.json()
    assert milestone["releaseGate"] is True

    updated = client.patch(
        f"/api/milestones/{milestone['id']}",
        headers=_auth(state["ownerToken"]),
        json={"status": "at_risk", "targetDate": "2026-12-11"},
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "at_risk"
    assert updated.json()["targetDate"] == "2026-12-11"

    roadmap = client.get(
        f"/api/projects/{project_id}/roadmap", headers=_auth(state["ownerToken"])
    )
    assert roadmap.status_code == 200
    assert any(
        item["id"] == milestone["id"] for item in roadmap.json()["milestones"]
    )

    viewer_create = client.post(
        f"/api/projects/{project_id}/milestones",
        headers=_auth(state["viewerToken"]),
        json={"title": "Viewer gate"},
    )
    assert viewer_create.status_code == 403


def test_viewer_cannot_create_tasks_but_can_read() -> None:
    project_id = state["projectId"]
    forbidden = client.post(
        f"/api/projects/{project_id}/tasks",
        headers=_auth(state["viewerToken"]),
        json={"title": "Viewer task"},
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["error"]["code"] == "FORBIDDEN"

    readable = client.get(
        f"/api/projects/{project_id}/tasks", headers=_auth(state["viewerToken"])
    )
    assert readable.status_code == 200


def test_document_lifecycle_and_viewer_delete_gate() -> None:
    workspace_id = state["workspaceId"]
    created = client.post(
        f"/api/workspaces/{workspace_id}/documents",
        headers=_auth(state["memberToken"]),
        json={
            "title": f"Surface document {PREFIX}",
            "content": "# Draft\n\nBody.",
            "projectId": state["projectId"],
        },
    )
    assert created.status_code == 201, created.text
    document = created.json()
    state["documentId"] = document["id"]

    updated = client.patch(
        f"/api/documents/{document['id']}",
        headers=_auth(state["memberToken"]),
        json={"content": "# Draft v2\n\nUpdated body.", "status": "review"},
    )
    assert updated.status_code == 200
    assert updated.json()["content"] == "# Draft v2\n\nUpdated body."
    assert updated.json()["status"] == "review"

    listed = client.get(
        f"/api/workspaces/{workspace_id}/documents?projectId={state['projectId']}",
        headers=_auth(state["viewerToken"]),
    )
    assert listed.status_code == 200
    assert any(item["id"] == document["id"] for item in listed.json()["documents"])

    viewer_delete = client.delete(
        f"/api/documents/{document['id']}", headers=_auth(state["viewerToken"])
    )
    assert viewer_delete.status_code == 403

    deleted = client.delete(
        f"/api/documents/{document['id']}", headers=_auth(state["ownerToken"])
    )
    assert deleted.status_code == 200

    missing = client.patch(
        f"/api/documents/{document['id']}",
        headers=_auth(state["ownerToken"]),
        json={"title": "Gone"},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "DOCUMENT_NOT_FOUND"


def test_meeting_summary_and_action_items_become_tasks() -> None:
    workspace_id = state["workspaceId"]
    created = client.post(
        f"/api/workspaces/{workspace_id}/meetings",
        headers=_auth(state["ownerToken"]),
        json={
            "title": f"Surface meeting {PREFIX}",
            "agenda": "Decide the retry mitigation and assign follow-ups.",
            "projectId": state["projectId"],
            "scheduledAt": "2026-11-05T10:00:00Z",
            "durationMinutes": 45,
        },
    )
    assert created.status_code == 201, created.text
    meeting = created.json()
    state["meetingId"] = meeting["id"]

    summary = client.post(
        f"/api/meetings/{meeting['id']}/summarize",
        headers=_auth(state["ownerToken"]),
    )
    assert summary.status_code == 200
    body = summary.json()
    assert body["summary"]
    assert body["assistant"]["provider"] == "deterministic-demo"
    assert body["assistant"]["degraded"] is True

    # Curate action items after summarising (the summary deliberately replaces
    # the extracted action list, matching the reference implementation).
    updated = client.patch(
        f"/api/meetings/{meeting['id']}",
        headers=_auth(state["ownerToken"]),
        json={
            "notes": "Agreed to reuse the original idempotency key on retry.",
            "status": "completed",
            "actionItems": [
                {"title": "Reuse idempotency key", "owner": "Lena", "dueDate": "2026-11-12"},
                {"title": "Add duplicate capture regression test", "owner": "Arjun"},
            ],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["status"] == "completed"
    assert len(updated.json()["actionItems"]) == 2

    converted = client.post(
        f"/api/meetings/{meeting['id']}/actions",
        headers=_auth(state["ownerToken"]),
        json={"projectId": state["projectId"]},
    )
    assert converted.status_code == 201
    tasks = converted.json()["tasks"]
    assert len(tasks) == 2
    assert all(task["sourceTicketId"] is None for task in tasks)
    assert all("meeting-action" in task["labels"] for task in tasks)

    # Conversion is idempotent: stored task ids prevent duplicate tasks.
    again = client.post(
        f"/api/meetings/{meeting['id']}/actions",
        headers=_auth(state["ownerToken"]),
        json={"projectId": state["projectId"]},
    )
    assert again.status_code == 201
    assert again.json()["tasks"] == []


def test_thread_lifecycle() -> None:
    workspace_id = state["workspaceId"]
    created = client.post(
        f"/api/workspaces/{workspace_id}/threads",
        headers=_auth(state["memberToken"]),
        json={
            "title": f"Surface discussion {PREFIX}",
            "body": "Should the retry reuse the original idempotency key?",
            "category": "engineering",
            "projectId": state["projectId"],
        },
    )
    assert created.status_code == 201, created.text
    thread = created.json()
    state["threadId"] = thread["id"]

    reply = client.post(
        f"/api/threads/{thread['id']}/replies",
        headers=_auth(state["ownerToken"]),
        json={"body": "Yes — and add a regression test for it."},
    )
    assert reply.status_code == 201
    reply_body = reply.json()
    assert any(
        item["body"] == "Yes — and add a regression test for it."
        for item in reply_body["replies"]
    )

    detail = client.get(
        f"/api/threads/{thread['id']}", headers=_auth(state["viewerToken"])
    )
    assert detail.status_code == 200
    assert len(detail.json()["replies"]) >= 1
    assert detail.json()["replies"][0]["body"] == "Yes — and add a regression test for it."

    solved = client.patch(
        f"/api/threads/{thread['id']}",
        headers=_auth(state["ownerToken"]),
        json={"solved": True},
    )
    assert solved.status_code == 200
    assert solved.json()["solved"] is True

    listed = client.get(
        f"/api/workspaces/{workspace_id}/threads?projectId={state['projectId']}",
        headers=_auth(state["ownerToken"]),
    )
    assert listed.status_code == 200
    assert any(item["id"] == thread["id"] for item in listed.json()["threads"])


def test_document_ai_draft_and_usage() -> None:
    workspace_id = state["workspaceId"]
    drafted = client.post(
        "/api/ai/documents/draft",
        headers=_auth(state["ownerToken"]),
        json={
            "workspaceId": workspace_id,
            "projectId": state["projectId"],
            "title": "Retry mitigation note",
            "outline": "Context, decision, acceptance criteria and unknowns.",
        },
    )
    assert drafted.status_code == 200, drafted.text
    body = drafted.json()
    assert body["provider"] == "deterministic-demo"
    assert body["model"] == "miraiwerk-rules-v1"
    assert body["degraded"] is True
    assert body["text"]

    diagram = client.post(
        "/api/ai/documents/draft",
        headers=_auth(state["ownerToken"]),
        json={
            "workspaceId": workspace_id,
            "projectId": state["projectId"],
            "title": "Retry decision diagram",
            "outline": "Ticket evidence enters analysis, RippleMap simulates impact, then a human approves.",
            "docType": "diagram",
        },
    )
    assert diagram.status_code == 200, diagram.text
    diagram_body = diagram.json()
    assert diagram_body["provider"] == "deterministic-demo"
    assert diagram_body["text"].lstrip().startswith("flowchart ")
    assert "Retry decision diagram" in diagram_body["text"]

    usage = client.get(
        f"/api/ai/usage?workspaceId={workspace_id}", headers=_auth(state["ownerToken"])
    )
    assert usage.status_code == 200
    rows = usage.json()["usage"]
    assert any(row["workflow"] == "assistant" for row in rows)


def test_workspace_workload_and_audit_gates() -> None:
    workspace_id = state["workspaceId"]
    workload = client.get(
        f"/api/workspaces/{workspace_id}/workload", headers=_auth(state["ownerToken"])
    )
    assert workload.status_code == 200
    assert any(item["userId"] == state["ownerId"] for item in workload.json()["workload"])

    owner_audit = client.get(
        f"/api/workspaces/{workspace_id}/audit", headers=_auth(state["ownerToken"])
    )
    assert owner_audit.status_code == 200
    assert isinstance(owner_audit.json()["events"], list)

    viewer_audit = client.get(
        f"/api/workspaces/{workspace_id}/audit", headers=_auth(state["viewerToken"])
    )
    assert viewer_audit.status_code == 403


def _create_and_analyze_ticket(title: str, description: str) -> tuple[str, str]:
    created = client.post(
        "/api/tickets",
        headers=_auth(state["memberToken"]),
        json={
            "projectId": state["projectId"],
            "title": title,
            "description": description,
            "ticketType": "incident",
            "severityReported": "high",
            "evidence": "Two capture.succeeded webhooks shared one order.",
        },
    )
    assert created.status_code == 201, created.text
    ticket_id = created.json()["ticket"]["id"]

    analyzed = client.post(
        f"/api/tickets/{ticket_id}/analyze", headers=_auth(state["ownerToken"])
    )
    assert analyzed.status_code == 200, analyzed.text
    proposal = analyzed.json()["proposal"]
    assert proposal["status"] == "pending"
    return ticket_id, proposal["id"]


def test_reject_decision_preserves_plan() -> None:
    ticket_id, proposal_id = _create_and_analyze_ticket(
        "Surface reject path",
        "The retry path still sends a fresh idempotency key after a timeout, which can duplicate captures.",
    )
    before = client.get(
        f"/api/projects/{state['projectId']}/plan", headers=_auth(state["ownerToken"])
    ).json()["version"]

    rejected = client.post(
        f"/api/decisions/{proposal_id}/reject",
        headers=_auth(state["ownerToken"]),
        json={"reason": "Not this release."},
    )
    assert rejected.status_code == 200
    assert rejected.json()["proposal"]["status"] == "rejected"

    after = client.get(
        f"/api/projects/{state['projectId']}/plan", headers=_auth(state["ownerToken"])
    ).json()["version"]
    assert after == before

    ticket = client.get(
        f"/api/tickets/{ticket_id}", headers=_auth(state["ownerToken"])
    )
    assert ticket.status_code == 200
    assert ticket.json()["ticket"]["status"] == "rejected"

    again = client.post(
        f"/api/decisions/{proposal_id}/reject",
        headers=_auth(state["ownerToken"]),
        json={"reason": "Second attempt."},
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "DECISION_NOT_PENDING"


def test_clarify_decision_records_questions() -> None:
    ticket_id, proposal_id = _create_and_analyze_ticket(
        "Surface clarify path",
        "Something about checkout feels wrong but the report has no reproduction steps or affected order ids.",
    )

    clarified = client.post(
        f"/api/decisions/{proposal_id}/clarify",
        headers=_auth(state["ownerToken"]),
        json={
            "reason": "The report lacks reproduction details.",
            "questions": ["Which order ids are affected?", "When did it start?"],
        },
    )
    assert clarified.status_code == 200
    assert clarified.json()["proposal"]["status"] == "clarified"
    questions = clarified.json()["proposal"]["clarifyingQuestions"]
    assert "Which order ids are affected?" in questions

    ticket = client.get(
        f"/api/tickets/{ticket_id}", headers=_auth(state["ownerToken"])
    )
    assert ticket.status_code == 200
    assert ticket.json()["ticket"]["status"] == "needs_clarification"

    viewer_attempt = client.post(
        f"/api/decisions/{proposal_id}/clarify",
        headers=_auth(state["viewerToken"]),
        json={"reason": "Viewers cannot do this."},
    )
    assert viewer_attempt.status_code == 403
