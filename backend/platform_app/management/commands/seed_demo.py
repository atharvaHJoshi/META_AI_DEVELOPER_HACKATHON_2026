"""Reproduce the MIRAIWERK demo scenario end to end.

Resets all product tables, then re-creates the seeded organisation, project,
tickets, analysed decisions (1 approved → plan v2, 4 pending), teams, documents,
meetings, forum threads and security audit rows. Uses the same service layer as
the HTTP API, so seeding also exercises the backend.
"""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand
from django.db import connection, transaction
from django.utils import timezone

from aiml import DETERMINISTIC_MODEL, commerce_plan
from ripplemap.dates import add_working_days, format_iso_date, parse_iso_date
from platform_app.passwords import hash_password
from services.decision_service import approve_decision
from services.project_service import create_project, get_project_plan
from services.ticket_service import analyze_ticket, create_ticket
from services.project_service import list_tickets  # noqa: F401  (kept for parity/debug)

MAYA = "usr_maya"
ARJUN = "usr_arjun"
LENA = "usr_lena"
PRIYA = "usr_priya"
ORG = "org_miraiwerk"
WORKSPACE = "ws_platform"
WORKSPACE_CX = "ws_experience"
DEMO_PASSWORD = "Miraiwerk!2026"

DEMO_USERS = [
    (MAYA, "Maya Chen", "maya.chen@miraiwerk.demo", "Director of Product", "#496A91", True, True),
    (ARJUN, "Arjun Patel", "arjun.patel@miraiwerk.demo", "Engineering Manager", "#5C7F6F", True, False),
    (LENA, "Lena Ortiz", "lena.ortiz@miraiwerk.demo", "Staff Engineer", "#A7793F", False, False),
    (PRIYA, "Priya Shah", "priya.shah@miraiwerk.demo", "Finance Partner", "#7B6A8F", False, False),
]

TRUNCATE_SQL = """
TRUNCATE ai_calls, audit_events, decision_audit, scenario_runs,
  decision_proposals, ticket_links, tickets, task_dependencies, tasks,
  milestones, requirements, plan_versions, project_members, projects,
  documents, meetings, forum_replies, forum_threads, team_members, teams,
  workspace_members, workspaces, organization_members, organizations,
  sessions, oauth_accounts, one_time_tokens, security_audit, users
CASCADE;
"""


def _iso_today() -> str:
    return format_iso_date(parse_iso_date(str(timezone.now().date())))


def _plus_working_days(start: str, days: int) -> str:
    return format_iso_date(add_working_days(parse_iso_date(start), days))


