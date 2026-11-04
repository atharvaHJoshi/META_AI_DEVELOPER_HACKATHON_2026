# Migration to give product tables database-level defaults.
#
# The original Express service issued raw INSERT statements that relied on the
# schema providing defaults; when the schema was rebuilt with Django migrations
# those happened only in Python. This migration adds the defaults back at the
# database level, so both ORM and raw SQL inserts behave the same.

from django.db import migrations

DEFAULTS = {
    "users": {
        "avatar_color": "'#5B6CFF'",
        "status": "'active'",
        "is_platform_admin": "false",
        "is_staff": "false",
        "locale": "'en'",
        "timezone": "'UTC'",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "organizations": {
        "description": "''",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "organization_members": {
        "role": "'member'",
        "created_at": "now()",
    },
    "workspaces": {
        "description": "''",
        "onboarding_stage": "1",
        "onboarding_json": "'{}'::jsonb",
        "ai_context_json": "'{}'::jsonb",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "workspace_members": {
        "role": "'member'",
        "created_at": "now()",
    },
    "sessions": {
        "user_agent": "''",
        "created_at": "now()",
        "last_used_at": "now()",
    },
    "oauth_accounts": {
        "created_at": "now()",
    },
    "one_time_tokens": {
        "created_at": "now()",
    },
    "security_audit": {
        "metadata": "'{}'::jsonb",
        "created_at": "now()",
    },
    "projects": {
        "description": "''",
        "goal": "''",
        "status": "'active'",
        "constraints_json": "'{}'::jsonb",
        "current_plan_version": "1",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "plan_versions": {
        "snapshot_json": "'{}'::jsonb",
        "change_summary": "''",
        "created_at": "now()",
    },
    "requirements": {
        "description": "''",
        "acceptance_criteria": "'[]'::jsonb",
        "source": "'generated'",
        "status": "'confirmed'",
        "created_at": "now()",
    },
    "milestones": {
        "description": "''",
        "release_gate": "false",
        "status": "'planned'",
        "position": "0",
    },
    "tasks": {
        "description": "''",
        "status": "'planned'",
        "priority": "'P2'",
        "owner_role": "'Engineering'",
        "labels_json": "'[]'::jsonb",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "task_dependencies": {
        "dependency_type": "'finishes_to_start'",
    },
    "tickets": {
        "description": "''",
        "source": "'manual'",
        "affected_component": "''",
        "reported_impact": "''",
        "evidence": "''",
        "reporter": "''",
        "environment": "''",
        "severity_reported": "'unspecified'",
        "status": "'new'",
        "created_at": "now()",
    },
    "ticket_links": {
        "evidence_state": "'inferred'",
        "confirmed": "false",
        "created_at": "now()",
    },
    "decision_proposals": {
        "summary": "''",
        "classification_json": "'{}'::jsonb",
        "policy_json": "'{}'::jsonb",
        "evidence_json": "'[]'::jsonb",
        "unknowns_json": "'[]'::jsonb",
        "clarifying_questions_json": "'[]'::jsonb",
        "related_records_json": "'[]'::jsonb",
        "duplicate_candidates_json": "'[]'::jsonb",
        "proposed_changes_json": "'{}'::jsonb",
        "recommendation_rationale": "''",
        "status": "'pending'",
        "model_provider": "'deterministic-demo'",
        "model_name": "''",
        "created_at": "now()",
    },
    "scenario_runs": {
        "label": "''",
        "output_json": "'{}'::jsonb",
        "valid": "false",
        "validation_errors_json": "'[]'::jsonb",
        "created_at": "now()",
    },
    "decision_audit": {
        "reason": "''",
        "timestamp": "now()",
    },
    "audit_events": {
        "summary": "''",
        "timestamp": "now()",
    },
    "ai_calls": {
        "model": "''",
        "duration_ms": "0",
        "success": "false",
        "degraded": "false",
        "created_at": "now()",
    },
    "teams": {
        "description": "''",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "documents": {
        "content": "''",
        "doc_type": "'markdown'",
        "status": "'draft'",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "meetings": {
        "notes": "''",
        "duration_minutes": "30",
        "status": "'scheduled'",
        "summary": "''",
        "action_items_json": "'[]'::jsonb",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "forum_threads": {
        "body": "''",
        "category": "'general'",
        "solved": "false",
        "created_at": "now()",
        "updated_at": "now()",
    },
    "forum_replies": {
        "created_at": "now()",
    },
}


def make_forward(defaults):
    statements = [
        f"ALTER TABLE {table} ALTER COLUMN {column} SET DEFAULT {default};"
        for table, columns in defaults.items()
        for column, default in columns.items()
    ]
    return migrations.RunSQL(
        sql=statements,
        reverse_sql=[
            f"ALTER TABLE {table} ALTER COLUMN {column} DROP DEFAULT;"
            for table, columns in defaults.items()
            for column in columns
        ],
    )


class Migration(migrations.Migration):
    dependencies = [
        ("platform_app", "0001_initial"),
    ]

    operations = [
        make_forward(DEFAULTS),
    ]
