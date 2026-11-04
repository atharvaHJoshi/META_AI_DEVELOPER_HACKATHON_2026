"""Integration tests for the MIRAIWERK API.

Hermetic: exercises the labelled deterministic path (AI provider forced to
``deterministic`` before any app import) and never depends on seeded demo
records — each run creates its own users and project and removes them after.

Requires a reachable PostgreSQL (default: docker-compose db on port 55434, or
DATABASE_URL). Apply migrations first: ``python manage.py migrate``.
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

PREFIX = secrets.token_hex(4)
OWNER = f"usr_test_owner_{PREFIX}"
MEMBER = f"usr_test_member_{PREFIX}"
VIEWER = f"usr_test_viewer_{PREFIX}"
TEST_USERS = [OWNER, MEMBER, VIEWER]
ORG_ID = f"org_test_{PREFIX}"
WS_ID = f"ws_test_{PREFIX}"

client = TestClient(application)

INCIDENT_TICKET = {
    "title": "Customers charged twice after checkout retry",
    "description": (
        "Production incident: when the payment confirmation request times out, the client retries "
        "automatically after five seconds. Some customers receive two captures for one order. We have "
        "14 confirmed duplicate captures since 09:10 UTC. Automatic retries are still enabled."
    ),
    "source": "manual",
    "ticketType": "incident",
    "affectedComponent": "Payments / checkout retry",
    "reportedImpact": (
        "14 customers charged twice; support has refunded 6 so far. The payments release gate is "
        "scheduled this week, so exposure is still increasing."
    ),
    "evidence": (
        "Transactions pi_8841 and pi_8842 share idempotency key idem_5521 and produced two "
        "capture.succeeded webhooks. Sample order ORD-5521. Application logs show the confirmation "
        "retry does not reuse the original idempotency key."
    ),
    "reporter": "Integration Test",
    "environment": "production",
    "severityReported": "critical",
}

SECOND_TICKET = {
    "title": "Payment retry sends duplicate webhook after timeout",
    "description": (
        "A second report of the same retry path: the confirmation request times out, the client "
        "retries, and the processor receives a second capture request with a fresh idempotency key."
    ),
    "source": "manual",
    "ticketType": "incident",
    "affectedComponent": "Payments / retry",
    "reportedImpact": "Three additional duplicate captures reported by support.",
    "evidence": (
        "Capture webhook payload shows a distinct idempotency key on the retry. Request trace is "
        "attached to the incident bridge."
    ),
    "reporter": "Integration Test",
    "environment": "production",
    "severityReported": "high",
}

state: dict = {"project_id": None, "initial_task_count": 0}


def as_user(user_id: str) -> dict:
    return {"x-user-id": user_id}


def _create_fixtures() -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO users (id, name, email, title, avatar_color)
            VALUES
              (%s, 'Test Owner', %s, 'Product Lead', '#5B6CFF'),
              (%s, 'Test Member', %s, 'Staff Engineer', '#12B76A'),
              (%s, 'Test Viewer', %s, 'Executive Observer', '#F79009')
            """,
            [
                OWNER, f"owner.{PREFIX}@miraiwerk.test",
                MEMBER, f"member.{PREFIX}@miraiwerk.test",
                VIEWER, f"viewer.{PREFIX}@miraiwerk.test",
            ],
        )
        cursor.execute(
            """
            INSERT INTO organizations (id, name, slug, created_by)
            VALUES (%s, 'Integration Organization', %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            [ORG_ID, f"org-test-{PREFIX}", OWNER],
        )
        cursor.execute(
            """
            INSERT INTO workspaces (id, organization_id, name, slug, created_by)
            VALUES (%s, %s, 'Integration Workspace', %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            [WS_ID, ORG_ID, f"ws-test-{PREFIX}", OWNER],
        )
        cursor.execute(
            """
            INSERT INTO organization_members (organization_id, user_id, role)
            VALUES (%s, %s, 'owner'), (%s, %s, 'member'), (%s, %s, 'viewer')
            ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
            """,
            [ORG_ID, OWNER, ORG_ID, MEMBER, ORG_ID, VIEWER],
        )
        cursor.execute(
            """
            INSERT INTO workspace_members (workspace_id, user_id, role)
            VALUES (%s, %s, 'owner'), (%s, %s, 'manager'), (%s, %s, 'viewer')
            ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
            """,
            [WS_ID, OWNER, WS_ID, MEMBER, WS_ID, VIEWER],
        )


def _cleanup_fixtures() -> None:
    # Django emulates ON DELETE CASCADE in Python, so the schema-level FKs are
    # NO ACTION; raw SQL cleanup must remove rows in dependency order.
    project_id = state["project_id"]
    with connection.cursor() as cursor:
        if project_id:
            cursor.execute(
                """
                DELETE FROM scenario_runs
                USING decision_proposals
                WHERE scenario_runs.proposal_id = decision_proposals.id
                  AND decision_proposals.project_id = %s
                """,
                [project_id],
            )
            cursor.execute(
                """
                DELETE FROM decision_audit
                USING decision_proposals
                WHERE decision_audit.decision_id = decision_proposals.id
                  AND decision_proposals.project_id = %s
                """,
                [project_id],
            )
            cursor.execute("DELETE FROM decision_proposals WHERE project_id = %s", [project_id])
            cursor.execute(
                """
                DELETE FROM ticket_links
                USING tickets
                WHERE ticket_links.ticket_id = tickets.id AND tickets.project_id = %s
                """,
                [project_id],
            )
            cursor.execute("DELETE FROM tickets WHERE project_id = %s", [project_id])
            cursor.execute(
                """
                DELETE FROM task_dependencies
                WHERE successor_task_id IN (SELECT id FROM tasks WHERE project_id = %s)
                   OR predecessor_task_id IN (SELECT id FROM tasks WHERE project_id = %s)
                """,
                [project_id, project_id],
            )
            cursor.execute("DELETE FROM tasks WHERE project_id = %s", [project_id])
            cursor.execute("DELETE FROM milestones WHERE project_id = %s", [project_id])
            cursor.execute("DELETE FROM requirements WHERE project_id = %s", [project_id])
            cursor.execute("DELETE FROM plan_versions WHERE project_id = %s", [project_id])
            cursor.execute("DELETE FROM audit_events WHERE project_id = %s", [project_id])
            cursor.execute("DELETE FROM project_members WHERE project_id = %s", [project_id])
            cursor.execute("DELETE FROM ai_calls WHERE project_id = %s", [project_id])
            cursor.execute("DELETE FROM projects WHERE id = %s", [project_id])
        cursor.execute(
            "DELETE FROM forum_replies WHERE thread_id IN (SELECT id FROM forum_threads WHERE workspace_id = %s)",
            [WS_ID],
        )
        cursor.execute("DELETE FROM forum_threads WHERE workspace_id = %s", [WS_ID])
        cursor.execute("DELETE FROM meetings WHERE workspace_id = %s", [WS_ID])
        cursor.execute("DELETE FROM documents WHERE workspace_id = %s", [WS_ID])
        cursor.execute(
            "DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE workspace_id = %s)",
            [WS_ID],
        )
        cursor.execute("DELETE FROM teams WHERE workspace_id = %s", [WS_ID])
        cursor.execute("DELETE FROM workspace_members WHERE workspace_id = %s", [WS_ID])
        cursor.execute("DELETE FROM workspaces WHERE id = %s", [WS_ID])
        cursor.execute("DELETE FROM organization_members WHERE organization_id = %s", [ORG_ID])
        cursor.execute("DELETE FROM organizations WHERE id = %s", [ORG_ID])
        cursor.execute("DELETE FROM sessions WHERE user_id = ANY(%s::text[])", [TEST_USERS])
        cursor.execute("DELETE FROM one_time_tokens WHERE user_id = ANY(%s::text[])", [TEST_USERS])
        cursor.execute("DELETE FROM oauth_accounts WHERE user_id = ANY(%s::text[])", [TEST_USERS])
        cursor.execute("DELETE FROM organization_members WHERE user_id = ANY(%s::text[])", [TEST_USERS])
        cursor.execute("DELETE FROM workspace_members WHERE user_id = ANY(%s::text[])", [TEST_USERS])
        cursor.execute("DELETE FROM project_members WHERE user_id = ANY(%s::text[])", [TEST_USERS])
        cursor.execute("DELETE FROM security_audit WHERE user_id = ANY(%s::text[])", [TEST_USERS])
        cursor.execute("DELETE FROM users WHERE id = ANY(%s::text[])", [TEST_USERS])


@pytest.fixture(scope="module", autouse=True)
def fixtures():
    _create_fixtures()
    yield
    _cleanup_fixtures()


def test_health() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert response.json()["ai"] in {"meta", "deterministic-demo", "gemini"}


def test_create_project_with_deterministic_plan() -> None:
    generated = client.post(
        "/api/projects/generate-plan",
        headers=as_user(OWNER),
        json={
            "name": f"Integration Checkout {PREFIX}",
            "goal": "Launch a reliable checkout without duplicate payment captures.",
            "description": (
                "An integration-test commerce launch covering authentication, product discovery, "
                "checkout, payment retries and release observability."
            ),
            "startDate": "2026-11-02",
            "targetDate": "2026-12-18",
            "constraints": {
                "team": "2 backend, 1 frontend, 1 QA",
                "capacityPersonDays": 120,
                "technology": "React, Node.js, PostgreSQL",
                "nonNegotiables": "No duplicate payment capture.",
            },
        },
    )
    assert generated.status_code == 200
    body = generated.json()
    assert body["provider"] == "deterministic-demo"
    assert len(body["draft"]["tasks"]) > 2

    created = client.post(
        "/api/projects",
        headers={**as_user(OWNER), "x-workspace-id": WS_ID},
        json={
            "draft": body["draft"],
            "generation": {
                "provider": body["provider"],
                "model": body["model"],
                "degraded": body["degraded"],
            },
            "constraints": {
                "team": "2 backend, 1 frontend, 1 QA",
                "capacityPersonDays": 120,
                "technology": "React, Node.js, PostgreSQL",
                "nonNegotiables": "No duplicate payment capture.",
            },
        },
    )
    assert created.status_code == 201
    payload = created.json()
    state["project_id"] = payload["project"]["id"]
    state["initial_task_count"] = len(payload["tasks"])
    assert payload["version"] == 1

    # createProject adds every workspace member; promote the test member.
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE project_members SET role = 'member' WHERE project_id = %s AND user_id = %s",
            [state["project_id"], MEMBER],
        )