class Command(BaseCommand):
    help = "Reset the MIRAIWERK demo data and re-create the demo scenario."

    def add_arguments(self, parser):
        parser.add_argument(
            "--ai",
            action="store_true",
            help="Use the configured AI provider for ticket analysis (slow; default is deterministic rules).",
        )

    def handle(self, *args, **options):
        if not options["ai"]:
            # Fast, reproducible seed: no network dependency, always the same
            # deterministic (labelled) analysis. Pass --ai to use Gemini/Meta.
            from core import config

            config.AI_PROVIDER = "deterministic"
            self.stdout.write("Using deterministic rules for ticket analysis (pass --ai to use the configured provider).")
        self.stdout.write("Resetting MIRAIWERK demo data…")
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute(TRUNCATE_SQL)

        self._seed_users()
        self._seed_tenant()

        start_date = _plus_working_days(_iso_today(), 1)
        target_date = _plus_working_days(start_date, 42)
        draft = commerce_plan(
            {
                "name": "Commerce Platform Relaunch",
                "goal": "Launch a reliable checkout experience without duplicate charges or broken order state.",
                "description": (
                    "Relaunch of the direct-to-consumer storefront. The team is rebuilding authentication, "
                    "product discovery, checkout, payment retries, order lifecycle and release observability "
                    "on a React + Node.js + PostgreSQL stack. The payments release gate must be passed before "
                    "any production launch work proceeds."
                ),
                "startDate": start_date,
                "targetDate": target_date,
                "constraints": {},
            }
        )

        project = create_project(
            MAYA,
            {
                "draft": draft,
                "generation": {
                    "provider": "deterministic-demo",
                    "model": DETERMINISTIC_MODEL,
                    "degraded": False,
                },
                "constraints": {
                    "team": "2 backend, 1 frontend, 1 QA, shared DevOps",
                    "capacityPersonDays": 260,
                    "technology": "React, TypeScript, Node.js, PostgreSQL, payment processor",
                    "nonNegotiables": (
                        "No duplicate payment capture. Every release needs a rollback plan "
                        "and named on-call owner."
                    ),
                    "policy": {
                        "criticalResponseHours": 4,
                        "highResponseDays": 2,
                        "normalResponseDays": 7,
                        "requireEvidenceForP0": True,
                        "escalationComponents": ["payments", "checkout", "auth"],
                        "releaseFreezeDays": 3,
                    },
                },
            },
            {
                "provider": "deterministic-demo",
                "model": DETERMINISTIC_MODEL,
                "degraded": False,
            },
            {"workspaceId": WORKSPACE},
        )
        project_id = project["project"]["id"]
        self.stdout.write(f"Project created: {project['project']['name']} ({project_id}) — plan v1")

        # -- Approved history: a search regression is accepted → plan v2 --------
        search_ticket = create_ticket(
            LENA,
            {
                "projectId": project_id,
                "title": "Search filters reset when returning from a product page",
                "description": (
                    "Steps to reproduce: open Product discovery, apply a category and a price filter, "
                    "open a product, then press Back. The filter chips disappear and the result list resets. "
                    "Expected: filters persist in the URL and remain applied. Actual: state is lost on back "
                    "navigation. This is a regression from last week's release."
                ),
                "source": "manual",
                "ticketType": "bug",
                "affectedComponent": "Product discovery / search",
                "reportedImpact": (
                    "Customers lose their filtered result set and must repeat the search. Roughly one in five "
                    "sessions uses filters, and we have three related reports this week."
                ),
                "evidence": (
                    "Reproduced four times in Chrome and Safari. The URL query parameters are absent after "
                    "back navigation; session recording shows the full page reload."
                ),
                "reporter": "Lena Ortiz",
                "environment": "production",
                "severityReported": "medium",
            },
        )
        analyzed_search = analyze_ticket(MAYA, search_ticket["ticket"]["id"])
        if not analyzed_search.get("proposal"):
            raise RuntimeError("Seed search ticket produced no proposal.")
        approved = approve_decision(
            MAYA,
            analyzed_search["proposal"]["id"],
            "accept",
            "Accept the regression fix and its verification task before the search release review.",
        )
        self.stdout.write(
            f"Approved search regression as {approved['proposal']['id']}; plan version {approved['planVersionNumber']} created."
        )

        # -- Pending decisions ---------------------------------------------------
        incident_ticket = create_ticket(
            ARJUN,
            {
                "projectId": project_id,
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
                "reporter": "Arjun Patel",
                "environment": "production",
                "severityReported": "critical",
            },
        )
        incident = analyze_ticket(MAYA, incident_ticket["ticket"]["id"])
        self.stdout.write(
            f"Incident proposal {incident['proposal']['id']}: "
            f"recommendation={incident['proposal']['recommendation']}, "
            f"priority={incident['proposal']['classification']['priority']}"
        )

        feature_ticket = create_ticket(
            MAYA,
            {
                "projectId": project_id,
                "title": "Add saved payment methods for returning customers",
                "description": (
                    "Returning customers should be able to save a payment method and reuse it at checkout. "
                    "The request comes from the customer success team after repeated feedback from repeat buyers. "
                    "No success metric or scope boundary has been agreed yet."
                ),
                "source": "manual",
                "ticketType": "feature_request",
                "affectedComponent": "Checkout / payments",
                "reportedImpact": "Repeat buyers re-enter payment details every time. Conversion impact is not measured.",
                "evidence": "Eight customer interview notes mention saved payment methods; no funnel metric is attached.",
                "reporter": "Maya Chen",
                "environment": "production",
                "severityReported": "low",
            },
        )
        feature = analyze_ticket(MAYA, feature_ticket["ticket"]["id"])
        self.stdout.write(
            f"Feature request proposal {feature['proposal']['id']}: recommendation={feature['proposal']['recommendation']}"
        )

        vague_ticket = create_ticket(
            LENA,
            {
                "projectId": project_id,
                "title": "Something about checkout seems off on some devices",
                "description": (
                    "The checkout experience seems off on some devices. We do not have a reproducible example, "
                    "logs, affected-user details, or a clear description of the expected outcome yet."
                ),
                "source": "manual",
                "ticketType": None,
                "affectedComponent": "",
                "reportedImpact": "",
                "evidence": "",
                "reporter": "Lena Ortiz",
                "environment": "",
                "severityReported": "unspecified",
            },
        )
        vague = analyze_ticket(MAYA, vague_ticket["ticket"]["id"])
        self.stdout.write(
            f"Vague report proposal {vague['proposal']['id']}: recommendation={vague['proposal']['recommendation']}"
        )

        duplicate_like_ticket = create_ticket(
            MAYA,
            {
                "projectId": project_id,
                "title": "Duplicate charge reported after checkout retry",
                "description": (
                    "A customer reports a duplicate charge after a checkout retry. Finance confirms this is "
                    "an invoice export duplicate, not a payment capture. The monthly invoice CSV lists the "
                    "same charge line twice after a plan upgrade with proration."
                ),
                "source": "manual",
                "ticketType": "bug",
                "affectedComponent": "Finance / invoice export",
                "reportedImpact": (
                    "Finance manually corrects affected invoices before month-end close. No customer has been "
                    "overcharged by the payment processor."
                ),
                "evidence": (
                    "Two invoice CSV rows share invoice_id INV-2031 and line_item_id li_908. The payment "
                    "processor export contains one capture for the same period; no duplicate capture.succeeded "
                    "webhook exists."
                ),
                "reporter": "Maya Chen",
                "environment": "production",
                "severityReported": "medium",
            },
        )
        duplicate_like = analyze_ticket(MAYA, duplicate_like_ticket["ticket"]["id"])
        self.stdout.write(
            f"Duplicate-looking proposal {duplicate_like['proposal']['id']}: "
            f"recommendation={duplicate_like['proposal']['recommendation']}, "
            f"candidates={len(duplicate_like['proposal']['duplicateCandidates'])}"
        )

        plan = get_project_plan(MAYA, project_id)
        self._assign_work(project_id)
        self._seed_documents(WORKSPACE, project_id)
        self._seed_meetings(WORKSPACE, project_id)
        self._seed_threads(WORKSPACE, project_id)
        self._seed_security_audit(WORKSPACE, project_id)

        self.stdout.write("\nDemo seed complete.")
        self.stdout.write(f"  project:  {project_id}  (plan v{plan['version']})")
        self.stdout.write(f"  tasks:    {len(plan['tasks'])}")
        self.stdout.write("  tickets:  5 (1 approved, 4 pending)")
        self.stdout.write("  open decisions: incident, feature, vague report, duplicate-looking")
        self.stdout.write(
            self.style.SUCCESS(f"  sign in as: maya.chen@miraiwerk.demo / {DEMO_PASSWORD} (owner)")
        )
        self.stdout.write(
            "  also: arjun.patel@… (manager), lena.ortiz@… (member), priya.shah@… (viewer)"
        )

    # ---------------------------------------------------------------- users
    def _seed_users(self) -> None:
        password_hash = hash_password(DEMO_PASSWORD)
        with connection.cursor() as cursor:
            for user_id, name, email, title, color, _member, is_admin in DEMO_USERS:
                cursor.execute(
                    """
                    INSERT INTO users (id, name, email, title, avatar_color, password_hash, status, is_platform_admin, is_staff)
                    VALUES (%s, %s, %s, %s, %s, %s, 'active', %s, %s)
                    ON CONFLICT (id) DO UPDATE
                      SET name = EXCLUDED.name,
                          email = EXCLUDED.email,
                          title = EXCLUDED.title,
                          avatar_color = EXCLUDED.avatar_color,
                          password_hash = EXCLUDED.password_hash,
                          status = 'active',
                          is_platform_admin = EXCLUDED.is_platform_admin,
                          is_staff = EXCLUDED.is_staff
                    """,
                    [user_id, name, email, title, color, password_hash, is_admin, is_admin],
                )

    def _seed_tenant(self) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO organizations (id, name, slug, description, created_by)
                VALUES (%s, 'Miraiwerk', 'miraiwerk', 'Product and platform delivery organization.', %s)
                ON CONFLICT (id) DO UPDATE
                  SET name = EXCLUDED.name, description = EXCLUDED.description
                """,
                [ORG, MAYA],
            )
            cursor.execute(
                """
                INSERT INTO workspaces
                  (id, organization_id, name, slug, description, onboarding_stage, onboarding_json, ai_context_json, created_by)
                VALUES
                  (%s, %s, 'Platform Delivery', 'platform-delivery',
                   'Commerce relaunch, payments reliability and platform operations.', 8,
                   '{"completed":true}'::jsonb,
                   '{"tone":"concise","releasePolicy":"Every release needs a rollback plan and a named on-call owner.","capacityUnit":"person-days"}'::jsonb,
                   %s),
                  (%s, %s, 'Customer Experience', 'customer-experience',
                   'Discovery, support and customer-facing improvements.', 8,
                   '{"completed":true}'::jsonb,
                   '{"tone":"customer-first","releasePolicy":"Customer-impacting changes need a support brief."}'::jsonb,
                   %s)
                ON CONFLICT (id) DO UPDATE
                  SET name = EXCLUDED.name,
                      description = EXCLUDED.description,
                      ai_context_json = EXCLUDED.ai_context_json
                """,
                [WORKSPACE, ORG, MAYA, WORKSPACE_CX, ORG, MAYA],
            )
            cursor.execute(
                """
                INSERT INTO organization_members (organization_id, user_id, role)
                VALUES (%s, %s, 'owner'), (%s, %s, 'manager'), (%s, %s, 'member'), (%s, %s, 'viewer')
                ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role
                """,
                [ORG, MAYA, ORG, ARJUN, ORG, LENA, ORG, PRIYA],
            )
            cursor.execute(
                """
                INSERT INTO workspace_members (workspace_id, user_id, role)
                VALUES
                  (%s, %s, 'owner'), (%s, %s, 'manager'), (%s, %s, 'member'), (%s, %s, 'viewer'),
                  (%s, %s, 'owner'), (%s, %s, 'manager'), (%s, %s, 'member')
                ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
                """,
                [
                    WORKSPACE, MAYA, WORKSPACE, ARJUN, WORKSPACE, LENA, WORKSPACE, PRIYA,
                    WORKSPACE_CX, MAYA, WORKSPACE_CX, ARJUN, WORKSPACE_CX, LENA,
                ],
            )
            cursor.execute(
                """
                INSERT INTO teams (id, workspace_id, name, description, lead_id)
                VALUES
                  ('team_payments', %s, 'Payments', 'Checkout, payment capture and reconciliation.', %s),
                  ('team_platform', %s, 'Platform', 'Search, identity and release engineering.', %s)
                ON CONFLICT (id) DO NOTHING
                """,
                [WORKSPACE, ARJUN, WORKSPACE, ARJUN],
            )
            cursor.execute(
                """
                INSERT INTO team_members (team_id, user_id)
                VALUES ('team_payments', %s), ('team_payments', %s), ('team_platform', %s), ('team_platform', %s)
                ON CONFLICT DO NOTHING
                """,
                [ARJUN, LENA, LENA, MAYA],
            )

    def _assign_work(self, project_id: str) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE tasks
                SET assignee_id = CASE
                      WHEN owner_role IN ('Frontend', 'QA') THEN %s
                      WHEN owner_role IN ('Backend', 'Full-stack', 'Engineering') THEN %s
                      ELSE %s
                    END,
                    team_id = CASE
                      WHEN owner_role IN ('Frontend', 'QA') THEN 'team_platform'
                      ELSE 'team_payments'
                    END
                WHERE project_id = %s
                """,
                [LENA, ARJUN, ARJUN, project_id],
            )

    def _seed_documents(self, workspace_id: str, project_id: str) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO documents
                  (id, workspace_id, project_id, title, doc_type, content, status, created_by, updated_by, created_at, updated_at)
                VALUES
                  (%s, %s, %s, 'Payments launch decision record', 'markdown', %s,
                   'published', %s, %s, now() - interval '3 hours', now() - interval '2 hours'),
                  (%s, %s, %s, 'Checkout dependency diagram', 'diagram', %s,
                   'draft', %s, %s, now() - interval '2 hours', now() - interval '90 minutes'),
                  ('doc_platform_operating_notes', %s, NULL, 'Platform delivery operating notes', 'markdown', %s,
                   'published', %s, %s, now() - interval '1 day', now() - interval '1 day')
                ON CONFLICT (id) DO NOTHING
                """,
                [
                    "doc_payments_decision", workspace_id, project_id,
                    (
                        "# Payments launch decision record\n\n## Context\n\nThe payments release gate is scheduled for this week. "
                        "The checkout retry incident shows duplicate captures after a timeout.\n\n## Decision\n\nDo not open the "
                        "production release gate until the idempotency fix and regression coverage are accepted.\n\n## Evidence\n\n"
                        "- 14 confirmed duplicate captures since 09:10 UTC.\n- Two capture.succeeded webhooks share one idempotency key.\n"
                        "- The client retries after five seconds without reusing the original key.\n\n## Consequences\n\n"
                        "The launch moves behind the payments release gate. Support receives a refund runbook; no plan change is "
                        "committed until RippleMap is approved by an owner or PM."
                    ),
                    MAYA, MAYA,
                    "doc_checkout_diagram", workspace_id, project_id,
                    (
                        "graph TD\n  ticket[Ticket evidence] --> proposal[Decision proposal]\n"
                        "  proposal --> ripple[RippleMap simulation]\n"
                        "  ripple --> approval{Human approval}\n"
                        "  approval -->|accept| version[Immutable plan version]\n"
                        "  approval -->|clarify| evidence[More evidence requested]\n"
                        "  version --> tasks[Delivery tasks]\n  tasks --> release[Payments release gate]"
                    ),
                    MAYA, MAYA,
                    workspace_id,
                    (
                        "# Platform delivery operating notes\n\n- Every release needs a named on-call owner and a rollback plan.\n"
                        "- Critical incidents require four-hour response and human review before a plan change.\n"
                        "- RippleMap simulations are deterministic; AI explains and drafts, but never approves.\n"
                        "- Decision records are kept in this workspace and linked to the project plan they affect."
                    ),
                    MAYA, MAYA,
                ],
            )

    def _seed_meetings(self, workspace_id: str, project_id: str) -> None:
        action_items = [
            {"title": "Add stale-proposal regression coverage", "owner": "Arjun Patel", "dueDate": None, "taskId": None},
            {"title": "Document rollback ownership for the payments gate", "owner": "Maya Chen", "dueDate": None, "taskId": None},
        ]
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO meetings
                  (id, workspace_id, project_id, title, agenda, notes, scheduled_at, duration_minutes, status, summary, action_items_json, created_by)
                VALUES
                  (%s, %s, %s, 'Payments release readiness review', %s, %s,
                   now() + interval '2 days', 45, 'scheduled', '', '[]'::jsonb, %s),
                  (%s, %s, %s, 'RippleMap design review', %s, %s,
                   now() - interval '1 day', 60, 'completed', %s, %s::jsonb, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                [
                    "mtg_release_review", workspace_id, project_id,
                    "Confirm duplicate-capture containment, rollback owner and release-gate evidence.",
                    (
                        "Support confirmed the refund runbook is ready. The idempotency fix is still waiting for "
                        "regression coverage. The team agreed not to open the release gate until the plan change is approved."
                    ),
                    MAYA,
                    "mtg_design_review", workspace_id, project_id,
                    "Review the deterministic simulation boundary and the stale-proposal behaviour.",
                    (
                        "The team reviewed the approved-plan snapshot and the proposal state. Human approval "
                        "remains mandatory. No automated approval path was accepted."
                    ),
                    (
                        "The design review confirmed that RippleMap must continue to simulate against an approved "
                        "plan snapshot. Approval remains an explicit human decision, and stale proposals must be "
                        "rejected or re-analysed rather than silently replayed."
                    ),
                    json.dumps(action_items),
                    ARJUN,
                ],
            )

    def _seed_threads(self, workspace_id: str, project_id: str) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO forum_threads
                  (id, workspace_id, project_id, title, body, category, solved, created_by, created_at, updated_at)
                VALUES
                  (%s, %s, %s, 'Should the payments release gate move?', %s, 'decision', false,
                   %s, now() - interval '3 hours', now() - interval '1 hour'),
                  (%s, %s, %s, 'Duplicate-looking invoice rows are not duplicate captures', %s, 'risk', true,
                   %s, now() - interval '1 day', now() - interval '4 hours')
                ON CONFLICT (id) DO NOTHING
                """,
                [
                    "thr_release_gate", workspace_id, project_id,
                    (
                        "The retry incident has a clear containment path, but the idempotency fix still needs "
                        "regression coverage. Should the gate move this week or wait for the accepted plan change?"
                    ),
                    ARJUN,
                    "thr_invoice_duplicate", workspace_id, project_id,
                    (
                        "Finance found two invoice CSV rows with the same line item after a prorated upgrade. "
                        "The processor export has one capture. We should document the distinction before the "
                        "next finance review."
                    ),
                    LENA,
                ],
            )
            cursor.execute(
                """
                INSERT INTO forum_replies (id, thread_id, body, created_by, created_at)
                VALUES
                  (%s, 'thr_release_gate', %s, %s, now() - interval '2 hours'),
                  (%s, 'thr_release_gate', %s, %s, now() - interval '1 hour')
                ON CONFLICT (id) DO NOTHING
                """,
                [
                    "rep_release_gate_1",
                    "Recommendation: keep the gate closed until the regression task is accepted and linked to the idempotency fix.",
                    ARJUN,
                    "rep_release_gate_2",
                    "Agreed. I will not simulate an approval against a plan that does not contain the fix. The proposal must be re-analysed if evidence changes.",
                    MAYA,
                ],
            )

    def _seed_security_audit(self, workspace_id: str, project_id: str) -> None:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO security_audit (id, user_id, action, outcome, ip_address, user_agent, metadata, created_at)
                VALUES
                  ('sa_seed_workspace_provisioned', %s, 'workspace.provisioned', 'success', '127.0.0.1',
                   'MIRAIWERK seed script', %s::jsonb, now() - interval '1 day'),
                  ('sa_seed_role_updated', %s, 'workspace.member_role_changed', 'success', '127.0.0.1',
                   'MIRAIWERK seed script', %s::jsonb, now() - interval '20 hours'),
                  ('sa_seed_release_review', %s, 'project.reviewed', 'success', '127.0.0.1',
                   'MIRAIWERK seed script', %s::jsonb, now() - interval '2 hours')
                ON CONFLICT (id) DO NOTHING
                """,
                [
                    MAYA,
                    json.dumps({"workspaceId": workspace_id, "projectId": project_id}),
                    MAYA,
                    json.dumps({"workspaceId": workspace_id, "member": "Lena Ortiz", "role": "member"}),
                    ARJUN,
                    json.dumps({"workspaceId": workspace_id, "projectId": project_id, "decision": "split"}),
                ],
            )