def test_owner_lists_project_but_anonymous_outsider_cannot() -> None:
    response = client.get("/api/projects", headers=as_user(OWNER))
    assert response.status_code == 200
    match = next((p for p in response.json()["projects"] if p["id"] == state["project_id"]), None)
    assert match is not None
    assert match["currentPlanVersion"] == 1
    assert match["role"] == "owner"

    outsider = client.get(f"/api/projects/{state['project_id']}/plan", headers=as_user(f"usr_missing_{PREFIX}"))
    assert outsider.status_code == 401


def test_viewer_cannot_create_ticket() -> None:
    response = client.post(
        "/api/tickets",
        headers=as_user(VIEWER),
        json={**INCIDENT_TICKET, "projectId": state["project_id"]},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"


def test_create_and_analyze_incident_ticket() -> None:
    created = client.post(
        "/api/tickets",
        headers=as_user(MEMBER),
        json={**INCIDENT_TICKET, "projectId": state["project_id"]},
    )
    assert created.status_code == 201
    assert created.json()["ticket"]["status"] == "new"
    state["first_ticket_id"] = created.json()["ticket"]["id"]

    analyzed = client.post(
        f"/api/tickets/{state['first_ticket_id']}/analyze",
        headers=as_user(OWNER),
    )
    assert analyzed.status_code == 200
    proposal = analyzed.json()["proposal"]
    assert proposal["status"] == "pending"
    assert proposal["basePlanVersion"] == 1
    assert proposal["modelProvider"] == "deterministic-demo"
    assert proposal["classification"]["ticketType"] == "incident"
    assert len(proposal["evidence"]) > 0
    assert len(proposal["unknowns"]) > 0
    assert any(item["state"] == "inferred" for item in proposal["evidence"])
    accept_tasks = proposal["proposedChanges"]["accept"]["tasksToAdd"]
    assert len(accept_tasks) == 2
    assert all(len(task["description"]) > 0 for task in accept_tasks)
    state["first_proposal_id"] = proposal["id"]


def test_simulate_accept_option() -> None:
    mismatch = client.post(
        f"/api/decisions/{state['first_proposal_id']}/simulate",
        headers=as_user(OWNER),
        json={"option": "accept", "baselineVersion": 99},
    )
    assert mismatch.status_code == 409
    assert mismatch.json()["error"]["code"] == "BASELINE_VERSION_MISMATCH"

    response = client.post(
        f"/api/decisions/{state['first_proposal_id']}/simulate",
        headers=as_user(OWNER),
        json={"option": "accept", "baselineVersion": 1},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["option"] == "accept"
    assert body["valid"] is True
    assert len(body["inputHash"]) >= 16
    assert body["metrics"]["tasksAdded"] == 2
    assert len(body["diff"]["addedTasks"]) == 2


def test_prepare_second_proposal_against_same_baseline() -> None:
    created = client.post(
        "/api/tickets",
        headers=as_user(MEMBER),
        json={**SECOND_TICKET, "projectId": state["project_id"]},
    )
    assert created.status_code == 201

    analyzed = client.post(
        f"/api/tickets/{created.json()['ticket']['id']}/analyze",
        headers=as_user(OWNER),
    )
    assert analyzed.status_code == 200
    assert analyzed.json()["proposal"]["basePlanVersion"] == 1
    state["second_proposal_id"] = analyzed.json()["proposal"]["id"]

    simulated = client.post(
        f"/api/decisions/{state['second_proposal_id']}/simulate",
        headers=as_user(MEMBER),
        json={"option": "accept", "baselineVersion": 1},
    )
    assert simulated.status_code == 200
    assert simulated.json()["valid"] is True


def test_members_and_viewers_cannot_approve() -> None:
    for user_id in (MEMBER, VIEWER):
        response = client.post(
            f"/api/decisions/{state['first_proposal_id']}/approve",
            headers=as_user(user_id),
            json={"option": "accept", "reason": "Attempted by a non-approver."},
        )
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "FORBIDDEN"


def test_approve_accept_creates_plan_version_2() -> None:
    approved = client.post(
        f"/api/decisions/{state['first_proposal_id']}/approve",
        headers=as_user(OWNER),
        json={
            "option": "accept",
            "reason": "Accept the containment fix and regression task before the payments gate.",
        },
    )
    assert approved.status_code == 200
    assert approved.json()["planVersionNumber"] == 2
    assert approved.json()["proposal"]["status"] == "approved"
    assert approved.json()["audit"]["action"] == "approved"

    plan = client.get(f"/api/projects/{state['project_id']}/plan", headers=as_user(OWNER))
    assert plan.status_code == 200
    payload = plan.json()
    assert payload["version"] == 2
    assert len(payload["tasks"]) == state["initial_task_count"] + 2
    assert any(task.get("sourceTicketId") == state["first_ticket_id"] for task in payload["tasks"])

    history = client.get(f"/api/projects/{state['project_id']}/history", headers=as_user(OWNER))
    assert history.status_code == 200
    versions = history.json()["versions"]
    assert {v["versionNumber"] for v in versions} >= {1, 2}
    v2 = next(v for v in versions if v["versionNumber"] == 2)
    assert v2["parentVersionId"]
    assert any(d["action"] == "approved" for d in history.json()["decisions"])
    assert any(e["action"] == "plan.versioned" for e in history.json()["auditEvents"])


def test_sibling_proposal_is_stale_and_blocked() -> None:
    detail = client.get(f"/api/decisions/{state['second_proposal_id']}", headers=as_user(OWNER))
    assert detail.status_code == 200
    assert detail.json()["status"] == "stale"

    simulation = client.post(
        f"/api/decisions/{state['second_proposal_id']}/simulate",
        headers=as_user(OWNER),
        json={"option": "accept", "baselineVersion": 1},
    )
    assert simulation.status_code == 409
    assert simulation.json()["error"]["code"] == "DECISION_NOT_PENDING"

    approval = client.post(
        f"/api/decisions/{state['second_proposal_id']}/approve",
        headers=as_user(OWNER),
        json={"option": "accept", "reason": "Should be rejected as stale."},
    )
    assert approval.status_code == 409
    assert approval.json()["error"]["code"] == "DECISION_NOT_PENDING"

    history = client.get(f"/api/projects/{state['project_id']}/history", headers=as_user(OWNER))
    assert any(
        d["decisionId"] == state["second_proposal_id"] and d["action"] == "stale"
        for d in history.json()["decisions"]
    )
    assert any(e["action"] == "decision.stale" for e in history.json()["auditEvents"])


def test_approval_requires_stored_matching_scenario() -> None:
    created = client.post(
        "/api/tickets",
        headers=as_user(MEMBER),
        json={
            **INCIDENT_TICKET,
            "title": "Checkout retry still duplicating captures",
            "projectId": state["project_id"],
        },
    )
    assert created.status_code == 201
    third_ticket_id = created.json()["ticket"]["id"]

    analyzed = client.post(
        f"/api/tickets/{third_ticket_id}/analyze",
        headers=as_user(OWNER),
    )
    proposal_id = analyzed.json()["proposal"]["id"]
    assert analyzed.json()["proposal"]["basePlanVersion"] == 2

    with connection.cursor() as cursor:
        cursor.execute("DELETE FROM scenario_runs WHERE proposal_id = %s", [proposal_id])
    unsimulated = client.post(
        f"/api/decisions/{proposal_id}/approve",
        headers=as_user(OWNER),
        json={"option": "accept", "reason": "Approve without a stored scenario."},
    )
    assert unsimulated.status_code == 409
    assert unsimulated.json()["error"]["code"] == "SCENARIO_REQUIRED"

    simulated = client.post(
        f"/api/decisions/{proposal_id}/simulate",
        headers=as_user(OWNER),
        json={"option": "accept", "baselineVersion": 2},
    )
    assert simulated.status_code == 200

    approved = client.post(
        f"/api/decisions/{proposal_id}/approve",
        headers=as_user(OWNER),
        json={"option": "accept", "reason": "Verified scenario before approval."},
    )
    assert approved.status_code == 200
    assert approved.json()["planVersionNumber"] == 3


def test_defer_records_audited_decision_without_versioning() -> None:
    created = client.post(
        "/api/tickets",
        headers=as_user(MEMBER),
        json={
            **INCIDENT_TICKET,
            "projectId": state["project_id"],
            "title": "Add saved payment methods for returning customers",
            "description": (
                "Returning customers should be able to save a payment method and reuse it at "
                "checkout. No success metric or scope boundary has been agreed yet."
            ),
            "ticketType": "feature_request",
            "affectedComponent": "Checkout / payments",
            "reportedImpact": "Repeat buyers re-enter payment details every time.",
            "evidence": "Eight customer interview notes mention saved payment methods.",
            "severityReported": "low",
        },
    )
    assert created.status_code == 201

    analyzed = client.post(
        f"/api/tickets/{created.json()['ticket']['id']}/analyze",
        headers=as_user(OWNER),
    )
    assert analyzed.json()["proposal"]["recommendation"] == "defer"
    proposal_id = analyzed.json()["proposal"]["id"]

    simulation = client.post(
        f"/api/decisions/{proposal_id}/simulate",
        headers=as_user(OWNER),
        json={"option": "defer", "baselineVersion": 3},
    )
    assert simulation.status_code == 200
    assert simulation.json()["metrics"]["tasksAdded"] == 0

    approved = client.post(
        f"/api/decisions/{proposal_id}/approve",
        headers=as_user(OWNER),
        json={"option": "defer", "reason": "Park behind the active payments release."},
    )
    assert approved.status_code == 200
    assert approved.json()["planVersionNumber"] is None
    assert approved.json()["proposal"]["status"] == "approved"

    plan = client.get(f"/api/projects/{state['project_id']}/plan", headers=as_user(OWNER))
    assert plan.json()["version"] == 3


def test_malformed_ticket_input_returns_422() -> None:
    response = client.post(
        "/api/tickets",
        headers=as_user(OWNER),
        json={"projectId": state["project_id"], "title": "x", "description": "too short"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
